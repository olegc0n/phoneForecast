package com.lili.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

import javax.net.ssl.HttpsURLConnection;

/**
 * Real weather for Lili: the forecast for the place the user chose, fetched,
 * kept and handed to the page. Nothing about it is shown; it only decides her
 * clothes and which scenes suit the sky (src/wallpaper/forecast.js turns it
 * into the payload the cat reads).
 *
 * SOURCES. Open-Meteo (no key; data CC BY 4.0, "Weather data by
 * Open-Meteo.com"), hourly for three days. When it fails - the network, a 5xx,
 * or JSON that is not a forecast - MET Norway's Locationforecast 2.0 compact
 * ("Weather data by MET Norway") instead. MET refuses a request without a
 * User-Agent naming the app and a contact (403), so every request carries
 * USER_AGENT; its Expires is respected (no request before it, for the same
 * place) and If-Modified-Since is sent with the Last-Modified it gave. MET has
 * no sunrise or sunset: the page computes both itself, for both sources.
 *
 * WHAT IS SENT. The coordinates only: rounded to 2 decimals (about 1 km) for
 * Open-Meteo, 4 for MET (its maximum). A search sends the name typed. HTTPS
 * only, 10 s timeouts, gzip, no redirects followed; get() is the one place
 * that opens a connection.
 *
 * WHEN (fetch policy):
 *   1. at once when the place changes or Real weather is turned on (now());
 *   2. when a wallpaper engine becomes visible and the forecast is older than
 *      2 h (visible());
 *   3. from WeatherJob, every 3 h with any network, persisted (job()) - unless
 *      the forecast is younger than 1 h;
 *   4. never more than once in 30 min for one place, except (1); after a
 *      failure, not again for 30 min, then 1 h, then 3 h (and so on);
 *   5. with no place, or Real weather off, never: no request, and the job is
 *      cancelled.
 * Offline (no active network), nothing is attempted. One fetch at a time; a
 * forced one asked for meanwhile follows it. A result for a place that is no
 * longer the place is thrown away.
 *
 * KEPT in files/forecast.json (a temp file, then a rename), so a restart costs
 * no request: the raw response, its source, when it was fetched, the place it
 * is for, and MET's Last-Modified and Expires. The prefs hold the metadata
 * (wx_at, wx_src, wx_key, wx_try_at, wx_fails, wx_error) for the settings
 * screen and for the policy above, so neither has to read the file.
 *
 * TO THE PAGE: pageData() - {source, body, lat, lon, fetchedAt, place}, or ""
 * with no place, Real weather off, nothing kept for this place. The page asks
 * for it at boot through the bridge (PhoneForecast.forecast()), and every
 * LiliView that is not a still picture listens here (Listener) and pushes
 * Wall.forecast(...) after each new forecast, place or switch. The page
 * decides what is stale (fetched more than 48 h ago) or does not cover the
 * hour, and lives under an invented sky then.
 *
 * Log: adb logcat -s Lili, the [WX] lines.
 */
final class Forecast {

    private static final String TAG = LiliWeb.TAG;

    /** Every request carries this; MET Norway refuses one without the app and a contact. %s: the versionName. */
    static final String USER_AGENT = "Lili/%s (+https://github.com/olegc0n/phoneForecast)";

    private static final String OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s" +
        "&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,pressure_msl,precipitation,is_day" +
        "&daily=sunrise,sunset&timezone=auto&forecast_days=3&wind_speed_unit=ms&timeformat=unixtime";
    private static final String MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=%s&lon=%s";
    private static final String GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search?name=%s&count=8&language=%s&format=json";

    static final String SRC_OPEN_METEO = "open-meteo";
    static final String SRC_MET = "met";
    private static final String FILE = "forecast.json";

    private static final long MINUTE = 60L * 1000, HOUR = 60 * MINUTE;
    static final long VISIBLE_AFTER_MS = 2 * HOUR;      /* (2) */
    static final long JOB_AFTER_MS = HOUR;              /* (3) */
    static final long MIN_GAP_MS = 30 * MINUTE;         /* (4) */
    static final long[] BACKOFF_MS = { 30 * MINUTE, HOUR, 3 * HOUR };
    static final int TIMEOUT_MS = 10000;
    private static final int MAX_BYTES = 4 * 1024 * 1024;

    private static final int FORCE = 1, VISIBLE = 2, JOB = 3;

