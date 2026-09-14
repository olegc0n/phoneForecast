package com.lili.informer;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * A window onto informer.html, and nothing else.
 *
 * The whole point of the app is the handful of things a browser tab cannot do
 * on a phone living on a shelf:
 *
 *   - FLAG_KEEP_SCREEN_ON, so the display stays up without the developer-options
 *     "stay awake while charging" trick;
 *     instead of painting a black overlay over the page;
 *   - immersive fullscreen with no URL bar and no way to navigate away;
 *   - DOM storage that reliably works, unlike a file:// tab;
 *   - coming back up on its own after a power cut (see BootReceiver).
 *
 * Deliberately framework-only - no AppCompat, no AndroidX - so it builds with
 * nothing but the platform jar, aapt2, d8 and apksigner.
 */
public class MainActivity extends Activity {

    private static final String TAG = "Lili";

    private WebView web;
    private String pendingEpisode;   /* adb ... -e ep <id> plays one episode on load */
    private boolean pendingPlan;     /* adb ... -e plan 1 dumps today's schedule */

    @Override
    protected void onCreate(Bundle state) {
        /* Which app is this? Two builds under different package names once cost
         * an afternoon of chasing a bug in the one that was not running. */
        Log.i(TAG, "[LIFE] onCreate " + getPackageName() + " savedState=" + (state != null));
        super.onCreate(state);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (getIntent() != null) {
            pendingEpisode = getIntent().getStringExtra("ep");
            pendingPlan = getIntent().getStringExtra("plan") != null;
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          /* the weather cache depends on this */
        s.setAllowFileAccess(true);

        /* THE WEATHER CALL DEPENDS ON THIS ONE.
         *
         * The page is loaded from file:///android_asset/, and from API 16 onward
         * a file:// page is an opaque origin that may not touch any other one.
         * The default is off, so the XHR to api.weather.yandex.ru was refused
         * inside the WebView and never reached the network at all - which is the
         * worst shape a bug can take here: curl from a laptop works, the key is
         * fine, the developer console shows zero requests because none arrived,
         * and the screen keeps painting the cached file as though nothing is
         * wrong. Nothing on the phone says no; it just never asks.
         *
         * The page is our own asset and loads nothing it did not ship with, so
         * granting it is the same trust we already place in the file. */
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);                    /* ignore the system font-size setting */

        web.setBackgroundColor(0xFF000000);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        /* keep everything inside: nothing in the page should ever navigate away */
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i(TAG, "[LIFE] onPageFinished " + url);
                super.onPageFinished(view, url);
                if (pendingPlan) {
                    pendingPlan = false;
                    view.postDelayed(new Runnable() {
                        public void run() { dumpPlan(); }
                    }, 2200);
                }
                if (pendingEpisode == null) return;
                final String ep = pendingEpisode;
                pendingEpisode = null;
                /* give the page a moment to lay itself out first */
                view.postDelayed(new Runnable() {
                    public void run() { playEpisode(ep); }
                }, 1600);
            }
        });
        /* Send the page's console straight to logcat, so the day's schedule can be
         * read with `adb logcat -s Lili` instead of squinting at an overlay. */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "PhoneForecast");

        setContentView(web);
        web.loadUrl("file:///android_asset/informer.html");
    }

    /**
     * Plays one episode by name, for testing:
     *   adb shell am start -n com.lili.informer/.MainActivity -e ep box
     */
    private void playEpisode(String id) {
        if (web == null || id == null) return;
        String js = "try{Cat.play('" + id.replace("'", "") + "')}catch(e){}";
        if (Build.VERSION.SDK_INT >= 19) web.evaluateJavascript(js, null);
        else web.loadUrl("javascript:" + js);
    }

    /**
     * Prints today's whole schedule to logcat:
     *   adb shell am start -n com.lili.informer/.MainActivity -e plan 1
     *   adb logcat -s Lili
     */
    private void dumpPlan() {
        if (web == null) return;
        String js = "try{Cat.plan()}catch(e){console.log('plan dump failed: '+e)}";
        if (Build.VERSION.SDK_INT >= 19) web.evaluateJavascript(js, null);
        else web.loadUrl("javascript:" + js);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        Log.i(TAG, "[LIFE] onNewIntent " + (intent == null ? "null" : String.valueOf(intent.getExtras())));
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null) return;
        String ep = intent.getStringExtra("ep");
        if (ep != null) playEpisode(ep);
        if (intent.getStringExtra("plan") != null) dumpPlan();
    }

    /* ---------------- immersive fullscreen ---------------- */

    private void immersive() {
        View d = getWindow().getDecorView();
        int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN;
        if (Build.VERSION.SDK_INT >= 19) {
            f |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        }
        d.setSystemUiVisibility(f);
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.i(TAG, "[LIFE] onPause");
    }

    @Override
    protected void onStop() {
        super.onStop();
        Log.i(TAG, "[LIFE] onStop");
    }

    @Override
    protected void onResume() {
        Log.i(TAG, "[LIFE] onResume");
        super.onResume();
        immersive();
        home();
    }

    /**
     * Put the page back on the forecast.
     *
     * The activity is singleTask and the WebView is never reloaded, so whatever
     * was on screen when the app went to the background is still there when it
     * comes back - close it while the episode list is up and tapping the icon
     * returns you to the episode list, not the weather. This is a weather
     * display; coming back to it should show weather.
     *
     * The page makes this a no-op when the forecast is already showing, and the
     * try/catch covers the first resume, which happens before the page exists.
     */
    private void home() {
        Log.i(TAG, "[LIFE] home() -> Cat.home()");
        if (web == null) return;
        String js = "try{Cat.home()}catch(e){}";
        if (Build.VERSION.SDK_INT >= 19) web.evaluateJavascript(js, null);
        else web.loadUrl("javascript:" + js);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        Log.i(TAG, "[LIFE] onWindowFocusChanged focus=" + focus);
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    /**
     * Back is handed to the page, which knows what it is in the middle of. It
     * unwinds one layer per press: the settings dialog closes, then the episode
     * list, and once the forecast is all that is left the page says so and
     * Android gets the press, so the app can still be closed.
     */
    @Override
    public void onBackPressed() {
        Log.i(TAG, "[LIFE] onBackPressed");
        if (web == null || Build.VERSION.SDK_INT < 19) { super.onBackPressed(); return; }
        web.evaluateJavascript(
            "(function(){try{return Cat.back()?1:0}catch(e){return 0}})()",
            new ValueCallback<String>() {
                public void onReceiveValue(String v) {
                    Log.i(TAG, "[LIFE] page handled back? " + v);
                    if (!"1".equals(v)) MainActivity.super.onBackPressed();
                }
            });
    }

    /* ---------------- the bridge the page may use ----------------
     *
     * No brightness control here. There was, so quiet hours could dim the room,
     * and it made the screen worse: Android's automatic brightness already
     * measures the light and gets it right, and an app overriding it with a fixed
     * fraction only gets it wrong in a different way. The system owns the
     * backlight.                                                              */

    private class Bridge {
        @JavascriptInterface
        public String host() {
            return "android";
        }

        @JavascriptInterface
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }
    }
}
