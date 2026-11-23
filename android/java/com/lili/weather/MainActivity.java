package com.lili.weather;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
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
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

/**
 * A window onto informer.html, and nothing else.
 *
 * The whole point of the app is the handful of things a browser tab cannot do
 * on a phone living on a shelf:
 *
 *   - FLAG_KEEP_SCREEN_ON, so the display stays up without the developer-options
 *     "stay awake while charging" trick;
 *   - immersive fullscreen with no URL bar and no way to navigate away;
 *   - DOM storage that reliably works, unlike a file:// tab;
 *   - a User-Agent that names the app, which MET Norway requires;
 *   - "use my location" (ACCESS_COARSE_LOCATION, asked only when tapped);
 *   - coming back up on its own after a power cut (see BootReceiver).
 *
 * Deliberately framework-only - no AppCompat, no AndroidX - so it builds with
 * nothing but the platform jar, aapt2, d8 and apksigner.
 *
 * The page's words are its own, in English or Russian from the phone's
 * language (lang() below); res/values and res/values-ru hold this side's few.
 *
 * The page calls in through window.PhoneForecast (Bridge below); this calls
 * the page through evaluateJavascript: Cat.play, Cat.plan, Cat.home, Cat.back
 * and Places.located. Keep those names stable.
 */
public class MainActivity extends Activity {

    private static final String TAG = "Lili";

    /**
     * Appended to the WebView's own User-Agent, so every request the page makes
     * names the app and where to reach its author. MET Norway answers 403 to a
     * request without one; Open-Meteo gets the same. %s: the versionName.
     */
    static final String USER_AGENT = "Lili-Weather/%s (+https://github.com/olegc0n/phoneForecast)";

    private static final int REQ_LOCATION = 1;
    private static final long FIX_TIMEOUT_MS = 15000;
    private static final long LAST_KNOWN_MAX_AGE_MS = 24L * 60 * 60 * 1000;
    /* a resume within this long of asking for the permission is the dialog going away */
    private static final long ASKING_GRACE_MS = 2 * 60 * 1000;

    private WebView web;
    private String pendingEpisode;   /* adb ... -e ep <id> plays one episode on load */
    private boolean pendingPlan;     /* adb ... -e plan 1 dumps today's schedule */

    private final Handler main = new Handler(Looper.getMainLooper());
    private long askedAt;            /* when the location permission was asked for, or 0 */
    private boolean locating;        /* a fix, or its name, is on its way */
    private LocationManager locationManager;
    private LocationListener fixListener;
    private Runnable fixTimeout;

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
        s.setDomStorageEnabled(true);          /* the weather cache and the place depend on this */
        s.setAllowFileAccess(true);

