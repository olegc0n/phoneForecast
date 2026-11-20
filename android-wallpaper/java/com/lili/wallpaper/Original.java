package com.lili.wallpaper;

import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import java.io.File;
import java.io.IOException;

/**
 * "My wallpaper": the picture the user had as their home wallpaper when they
 * first opened Lili, kept for good as files/original.jpg.
 *
 * Users mostly have a picture of their own as wallpaper and may long have
 * deleted the file it came from, so it must not be lost. The settings screen
 * asks for it (obtain(), on a worker thread) every time it opens or resumes
 * until it is kept, and then never again. It is the first background option
 * (Look.original) and the default look before anything is applied
 * (Prefs.kind). Home off restores it when there is no home backup
 * (Backup.ORIGINAL).
 *
 * Where it comes from, in order:
 *   - the home wallpaper is Lili's live wallpaper: the static home backup that
 *     Backup saved before she took the screen, if there is one (NO_BACKUP if not);
 *   - another app's live wallpaper: there is no picture (LIVE);
 *   - a picture: read it. Up to Android 12 (API 32) that needs
 *     READ_EXTERNAL_STORAGE on API 27-32, asked for at run time (DENIED until it
 *     is granted). From Android 13 (API 33) only "All files access" lets an app
 *     read the wallpaper (MANAGE_EXTERNAL_STORAGE, granted by the user in the
 *     system settings): NEED_ALL_FILES until it is. It is never read without
 *     it there, so that a platform which answers with the default picture
 *     instead of refusing never gets that kept by mistake;
 *   - and, whatever the reason it could not be read, a photo the user picks
 *     (fromPhoto()).
 * Each goes through the backdrop's import (Backdrop.importPhoto: sampled, EXIF
 * upright, centre-cropped to the portrait screen, written as a temp file and
 * renamed), into original.part, and keep() renames that to original.jpg - only
 * when there is no original.jpg yet. Nothing ever deletes, replaces or writes
 * over original.jpg once it is there: no Discard, Apply, fresh open, photo
 * pick or restore (group I of check-wallpaper.js checks that statically).
 * Prefs.ORIG_AT is written once, after the rename; it is the decode key and
 * what every view listens to.
 */
final class Original {

    private static final String TAG = LiliWeb.TAG;

    /** The kept picture. Never deleted (group I). */
    static final String FILE = "original.jpg";
    private static final String PART = "original.part";     /* the import, before it is renamed into FILE */
    private static final String SOURCE = "original.src";    /* cache: the wallpaper as read, before the import */

    /* what obtain() found */
    static final int HAVE = 0;              /* kept */
    static final int NEED_ALL_FILES = 1;    /* API 33+: a picture, readable only with "All files access" */
    static final int DENIED = 2;            /* API 23-32: READ_EXTERNAL_STORAGE not granted */
    static final int LIVE = 3;              /* another app's live wallpaper: no picture */
    static final int NO_BACKUP = 4;         /* Lili is the wallpaper, and the picture before her was not saved */
    static final int FAILED = 5;            /* could not be read */

    private static final Object LOCK = new Object();

    private Original() {}

