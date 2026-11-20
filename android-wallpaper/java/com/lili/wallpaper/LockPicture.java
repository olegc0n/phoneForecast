package com.lili.wallpaper;

import android.app.Presentation;
import android.app.WallpaperManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * Lili on the lock screen, as a still picture.
 *
 * BLOCKED in this version: nothing turns lock mode on any more (the Lock screen
 * switch can only be turned off; docs/WALLPAPER.md section 8 says why). This
 * stays in the tree, working, for a phone that still has lock mode on from an
 * earlier build - its picture is kept fresh until the switch is turned off -
 * and so that the feature can come back: turning it on was Backup of the lock
 * screen, then Prefs.LOCK_ON true with LOCK_ID 0, LockJob.schedule and
 * request(context, false, callback).
 *
 * No public API puts a live wallpaper on the lock screen alone, and Huawei and
 * Samsung never show a third-party live wallpaper there at all. Any app with
 * SET_WALLPAPER may set a picture for the lock screen only, though:
 * setBitmap(bmp, null, true, FLAG_LOCK), API 24+. So this renders her once,
 * offscreen, and sets that.
 *
 * The render is the wallpaper's own: a private VirtualDisplay (flags 0, as in
 * LiliWallpaper) - here on an ImageReader's surface, at the real screen size,
 * portrait - and a Presentation on it holding a LiliView.still(): the same
 * native backdrop, the same page in still mode (#still=1, src/wallpaper/
 * still.js), her size and height from the bridge's config(). The page poses
 * her, freezes itself and calls PhoneForecast.stillReady(); SETTLE_MS later
 * the latest frame is copied into a Bitmap (minding rowStride padding),
 * everything is torn down, and the Bitmap is set on a worker thread.
 *
 * One render at a time. A request while one is in flight is folded into one
 * more render after it. The offscreen render is torn down within TIMEOUT_MS,
 * so a page that never says ready leaves nothing alive; setBitmap then has
 * SET_TIMEOUT_MS before the render is given up on. Every wallpaper write
 * holds Backup.WRITE, so a restore never interleaves with it. Callbacks always
 * arrive posted to the main thread, never from inside request().
 *
 * An "auto" render (the 3-hourly job, a settings change) first checks that the
 * lock screen still shows the picture we set (getWallpaperId(FLAG_LOCK) equals
 * the one we stored). If the user has put something else there, it is not
 * overwritten: lock mode is turned off, and the settings screen says why.
 */
final class LockPicture {

    /** The outcome, on the main thread. */
    interface Done {
        void done(boolean ok, String detail);
    }

    private static final String TAG = LiliWeb.TAG;
    static final long TIMEOUT_MS = 8000;
    private static final long SET_TIMEOUT_MS = 20000;  /* setBitmap encodes a full-screen PNG */
    private static final long SETTLE_MS = 600;       /* after stillReady: the compositor's last frame */
    private static final long RETRY_MS = 200;
    private static final int RETRIES = 8;
    private static final long DEBOUNCE_MS = 1000;

    /* what is on the lock screen, as far as an app can tell */
    static final int LOCK_UNSUPPORTED = 0, LOCK_OURS = 1, LOCK_MIRROR = 2, LOCK_OTHER = 3;

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static LockPicture current;              /* the render in flight */
    private static boolean again;                    /* one more after it */
    private static boolean againAuto = true;         /* ...and whether all who asked for it were automatic */
    private static final List<Done> waiting = new ArrayList<Done>();
    private static Context soonContext;
    private static final Runnable soon = new Runnable() {
        public void run() { if (soonContext != null) request(soonContext, true, null); }
    };

    static boolean supported() {
        return Build.VERSION.SDK_INT >= 24;
    }

    /** A render in flight or queued. */
    static boolean busy() {
        return current != null || again;
    }