    /** The outcome of a fetch asked for by the job, on the main thread. */
    interface Done {
        void done(boolean ok, String detail);
    }

    /** A new forecast, place or switch: whatever the page has may be out of date. Main thread. */
    interface Listener {
        void forecastChanged();
    }

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Object LOCK = new Object();
    private static boolean running;         /* a fetch on its worker thread */
    private static boolean again;           /* ...and a forced one asked for meanwhile */
    private static Stored latest;           /* files/forecast.json, as last read or written */
    private static boolean latestRead;
    private static String pageCache;        /* pageData() for `pageCacheOf` */
    private static Stored pageCacheOf;
    private static String agent;
    /* held weakly: a listener's owner keeps it (as with Chroma and the prefs) */
    private static final WeakHashMap<Listener, Boolean> LISTENERS = new WeakHashMap<Listener, Boolean>();

    private Forecast() {}

    /* ---- the place ---- */

    /** Where the weather is for, as the settings stored it; null when there is none. */
    static final class Place {
        final String name;
        final double lat, lon;
        final String how;           /* Prefs.HOW_SEARCH | HOW_GPS */

        Place(String name, double lat, double lon, String how) {
            this.name = name;
            this.lat = lat;
            this.lon = lon;
            this.how = how;
        }

        static Place current(SharedPreferences p) {
            String la = p.getString(Prefs.WX_LAT, null), lo = p.getString(Prefs.WX_LON, null);
            if (la == null || lo == null) return null;
            try {
                double a = Double.parseDouble(la), b = Double.parseDouble(lo);
                if (Double.isNaN(a) || Double.isNaN(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
                return new Place(p.getString(Prefs.WX_PLACE, ""), a, b, p.getString(Prefs.WX_HOW, Prefs.HOW_SEARCH));
            } catch (NumberFormatException e) {
                return null;
            }
        }

        /** The place as a forecast is kept for it: 4 decimals, about 10 m. */
        String key() {
            return fixed(lat, 4) + "," + fixed(lon, 4);
        }
    }

    static String fixed(double v, int decimals) {
        return String.format(Locale.ROOT, "%." + decimals + "f", v);
    }

    /** A place is set and Real weather is on: the only state in which anything is fetched. */
    static boolean enabled(Context context) {
        SharedPreferences p = Prefs.of(context);
        return Place.current(p) != null && Prefs.weatherOn(p);
    }

    /* ---- what the settings screen does ---- */

    /** A place chosen (a search result, or Use my location): kept, Real weather on, the job, a fetch now. Main thread. */
    static void setPlace(Context context, String name, double lat, double lon, String how) {
        Context app = context.getApplicationContext();
        Prefs.of(app).edit()
            .putString(Prefs.WX_PLACE, name)
            .putString(Prefs.WX_LAT, fixed(lat, 4))
            .putString(Prefs.WX_LON, fixed(lon, 4))
            .putString(Prefs.WX_HOW, how)
            .putBoolean(Prefs.WX_ON, true)
            .putInt(Prefs.WX_FAILS, 0)
            .putString(Prefs.WX_ERROR, "")
            .apply();
        Log.i(TAG, "[WX] place: " + name + " (" + how + ")");
        changed();                                /* the last place's weather leaves every page at once */
        WeatherJob.schedule(app);
        now(app);
    }

    /** The Real weather switch. Off: the job cancelled, the pages back to an invented sky, no network. Main thread. */
    static void setOn(Context context, boolean on) {
        Context app = context.getApplicationContext();
        Prefs.of(app).edit().putBoolean(Prefs.WX_ON, on).apply();
        Log.i(TAG, "[WX] real weather " + (on ? "on" : "off"));
        if (on) {
            WeatherJob.schedule(app);
            changed();
            now(app);
        } else {
            WeatherJob.cancel(app);
            changed();
        }
    }

    /** The job, as the state says: scheduled (idempotently) while enabled, cancelled otherwise. */
    static void ensureJob(Context context) {
        Context app = context.getApplicationContext();
        if (enabled(app)) WeatherJob.schedule(app);
        else WeatherJob.cancel(app);
    }

    static boolean busy() {
        synchronized (LOCK) {
            return running;
        }
    }

    /* ---- when to fetch ---- */

    /** (1) The place changed, or Real weather was turned on: now, whatever the 30 minutes say. */
    static void now(Context context) {
        request(context, FORCE, null);
    }

    /** (2) A wallpaper engine came into view. */
    static void visible(Context context) {
        request(context, VISIBLE, null);
    }

    /** (3) The 3-hourly job. */
    static void job(Context context, Done done) {
        request(context, JOB, done);
    }

    private static void request(Context context, int why, final Done done) {
        final Context app = context.getApplicationContext();
        SharedPreferences p = Prefs.of(app);
        final Place place = Place.current(p);
        if (place == null || !Prefs.weatherOn(p)) {
            /* (5) no place, or Real weather off: no network at all */
            finish(done, false, "no place, or real weather off");
            return;
        }
        long now = System.currentTimeMillis();
        if (why != FORCE) {
            String wait = notDue(p, place, why, now);
            if (wait != null) {
                finish(done, true, wait);
                return;
            }
        }
        if (!online(app)) {
            Log.i(TAG, "[WX] offline - nothing fetched");
            if (why == FORCE) p.edit().putString(Prefs.WX_ERROR, "offline").apply();
            finish(done, false, "offline");
            return;
        }
        synchronized (LOCK) {
            if (running) {
                if (why == FORCE) again = true;
                finish(done, true, "a fetch is already running");
                return;
            }
            running = true;
        }
        Log.i(TAG, "[WX] fetching for " + place.key() + " (" + (why == FORCE ? "asked" : why == VISIBLE ? "shown" : "job") + ")");
        new Thread(new Runnable() {
            public void run() { fetch(app, place, done); }
        }, "lili-forecast").start();
    }

    /* (2) to (4): null when a fetch is due, else why not */
    private static String notDue(SharedPreferences p, Place place, int why, long now) {
        long tried = p.getLong(Prefs.WX_TRY_AT, 0);
        if (tried > now) tried = 0;                          /* a clock that went back is no schedule */
        if (now - tried < MIN_GAP_MS) return "tried " + (now - tried) / MINUTE + " min ago";
        int fails = p.getInt(Prefs.WX_FAILS, 0);
        if (fails > 0 && now - tried < BACKOFF_MS[Math.min(fails, BACKOFF_MS.length) - 1]) {
            return "backing off after " + fails + " failure(s)";
        }
        long at = place.key().equals(p.getString(Prefs.WX_KEY, "")) ? p.getLong(Prefs.WX_AT, 0) : 0;
        if (at > now) at = 0;
        long age = at > 0 ? now - at : Long.MAX_VALUE;
        if (age < (why == VISIBLE ? VISIBLE_AFTER_MS : JOB_AFTER_MS)) return "fresh, " + age / MINUTE + " min old";
        return null;
    }

    private static boolean online(Context app) {
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo n = cm.getActiveNetworkInfo();
            return n != null && n.isConnected();
        } catch (Throwable t) {
            return true;                          /* cannot tell: try, and let the request say */
        }
    }

