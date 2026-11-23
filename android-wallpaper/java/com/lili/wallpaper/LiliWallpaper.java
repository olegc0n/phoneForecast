package com.lili.wallpaper;

import android.app.Presentation;
import android.app.WallpaperColors;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.Window;
import android.view.WindowManager;

/**
 * Lili as a live wallpaper.
 *
 * A wallpaper engine only gets a bare Surface, and a WebView cannot be added to
 * one. So each engine creates a private VirtualDisplay that renders straight
 * into the wallpaper's surface, and shows a Presentation (a dialog that lives
 * on that display) holding a LiliView: the backdrop with the transparent
 * WebView over it. Whatever they draw lands on the wallpaper.
 *
 * Each engine (the picker's preview, the home screen, the lock screen where it
 * is separate) has its own display, presentation, WebView and page. They share
 * the prefs, the decoded photo and localStorage.
 *
 * A new surface size rebuilds everything, 150 ms later and debounced, rather
 * than resizing the virtual display: a Presentation dismisses itself when its
 * display's metrics change on older Android, and a rebuild is the path that has
 * to work anyway. The page reloads and she starts a fresh animation.
 *
 * Never blank: (1) presentation with backdrop and WebView; (2) no WebView, the
 * backdrop alone (LiliView retries); (3) no display or presentation: torn down,
 * and the backdrop drawn straight onto the surface with lockCanvas - until the
 * surface is recreated, because a surface once locked for software drawing
 * cannot go back to a hardware producer.
 *
 * Touch is off: she does not react to it yet.
 *
 * Real weather: an engine coming into view asks Forecast for a new forecast
 * (fetched only if the one kept is over 2 h old and the policy allows it), and
 * a new engine makes sure the 3-hourly WeatherJob is there while weather is on.
 *
 * Chroma mode (CaptureActivity taking the real home screen): the engine's
 * LiliView turns magenta by itself; drawn flat (level 3), the engine draws
 * Chroma.KEY itself.
 */
public class LiliWallpaper extends WallpaperService {

    private static final String TAG = LiliWeb.TAG;
    private static int engines = 0;

    @Override
    public Engine onCreateEngine() {
        return new LiliEngine();
    }

    private final class LiliEngine extends Engine implements SharedPreferences.OnSharedPreferenceChangeListener, Chroma.Listener {

        private final int id = ++engines;
        private final Handler main = new Handler(Looper.getMainLooper());
        private SharedPreferences prefs;

        private SurfaceHolder holder;
        private VirtualDisplay display;
        private Presentation presentation;
        private LiliView view;           /* a strong reference: it is a prefs listener */
        private boolean visible;
        private boolean flat;            /* level 3: the backdrop drawn straight onto the surface */
        private int builtW, builtH;      /* the size the current build is for */
        private int wantW, wantH;        /* the size of the surface now */

        private final Runnable rebuildNow = new Runnable() {
            public void run() { rebuild(); }
        };

        /* A new backdrop: redraw it if it is drawn flat, and tell the system its
         * colours changed - once per Apply, however many bg_* keys it changed. */
        private final Runnable backdropChanged = new Runnable() {
            public void run() {
                if (flat) drawFlat();
                if (Build.VERSION.SDK_INT >= 27) {
                    try { notifyColorsChanged(); } catch (Throwable t) { Log.w(TAG, "[WALL " + id + "] notifyColorsChanged", t); }
                }
            }
        };

        private void log(String s) {
            Log.i(TAG, "[WALL " + id + "] " + s);
        }

        @Override
        public void onCreate(SurfaceHolder h) {
            super.onCreate(h);
            setTouchEventsEnabled(false);
            prefs = Prefs.of(LiliWallpaper.this);
            prefs.registerOnSharedPreferenceChangeListener(this);
            Chroma.listen(this);
            Forecast.ensureJob(LiliWallpaper.this);
            log("created preview=" + isPreview() + " sdk " + Build.VERSION.SDK_INT);
        }

        @Override
        public void onSurfaceCreated(SurfaceHolder h) {
            super.onSurfaceCreated(h);
            holder = h;
            flat = false;
            log("surface created preview=" + isPreview());
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder h, int format, int width, int height) {
            super.onSurfaceChanged(h, format, width, height);
            holder = h;
            wantW = width;
            wantH = height;
            log("surface " + width + "x" + height + " preview=" + isPreview() + (flat ? " (flat)" : ""));
            if (flat) { drawFlat(); return; }
            if (display == null && presentation == null) { build(); return; }
            if (width == builtW && height == builtH) return;
            main.removeCallbacks(rebuildNow);
            main.postDelayed(rebuildNow, 150);
        }