    /**
     * Render and set the picture now (main thread). auto: nobody asked for this
     * one just now, so a lock screen the user changed is left alone.
     */
    static void request(Context context, boolean auto, Done cb) {
        main.removeCallbacks(soon);
        Context app = context.getApplicationContext();
        if (current != null) {
            again = true;
            againAuto = againAuto && auto;
            if (cb != null) waiting.add(cb);
            Log.i(TAG, "[LOCK] a render is in flight - one more follows it");
            return;
        }
        List<Done> cbs = new ArrayList<Done>();
        if (cb != null) cbs.add(cb);
        current = new LockPicture(app, auto, cbs);
        current.start();
    }

    /** The background, her size or height changed: render again once they settle. */
    static void requestSoon(Context context) {
        soonContext = context.getApplicationContext();
        main.removeCallbacks(soon);
        main.postDelayed(soon, DEBOUNCE_MS);
    }

    /** Stop whatever is in flight or queued (lock mode off, the job stopped). */
    static void cancel(final String why) {
        main.removeCallbacks(soon);
        again = false;
        againAuto = true;
        final List<Done> dropped = new ArrayList<Done>(waiting);
        waiting.clear();
        for (final Done cb : dropped) {
            main.post(new Runnable() { public void run() { cb.done(false, "cancelled: " + why); } });
        }
        if (current != null) current.fail("cancelled: " + why);
    }

    /* ---- the lock screen's state ---- */

    /** Ours (the picture we set last), the home wallpaper mirrored, or something else. */
    static int lockState(Context context) {
        if (!supported()) return LOCK_UNSUPPORTED;
        try {
            int id = WallpaperManager.getInstance(context).getWallpaperId(WallpaperManager.FLAG_LOCK);
            int ours = Prefs.of(context).getInt(Prefs.LOCK_ID, 0);
            if (ours > 0 && id == ours) return LOCK_OURS;
            if (id < 0) return LOCK_MIRROR;
            return LOCK_OTHER;
        } catch (Throwable t) {
            Log.w(TAG, "[LOCK] getWallpaperId failed", t);
            return LOCK_OTHER;
        }
    }

    /**
     * True when we set a picture and the lock screen no longer shows it. False
     * when we cannot tell (nothing stored, the call failed): then a refresh goes
     * ahead.
     */
    static boolean changedByUser(Context context) {
        if (!supported()) return false;
        int ours = Prefs.of(context).getInt(Prefs.LOCK_ID, 0);
        if (ours <= 0) return false;
        try {
            int id = WallpaperManager.getInstance(context).getWallpaperId(WallpaperManager.FLAG_LOCK);
            if (id != ours) Log.i(TAG, "[LOCK] the lock wallpaper is " + id + ", ours was " + ours);
            return id != ours;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Lili leaves the lock screen by herself: lock mode off, the job stops, the note says why ("" = no note). */
    static void turnOff(Context context, String note) {
        SharedPreferences p = Prefs.of(context);
        p.edit().putBoolean(Prefs.LOCK_ON, false).putString(Prefs.LOCK_NOTE, note).apply();
        LockJob.cancel(context);
        Log.i(TAG, "[LOCK] lock mode turned off: '" + note + "'");
    }

    /* ---- one render ---- */

    private final Context app;
    private final boolean auto;
    private final List<Done> callbacks;
    private final long started = SystemClock.elapsedRealtime();
    private boolean finished;

    private ImageReader reader;
    private VirtualDisplay display;
    private Presentation presentation;
    private LiliView view;                /* a strong reference, though a still view listens to nothing */
    private Image latest;
    private int frames;
    private int tries;

    private final Runnable timeout = new Runnable() {
        public void run() { fail("timed out after " + ms() + " ms, " + frames + " frames"); }
    };
    private final Runnable capture = new Runnable() {
        public void run() { capture(); }
    };

    private LockPicture(Context app, boolean auto, List<Done> callbacks) {
        this.app = app;
        this.auto = auto;
        this.callbacks = callbacks;
    }

    private long ms() {
        return SystemClock.elapsedRealtime() - started;
    }

    private void start() {
        if (!supported()) { finish(false, "needs Android 7.0 (API 24)"); return; }
        if (!Prefs.lockOn(Prefs.of(app))) {
            LockJob.cancel(app);
            finish(false, "lock mode is off");
            return;
        }
        if (auto && changedByUser(app)) {
            turnOff(app, Prefs.NOTE_CHANGED);
            finish(false, "the lock screen was changed outside Lili - lock mode turned off");
            return;
        }
        Log.i(TAG, "[LOCK] render" + (auto ? " (auto)" : ""));
        main.postDelayed(timeout, TIMEOUT_MS);
        try {
            build();
        } catch (Throwable t) {
            Log.w(TAG, "[LOCK] could not build the offscreen render", t);
            fail("could not build: " + t);
        }
    }

    private void build() {
        Point real = new Point();
        ((WindowManager) app.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealSize(real);
        int w = Math.min(real.x, real.y), h = Math.max(real.x, real.y);       /* portrait */
        int dpi = app.getResources().getDisplayMetrics().densityDpi;

        /* 3: one image held here, plus the two acquireLatestImage() juggles */
        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3);
        reader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            public void onImageAvailable(ImageReader r) { keepLatest(r); }
        }, main);

        DisplayManager dm = (DisplayManager) app.getSystemService(Context.DISPLAY_SERVICE);
        display = dm.createVirtualDisplay("lili-lock", w, h, dpi, reader.getSurface(), 0);
        if (display == null) throw new IllegalStateException("createVirtualDisplay returned null");

        presentation = new Presentation(app, display.getDisplay());
        Window win = presentation.getWindow();
        if (win != null) {
            win.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                       | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
        }
        view = LiliView.still(presentation.getContext(), new LiliView.StillListener() {
            public void ready(String state) { onReady(state); }
            public void failed(String why) { fail(why); }
        });
        if (!view.hasWeb()) throw new IllegalStateException("no WebView");
        presentation.setContentView(view);
        presentation.show();
        view.setShown(true);
        Log.i(TAG, "[LOCK] offscreen " + w + "x" + h + " dpi " + dpi);
    }