    /* ---- one fetch, on its worker thread ---- */

    private static void fetch(final Context app, final Place place, final Done done) {
        SharedPreferences p = Prefs.of(app);
        long now = System.currentTimeMillis();
        p.edit().putLong(Prefs.WX_TRY_AT, now).apply();
        Stored old = latest(app);
        Stored got = null;
        String error = null;
        try {
            got = openMeteo(app, place, now);
        } catch (Fallback e) {
            Log.w(TAG, "[WX] Open-Meteo failed (" + e.getMessage() + ") - MET Norway instead");
            try {
                got = met(app, place, old, now);
            } catch (Throwable t) {
                error = "Open-Meteo: " + e.getMessage() + "; MET Norway: " + why(t);
            }
        } catch (Throwable t) {
            error = "Open-Meteo: " + why(t);
        }

        boolean saved = false, ok = false;
        if (got != null) {
            Place now2 = Place.current(p);
            if (now2 == null || !place.key().equals(now2.key()) || !Prefs.weatherOn(p)) {
                Log.i(TAG, "[WX] the place changed or real weather was turned off meanwhile - not kept");
            } else if (got == old) {
                ok = true;                        /* MET says what we have is still current */
            } else {
                try {
                    save(app, got);
                    saved = ok = true;
                } catch (IOException e) {
                    error = "could not keep it: " + why(e);
                }
            }
        }

        final boolean follow;
        synchronized (LOCK) {
            running = false;                      /* before the prefs below, so the settings see it done */
            follow = again;
            again = false;
        }
        SharedPreferences.Editor e = p.edit();
        if (ok) {
            Stored s = got;
            e.putLong(Prefs.WX_AT, s.fetchedAt).putString(Prefs.WX_SRC, s.source).putString(Prefs.WX_KEY, s.key)
             .putInt(Prefs.WX_FAILS, 0).putString(Prefs.WX_ERROR, "");
            Log.i(TAG, "[WX] " + (saved ? "kept a forecast from " + s.source : "still current, from " + s.source) +
                " for " + s.key + ", " + (s.body.length() / 1024) + " KB");
        } else if (error != null) {
            int fails = p.getInt(Prefs.WX_FAILS, 0) + 1;
            e.putInt(Prefs.WX_FAILS, fails).putString(Prefs.WX_ERROR, error);
            Log.w(TAG, "[WX] failed (" + fails + " in a row): " + error);
        }
        e.apply();

        final boolean changedNow = saved;
        final boolean success = ok;
        final String detail = ok ? "ok" : error != null ? error : "not kept";
        main.post(new Runnable() {
            public void run() {
                if (changedNow) changed();
                if (done != null) done.done(success, detail);
                if (follow) now(app);
            }
        });
    }

