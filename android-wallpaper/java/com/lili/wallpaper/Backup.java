package com.lili.wallpaper;

import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Point;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.view.WindowManager;

import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The wallpapers that were there before Lili, so that turning a switch off in
 * the settings screen puts them back.
 *
 * Every time the Home switch is turned on, before Lili takes the home screen
 * (and, on stock Android, possibly the lock screen with it), whatever is on
 * both screens now is saved. This replaces any older copy of that screen,
 * because the user may have changed wallpapers in between. The exception is
 * Lili's own wallpaper (her live component, or the lock picture she set last).
 * Then the older copy stays, because it is still the one from before her:
 *
 *   home  a live wallpaper (not Lili): its component, "live:<pkg/cls>"
 *         a picture: getWallpaperFile(FLAG_SYSTEM) copied to files/backup_home
 *         (getDrawable() below API 24, or when there is no file: the default)
 *   lock  (API 24+) no lock wallpaper of its own (getWallpaperId < 0, or no
 *         file): "mirror", it shows the home wallpaper
 *         a picture: getWallpaperFile(FLAG_LOCK) copied to files/backup_lock
 *         a live wallpaper of its own (API 34+ can tell): its component
 *
 * Reading a wallpaper's picture needs READ_EXTERNAL_STORAGE on API 27-32 (24-26
 * may not), and more than an app can get on 33+. The attempt then throws a
 * SecurityException, which comes back as DENIED. The settings screen asks for
 * the permission where that can help and otherwise carries on. The screen then
 * has no backup (""), and turning it off later asks what to put there instead.
 * The live and mirror cases need no permission at all.
 *
 * Restoring: plan() says how, and restore() does it, off the main thread.
 *   home  a picture: setStream(FLAG_SYSTEM). This replaces the live Lili and
 *         leaves a lock-only picture where it is. A live wallpaper: the system
 *         picker for it (the settings screen opens that).
 *   lock  a picture: setStream(FLAG_LOCK). "mirror" or a live one:
 *         clear(FLAG_LOCK), because a lock-only live wallpaper cannot be set.
 *         If the home screen is the live Lili, clearing would leave her on the
 *         lock screen. Then the saved home picture (which a mirroring lock
 *         screen showed before her) goes on the lock screen, and without one
 *         there is nothing to restore.
 *   both  Home off while her live wallpaper covered the lock screen: the home
 *         screen as above, then restoreLockAfterHome().
 * The backups are kept after a restore. The next turn-on replaces them.
 *
 * The lock screen is never taken by a switch in this version (see
 * SettingsActivity); its "turn off" restores her picture from an earlier build.
 */
final class Backup {

    private static final String TAG = LiliWeb.TAG;

    /* what a save did, in order of how bad it is */
    static final int SKIPPED = 0, SAVED = 1, FAILED = 2, DENIED = 3;
    private static final String[] RESULT = { "skipped", "saved", "failed", "denied" };

    /* how a screen is put back */
    static final int NONE = 0, PICTURE = 1, HOME_PICTURE = 2, CLEAR = 3, LIVE_PICKER = 4;

    static final String HOME_FILE = "backup_home", LOCK_FILE = "backup_lock";
    static final String STATIC = "static", MIRROR = "mirror", LIVE = "live:";

    /** Held around every wallpaper this app writes (here and in LockPicture), one at a time. */
    static final Object WRITE = new Object();

    private Backup() {}

    static String home(SharedPreferences p) { return p.getString(Prefs.BK_HOME, ""); }
    static String lock(SharedPreferences p) { return p.getString(Prefs.BK_LOCK, ""); }

    /** "live:pkg/cls" -> the component, or null */
    static ComponentName component(String saved) {
        if (saved == null || !saved.startsWith(LIVE)) return null;
        return ComponentName.unflattenFromString(saved.substring(LIVE.length()));
    }

    /* ---- saving; all off the main thread (a big picture is copied or encoded) ---- */

    /**
     * The Home switch is being turned on: save the home screen and (API 24+)
     * the lock screen, because on stock Android the picker's "Home screen and
     * lock screen" replaces the lock wallpaper too. A screen that could not be
     * read has no backup now. Returns the worse of the two, so that DENIED
     * from either one asks for the permission.
     */
    static int beforeHome(Context context) {
        Context app = context.getApplicationContext();
        int r = saveHome(app);
        if (r == FAILED || r == DENIED) drop(app, false);
        int l = SKIPPED;
        if (Build.VERSION.SDK_INT >= 24) {
            l = saveLock(app);
            if (l == FAILED || l == DENIED) drop(app, true);
        }
        log(app, "home on: home " + RESULT[r] + ", lock " + RESULT[l]);
        return Math.max(r, l);
    }

