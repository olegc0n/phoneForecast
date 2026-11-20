package com.lili.wallpaper;

import android.app.WallpaperColors;
import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Point;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.view.WindowManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * What is behind Lili: one of six dark presets, or the user's own photo.
 *
 * Drawn natively, under a transparent WebView, by one routine that also serves
 * the fallbacks (no WebView, no virtual display), the colours handed to the
 * system and the swatches in the settings screen. All presets are dark because
 * the props are drawn for a dark page.
 *
 * The photo is imported once, from the settings screen: EXIF orientation
 * applied, centre-cropped to the portrait screen, never upscaled. It goes to
 * files/bg_draft.jpg first, the draft (Look.draftPhoto); Apply moves it over
 * files/bg.jpg (adoptDraft) and bumps bg_rev. Discarding the draft deletes it
 * (dropDraft).
 *
 * Each file has its own decode, once per revision: bg.jpg keyed by bg_rev,
 * bg_draft.jpg by the draft's import stamp. The wallpaper only ever asks for
 * bg.jpg, so it never shows a photo that is not applied; a preview of a draft
 * photo asks for bg_draft.jpg, so it never shows the old one. The applied
 * Bitmap is shared by every engine. None is ever recycle()d, because a view
 * may still be drawing it.
 */
final class Backdrop {

    private static final String TAG = LiliWeb.TAG;
    static final String PHOTO_FILE = "bg.jpg";          /* the applied photo */
    static final String DRAFT_FILE = "bg_draft.jpg";    /* one chosen in the settings screen, not applied yet */

    /** name, top colour, bottom colour: vertical gradients */
    static final String[] PRESETS = { "night", "black", "graphite", "forest", "plum", "ember" };
    private static final int[][] COLORS = {
        { 0xFF22335A, 0xFF141D33 },
        { 0xFF000000, 0xFF000000 },
        { 0xFF2A2D34, 0xFF17191D },
        { 0xFF1F3B33, 0xFF11211C },
        { 0xFF3A2444, 0xFF1C1224 },
        { 0xFF4A2A2A, 0xFF1F1414 },
    };

    /** One file's decode, and the revision it is of. */
    private static final class Slot {
        final String file;
        Bitmap bmp;
        long key = Long.MIN_VALUE;            /* nothing decoded yet */

        Slot(String file) { this.file = file; }

        void forget() {
            bmp = null;
            key = Long.MIN_VALUE;
        }
    }

    private static final Object LOCK = new Object();
    private static final Slot APPLIED = new Slot(PHOTO_FILE);
    private static final Slot DRAFT = new Slot(DRAFT_FILE);

    private Backdrop() {}

    static int[] preset(String name) {
        for (int i = 0; i < PRESETS.length; i++) if (PRESETS[i].equals(name)) return COLORS[i];
        return COLORS[0];
    }

    static boolean known(String name) {
        for (String p : PRESETS) if (p.equals(name)) return true;
        return false;
    }

    /** The backdrop as applied (prefs), filling w x h: the wallpaper, the lock picture, the colours. */
    static void draw(Canvas canvas, int w, int h, Context context) {
        draw(canvas, w, h, context, Look.fromPrefs(Prefs.of(context)));
    }

    /** The backdrop of `look`, filling w x h: the preview of a draft. */
    static void draw(Canvas canvas, int w, int h, Context context, Look look) {
        Bitmap bmp = look.photo ? photo(context, look) : null;
        if (bmp == null) {
            drawPreset(canvas, w, h, look.preset);
            return;
        }
        canvas.drawColor(Color.BLACK);
        canvas.drawBitmap(bmp, centreCrop(bmp.getWidth(), bmp.getHeight(), w, h),
            new Paint(Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG));
        if (look.dim > 0) canvas.drawColor(Color.argb(Math.round(look.dim * 2.55f), 0, 0, 0));
    }