    /** Open-Meteo failed in a way MET Norway may not have: the network, a 5xx, JSON that is not a forecast. */
    private static final class Fallback extends IOException {
        Fallback(String message) {
            super(message);
        }
    }

    private static Stored openMeteo(Context app, Place place, long now) throws IOException {
        String url = String.format(Locale.ROOT, OPEN_METEO_URL, fixed(place.lat, 2), fixed(place.lon, 2));
        Reply r;
        try {
            r = get(app, url, null);
        } catch (IOException e) {
            throw new Fallback(why(e));
        }
        if (r.code >= 500) throw new Fallback("HTTP " + r.code);
        if (r.code != 200) throw new IOException("HTTP " + r.code);
        if (!openMeteoUsable(r.body)) throw new Fallback("not a forecast");
        return new Stored(SRC_OPEN_METEO, r.body, now, place, null, 0);
    }

    /* MET: never before its Expires for the same place; If-Modified-Since with what it last said */
    private static Stored met(Context app, Place place, Stored old, long now) throws IOException {
        boolean same = old != null && SRC_MET.equals(old.source) && place.key().equals(old.key);
        if (same && old.expires > now) {
            Log.i(TAG, "[WX] MET Norway: what we have does not expire for " + (old.expires - now) / MINUTE + " min");
            return old;
        }
        Map<String, String> headers = new HashMap<String, String>();
        if (same && old.lastModified != null) headers.put("If-Modified-Since", old.lastModified);
        Reply r = get(app, String.format(Locale.ROOT, MET_URL, fixed(place.lat, 4), fixed(place.lon, 4)), headers);
        if (r.code == 304 && same) {
            return old.renewed(now, r.lastModified != null ? r.lastModified : old.lastModified, r.expires);
        }
        if (r.code != 200 && r.code != 203) throw new IOException("HTTP " + r.code);
        if (!metUsable(r.body)) throw new IOException("not a forecast");
        return new Stored(SRC_MET, r.body, now, place, r.lastModified, r.expires);
    }

    private static boolean openMeteoUsable(String body) {
        try {
            JSONObject h = new JSONObject(body).getJSONObject("hourly");
            JSONArray t = h.getJSONArray("time");
            return t.length() > 0 && h.getJSONArray("weather_code").length() == t.length();
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean metUsable(String body) {
        try {
            return new JSONObject(body).getJSONObject("properties").getJSONArray("timeseries").length() > 0;
        } catch (Throwable t) {
            return false;
        }
    }

    private static String why(Throwable t) {
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m != null ? ": " + m : "");
    }

    /* ---- the network: one way in ---- */

    private static final class Reply {
        final int code;
        final String body;              /* only for 200 and 203 */
        final String lastModified;
        final long expires;             /* 0: none */

        Reply(int code, String body, String lastModified, long expires) {
            this.code = code;
            this.body = body;
            this.lastModified = lastModified;
            this.expires = expires;
        }
    }

    /** "Lili/1.0.0 (+https://github.com/olegc0n/phoneForecast)" */
    static String userAgent(Context context) {
        if (agent == null) {
            String v = "0";
            try {
                v = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
            } catch (Throwable ignored) {
                /* "0" */
            }
            agent = String.format(Locale.ROOT, USER_AGENT, v);
        }
        return agent;
    }

    /**
     * The one place a connection is opened: HTTPS only, USER_AGENT on every
     * request, gzip, 10 s to connect and 10 s to read, no redirects followed.
     * A worker thread only.
     */
    private static Reply get(Context context, String url, Map<String, String> headers) throws IOException {
        if (!url.startsWith("https://")) throw new IOException("not HTTPS");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            if (!(c instanceof HttpsURLConnection)) throw new IOException("not HTTPS");
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setRequestProperty("User-Agent", userAgent(context));
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Accept-Encoding", "gzip");
            if (headers != null) {
                for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
            }
            int code = c.getResponseCode();
            String body = (code == 200 || code == 203) ? read(c) : null;
            return new Reply(code, body, c.getHeaderField("Last-Modified"), c.getHeaderFieldDate("Expires", 0));
        } finally {
            c.disconnect();
        }
    }

