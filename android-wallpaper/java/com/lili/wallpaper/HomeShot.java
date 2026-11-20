package com.lili.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.util.Log;
import android.view.WindowManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * The user's real home screen, for the preview's icons layer: what
 * CaptureActivity took and Keyer cut out - icons, labels, widgets, the status
 * bar - on transparent, as files/homescreen.png (ARGB), with the screen size it
 * was taken at (Prefs.SHOT_W/SHOT_H) and when (SHOT_AT). The preview uses it
 * only while the screen is that size (fits()); otherwise the drawn icons.
 */
final class HomeShot {

    private static final String TAG = LiliWeb.TAG;
    static final String FILE = "homescreen.png";

    private HomeShot() {}

    static File file(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), FILE);
    }

    /** When the one there was taken; 0 if there is none. */
    static long at(Context context) {
        return file(context).isFile() ? Prefs.of(context).getLong(Prefs.SHOT_AT, 0) : 0;
    }

    /** There is one, and the screen is the size it was taken at. Cheap: main thread. */
    static boolean fits(Context context) {
        if (at(context) <= 0) return false;
        SharedPreferences p = Prefs.of(context);
        Point real = realSize(context);
        return p.getInt(Prefs.SHOT_W, 0) == real.x && p.getInt(Prefs.SHOT_H, 0) == real.y;
    }

    /** The screen in its current orientation, in real pixels: what a capture is taken at. */
    static Point realSize(Context context) {
        Point real = new Point();
        ((WindowManager) context.getApplicationContext().getSystemService(Context.WINDOW_SERVICE))
            .getDefaultDisplay().getRealSize(real);
        return real;
    }

    /** The picture, or null. Off the main thread: a full-screen PNG. */
    static Bitmap load(Context context) {
        File f = file(context);
        if (!f.isFile()) return null;
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            return BitmapFactory.decodeFile(f.getPath(), o);
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] homescreen.png unreadable", t);
            return null;
        }
    }

    /** A new one: written as a temp file and renamed over the old, then its size and time. Worker thread. */
    static void save(Context context, Bitmap keyed) throws IOException {
        Context app = context.getApplicationContext();
        File dst = file(app), tmp = new File(dst.getPath() + ".tmp");
        OutputStream os = new FileOutputStream(tmp);
        boolean ok;
        try {
            ok = keyed.compress(Bitmap.CompressFormat.PNG, 100, os);
        } finally {
            try { os.close(); } catch (IOException ignored) {}
        }
        if (!ok) {
            tmp.delete();
            throw new IOException("could not encode the capture");
        }
        if (!tmp.renameTo(dst)) {
            dst.delete();
            if (!tmp.renameTo(dst)) throw new IOException("could not rename " + tmp);
        }
        Prefs.of(app).edit()
            .putInt(Prefs.SHOT_W, keyed.getWidth())
            .putInt(Prefs.SHOT_H, keyed.getHeight())
            .putLong(Prefs.SHOT_AT, System.currentTimeMillis())
            .apply();
        Log.i(TAG, "[CAPTURE] saved " + keyed.getWidth() + "x" + keyed.getHeight() + ", " + dst.length() / 1024 + " KB");
    }
}