        /* THE WEATHER CALL DEPENDS ON THIS ONE.
         *
         * The page is loaded from file:///android_asset/, and from API 16 onward
         * a file:// page is an opaque origin that may not touch any other one.
         * The default is off, so the forecast XHR was refused inside the WebView
         * and never reached the network at all - which is the worst shape a bug
         * can take here: curl from a laptop works, the service sees zero
         * requests because none arrived, and the screen keeps painting the
         * cached file as though nothing is wrong.
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

        /* MET Norway's terms: every request names the app and a contact. An XHR
         * cannot set User-Agent itself, so the WebView's carries it for all. */
        s.setUserAgentString(s.getUserAgentString() + " " + userAgent());

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
        keepImmersive();
        web.loadUrl("file:///android_asset/informer.html");
    }

    /** "Lili-Weather/1.0.0 (+https://github.com/olegc0n/phoneForecast)" */
    private String userAgent() {
        String v = "0";
        try {
            v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Throwable ignored) {
            /* "0" */
        }
        return String.format(Locale.ROOT, USER_AGENT, v);
    }

    private void js(String code) {
        if (web == null) return;
        if (Build.VERSION.SDK_INT >= 19) web.evaluateJavascript(code, null);
        else web.loadUrl("javascript:" + code);
    }

    /**
     * Plays one episode by name, for testing:
     *   adb shell am start -n com.lili.weather/.MainActivity -e ep box
     */
    private void playEpisode(String id) {
        if (id == null) return;
        js("try{Cat.play('" + id.replace("'", "") + "')}catch(e){}");
    }

    /**
     * Prints today's whole schedule to logcat:
     *   adb shell am start -n com.lili.weather/.MainActivity -e plan 1
     *   adb logcat -s Lili
     */
    private void dumpPlan() {
        js("try{Cat.plan()}catch(e){console.log('plan dump failed: '+e)}");
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

    /* The keyboard brings the navigation bar back (typing a city in the settings
     * dialog), and so does a system dialog. The settings dialog is part of the
     * page, not a window, so the activity never loses focus and nothing above
     * would hide the bar again: it stayed over the bottom of the screen and cut
     * Lili off. So when the bar comes back, hide it again a moment later - but
     * not while the keyboard is up, which needs it; wait for that to close. */
    private final Runnable reImmersive = new Runnable() {
        public void run() {
            if (keyboardShown()) { main.postDelayed(this, 1500); return; }
            Log.i(TAG, "[LIFE] navigation bar back - hiding it again");
            immersive();
        }
    };

    private void keepImmersive() {
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(
            new View.OnSystemUiVisibilityChangeListener() {
                public void onSystemUiVisibilityChange(int visibility) {
                    if ((visibility & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) != 0) return;
                    main.removeCallbacks(reImmersive);
                    main.postDelayed(reImmersive, 2000);
                }
            });
    }

    /* The keyboard takes a large slice off the bottom of the visible frame; the
     * navigation bar alone takes well under 15% of the screen. */
    private boolean keyboardShown() {
        View d = getWindow().getDecorView();
        android.graphics.Rect r = new android.graphics.Rect();
        d.getWindowVisibleDisplayFrame(r);
        int h = d.getRootView().getHeight();
        return h > 0 && (h - r.bottom) > h * 0.15f;
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
        /* The permission dialog pauses the activity, and the resume after it is
         * not somebody coming back to the shelf: home() would close the settings
         * dialog the answer is about to land in. */
        boolean fromAsking = askedAt != 0 && SystemClock.elapsedRealtime() - askedAt < ASKING_GRACE_MS;
        askedAt = 0;
        if (!fromAsking) home();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(reImmersive);
        stopFix();
        super.onDestroy();
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
        js("try{Cat.home()}catch(e){}");
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

    /* ---------------- "use my location" ----------------
     *
     * ACCESS_COARSE_LOCATION, asked for only when the button is tapped. The fix
     * comes from the framework LocationManager's network provider - no Google
     * services, which Huawei phones do not have: the last known fix if it is
     * under a day old, else one update, 15 s at most (and an older last fix if
     * that is all there is). It is rounded to 4 decimals (about 10 m), named by
     * the platform Geocoder where there is one (else the page calls it by its
     * coordinates), and handed to the page, which keeps it and asks for its
     * forecast. Nothing else is done with it.                                  */

    private void locate() {
        if (locating) return;
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            /* asked before and refused: say why once more before Android asks again */
            if (shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                Toast.makeText(this, R.string.location_rationale, Toast.LENGTH_LONG).show();
            }
            askedAt = SystemClock.elapsedRealtime();
            requestPermissions(new String[] { Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
            return;                               /* onRequestPermissionsResult() carries on */
        }
        startFix();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != REQ_LOCATION) return;
        boolean granted = results != null && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        Log.i(TAG, "[WX] ACCESS_COARSE_LOCATION " + (granted ? "granted" : "denied"));
        if (granted) startFix();
        else answer(null, "denied");
    }

    private void startFix() {
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        try {
            if (lm == null || !lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                answer(null, "off");
                return;
            }
            final Location last = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null && age(last) < LAST_KNOWN_MAX_AGE_MS) {
                located(last);
                return;
            }
            locating = true;
            locationManager = lm;
            fixListener = new LocationListener() {
                public void onLocationChanged(Location l) {
                    if (stopFix() && l != null) located(l);
                }
                public void onStatusChanged(String provider, int status, Bundle extras) {}
                public void onProviderEnabled(String provider) {}
                public void onProviderDisabled(String provider) {}
            };
            fixTimeout = new Runnable() {
                public void run() {
                    if (!stopFix()) return;
                    Log.i(TAG, "[WX] no location fix in " + FIX_TIMEOUT_MS / 1000 + " s");
                    if (last != null) located(last);
                    else answer(null, "timeout");
                }
            };
            main.postDelayed(fixTimeout, FIX_TIMEOUT_MS);
            lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, fixListener, Looper.getMainLooper());
        } catch (SecurityException e) {
            stopFix();
            answer(null, "denied");
        } catch (Throwable t) {
            Log.w(TAG, "[WX] location failed", t);
            stopFix();
            answer(null, "failed");
        }
    }

    /* the single update and its timeout, gone; true if one was waiting */
    private boolean stopFix() {
        boolean was = locating;
        locating = false;
        if (fixTimeout != null) {
            main.removeCallbacks(fixTimeout);
            fixTimeout = null;
        }
        if (fixListener != null && locationManager != null) {
            try {
                locationManager.removeUpdates(fixListener);
            } catch (Throwable ignored) {
                /* gone already */
            }
        }
        fixListener = null;
        locationManager = null;
        return was;
    }

    private static long age(Location l) {
        return (SystemClock.elapsedRealtimeNanos() - l.getElapsedRealtimeNanos()) / 1000000L;
    }

    /* A fix: rounded, named on a worker thread, then handed to the page. */
    private void located(Location l) {
        final double lat = Math.round(l.getLatitude() * 10000) / 10000.0;
        final double lon = Math.round(l.getLongitude() * 10000) / 10000.0;
        locating = true;
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            public void run() {
                final String name = nameOf(app, lat, lon);
                main.post(new Runnable() {
                    public void run() {
                        locating = false;
                        try {
                            JSONObject o = new JSONObject();
                            o.put("lat", lat);
                            o.put("lon", lon);
                            o.put("name", name);
                            answer(o, null);
                        } catch (JSONException e) {
                            answer(null, "failed");
                        }
                    }
                });
            }
        }, "lili-geocoder").start();
    }

    /* "Minsk, Belarus" from the platform's Geocoder, where there is one; else "" */
    private static String nameOf(Context app, double lat, double lon) {
        if (!Geocoder.isPresent()) return "";
        try {
            List<Address> found = new Geocoder(app, Locale.getDefault()).getFromLocation(lat, lon, 1);
            if (found == null || found.isEmpty()) return "";
            Address a = found.get(0);
            String city = a.getLocality();
            if (city == null || city.length() == 0) city = a.getSubAdminArea();
            if (city == null || city.length() == 0) city = a.getAdminArea();
            String country = a.getCountryName();
            if (city == null || city.length() == 0) return country == null ? "" : country;
            return country == null || country.length() == 0 ? city : city + ", " + country;
        } catch (Throwable t) {
            Log.w(TAG, "[WX] the Geocoder could not name the place", t);
            return "";
        }
    }

    /* Places.located({ok, lat, lon, name} | {ok: false, error}) on the page. */
    private void answer(JSONObject found, String error) {
        String json;
        try {
            JSONObject o = found != null ? found : new JSONObject();
            o.put("ok", found != null);
            if (error != null) o.put("error", error);
            /* evaluateJavascript takes it as a JS literal: no raw line or paragraph separators */
            json = o.toString()
                .replace(String.valueOf((char) 0x2028), "\\u2028")
                .replace(String.valueOf((char) 0x2029), "\\u2029");
        } catch (JSONException e) {
            json = "{\"ok\":false,\"error\":\"failed\"}";
        }
        Log.i(TAG, "[WX] location -> page: " + (found != null ? "a place" : error));
        js("try{Places.located(" + json + ")}catch(e){}");
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

        /** The phone's language ("ru", "en", "uk"...): the page picks English or Russian from it (i18n.js). */
        @JavascriptInterface
        public String lang() {
            return Locale.getDefault().getLanguage();
        }

        /** "Use my location": starts at once, answers later through Places.located(). */
        @JavascriptInterface
        public boolean locate() {
            runOnUiThread(new Runnable() {
                public void run() { MainActivity.this.locate(); }
            });
            return true;
        }
    }
}
