package com.lili.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Everything the user can set, in one SharedPreferences file.
 *
 * The settings screen writes it, and the look (bg_*, size, lift) only when the
 * user applies a draft (Look.toPrefs, one apply()). Original writes orig_at once,
 * HomeShot the shot_* keys of a capture, Forecast the wx_* keys of real
 * weather (the place and the switch apply at once). Every wallpaper engine
 * listens to it (they all run in this one process and share one
 * SharedPreferences instance), so an applied change shows on the home screen
 * with no page reload. Always reached through the application context, so that
 * every caller gets that same instance.
 */
final class Prefs {

    static final String FILE = "lili";

    static final String BG_KIND = "bg_kind";       /* "preset" | "photo" | "original"; absent until the first Apply */
    static final String BG_PRESET = "bg_preset";   /* a name in Backdrop.PRESETS */
    static final String BG_DIM = "bg_dim";         /* 0..60: % of black over a photo */
    static final String BG_REV = "bg_rev";         /* bumped whenever a new photo is applied, so listeners fire */
    static final String SIZE = "size";             /* 15..100: stage width, % of the largest 9:16 box */
    static final String LIFT = "lift";             /* 0..45: stage bottom, % of the screen height */

    /* "My wallpaper" (Original): when files/original.jpg was kept; 0 = not yet. Not a
     * look key - the look says only that it is behind her - but it is the decode
     * key of that picture, and before the first Apply it makes My wallpaper the
     * default look, so every view that draws the backdrop listens to it too. */
    static final String ORIG_AT = "orig_at";

    /* The user's real home screen, captured for the preview's icons layer
     * (HomeShot): the screen size it was taken at, and when. */
    static final String SHOT_W = "shot_w", SHOT_H = "shot_h", SHOT_AT = "shot_at";

    /* Lock mode: the lock-screen picture is Lili's and the refresh job keeps it
     * fresh. Nothing sets it true in this version (the feature is blocked; see
     * LockPicture): it is only carried over from an earlier build by migrate(),
     * and turned off by the Lock screen switch or the job. The home screen has
     * no such key: it is whatever the system says (getWallpaperInfo()). */
    static final String LOCK_ON = "lock_on";       /* boolean */

    /* The lock-screen picture (LockPicture). Not "bg_": no view listens to these. */
    static final String LOCK_ID = "lock_id";       /* getWallpaperId(FLAG_LOCK) after our last set; 0 = unknown */
    static final String LOCK_AT = "lock_at";       /* when we last set it, System.currentTimeMillis() */
    static final String LOCK_NOTE = "lock_note";   /* why lock mode turned itself off; "" = nothing to say */
    static final String NOTE_CHANGED = "changed";  /* the lock wallpaper was changed outside Lili */

    /* The wallpapers that were there before Lili took each screen (Backup). */
    static final String BK_HOME = "bk_home";       /* "" | "static" | "live:<component>" */
    static final String BK_LOCK = "bk_lock";       /* "" | "static" | "mirror" | "live:<component>" */

    /* Real weather (Forecast, WeatherPanel). Not look keys: they apply at once,
     * never through the draft, and no view redraws for them. The place: */
    static final String WX_PLACE = "wx_place";     /* "Minsk, Belarus", as shown */
    static final String WX_LAT = "wx_lat";         /* degrees, a string with at most 4 decimals */
    static final String WX_LON = "wx_lon";
    static final String WX_HOW = "wx_how";         /* HOW_SEARCH | HOW_GPS */
    static final String WX_ON = "wx_on";           /* the Real weather switch; on unless turned off */
    /* ...and the fetches (written only by Forecast): */
    static final String WX_AT = "wx_at";           /* when the stored forecast was fetched; 0: none */
    static final String WX_SRC = "wx_src";         /* Forecast.SRC_OPEN_METEO | SRC_MET */
    static final String WX_KEY = "wx_key";         /* the place it is for (Forecast.Place.key()) */
    static final String WX_TRY_AT = "wx_try_at";   /* the last attempt, success or not */
    static final String WX_FAILS = "wx_fails";     /* failed attempts in a row */
    static final String WX_ERROR = "wx_error";     /* why the last one failed, for the log; "" */
    static final String HOW_SEARCH = "search", HOW_GPS = "gps";

