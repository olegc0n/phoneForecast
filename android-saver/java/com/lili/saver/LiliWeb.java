package com.lili.saver;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateFormat;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The WebView both the dream and the preview show, set up once, here.
 *
 * Unlike the informer's, this page never makes a request: it loads its one
 * asset and nothing else, so none of the file-access settings MainActivity
 * needs for its XHR are turned on. Assets load without them.
 *
 * The bridge keeps the informer's name, window.PhoneForecast, because the
 * shared host.js detects exactly that. Methods: host(), sdk(), is24h(), and
 * night(on), which the page calls when Lili falls asleep or wakes.
 */
final class LiliWeb {

    static final String TAG = "Lili";
    static final String PAGE = "file:///android_asset/saver.html";

    /** What the page may ask of whoever is showing it. Called on the main thread. */
    interface Listener {
        void night(boolean on);
    }

    private LiliWeb() {}

    /** May throw: a WebView cannot be created while its package is updating. */
    static WebView create(Context context, final Listener listener) {
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

        web.setBackgroundColor(0xFF000000);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "[LIFE] onPageFinished " + url);
                super.onPageFinished(view, url);
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
        web.addJavascriptInterface(new Bridge(context.getApplicationContext(), listener), "PhoneForecast");
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

    private static final class Bridge {
        private final Context context;
        private final Listener listener;
        private final Handler main = new Handler(Looper.getMainLooper());

        Bridge(Context context, Listener listener) {
            this.context = context;
            this.listener = listener;
        }

        @JavascriptInterface
        public String host() {
            return "android";
        }

        @JavascriptInterface
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }

        /** the clock follows the phone's 12/24-hour setting */
        @JavascriptInterface
        public boolean is24h() {
            return DateFormat.is24HourFormat(context);
        }

        /** JavaScript calls arrive on a binder thread; the window is the main thread's */
        @JavascriptInterface
        public void night(final boolean on) {
            Log.i(TAG, "[LIFE] night(" + on + ")");
            if (listener == null) return;
            main.post(new Runnable() {
                public void run() { listener.night(on); }
            });
        }
    }
}