    static File file(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), FILE);
    }

    /** My wallpaper is kept. Cheap: the main thread may ask. */
    static boolean have(Context context) {
        return file(context).isFile();
    }

    /** API 33+ reads the wallpaper only with this: "All files access" (MANAGE_EXTERNAL_STORAGE). */
    static boolean allFiles() {
        if (Build.VERSION.SDK_INT < 30) return false;
        try {
            return Environment.isExternalStorageManager();
        } catch (Throwable t) {
            return false;
        }
    }

    /** Android 13 and newer: reading the wallpaper needs All files access. */
    static boolean needsAllFiles() {
        return Build.VERSION.SDK_INT >= 33;
    }

    /** Keeps the current home wallpaper's picture if it can, and says how it went. Worker thread. */
    static int obtain(Context context) {
        Context app = context.getApplicationContext();
        if (have(app)) {
            stamped(app);
            return HAVE;
        }
        WallpaperManager wm = WallpaperManager.getInstance(app);
        WallpaperInfo info = null;
        try {
            info = wm.getWallpaperInfo();
        } catch (Throwable t) {
            Log.w(TAG, "[ORIG] getWallpaperInfo failed", t);
        }
        if (info != null) {
            if (!app.getPackageName().equals(info.getPackageName())) {
                Log.i(TAG, "[ORIG] the home wallpaper is live (" + info.getComponent().flattenToShortString() + "): no picture");
                return LIVE;
            }
            /* Lili: the picture that was there before her, if Backup saved one */
            File backup = Backup.homePicture(app);
            if (backup == null) {
                Log.i(TAG, "[ORIG] Lili is the wallpaper and nothing static was saved before her");
                return NO_BACKUP;
            }
            try {
                keep(app, Uri.fromFile(backup));
                Log.i(TAG, "[ORIG] kept from the home backup");
                return HAVE;
            } catch (Throwable t) {
                Log.w(TAG, "[ORIG] the home backup could not be imported", t);
                return FAILED;
            }
        }
        if (needsAllFiles() && !allFiles()) {
            Log.i(TAG, "[ORIG] a picture, but Android 13+ lets only All files access read it");
            return NEED_ALL_FILES;
        }
        File src = new File(app.getCacheDir(), SOURCE);
        try {
            if (!Backup.readHome(app, src)) {
                Log.i(TAG, "[ORIG] no picture to read");
                return FAILED;
            }
            keep(app, Uri.fromFile(src));
            Log.i(TAG, "[ORIG] kept the current home wallpaper");
            return HAVE;
        } catch (SecurityException e) {
            Log.i(TAG, "[ORIG] not allowed to read the wallpaper - " + e.getMessage());
            return needsAllFiles() ? NEED_ALL_FILES : DENIED;
        } catch (Throwable t) {
            Log.w(TAG, "[ORIG] could not read the wallpaper", t);
            return FAILED;
        } finally {
            src.delete();
        }
    }

    /** The user picked their wallpaper from their photos. Only while nothing is kept. Worker thread. */
    static void fromPhoto(Context context, Uri uri) throws IOException {
        keep(context.getApplicationContext(), uri);
        Log.i(TAG, "[ORIG] kept from a photo");
    }

    /*
     * The import, then the one rename into original.jpg - only if there is none:
     * an original.jpg that is there already is never touched. The part file is
     * this method's own, never the kept picture.
     */
    private static void keep(Context app, Uri uri) throws IOException {
        synchronized (LOCK) {
            File kept = file(app);
            if (kept.isFile()) {
                stamped(app);
                return;
            }
            File part = new File(app.getFilesDir(), PART);
            Backdrop.importPhoto(app, uri, part);
            if (!part.renameTo(kept)) {
                part.delete();
                throw new IOException("could not rename " + part);
            }
            stamped(app);
        }
    }

    /* Prefs.ORIG_AT, once: listeners redraw, and before the first Apply it is the default look. */
    private static void stamped(Context app) {
        if (Prefs.hasOriginal(Prefs.of(app))) return;
        Prefs.of(app).edit().putLong(Prefs.ORIG_AT, System.currentTimeMillis()).apply();
    }

    /** A small decode for the settings screen's button, at least `minW` px wide; null if none. Worker thread. */
    static Bitmap thumbnail(Context context, int minW) {
        File f = file(context);
        if (!f.isFile()) return null;
        try {
            BitmapFactory.Options b = new BitmapFactory.Options();
            b.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getPath(), b);
            if (b.outWidth <= 0) return null;
            int sample = 1;
            while (b.outWidth / (sample * 2) >= minW) sample *= 2;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            return BitmapFactory.decodeFile(f.getPath(), o);
        } catch (Throwable t) {
            Log.w(TAG, "[ORIG] no thumbnail", t);
            return null;
        }
    }
}