    /* Keys of the three-button version, read once to carry lock mode over and then removed. */
    private static final String OLD_WHERE = "where", OLD_BK_AT = "bk_at", OLD_BK_DENIED = "bk_denied";
    private static volatile boolean migrated;

    static final String KIND_PRESET = "preset";
    static final String KIND_PHOTO = "photo";
    static final String KIND_ORIGINAL = "original";

    static final String DEF_PRESET = "night";
    static final int DEF_DIM = 20, DEF_SIZE = 60, DEF_LIFT = 22;
    static final int DIM_MIN = 0, DIM_MAX = 60;
    /* 100 is her size in the weather app; 15 makes her smaller than a launcher icon */
    static final int SIZE_MIN = 15, SIZE_MAX = 100;
    static final int LIFT_MIN = 0, LIFT_MAX = 45;

    private Prefs() {}

    static SharedPreferences of(Context context) {
        SharedPreferences p = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
        if (!migrated) migrate(p);
        return p;
    }

    /* An install over the three-button version: "lock" or "both" meant lock
     * mode on. Idempotent, so two threads doing it at once is harmless. */
    private static void migrate(SharedPreferences p) {
        migrated = true;
        if (!p.contains(OLD_WHERE) && !p.contains(OLD_BK_AT) && !p.contains(OLD_BK_DENIED)) return;
        String w = p.getString(OLD_WHERE, "");
        SharedPreferences.Editor e = p.edit().remove(OLD_WHERE).remove(OLD_BK_AT).remove(OLD_BK_DENIED);
        if (!p.contains(LOCK_ON)) e.putBoolean(LOCK_ON, "lock".equals(w) || "both".equals(w));
        e.apply();
    }

    static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    static boolean knownKind(String k) {
        return KIND_PRESET.equals(k) || KIND_PHOTO.equals(k) || KIND_ORIGINAL.equals(k);
    }

    /** My wallpaper has been kept (files/original.jpg). */
    static boolean hasOriginal(SharedPreferences p) {
        return p.getLong(ORIG_AT, 0) > 0;
    }

    /**
     * What is behind her, as applied. Before the first Apply (no bg_kind yet)
     * that is My wallpaper once it has been kept, else the default preset. A look
     * applied before My wallpaper was kept stays as it is.
     */
    static String kind(SharedPreferences p) {
        String k = p.getString(BG_KIND, null);
        if (k == null) return hasOriginal(p) ? KIND_ORIGINAL : KIND_PRESET;
        return knownKind(k) ? k : KIND_PRESET;
    }

    static int dim(SharedPreferences p) {
        return clamp(p.getInt(BG_DIM, DEF_DIM), DIM_MIN, DIM_MAX);
    }

    static int size(SharedPreferences p) {
        return clamp(p.getInt(SIZE, DEF_SIZE), SIZE_MIN, SIZE_MAX);
    }

    static int lift(SharedPreferences p) {
        return clamp(p.getInt(LIFT, DEF_LIFT), LIFT_MIN, LIFT_MAX);
    }

    /** Lock mode: the lock-screen picture is Lili's, and kept fresh. */
    static boolean lockOn(SharedPreferences p) {
        return p.getBoolean(LOCK_ON, false);
    }

    /** The Real weather switch, as set (a place is needed too: Forecast.enabled). */
    static boolean weatherOn(SharedPreferences p) {
        return p.getBoolean(WX_ON, true);
    }

    /** What the page's Wall.apply() and its boot config take, as applied: {"size":60,"lift":22} */
    static String pageConfig(Context context) {
        SharedPreferences p = of(context);
        return pageConfig(size(p), lift(p));
    }

    static String pageConfig(int size, int lift) {
        return "{\"size\":" + size + ",\"lift\":" + lift + "}";
    }
}
