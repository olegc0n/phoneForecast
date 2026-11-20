package com.lili.wallpaper;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The WebView every LiliView shows, set up once, here.
 *
 * Unlike the informer's, this page never makes a request: it loads its one
 * asset and nothing else, so none of the file-access settings MainActivity
 * needs for its XHR are turned on. Assets load without them.
 *
 * The background is transparent: the backdrop (a preset or the user's photo)
 * is drawn natively, underneath.
 *
 * The renderer may be reclaimed while the wallpaper is hidden
 * (RENDERER_PRIORITY_BOUND, waived when not visible). onRenderProcessGone then
 * MUST return true and the WebView must be dropped: returning false makes
 * Android kill the whole wallpaper process.
 *
 * The bridge keeps the informer's name, window.PhoneForecast, because the
 * shared host.js detects exactly that. Methods: host(), sdk(), config(), and
 * stillReady(json), which only the page in still mode (#still=1, the
 * lock-screen picture) calls, once, when she has posed and the page is frozen.
 */
final class LiliWeb {

    static final String TAG = "Lili";
    static final String PAGE = "file:///android_asset/wallpaper.html";

    /** What the owner of a WebView hears from it, on the main thread - and the one thing it is asked. */
    interface Callbacks {
        void pageFinished(WebView web);
        void rendererGone(WebView web);
        /** still mode: she is posed and nothing on the page will move again */
        void stillReady(WebView web, String state);
        /** Her size and height for the page's boot config, {"size":60,"lift":22}: the applied
         *  ones, or a draft's in the preview. Asked on the JavaBridge thread, not the main one. */
        String config();
    }

    private LiliWeb() {}

    /** May throw: a WebView cannot be created while its package is updating. */
    static WebView create(Context context, final Callbacks callbacks) {
        WebView web = new WebView(context);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          /* the shuffle's history of what she has shown */
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);                    /* ignore the system font-size setting */

        web.setBackgroundColor(Color.TRANSPARENT);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        if (Build.VERSION.SDK_INT >= 26) {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_BOUND, true);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "[LIFE] onPageFinished " + url);
                super.onPageFinished(view, url);
                if (callbacks != null && url != null && url.startsWith(PAGE)) callbacks.pageFinished(view);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "[LIFE] renderer gone, crashed=" + (detail != null && detail.didCrash()));
                /* now, not posted: the WebView is unusable from this moment, and
                 * nothing may call into it before it is dropped */
                if (callbacks != null) callbacks.rendererGone(view);
                return true;
            }
        });
        /* the page's console goes to logcat: adb logcat -s Lili */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(context.getApplicationContext(), web, callbacks), "PhoneForecast");
        return web;
    }

    /** Everything a WebView holds, let go of. Safe to call on a half-built one. */
    static void destroy(WebView web) {
        if (web == null) return;
        try {
            ViewParent parent = web.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(web);
        } catch (Exception ignored) {}
        try { web.stopLoading(); } catch (Exception ignored) {}
        try { web.loadUrl("about:blank"); } catch (Exception ignored) {}
        try { web.removeJavascriptInterface("PhoneForecast"); } catch (Exception ignored) {}
        try { web.destroy(); } catch (Exception ignored) {}
        Log.i(TAG, "[LIFE] WebView destroyed");
    }

    /** The page, plus #ep=<id> to play one named animation first. */
    static String url(String ep) {
        if (ep != null && ep.matches("[a-z0-9_]+")) return PAGE + "#ep=" + ep;
        return PAGE;
    }

    /** The page in still mode: one calm pose, then frozen - the lock-screen picture. */
    static String stillUrl() {
        return PAGE + "#still=1";
    }

    private static final class Bridge {
        private final Context context;
        private final WebView web;
        private final Callbacks callbacks;
        private final Handler main = new Handler(Looper.getMainLooper());

        Bridge(Context context, WebView web, Callbacks callbacks) {
            this.context = context;
            this.web = web;
            this.callbacks = callbacks;
        }

        /** Called on the JavaBridge thread; the owner hears it on the main thread. */
        @JavascriptInterface
        public void stillReady(final String state) {
            if (callbacks == null) return;
            main.post(new Runnable() {
                public void run() { callbacks.stillReady(web, state); }
            });
        }

        @JavascriptInterface
        public String host() {
            return "android";
        }

        @JavascriptInterface
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }

        /** her size and height, read once at boot: {"size":60,"lift":22} - the owner says which */
        @JavascriptInterface
        public String config() {
            return callbacks != null ? callbacks.config() : Prefs.pageConfig(context);
        }
    }
}