        @Override
        public void onVisibilityChanged(boolean on) {
            super.onVisibilityChanged(on);
            visible = on;
            if (on) Forecast.visible(LiliWallpaper.this);   /* only if the forecast is over 2 h old, and allowed */
            log("visible=" + on + " preview=" + isPreview() + " " + builtW + "x" + builtH +
                (flat ? " flat" : view == null ? " no view" : view.hasWeb() ? "" : " no WebView"));
            if (view == null) return;
            view.setShown(on);
            if (on) {
                main.post(new Runnable() {
                    public void run() {
                        if (view != null) log("hardware accelerated=" + view.isHardwareAccelerated());
                    }
                });
            }
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder h) {
            log("surface destroyed");
            teardown();
            holder = null;
            super.onSurfaceDestroyed(h);
        }

        @Override
        public void onDestroy() {
            log("destroyed");
            teardown();
            main.removeCallbacks(backdropChanged);
            if (prefs != null) prefs.unregisterOnSharedPreferenceChangeListener(this);
            Chroma.unlisten(this);
            super.onDestroy();
        }

        /** Chroma mode: the LiliView handles itself; drawn flat, the engine redraws. */
        @Override
        public void chroma(boolean on) {
            if (flat) drawFlat();
        }

        /** API 27+: the platform derives Material You colours and the dark-text hint from these. */
        @Override
        public WallpaperColors onComputeColors() {
            if (Build.VERSION.SDK_INT < 27) return null;
            try {
                return Backdrop.colors(LiliWallpaper.this);
            } catch (Throwable t) {
                Log.w(TAG, "[WALL " + id + "] no colours", t);
                return null;
            }
        }

        /** A new backdrop applied (the settings screen's Apply), or My wallpaper kept (it may be the default look). */
        @Override
        public void onSharedPreferenceChanged(SharedPreferences p, String key) {
            if (key == null || !(key.startsWith("bg_") || Prefs.ORIG_AT.equals(key))) return;
            main.removeCallbacks(backdropChanged);
            main.post(backdropChanged);
        }

        private void build() {
            if (holder == null || wantW <= 0 || wantH <= 0) return;
            Surface surface = holder.getSurface();
            if (surface == null || !surface.isValid()) return;
            try {
                int dpi = getResources().getDisplayMetrics().densityDpi;
                DisplayManager dm = (DisplayManager) getSystemService(DISPLAY_SERVICE);
                display = dm.createVirtualDisplay("lili-wallpaper-" + id, wantW, wantH, dpi, surface, 0);
                if (display == null) throw new IllegalStateException("createVirtualDisplay returned null");
                final Presentation p = new Presentation(LiliWallpaper.this, display.getDisplay());
                presentation = p;
                Window win = p.getWindow();
                if (win != null) {
                    win.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                               | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
                }
                p.setOnDismissListener(new DialogInterface.OnDismissListener() {
                    public void onDismiss(DialogInterface d) {
                        if (p != presentation) return;          /* we dismissed it ourselves */
                        log("presentation dismissed by the system - rebuilding");
                        main.removeCallbacks(rebuildNow);
                        main.postDelayed(rebuildNow, 150);
                    }
                });
                view = new LiliView(p.getContext(), null);
                p.setContentView(view);
                p.show();
                builtW = wantW;
                builtH = wantH;
                view.setShown(visible || isVisible());
                log("built " + builtW + "x" + builtH + " dpi " + dpi + " preview=" + isPreview() +
                    " WebView=" + view.hasWeb());
            } catch (Throwable t) {
                Log.e(TAG, "[WALL " + id + "] could not build - drawing the backdrop flat", t);
                teardown();
                flat = true;
                drawFlat();
            }
        }

        private void rebuild() {
            log("rebuild for " + wantW + "x" + wantH);
            teardown();
            if (!flat) build();
        }

        /** Idempotent: dismiss the presentation, destroy the WebView, release the display. */
        private void teardown() {
            main.removeCallbacks(rebuildNow);
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
            builtW = builtH = 0;
        }

        /** Level 3: the backdrop, drawn in software straight onto the surface. */
        private void drawFlat() {
            if (holder == null) return;
            Canvas c = null;
            try {
                c = holder.lockCanvas();
                if (c != null && Chroma.on()) c.drawColor(Chroma.KEY);
                else if (c != null) Backdrop.draw(c, c.getWidth(), c.getHeight(), LiliWallpaper.this);
            } catch (Throwable t) {
                Log.w(TAG, "[WALL " + id + "] could not draw flat", t);
            } finally {
                if (c != null) {
                    try { holder.unlockCanvasAndPost(c); } catch (Throwable ignored) {}
                }
            }
            log("drew the backdrop flat");
        }
    }
}