    private static int saveHome(Context app) {
        WallpaperManager wm = WallpaperManager.getInstance(app);
        try {
            WallpaperInfo info = wm.getWallpaperInfo();
            if (info != null) {
                ComponentName c = info.getComponent();
                if (ours(app, c)) return SKIPPED;            /* Lili already: the older copy is from before her */
                keep(app, Prefs.BK_HOME, LIVE + c.flattenToString(), HOME_FILE);
                return SAVED;
            }
            boolean ok = Build.VERSION.SDK_INT >= 24 && copyFile(app, wm, WallpaperManager.FLAG_SYSTEM, HOME_FILE);
            if (!ok) ok = copyDrawable(app, wm, HOME_FILE);
            if (!ok) return FAILED;
            keep(app, Prefs.BK_HOME, STATIC, null);
            return SAVED;
        } catch (SecurityException e) {
            Log.i(TAG, "[BACKUP] home: not allowed to read it - " + e.getMessage());
            return DENIED;
        } catch (Throwable t) {
            Log.w(TAG, "[BACKUP] home failed", t);
            return FAILED;
        }
    }

    private static int saveLock(Context app) {
        SharedPreferences p = Prefs.of(app);
        WallpaperManager wm = WallpaperManager.getInstance(app);
        try {
            int id = wm.getWallpaperId(WallpaperManager.FLAG_LOCK);
            int mine = p.getInt(Prefs.LOCK_ID, 0);
            if (mine > 0 && id == mine) return SKIPPED;      /* Lili's own picture */
            if (id < 0) {
                if (homeIsOurs(app, wm)) return SKIPPED;     /* it shows the live Lili of the home screen */
                keep(app, Prefs.BK_LOCK, MIRROR, LOCK_FILE);
                return SAVED;
            }
            if (Build.VERSION.SDK_INT >= 34) {
                WallpaperInfo info = wm.getWallpaperInfo(WallpaperManager.FLAG_LOCK);
                if (info != null) {
                    if (ours(app, info.getComponent())) return SKIPPED;
                    keep(app, Prefs.BK_LOCK, LIVE + info.getComponent().flattenToString(), LOCK_FILE);
                    return SAVED;
                }
            }
            /* no lock-specific file means the lock screen shows the home wallpaper */
            if (copyFile(app, wm, WallpaperManager.FLAG_LOCK, LOCK_FILE)) {
                keep(app, Prefs.BK_LOCK, STATIC, null);
            } else {
                if (homeIsOurs(app, wm)) return SKIPPED;
                keep(app, Prefs.BK_LOCK, MIRROR, LOCK_FILE);
            }
            return SAVED;
        } catch (SecurityException e) {
            Log.i(TAG, "[BACKUP] lock: not allowed to read it - " + e.getMessage());
            return DENIED;
        } catch (Throwable t) {
            Log.w(TAG, "[BACKUP] lock failed", t);
            return FAILED;
        }
    }

    private static boolean ours(Context app, ComponentName c) {
        return c != null && app.getPackageName().equals(c.getPackageName());
    }

    private static boolean homeIsOurs(Context app, WallpaperManager wm) {
        try {
            WallpaperInfo info = wm.getWallpaperInfo();
            return info != null && ours(app, info.getComponent());
        } catch (Throwable t) {
            return false;
        }
    }

    /* the new backup of a screen; a picture file it no longer needs is deleted */
    private static void keep(Context app, String key, String value, String staleFile) {
        Prefs.of(app).edit().putString(key, value).apply();
        if (staleFile != null) new File(app.getFilesDir(), staleFile).delete();
    }

    /* that screen has no backup now */
    private static void drop(Context app, boolean lock) {
        Prefs.of(app).edit().remove(lock ? Prefs.BK_LOCK : Prefs.BK_HOME).apply();
        new File(app.getFilesDir(), lock ? LOCK_FILE : HOME_FILE).delete();
    }

    private static void log(Context app, String what) {
        SharedPreferences p = Prefs.of(app);
        Log.i(TAG, "[BACKUP] " + what + " -> home '" + home(p) + "', lock '" + lock(p) + "'");
    }