    static void drawPreset(Canvas canvas, int w, int h, String name) {
        int[] c = preset(name);
        Paint g = new Paint();
        g.setDither(true);
        g.setShader(new LinearGradient(0, 0, 0, Math.max(1, h), c[0], c[1], Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, g);
    }

    /** scale to cover w x h, centred */
    private static Matrix centreCrop(int bw, int bh, int w, int h) {
        float s = Math.max((float) w / bw, (float) h / bh);
        Matrix m = new Matrix();
        m.setScale(s, s);
        m.postTranslate((w - bw * s) / 2f, (h - bh * s) / 2f);
        return m;
    }

    /**
     * The photo of `look`, decoded once per revision: the applied one (bg.jpg,
     * keyed by bg_rev) or the draft (bg_draft.jpg, keyed by its import stamp).
     * Null if there is none or it cannot be read: the caller falls back to the
     * preset. The first decode of each happens on the main thread.
     */
    static Bitmap photo(Context context, Look look) {
        if (look.draftPhoto) return decode(context, DRAFT, look.stamp);
        return decode(context, APPLIED, Prefs.of(context).getInt(Prefs.BG_REV, 0));
    }

    private static Bitmap decode(Context context, Slot slot, long key) {
        synchronized (LOCK) {
            if (key == slot.key) return slot.bmp;
            slot.key = key;
            slot.bmp = null;
            File f = new File(context.getApplicationContext().getFilesDir(), slot.file);
            if (!f.isFile()) return null;
            try {
                slot.bmp = BitmapFactory.decodeFile(f.getPath());
                Log.i(TAG, "[BG] " + slot.file + " " +
                    (slot.bmp == null ? "unreadable" : slot.bmp.getWidth() + "x" + slot.bmp.getHeight()));
            } catch (OutOfMemoryError e) {
                Log.w(TAG, "[BG] " + slot.file + " too big to decode", e);
                slot.bmp = null;
            }
            return slot.bmp;
        }
    }

    /** Where the settings screen imports a photo it has not applied yet. */
    static File draftFile(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), DRAFT_FILE);
    }

    /**
     * Apply, for a draft photo: it becomes the applied one. It was written whole
     * when it was imported (a temp file, then a rename), so this is one more
     * rename, over bg.jpg. The preview's decode of it, if there is one, moves
     * over too, keyed by `rev` - the bg_rev the caller stores next - so the
     * wallpaper does not decode the same picture again. False, and nothing
     * changed, if the draft file is not there. Main thread, like every draw.
     */
    static boolean adoptDraft(Context context, long stamp, int rev) {
        File dir = context.getApplicationContext().getFilesDir();
        File src = new File(dir, DRAFT_FILE), dst = new File(dir, PHOTO_FILE);
        if (!src.isFile() || !replace(src, dst)) {
            Log.w(TAG, "[BG] the draft photo could not be applied");
            return false;
        }
        synchronized (LOCK) {
            if (DRAFT.key == stamp && DRAFT.bmp != null) {
                APPLIED.bmp = DRAFT.bmp;
                APPLIED.key = rev;
            }
            DRAFT.forget();
        }
        Log.i(TAG, "[BG] draft photo applied, bg_rev " + rev);
        return true;
    }

    /** A draft photo that will not be applied: its file (and a half-written one) and its decode. */
    static void dropDraft(Context context) {
        synchronized (LOCK) {
            DRAFT.forget();
        }
        File f = draftFile(context);
        boolean had = f.delete();
        new File(f.getPath() + ".tmp").delete();
        if (had) Log.i(TAG, "[BG] draft photo dropped");
    }

    /** src renamed over dst (a rename replaces it; failing that, dst deleted first). */
    private static boolean replace(File src, File dst) {
        if (src.renameTo(dst)) return true;
        dst.delete();
        return src.renameTo(dst);
    }

    /**
     * Copies the picture at `uri` into `dst`, upright and centre-cropped to the
     * portrait screen (written as dst.tmp, then renamed). Call it off the main
     * thread; throws on failure. The settings screen imports into
     * files/bg_draft.jpg (draftFile), never straight into bg.jpg. "Restore from
     * photo" uses it too, so a photo put back as a wallpaper is upright and
     * screen-sized like the backdrop.
     */
    static void importPhoto(Context context, Uri uri, File dst) throws IOException {
        Context app = context.getApplicationContext();
        ContentResolver cr = app.getContentResolver();

        /* the portrait screen, in real pixels */
        Point real = new Point();
        ((WindowManager) app.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealSize(real);
        int tw = Math.min(real.x, real.y), th = Math.max(real.x, real.y);

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        InputStream in = open(cr, uri);
        try { BitmapFactory.decodeStream(in, null, bounds); } finally { close(in); }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("not a picture: " + uri);

        int orientation = orientation(cr, uri);
        boolean swap = orientation >= 5 && orientation <= 8;
        int shownW = swap ? bounds.outHeight : bounds.outWidth;     /* as it is meant to be seen */
        int shownH = swap ? bounds.outWidth : bounds.outHeight;

        /* the largest power-of-two subsample that still covers the screen */
        int sample = 1;
        while (shownW / (sample * 2) >= tw && shownH / (sample * 2) >= th) sample *= 2;

        Bitmap decoded = null, out = null;
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            in = open(cr, uri);
            try { decoded = BitmapFactory.decodeStream(in, null, o); } finally { close(in); }
            if (decoded == null) throw new IOException("could not decode " + uri);

            int dw = decoded.getWidth(), dh = decoded.getHeight();
            int sw = swap ? dh : dw, sh = swap ? dw : dh;               /* upright size */
            float cover = Math.max((float) tw / sw, (float) th / sh);   /* > 1: smaller than the screen */
            float cropW = tw / cover, cropH = th / cover;               /* the centre region, upright px */
            float scale = Math.min(1f, cover);                          /* never upscale */
            int ow = Math.max(1, Math.round(cropW * scale)), oh = Math.max(1, Math.round(cropH * scale));

            Matrix m = exif(orientation, dw, dh);
            m.postTranslate(-(sw - cropW) / 2f, -(sh - cropH) / 2f);
            m.postScale(scale, scale);

            out = Bitmap.createBitmap(ow, oh, Bitmap.Config.ARGB_8888);
            new Canvas(out).drawBitmap(decoded, m, new Paint(Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG));
            decoded.recycle();
            decoded = null;

            File tmp = new File(dst.getPath() + ".tmp");
            FileOutputStream os = new FileOutputStream(tmp);
            boolean ok;
            try { ok = out.compress(Bitmap.CompressFormat.JPEG, 92, os); } finally { close(os); }
            if (!ok) { tmp.delete(); throw new IOException("could not write " + tmp); }
            if (!replace(tmp, dst)) throw new IOException("could not rename " + tmp);
            Log.i(TAG, "[BG] imported " + bounds.outWidth + "x" + bounds.outHeight + " orientation " + orientation +
                " sample " + sample + " -> " + ow + "x" + oh + " for a " + tw + "x" + th + " screen");
        } catch (OutOfMemoryError e) {
            throw new IOException("picture too big", e);
        } finally {
            if (decoded != null) decoded.recycle();
            if (out != null) out.recycle();
        }
    }

    /** EXIF orientation (1..8), 1 when unknown or below API 24 */
    private static int orientation(ContentResolver cr, Uri uri) {
        if (Build.VERSION.SDK_INT < 24) return 1;
        InputStream in = null;
        try {
            in = cr.openInputStream(uri);
            if (in == null) return 1;
            android.media.ExifInterface x = new android.media.ExifInterface(in);
            int o = x.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1);
            return (o >= 1 && o <= 8) ? o : 1;
        } catch (Throwable t) {
            return 1;
        } finally {
            close(in);
        }
    }

    /** decoded pixels -> upright pixels, for each EXIF orientation */
    private static Matrix exif(int o, int w, int h) {
        float[] v;
        switch (o) {
            case 2: v = new float[] { -1, 0, w, 0, 1, 0 }; break;     /* mirrored */
            case 3: v = new float[] { -1, 0, w, 0, -1, h }; break;    /* 180 */
            case 4: v = new float[] { 1, 0, 0, 0, -1, h }; break;     /* flipped */
            case 5: v = new float[] { 0, 1, 0, 1, 0, 0 }; break;      /* transposed */
            case 6: v = new float[] { 0, -1, h, 1, 0, 0 }; break;     /* 90 clockwise */
            case 7: v = new float[] { 0, -1, h, -1, 0, w }; break;    /* transversed */
            case 8: v = new float[] { 0, 1, 0, -1, 0, w }; break;     /* 270 clockwise */
            default: return new Matrix();
        }
        Matrix m = new Matrix();
        m.setValues(new float[] { v[0], v[1], v[2], v[3], v[4], v[5], 0, 0, 1 });
        return m;
    }

    /** API 27+ only: the platform derives Material You colours and the dark-text hint from this. */
    static WallpaperColors colors(Context context) {
        Bitmap small = Bitmap.createBitmap(108, 192, Bitmap.Config.ARGB_8888);
        draw(new Canvas(small), 108, 192, context);
        return WallpaperColors.fromBitmap(small);     /* not recycled: it may keep a reference */
    }

    private static InputStream open(ContentResolver cr, Uri uri) throws IOException {
        InputStream in = cr.openInputStream(uri);
        if (in == null) throw new IOException("cannot open " + uri);
        return in;
    }

    private static void close(java.io.Closeable c) {
        if (c == null) return;
        try { c.close(); } catch (IOException ignored) {}
    }
}
