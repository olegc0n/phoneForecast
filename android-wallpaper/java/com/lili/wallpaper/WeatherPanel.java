package com.lili.wallpaper;

import android.Manifest;
import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
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
import android.text.InputType;
import android.text.format.DateUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.Locale;

/**
 * The settings screen's Weather section: where her weather is for, and
 * whether it is real. It applies at once - it is not part of the look's draft
 * and has nothing to do with Preview or Apply (Forecast does the rest).
 *
 *   Weather for: Minsk, Belarus      (or "No place set, so the weather is invented")
 *   Real weather          [switch]   on by default once a place is set; off:
 *                                    an invented sky, and no network at all
 *   [City.............] [Search]     Open-Meteo's geocoding; the results (name,
 *                                    region, country) in the screen's own dialog
 *   [Use my location]                ACCESS_COARSE_LOCATION, asked once, when
 *                                    tapped; the framework LocationManager's
 *                                    network provider (no Google services:
 *                                    Huawei has none) - the last known fix if it
 *                                    is under a day old, else one update, 15 s
 *                                    at most; named by android.location.Geocoder
 *                                    where there is one, else "My location
 *                                    (52.52, 13.41)"
 *   Updated 14:05 · Open-Meteo       (or "No data yet", "Updating..."...)
 *   Weather data by Open-Meteo.com   the credit for the data in use
 *
 * No temperature or condition is shown here or anywhere else. Every view comes
 * from SettingsActivity's factories, in its colours (group I of
 * check-wallpaper.js checks that there is none of its own).
 */
final class WeatherPanel {

    private static final String TAG = LiliWeb.TAG;
    static final int REQ_LOCATION = 8;                /* next to SettingsActivity's own request codes */
    private static final long FIX_TIMEOUT_MS = 15000;
    private static final long LAST_KNOWN_MAX_AGE_MS = 24L * 60 * 60 * 1000;