    /** API 24+. False if there is no file for that screen. SecurityException passes up. */
    private static boolean copyFile(Context app, WallpaperManager wm, int which, String name) throws IOException {
        ParcelFileDescriptor pfd = wm.getWallpaperFile(which);
        if (pfd == null) return false;
        InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
        try {
            write(app, name, in);
        } finally {
            close(in);
        }
        return true;
    }

    /** The home wallpaper as a Drawable (the system default if none was set), saved as PNG. */
    private static boolean copyDrawable(Context app, WallpaperManager wm, String name) throws IOException {
        Drawable d = wm.getDrawable();
        if (d == null) return false;
        Bitmap bmp = null;
        boolean own = false;
        if (d instanceof BitmapDrawable) bmp = ((BitmapDrawable) d).getBitmap();
        if (bmp == null) {
            int w = d.getIntrinsicWidth(), h = d.getIntrinsicHeight();
            if (w <= 0 || h <= 0) return false;
            bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            own = true;
            d.setBounds(0, 0, w, h);
            d.draw(new Canvas(bmp));
        }
        File dir = app.getFilesDir();
        File tmp = new File(dir, name + ".tmp");
        OutputStream os = new FileOutputStream(tmp);
        boolean ok;
        try {
            ok = bmp.compress(Bitmap.CompressFormat.PNG, 100, os);
        } finally {
            close(os);
            if (own) bmp.recycle();
        }
        if (!ok) { tmp.delete(); throw new IOException("could not encode the wallpaper"); }
        rename(tmp, new File(dir, name));
        return true;
    }

