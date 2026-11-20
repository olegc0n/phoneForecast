package com.lili.wallpaper;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.widget.Toast;

/**
 * Captures the user's real home screen for the preview's icons layer
 * ("Use my real home screen"), with Lili cut out.
 *
 * Transparent and without any view, in a task of its own (its own
 * taskAffinity; started with NEW_TASK | MULTIPLE_TASK, not in recents). The
 * preview starts it and then moves its own task (settings and preview) to the
 * back, so what shows behind this window is the launcher, with Lili as its
 * wallpaper. Then:
 *
 *   1. MediaProjectionManager.createScreenCaptureIntent(): the user agrees (on
 *      Android 14+ they must choose "Entire screen"; a toast says so first).
 *   2. API 29+: CaptureService into the foreground (type mediaProjection), and
 *      only then getMediaProjection(). Its Callback is registered before the
 *      virtual display is made (Android 14 requires it).
 *   3. Chroma mode on: every live wallpaper draws solid magenta, Lili hidden.
 *      The 5 s safety timeout starts with the consent; SETTLE_MS for the home
 *      screen to repaint and the consent dialog to animate away.
 *   4. A VirtualDisplay mirroring the screen onto an ImageReader at the real
 *      screen size; the latest frame FRAME_MS later. Then release(): the
 *      display, the reader, the projection, the service - and chroma mode off,
 *      in a finally, whatever went wrong (group I checks it).
 *   5. Keyer cuts the magenta out (soft edges), on a worker thread. Too little
 *      magenta (a single app was chosen, the wallpaper was not on screen) is a
 *      failure. Saved as files/homescreen.png with the screen size (HomeShot).
 *   6. The preview's task back to the front (ActivityManager.getAppTasks(),
 *      AppTask.moveToFront(): our own tasks need no permission), and this
 *      activity gone. The preview reloads its icons layer in onResume.
 * Any failure - consent denied, a single app, nothing keyed out, a timeout -
 * ends chroma mode, toasts why, and goes back; the drawn icons stay.
 */
public class CaptureActivity extends Activity {

    private static final String TAG = LiliWeb.TAG;

    /** The preview's task id, to bring back to the front when done. */
    static final String EXTRA_TASK = "com.lili.wallpaper.TASK";

    private static final int REQ_CONSENT = 1;
    static final long SETTLE_MS = 700;      /* chroma on -> the home screen repainted, the consent dialog gone */
    static final long FRAME_MS = 400;       /* the virtual display's first frames */
    private static final long RETRY_MS = 100;
    private static final int RETRIES = 15;
    static final long SAFETY_MS = 5000;     /* consent -> chroma off, whatever happens */
    private static final float MIN_KEYED = 0.10f;   /* less background than this: not the home screen */

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjectionManager mpm;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private Toast hint;
    private boolean serviceAsked;   /* CaptureService.start() called */
    private boolean serviceOn;      /* ...and it is in the foreground */
    private boolean ended;          /* release()d: nothing more is captured */
    private boolean leaving;        /* back() called */
    private int tries;