    /* Hold on to the newest frame, so a still page that draws nothing more is
     * still there to take. */
    private void keepLatest(ImageReader r) {
        if (finished || r == null || r != reader) return;     /* nothing after teardown */
        Image img;
        try {
            img = r.acquireLatestImage();
        } catch (Throwable t) {
            Log.w(TAG, "[LOCK] acquireLatestImage: " + t);
            return;
        }
        if (img == null) return;
        if (latest != null) latest.close();
        latest = img;
        frames++;
    }

    private void onReady(String state) {
        if (finished) return;
        int faults = 1;
        try { faults = new JSONObject(state).optInt("faults", 1); } catch (Throwable ignored) {}
        Log.i(TAG, "[LOCK] page still after " + ms() + " ms: " + state);
        if (faults != 0) { fail("the page reported a fault"); return; }
        main.postDelayed(capture, SETTLE_MS);
    }

    private void capture() {
        if (finished) return;
        keepLatest(reader);                       /* a frame not announced yet */
        if (latest == null) {
            if (++tries <= RETRIES) { main.postDelayed(capture, RETRY_MS); return; }
            fail("no frame from the offscreen display");
            return;
        }
        final Bitmap bmp;
        try {
            bmp = copy(latest);
        } catch (Throwable t) {
            Log.w(TAG, "[LOCK] could not copy the frame", t);
            fail("could not copy the frame: " + t);
            return;
        }
        /* the render is done; a setBitmap that never returns must not keep this
         * render "in flight" for ever, or every later request would wait on it */
        main.removeCallbacks(timeout);
        main.postDelayed(timeout, SET_TIMEOUT_MS);
        Log.i(TAG, "[LOCK] captured " + bmp.getWidth() + "x" + bmp.getHeight() + " after " + ms() + " ms, " +
            frames + " frames");
        teardown();                               /* nothing left alive but the bitmap */
        new Thread(new Runnable() {
            public void run() { set(bmp); }
        }, "lili-lock").start();
    }