    private static void write(Context app, String name, InputStream in) throws IOException {
        File dir = app.getFilesDir();
        File tmp = new File(dir, name + ".tmp");
        OutputStream os = new FileOutputStream(tmp);
        long total = 0;
        boolean done = false;
        try {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); total += n; }
            done = true;
        } finally {
            close(os);
            if (!done) tmp.delete();
        }
        if (total == 0) { tmp.delete(); throw new IOException("the wallpaper file is empty"); }
        rename(tmp, new File(dir, name));
    }

    private static void rename(File tmp, File dst) throws IOException {
        if (tmp.renameTo(dst)) return;
        dst.delete();
        if (!tmp.renameTo(dst)) throw new IOException("could not rename " + tmp);
    }

    /* ---- restoring ---- */

    /** How the home screen would be put back: PICTURE, LIVE_PICKER or NONE. Cheap: main thread is fine. */
    static int homePlan(Context context) {
        Context app = context.getApplicationContext();
        String saved = home(Prefs.of(app));
        if (STATIC.equals(saved) && new File(app.getFilesDir(), HOME_FILE).isFile()) return PICTURE;
        if (component(saved) != null) return LIVE_PICKER;
        return NONE;
    }

    /**
     * How the lock screen would be put back: PICTURE, HOME_PICTURE, CLEAR or
     * NONE. homeOurs: the home screen is the live Lili, so the lock screen must
     * get a wallpaper of its own, or she would still be on it.
     */
    static int lockPlan(Context context, boolean homeOurs) {
        Context app = context.getApplicationContext();
        String saved = lock(Prefs.of(app));
        if (STATIC.equals(saved) && new File(app.getFilesDir(), LOCK_FILE).isFile()) return PICTURE;
        if (MIRROR.equals(saved) || component(saved) != null) {
            if (!homeOurs) return CLEAR;
            return homePlan(app) == PICTURE ? HOME_PICTURE : NONE;
        }
        return NONE;
    }

    /** Puts the saved wallpaper back as `plan` says (not LIVE_PICKER: that is the picker). Off the main thread. */
    static void restore(Context context, boolean lock, int plan) throws IOException {
        Context app = context.getApplicationContext();
        File dir = app.getFilesDir();
        switch (plan) {
            case PICTURE:
                setPicture(app, new File(dir, lock ? LOCK_FILE : HOME_FILE), lock);
                break;
            case HOME_PICTURE:
                if (!lock) throw new IOException("the home picture is restored with PICTURE");
                setPicture(app, new File(dir, HOME_FILE), true);
                break;
            case CLEAR:
                if (!lock) throw new IOException("only the lock screen is cleared to restore it");
                if (Build.VERSION.SDK_INT < 24) throw new IOException("no lock-screen wallpaper below API 24");
                synchronized (WRITE) {
                    WallpaperManager.getInstance(app).clear(WallpaperManager.FLAG_LOCK);
                }
                break;
            default:
                throw new IOException("nothing saved to restore (plan " + plan + ")");
        }
        Log.i(TAG, "[BACKUP] " + (lock ? "lock" : "home") + " restored, plan " + plan);
    }

    /**
     * Home is off again and her live wallpaper was covering the lock screen
     * too: the lock screen gets its saved picture back, or else follows the
     * home screen again (clear(FLAG_LOCK)) - which also undoes whatever the
     * system did to it when the home screen changed. API 24+, off the main thread.
     */
    static void restoreLockAfterHome(Context context) throws IOException {
        Context app = context.getApplicationContext();
        if (Build.VERSION.SDK_INT < 24) return;
        int plan = lockPlan(app, false) == PICTURE ? PICTURE : CLEAR;
        restore(app, true, plan);
    }

    /**
     * "System default", for a screen with no backup. Home: clear(FLAG_SYSTEM),
     * which leaves a lock-only picture alone (clear() below API 24). Lock:
     * clear(FLAG_LOCK), so it shows the home wallpaper again - unless that is
     * the live Lili: then the built-in default picture is set on the lock screen
     * alone, falling back to clearing if there is none. Off the main thread.
     */
    static void systemDefault(Context context, boolean lock, boolean homeOurs) throws IOException {
        Context app = context.getApplicationContext();
        if (lock && Build.VERSION.SDK_INT < 24) throw new IOException("no lock-screen wallpaper below API 24");
        WallpaperManager wm = WallpaperManager.getInstance(app);
        synchronized (WRITE) {
            if (!lock) {
                if (Build.VERSION.SDK_INT >= 24) wm.clear(WallpaperManager.FLAG_SYSTEM);
                else wm.clear();
            } else if (!homeOurs || !builtInOnLock(app, wm)) {
                wm.clear(WallpaperManager.FLAG_LOCK);
            }
        }
        Log.i(TAG, "[BACKUP] " + (lock ? "lock" : "home") + " set to the system default" + (homeOurs ? " (home is Lili)" : ""));
    }

    /* API 24+, inside WRITE: the built-in wallpaper, screen-sized, on the lock screen alone */
    private static boolean builtInOnLock(Context app, WallpaperManager wm) {
        Bitmap bmp = null;
        boolean own = false;
        try {
            Point real = new Point();
            ((WindowManager) app.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealSize(real);
            int w = Math.min(real.x, real.y), h = Math.max(real.x, real.y);
            Drawable d = wm.getBuiltInDrawable(w, h, true, 0.5f, 0.5f, WallpaperManager.FLAG_LOCK);
            if (d == null) d = wm.getBuiltInDrawable(w, h, true, 0.5f, 0.5f, WallpaperManager.FLAG_SYSTEM);
            if (d == null) return false;
            if (d instanceof BitmapDrawable) bmp = ((BitmapDrawable) d).getBitmap();
            if (bmp == null) {
                bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                own = true;
                d.setBounds(0, 0, w, h);
                d.draw(new Canvas(bmp));
            }
            return wm.setBitmap(bmp, null, true, WallpaperManager.FLAG_LOCK) != 0;
        } catch (Throwable t) {
            Log.w(TAG, "[BACKUP] no built-in picture for the lock screen", t);
            return false;
        } finally {
            if (own && bmp != null) bmp.recycle();
        }
    }

    /** A picture file onto the home screen or (API 24+) the lock screen alone. */
    static void setPicture(Context app, File f, boolean lock) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            synchronized (WRITE) {
                set(app, in, lock);
            }
        } finally {
            close(in);
        }
    }

    private static void set(Context app, InputStream in, boolean lock) throws IOException {
        WallpaperManager wm = WallpaperManager.getInstance(app);
        if (Build.VERSION.SDK_INT >= 24) {
            int id = wm.setStream(in, null, true, lock ? WallpaperManager.FLAG_LOCK : WallpaperManager.FLAG_SYSTEM);
            if (id == 0) throw new IOException("setStream returned 0");
        } else {
            if (lock) throw new IOException("no lock-screen wallpaper below API 24");
            wm.setStream(in);
        }
    }

    private static void close(Closeable c) {
        if (c == null) return;
        try { c.close(); } catch (IOException ignored) {}
    }
}