    private static String read(HttpURLConnection c) throws IOException {
        InputStream in = c.getInputStream();
        String enc = c.getContentEncoding();
        if ("gzip".equalsIgnoreCase(enc)) in = new GZIPInputStream(in);
        else if ("deflate".equalsIgnoreCase(enc)) in = new InflaterInputStream(in);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new IOException("the response is too large");
            }
            return out.toString("UTF-8");
        } finally {
            in.close();
        }
    }

    /* ---- the place search (Open-Meteo geocoding) ---- */

    /** One search result. */
    static final class Found {
        final String name, region, country;
        final double lat, lon;

        Found(String name, String region, String country, double lat, double lon) {
            this.name = name;
            this.region = region;
            this.country = country;
            this.lat = lat;
            this.lon = lon;
        }

        /** As the list shows it: the name, then the region and the country. */
        String label() {
            String rest = join(region.equals(name) ? "" : region, country);
            return rest.length() > 0 ? name + "\n" + rest : name;
        }

        /** As the settings screen names the place: "Minsk, Belarus". */
        String placeName() {
            return join(name, country);
        }
    }

    static String join(String a, String b) {
        if (a == null || a.length() == 0) return b == null ? "" : b;
        if (b == null || b.length() == 0) return a;
        return a + ", " + b;
    }

    /** The places called `name`, in `language` (en or ru). Sends the name typed and nothing else. A worker thread only. */
    static List<Found> search(Context context, String name, String language) throws IOException {
        List<Found> out = new ArrayList<Found>();
        String q = name.trim();
        if (q.length() == 0) return out;
        String url = String.format(Locale.ROOT, GEOCODING_URL, URLEncoder.encode(q, "UTF-8"),
            "ru".equals(language) ? "ru" : "en");
        Reply r = get(context, url, null);
        if (r.code != 200) throw new IOException("HTTP " + r.code);
        try {
            JSONArray a = new JSONObject(r.body).optJSONArray("results");
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                if (!o.has("latitude") || !o.has("longitude")) continue;
                out.add(new Found(o.optString("name", q), o.optString("admin1", ""), o.optString("country", ""),
                    o.getDouble("latitude"), o.getDouble("longitude")));
            }
        } catch (JSONException e) {
            throw new IOException("not a search result");
        }
        Log.i(TAG, "[WX] search: " + out.size() + " result(s)");
        return out;
    }

    /* ---- what is kept ---- */

    /** files/forecast.json: the raw response and where it came from. Immutable. */
    static final class Stored {
        final String source, body, place, key, lastModified;
        final double lat, lon;
        final long fetchedAt, expires;

        Stored(String source, String body, long fetchedAt, Place p, String lastModified, long expires) {
            this(source, body, fetchedAt, p.name, p.key(), p.lat, p.lon, lastModified, expires);
        }

        private Stored(String source, String body, long fetchedAt, String place, String key, double lat, double lon,
                       String lastModified, long expires) {
            this.source = source;
            this.body = body;
            this.fetchedAt = fetchedAt;
            this.place = place;
            this.key = key;
            this.lat = lat;
            this.lon = lon;
            this.lastModified = lastModified;
            this.expires = expires;
        }

        /** MET's 304: the same forecast, confirmed current now. */
        Stored renewed(long now, String modified, long newExpires) {
            return new Stored(source, body, now, place, key, lat, lon, modified, newExpires);
        }

        JSONObject json() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("v", 1);
            o.put("source", source);
            o.put("fetchedAt", fetchedAt);
            o.put("place", place);
            o.put("key", key);
            o.put("lat", lat);
            o.put("lon", lon);
            if (lastModified != null) o.put("lastModified", lastModified);
            o.put("expires", expires);
            o.put("body", body);
            return o;
        }

        static Stored from(JSONObject o) throws JSONException {
            String src = o.getString("source");
            if (!SRC_OPEN_METEO.equals(src) && !SRC_MET.equals(src)) throw new JSONException("source " + src);
            return new Stored(src, o.getString("body"), o.getLong("fetchedAt"), o.optString("place", ""),
                o.getString("key"), o.getDouble("lat"), o.getDouble("lon"),
                o.has("lastModified") ? o.getString("lastModified") : null, o.optLong("expires", 0));
        }
    }

    private static Stored latest(Context app) {
        synchronized (LOCK) {
            if (!latestRead) {
                latestRead = true;
                latest = readFile(app);
            }
            return latest;
        }
    }

    private static Stored readFile(Context app) {
        File f = new File(app.getFilesDir(), FILE);
        if (!f.isFile()) return null;
        try {
            FileInputStream in = new FileInputStream(f);
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                return Stored.from(new JSONObject(out.toString("UTF-8")));
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            Log.w(TAG, "[WX] the kept forecast is unreadable", t);
            return null;
        }
    }

    /* a temp file, then a rename: a reader never sees half of one */
    private static void save(Context app, Stored s) throws IOException {
        File dir = app.getFilesDir();
        File part = new File(dir, FILE + ".part");
        File target = new File(dir, FILE);
        try {
            FileOutputStream out = new FileOutputStream(part);
            try {
                out.write(s.json().toString().getBytes("UTF-8"));
                out.getFD().sync();
            } finally {
                out.close();
            }
        } catch (JSONException e) {
            throw new IOException(e.getMessage());
        }
        if (!part.renameTo(target)) {
            part.delete();
            throw new IOException("could not rename " + part.getName());
        }
        synchronized (LOCK) {
            latest = s;
            latestRead = true;
        }
    }

    /* ---- to the page ---- */

    /**
     * What the page gets: {"source", "body", "lat", "lon", "fetchedAt", "place"},
     * or "" - no place, Real weather off, nothing kept for this place. Any thread
     * (the page asks on the JavaBridge thread).
     */
    static String pageData(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences p = Prefs.of(app);
        Place place = Place.current(p);
        if (place == null || !Prefs.weatherOn(p)) return "";
        Stored s = latest(app);
        if (s == null || !place.key().equals(s.key)) return "";
        synchronized (LOCK) {
            if (pageCache != null && pageCacheOf == s) return pageCache;
        }
        String out;
        try {
            JSONObject o = new JSONObject();
            o.put("source", s.source);
            o.put("body", s.body);
            o.put("lat", s.lat);
            o.put("lon", s.lon);
            o.put("fetchedAt", s.fetchedAt);
            o.put("place", s.place);
            /* evaluateJavascript takes it as a JS literal: no raw line or paragraph separators */
            out = o.toString()
                .replace(String.valueOf((char) 0x2028), "\\u2028")
                .replace(String.valueOf((char) 0x2029), "\\u2029");
        } catch (JSONException e) {
            return "";
        }
        synchronized (LOCK) {
            pageCache = out;
            pageCacheOf = s;
        }
        return out;
    }

    /** Main thread. */
    static void listen(Listener l) {
        LISTENERS.put(l, Boolean.TRUE);
    }

    static void unlisten(Listener l) {
        LISTENERS.remove(l);
    }

    /* every page that can hear it: look again (main thread) */
    private static void changed() {
        for (Listener l : new ArrayList<Listener>(LISTENERS.keySet())) {
            try {
                l.forecastChanged();
            } catch (Throwable t) {
                Log.w(TAG, "[WX] a listener failed", t);
            }
        }
    }

    private static void finish(final Done done, final boolean ok, final String detail) {
        if (!"".equals(detail)) Log.i(TAG, "[WX] no fetch: " + detail);
        if (done == null) return;
        main.post(new Runnable() {
            public void run() { done.done(ok, detail); }
        });
    }
}
