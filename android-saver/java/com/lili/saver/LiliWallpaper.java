package com.lili.saver;

import android.app.Presentation;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.service.wallpaper.WallpaperService;
import android.util.Log;
import android.view.SurfaceHolder;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * SPIKE: Lili as a live wallpaper.
 *
 * A wallpaper engine only gets a bare Surface, and a WebView cannot be added to
 * one. So the engine creates a private VirtualDisplay that renders straight into
 * the wallpaper's surface, and shows a Presentation (a dialog that lives on that
 * display) holding the WebView. Whatever the WebView draws lands on the
 * wallpaper.
 *
 * Throwaway proof of feasibility: the clock is hidden and the background
 * recoloured from outside the page, and timers are not paused when the
 * wallpaper is hidden (pauseTimers() is process-wide, and the picker's preview
 * engine runs in this same process).
 */
public class LiliWallpaper extends WallpaperService {

    private static final String TAG = LiliWeb.TAG;

    @Override
    public Engine onCreateEngine() {
        return new LiliEngine();
    }

    private final class LiliEngine extends Engine {

        private VirtualDisplay display;
        private Presentation presentation;
        private WebView web;

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
            super.onSurfaceChanged(holder, format, width, height);
            int dpi = getResources().getDisplayMetrics().densityDpi;
            Log.i(TAG, "[WALL] surface " + width + "x" + height + " dpi " + dpi + " preview=" + isPreview());
            try {
                if (display == null) {
                    DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
                    display = dm.createVirtualDisplay("lili-wallpaper", width, height, dpi, holder.getSurface(), 0);
                    presentation = new Presentation(LiliWallpaper.this, display.getDisplay());
                    web = LiliWeb.create(presentation.getContext(), null);
                    web.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView v, String url) {
                            Log.i(TAG, "[WALL] page finished");
                            v.evaluateJavascript(
                                "(function(){var c=document.getElementById('sv_clock');" +
                                "if(c)c.style.display='none';" +
                                "document.documentElement.style.background='#1d2b44';" +
                                "document.body.style.background='#1d2b44';})()", null);
                        }
                    });
                    presentation.setContentView(web);
                    presentation.show();
                    web.loadUrl(LiliWeb.url(null));
                } else {
                    display.resize(width, height, dpi);
                    display.setSurface(holder.getSurface());
                }
            } catch (Throwable t) {
                Log.e(TAG, "[WALL] could not start", t);
                release();
            }
        }

        @Override
        public void onVisibilityChanged(boolean visible) {
            Log.i(TAG, "[WALL] visible=" + visible + " preview=" + isPreview());
            if (web == null) return;
            if (visible) web.onResume(); else web.onPause();
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            Log.i(TAG, "[WALL] surface destroyed");
            release();
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onDestroy() {
            release();
            super.onDestroy();
        }

        private void release() {
            if (presentation != null) {
                try { presentation.dismiss(); } catch (Exception ignored) {}
                presentation = null;
            }
            LiliWeb.destroy(web);
            web = null;
            if (display != null) {
                display.release();
                display = null;
            }
        }
    }
}