    private final SettingsActivity activity;
    private final Context app;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());

    private TextView placeLine, statusLine, creditLine;
    private Switch realSwitch;
    private EditText field;
    private Button searchButton, locateButton;
    private Dialog results;
    private boolean searching;      /* a search is on its way */
    private boolean fixing;         /* waiting for a location fix */
    private boolean naming;         /* ...and then for the Geocoder */
    private boolean destroyed;

    private LocationManager locationManager;
    private LocationListener fixListener;
    private Runnable fixTimeout;

    private final CompoundButton.OnCheckedChangeListener flip = new CompoundButton.OnCheckedChangeListener() {
        public void onCheckedChanged(CompoundButton b, boolean on) {
            Forecast.setOn(app, on);
            refresh();
        }
    };

    WeatherPanel(SettingsActivity activity) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
        this.prefs = Prefs.of(activity);
    }

    View build() {
        Context c = activity;
        LinearLayout col = new LinearLayout(c);
        col.setOrientation(LinearLayout.VERTICAL);

        col.addView(SettingsActivity.text(c, s(R.string.weather_heading), 15, SettingsActivity.TEXT_DIM), wrap(0, dp(4)));
        placeLine = SettingsActivity.text(c, "", 16, SettingsActivity.TEXT);
        col.addView(placeLine, wrap(0, dp(4)));
        realSwitch = SettingsActivity.toggle(c, R.string.weather_real);
        col.addView(realSwitch, wrap(dp(2), dp(10)));

        LinearLayout row = new LinearLayout(c);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        field = SettingsActivity.field(c, R.string.weather_search_hint);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        field.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            public boolean onEditorAction(TextView v, int action, KeyEvent ev) {
                boolean enter = ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER && ev.getAction() == KeyEvent.ACTION_DOWN;
                if (action != EditorInfo.IME_ACTION_SEARCH && !enter) return false;
                search();
                return true;
            }
        });
        row.addView(field, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        searchButton = SettingsActivity.button(c, R.string.weather_search, new View.OnClickListener() {
            public void onClick(View v) { search(); }
        });
        LinearLayout.LayoutParams lb = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lb.leftMargin = dp(8);
        row.addView(searchButton, lb);
        col.addView(row, wrap(0, dp(8)));

        locateButton = SettingsActivity.button(c, R.string.weather_locate, new View.OnClickListener() {
            public void onClick(View v) { locate(); }
        });
        col.addView(locateButton, wrap(0, dp(8)));

        statusLine = SettingsActivity.text(c, "", 14, SettingsActivity.TEXT_DIM);
        col.addView(statusLine, wrap(0, dp(2)));
        creditLine = SettingsActivity.text(c, "", 12, SettingsActivity.TEXT_DIM);
        col.addView(creditLine, wrap(0, dp(6)));
        col.addView(SettingsActivity.text(c, s(R.string.weather_note), 14, SettingsActivity.TEXT_DIM), wrap(0, 0));

        realSwitch.setOnCheckedChangeListener(flip);
        refresh();
        return col;
    }

    /** The settings screen resumed: the job as the state says, the lines again. */
    void resume() {
        Forecast.ensureJob(app);
        refresh();
    }

    void destroy() {
        destroyed = true;
        stopFix();
        if (results != null) {
            results.setOnDismissListener(null);
            results.dismiss();
            results = null;
        }
    }

    /** Everything from prefs and what is in flight. The settings screen calls it on every pref change too. */
    void refresh() {
        if (destroyed || placeLine == null) return;
        Forecast.Place place = Forecast.Place.current(prefs);
        boolean on = place != null && Prefs.weatherOn(prefs);
        placeLine.setText(place == null ? s(R.string.weather_none) : activity.getString(R.string.weather_for, place.name));
        SettingsActivity.show(realSwitch, on, flip);
        realSwitch.setEnabled(place != null);
        searchButton.setEnabled(!searching);
        locateButton.setEnabled(!fixing && !naming);

        boolean have = place != null && place.key().equals(prefs.getString(Prefs.WX_KEY, "")) &&
            prefs.getLong(Prefs.WX_AT, 0) > 0;
        boolean met = have && Forecast.SRC_MET.equals(prefs.getString(Prefs.WX_SRC, ""));
        String status;
        if (searching) {
            status = s(R.string.weather_searching);
        } else if (fixing || naming) {
            status = s(R.string.weather_locating);
        } else if (place == null) {
            status = null;
        } else if (!on) {
            status = s(R.string.weather_off);
        } else if (Forecast.busy()) {
            status = s(R.string.weather_updating);
        } else {
            boolean failed = prefs.getInt(Prefs.WX_FAILS, 0) > 0 || "offline".equals(prefs.getString(Prefs.WX_ERROR, ""));
            if (have) {
                String src = s(met ? R.string.weather_src_met : R.string.weather_src_om);
                status = activity.getString(failed ? R.string.weather_updated_failed : R.string.weather_updated,
                    when(prefs.getLong(Prefs.WX_AT, 0)), src);
            } else {
                status = s(failed ? R.string.weather_failed : R.string.weather_no_data);
            }
        }
        statusLine.setText(status != null ? status : "");
        statusLine.setVisibility(status != null ? View.VISIBLE : View.GONE);
        creditLine.setText(met ? R.string.weather_by_met : R.string.weather_by_om);
        creditLine.setVisibility(on ? View.VISIBLE : View.GONE);
    }

    /* ---- search ---- */

    private void search() {
        final String q = field.getText().toString().trim();
        if (searching) return;
        if (q.length() == 0) {
            field.requestFocus();
            return;
        }
        hideKeyboard();
        searching = true;
        refresh();
        final String language = "ru".equals(Locale.getDefault().getLanguage()) ? "ru" : "en";
        new Thread(new Runnable() {
            public void run() {
                List<Forecast.Found> found = null;
                try {
                    found = Forecast.search(app, q, language);
                } catch (Throwable t) {
                    Log.w(TAG, "[WX] search failed", t);
                }
                final List<Forecast.Found> list = found;
                main.post(new Runnable() {
                    public void run() { searched(q, list); }
                });
            }
        }, "lili-search").start();
    }

    private void searched(String q, List<Forecast.Found> found) {
        searching = false;
        if (destroyed || activity.isDestroyed()) return;
        refresh();
        if (found == null) {
            toast(s(R.string.weather_search_failed));
        } else if (found.isEmpty()) {
            toast(activity.getString(R.string.weather_not_found, q));
        } else {
            showResults(found);
        }
    }

    /* the results in the settings screen's own dialog: one button each, then Cancel */
    private void showResults(List<Forecast.Found> found) {
        if (results != null) {
            results.setOnDismissListener(null);
            results.dismiss();
        }
        final Dialog d = activity.newDialog();
        LinearLayout box = activity.dialogBox(s(R.string.weather_pick));
        for (final Forecast.Found f : found) {
            Button b = SettingsActivity.button(activity, f.label(), new View.OnClickListener() {
                public void onClick(View v) {
                    d.dismiss();
                    choose(f);
                }
            });
            b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            box.addView(b, wrap(0, dp(8)));
        }
        box.addView(SettingsActivity.button(activity, R.string.cancel, new View.OnClickListener() {
            public void onClick(View v) { d.cancel(); }
        }), wrap(0, 0));
        d.setOnDismissListener(new DialogInterface.OnDismissListener() {
            public void onDismiss(DialogInterface di) {
                if (results == d) results = null;
            }
        });
        /* eight results may not fit a small screen */
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(box);
        results = d;
        activity.open(d, scroll);
    }

    private void choose(Forecast.Found f) {
        Forecast.setPlace(app, f.placeName(), f.lat, f.lon, Prefs.HOW_SEARCH);
        field.setText("");
        refresh();
    }

    /* ---- Use my location ---- */

    private void locate() {
        if (fixing || naming) return;
        if (Build.VERSION.SDK_INT >= 23 &&
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(new String[] { Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
            return;                               /* permissionResult() carries on */
        }
        startFix();
    }

    /** The answer to the location question (SettingsActivity passes it on). */
    void permissionResult(boolean granted) {
        Log.i(TAG, "[WX] ACCESS_COARSE_LOCATION " + (granted ? "granted" : "denied"));
        if (destroyed) return;
        if (granted) startFix();
        else toast(s(R.string.weather_need_location));
    }

    private void startFix() {
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        try {
            if (lm == null || !lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                toast(s(R.string.weather_location_off));
                return;
            }
            final Location last = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null && age(last) < LAST_KNOWN_MAX_AGE_MS) {
                located(last);
                return;
            }
            fixing = true;
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
                    else toast(s(R.string.weather_location_failed));
                }
            };
            main.postDelayed(fixTimeout, FIX_TIMEOUT_MS);
            lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, fixListener, Looper.getMainLooper());
            refresh();
        } catch (SecurityException e) {
            stopFix();
            toast(s(R.string.weather_need_location));
        } catch (Throwable t) {
            Log.w(TAG, "[WX] location failed", t);
            stopFix();
            toast(s(R.string.weather_location_failed));
        }
    }

    /* the single update and its timeout, gone; true if one was waiting */
    private boolean stopFix() {
        boolean was = fixing;
        fixing = false;
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
        refresh();
        return was;
    }

    private static long age(Location l) {
        return (SystemClock.elapsedRealtimeNanos() - l.getElapsedRealtimeNanos()) / 1000000L;
    }

    /* A fix: rounded to 4 decimals (about 10 m), named on a worker thread, then the place. */
    private void located(Location l) {
        final double lat = Math.round(l.getLatitude() * 10000) / 10000.0;
        final double lon = Math.round(l.getLongitude() * 10000) / 10000.0;
        naming = true;
        refresh();
        new Thread(new Runnable() {
            public void run() {
                final String name = nameOf(lat, lon);
                main.post(new Runnable() {
                    public void run() {
                        naming = false;
                        if (destroyed) return;
                        Forecast.setPlace(app, name, lat, lon, Prefs.HOW_GPS);
                        refresh();
                    }
                });
            }
        }, "lili-geocoder").start();
    }

    /* "Minsk, Belarus" from the platform's Geocoder, where there is one; else the coordinates */
    private String nameOf(double lat, double lon) {
        if (Geocoder.isPresent()) {
            try {
                List<Address> found = new Geocoder(app, Locale.getDefault()).getFromLocation(lat, lon, 1);
                if (found != null && !found.isEmpty()) {
                    Address a = found.get(0);
                    String city = a.getLocality();
                    if (city == null || city.length() == 0) city = a.getSubAdminArea();
                    if (city == null || city.length() == 0) city = a.getAdminArea();
                    String name = Forecast.join(city, a.getCountryName());
                    if (name.length() > 0) return name;
                }
            } catch (Throwable t) {
                Log.w(TAG, "[WX] the Geocoder could not name the place", t);
            }
        }
        return app.getString(R.string.weather_my_location, Forecast.fixed(lat, 2), Forecast.fixed(lon, 2));
    }

    /* ---- small things ---- */

    private void hideKeyboard() {
        try {
            InputMethodManager imm = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.hideSoftInputFromWindow(field.getWindowToken(), 0);
        } catch (Throwable ignored) {
            /* no keyboard to hide */
        }
        field.clearFocus();
    }

    /* "14:05" today, "20 Nov, 14:05" otherwise; 12/24 h as the phone says */
    private String when(long at) {
        int f = DateUtils.FORMAT_SHOW_TIME;
        if (!DateUtils.isToday(at)) f |= DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_ABBREV_MONTH;
        return DateUtils.formatDateTime(activity, at, f);
    }

    private String s(int id) {
        return activity.getString(id);
    }

    private void toast(String text) {
        Toast.makeText(app, text, Toast.LENGTH_LONG).show();
    }

    private LinearLayout.LayoutParams wrap(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.bottomMargin = bottom;
        return p;
    }

    private int dp(float v) {
        return SettingsActivity.px(activity, v);
    }
}