    /* the system (or the user, from the status bar) stopped the projection */
    private final MediaProjection.Callback stopped = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            if (!ended) fail(getString(R.string.capture_failed, "stopped"));
        }
    };

    private final Runnable safety = new Runnable() {
        public void run() { fail(getString(R.string.capture_failed, "timed out")); }
    };
    private final Runnable open = new Runnable() {
        public void run() { open(); }
    };
    private final Runnable take = new Runnable() {
        public void run() { take(); }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Log.i(TAG, "[CAPTURE] start, sdk " + Build.VERSION.SDK_INT);
        if (state != null) {
            /* recreated half-way (it handles config changes itself, so the process went): nothing to go on with */
            ended = true;
            back();
            return;
        }
        mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) {
            fail(getString(R.string.capture_failed, "no screen capture on this phone"));
            return;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            hint = Toast.makeText(getApplicationContext(), R.string.capture_entire_hint, Toast.LENGTH_LONG);
            hint.show();
        }
        try {
            startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CONSENT);
        } catch (Throwable t) {
            fail(getString(R.string.capture_failed, String.valueOf(t)));
        }
    }

    @Override
    protected void onActivityResult(int request, final int result, final Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQ_CONSENT || ended) return;
        if (hint != null) hint.cancel();             /* not in the picture */
        if (result != RESULT_OK || data == null) {
            Log.i(TAG, "[CAPTURE] no consent");
            fail(getString(R.string.capture_denied));
            return;
        }
        main.postDelayed(safety, SAFETY_MS);
        if (Build.VERSION.SDK_INT >= 29) {
            serviceAsked = true;
            CaptureService.start(this, new CaptureService.Started() {
                public void started(String error) {
                    if (error != null) {
                        fail(getString(R.string.capture_failed, error));
                        return;
                    }
                    serviceOn = true;
                    if (ended) {
                        release();
                        return;
                    }
                    project(result, data);
                }
            });
        } else {
            project(result, data);
        }
    }

    private void project(int result, Intent data) {
        if (ended) return;
        try {
            projection = mpm.getMediaProjection(result, data);
            if (projection == null) throw new IllegalStateException("no projection");
            projection.registerCallback(stopped, main);         /* before createVirtualDisplay (Android 14) */
            Chroma.set(true);
            main.postDelayed(open, SETTLE_MS);
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] no projection", t);
            fail(getString(R.string.capture_failed, String.valueOf(t.getMessage())));
        }
    }

    private void open() {
        if (ended) return;
        try {
            Point real = HomeShot.realSize(this);
            DisplayMetrics m = new DisplayMetrics();
            getWindowManager().getDefaultDisplay().getRealMetrics(m);
            reader = ImageReader.newInstance(real.x, real.y, PixelFormat.RGBA_8888, 2);
            display = projection.createVirtualDisplay("lili-capture", real.x, real.y, m.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, main);
            if (display == null) throw new IllegalStateException("createVirtualDisplay returned null");
            Log.i(TAG, "[CAPTURE] mirroring " + real.x + "x" + real.y + " dpi " + m.densityDpi);
            main.postDelayed(take, FRAME_MS);
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] no virtual display", t);
            fail(getString(R.string.capture_failed, String.valueOf(t.getMessage())));
        }
    }

    private void take() {
        if (ended) return;
        Image img = null;
        Bitmap frame;
        try {
            img = reader.acquireLatestImage();
            if (img == null) {
                if (++tries <= RETRIES) {
                    main.postDelayed(take, RETRY_MS);
                    return;
                }
                throw new IllegalStateException("no frame from the screen");
            }
            frame = LockPicture.copy(img);
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] no frame", t);
            fail(getString(R.string.capture_failed, String.valueOf(t.getMessage())));
            return;
        } finally {
            if (img != null) img.close();
        }
        Log.i(TAG, "[CAPTURE] frame " + frame.getWidth() + "x" + frame.getHeight() + " after " + tries + " retries");
        release();                                  /* chroma off before anything slow */
        process(frame);
    }

    /* Keyed and saved on a worker thread; then back to the preview. */
    private void process(final Bitmap frame) {
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            public void run() {
                String error = null;
                boolean nothing = false;
                try {
                    int w = frame.getWidth(), h = frame.getHeight();
                    int[] px = new int[w * h];
                    frame.getPixels(px, 0, w, 0, 0, w, h);
                    frame.recycle();
                    int keyed = Keyer.key(px, w, h);
                    Log.i(TAG, "[CAPTURE] keyed " + keyed + " of " + (w * h) + " pixels");
                    if (keyed < MIN_KEYED * w * h) {
                        nothing = true;
                    } else {
                        Bitmap out = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888);
                        try {
                            HomeShot.save(app, out);
                        } finally {
                            out.recycle();
                        }
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "[CAPTURE] could not key or save", t);
                    error = String.valueOf(t.getMessage());
                }
                final String why = error;
                final boolean none = nothing;
                main.post(new Runnable() {
                    public void run() {
                        toast(why != null ? getString(R.string.capture_failed, why)
                            : none ? getString(R.string.capture_nothing) : getString(R.string.capture_done));
                        back();
                    }
                });
            }
        }, "lili-capture").start();
    }

    private void fail(String message) {
        if (leaving) return;
        Log.w(TAG, "[CAPTURE] failed: " + message);
        release();
        toast(message);
        back();
    }

    /**
     * Everything the capture holds, let go of: the display, the reader, the
     * projection, the service. Chroma mode always ends here, in the finally.
     * Idempotent.
     */
    private void release() {
        ended = true;
        main.removeCallbacks(safety);
        main.removeCallbacks(open);
        main.removeCallbacks(take);
        try {
            if (display != null) {
                try { display.release(); } catch (Throwable ignored) {}
                display = null;
            }
            if (reader != null) {
                try { reader.close(); } catch (Throwable ignored) {}
                reader = null;
            }
            if (projection != null) {
                try { projection.unregisterCallback(stopped); } catch (Throwable ignored) {}
                try { projection.stop(); } catch (Throwable ignored) {}
                projection = null;
            }
            if (serviceOn) {
                CaptureService.stop(this);
                serviceOn = false;
            } else if (serviceAsked) {
                CaptureService.abandon();
            }
        } finally {
            Chroma.set(false);
        }
    }

    /** The preview's task back in front (our own task: no permission needed), and this one gone. */
    private void back() {
        if (leaving) return;
        leaving = true;
        int task = getIntent() != null ? getIntent().getIntExtra(EXTRA_TASK, -1) : -1;
        boolean found = false;
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                for (ActivityManager.AppTask t : am.getAppTasks()) {
                    if (taskId(t) == task) {
                        t.moveToFront();
                        found = true;
                        break;
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] could not bring the preview back", t);
        }
        Log.i(TAG, "[CAPTURE] back to the preview: " + (found ? "yes" : "its task is gone"));
        finish();
        overridePendingTransition(0, 0);
    }

    @SuppressWarnings("deprecation")
    private static int taskId(ActivityManager.AppTask t) {
        ActivityManager.RecentTaskInfo info = t.getTaskInfo();
        return Build.VERSION.SDK_INT >= 29 ? info.taskId : info.id;
    }

    private void toast(String s) {
        Toast.makeText(getApplicationContext(), s, Toast.LENGTH_LONG).show();
    }

    @Override
    public void onBackPressed() {
        fail(getString(R.string.capture_denied));
    }

    @Override
    protected void onDestroy() {
        if (!ended) release();
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