    /** Worker thread. */
    private void set(Bitmap bmp) {
        String err = null;
        int id = 0, back = 0;
        try {
            /* one wallpaper write at a time: turning the Lock switch off turns
             * lock mode off before its restore starts, so the restore wins either way */
            synchronized (Backup.WRITE) {
                if (!Prefs.lockOn(Prefs.of(app))) {
                    err = "lock mode was turned off meanwhile";
                } else {
                    WallpaperManager wm = WallpaperManager.getInstance(app);
                    id = wm.setBitmap(bmp, null, true, WallpaperManager.FLAG_LOCK);
                    if (id == 0) err = "setBitmap returned 0";
                    else back = wm.getWallpaperId(WallpaperManager.FLAG_LOCK);
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "[LOCK] setBitmap failed", t);
            err = "setBitmap: " + t;
        } finally {
            bmp.recycle();
        }
        final String error = err;
        final int stored = back > 0 ? back : id;
        final int setId = id, readBack = back;
        main.post(new Runnable() {
            public void run() {
                if (finished) return;                 /* cancelled or timed out meanwhile */
                if (error != null) { fail(error); return; }
                Prefs.of(app).edit()
                    .putInt(Prefs.LOCK_ID, stored)
                    .putLong(Prefs.LOCK_AT, System.currentTimeMillis())
                    .putString(Prefs.LOCK_NOTE, "")
                    .apply();
                finish(true, "set, id " + setId + " (reads back " + readBack + ") after " + ms() + " ms");
            }
        });
    }

    private void fail(String why) {
        if (finished) return;
        Log.w(TAG, "[LOCK] failed: " + why);
        finish(false, why);
    }

    private void finish(final boolean ok, final String detail) {
        if (finished) return;
        finished = true;
        main.removeCallbacks(timeout);
        main.removeCallbacks(capture);
        teardown();
        if (ok) Log.i(TAG, "[LOCK] " + detail);
        for (final Done cb : callbacks) {
            main.post(new Runnable() { public void run() { cb.done(ok, detail); } });
        }
        if (current == this) current = null;
        if (again) {
            again = false;
            boolean a = againAuto;
            againAuto = true;
            List<Done> next = new ArrayList<Done>(waiting);
            waiting.clear();
            current = new LockPicture(app, a, next);
            final LockPicture n = current;
            main.post(new Runnable() { public void run() { n.start(); } });
        }
    }

    /** Idempotent: the presentation, the WebView, the display, the frames. */
    private void teardown() {
        Presentation p = presentation;
        presentation = null;
        if (p != null) {
            try { p.dismiss(); } catch (Throwable ignored) {}
        }
        if (view != null) {
            view.destroy();
            view = null;
        }
        if (display != null) {
            try { display.release(); } catch (Throwable ignored) {}
            display = null;
        }
        if (latest != null) {
            try { latest.close(); } catch (Throwable ignored) {}
            latest = null;
        }
        if (reader != null) {
            try { reader.setOnImageAvailableListener(null, null); } catch (Throwable ignored) {}
            try { reader.close(); } catch (Throwable ignored) {}
            reader = null;
        }
    }

    /** RGBA_8888 frame -> ARGB_8888 Bitmap (the same bytes in memory), rows unpadded. */
    private static Bitmap copy(Image img) {
        int w = img.getWidth(), h = img.getHeight();
        Image.Plane plane = img.getPlanes()[0];
        int ps = plane.getPixelStride(), rs = plane.getRowStride();
        if (ps != 4) throw new IllegalStateException("pixel stride " + ps);
        ByteBuffer src = plane.getBuffer();
        src.rewind();
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        if (rs == w * 4 && src.remaining() >= w * h * 4) {
            out.copyPixelsFromBuffer(src);
        } else {
            /* each row is rowStride bytes, of which the first w * 4 are pixels */
            ByteBuffer tight = ByteBuffer.allocate(w * h * 4);
            byte[] row = new byte[w * 4];
            for (int y = 0; y < h; y++) {
                src.position(y * rs);
                src.get(row, 0, row.length);
                tight.put(row);
            }
            tight.rewind();
            out.copyPixelsFromBuffer(tight);
        }
        out.setHasAlpha(false);                  /* the backdrop covers every pixel */
        return out;
    }
}
