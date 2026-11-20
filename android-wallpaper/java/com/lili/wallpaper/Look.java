package com.lili.wallpaper;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

/**
 * How Lili looks: what is behind her (a preset, a photo of one's own, or "My
 * wallpaper", and how dark a picture is), her size and how high she stands.
 * Immutable.
 *
 * The settings screen edits one of these as a draft. Nothing reaches prefs -
 * so neither the running wallpaper nor the lock picture changes - until the
 * user applies it: SettingsActivity.commit() is the one caller of toPrefs()
 * (group I of check-wallpaper.js checks that). The preview draws a draft as it
 * is (a LiliView given a Look). The live wallpaper and the lock picture read
 * prefs, as they always did.
 *
 * The kind (Prefs.KIND_*):
 *   preset    one of Backdrop.PRESETS
 *   photo     the "Choose photo..." slot. draftPhoto false is the applied one,
 *             files/bg.jpg. True is one chosen in the settings screen and not
 *             applied yet, files/bg_draft.jpg (Backdrop.DRAFT_FILE), imported at
 *             `stamp`, which tells two picks apart for the decode cache.
 *   original  "My wallpaper": the picture the user had as their home wallpaper,
 *             kept for good as files/original.jpg (Original). A slot of its own:
 *             choosing a photo never replaces it.
 * Only a photo has draftPhoto and stamp: the constructor drops them otherwise,
 * so a draft that moves away from a draft photo no longer refers to it. The
 * darkening applies to both pictures (picture()).
 *
 * equals() compares what is seen: the preset only for a preset, the darkening
 * only for a picture, the draft photo and its stamp only for a photo.
 */
final class Look {

    /** An Intent extra (a Bundle) carrying a look: settings to the preview, and back on Apply. */
    static final String EXTRA = "com.lili.wallpaper.LOOK";

    final String kind;          /* Prefs.KIND_PRESET | KIND_PHOTO | KIND_ORIGINAL */
    final boolean photo;        /* the "Choose photo..." picture behind her */
    final boolean original;     /* My wallpaper behind her */
    final String preset;        /* a name in Backdrop.PRESETS */
    final int dim;              /* % of black over a picture */
    final int size;             /* stage width, % of the largest 9:16 box */
    final int lift;             /* stage bottom, % of the screen height */
    final boolean draftPhoto;   /* the photo is files/bg_draft.jpg, not applied yet */
    final long stamp;           /* ...imported then; 0 without a draft photo */

    Look(String kind, String preset, int dim, int size, int lift, boolean draftPhoto, long stamp) {
        this.kind = Prefs.knownKind(kind) ? kind : Prefs.KIND_PRESET;
        this.photo = Prefs.KIND_PHOTO.equals(this.kind);
        this.original = Prefs.KIND_ORIGINAL.equals(this.kind);
        this.preset = Backdrop.known(preset) ? preset : Prefs.DEF_PRESET;
        this.dim = Prefs.clamp(dim, Prefs.DIM_MIN, Prefs.DIM_MAX);
        this.size = Prefs.clamp(size, Prefs.SIZE_MIN, Prefs.SIZE_MAX);
        this.lift = Prefs.clamp(lift, Prefs.LIFT_MIN, Prefs.LIFT_MAX);
        this.draftPhoto = photo && draftPhoto;
        this.stamp = this.draftPhoto ? stamp : 0;
    }

    /** A picture is behind her (a photo or My wallpaper): the darkening applies. */
    boolean picture() {
        return photo || original;
    }

    /** What is applied now. Before the first Apply: My wallpaper once it is kept (Prefs.kind). */
    static Look fromPrefs(SharedPreferences p) {
        return new Look(Prefs.kind(p), p.getString(Prefs.BG_PRESET, Prefs.DEF_PRESET),
            Prefs.dim(p), Prefs.size(p), Prefs.lift(p), false, 0);
    }

    /**
     * Apply: every look key in one editor, one apply(). A key whose value does
     * not change notifies nobody; each one that does is heard once.
     * rev: the bg_rev to store (one more than before when a photo was moved in).
     */
    void toPrefs(SharedPreferences p, int rev) {
        p.edit()
            .putString(Prefs.BG_KIND, kind)
            .putString(Prefs.BG_PRESET, preset)
            .putInt(Prefs.BG_DIM, dim)
            .putInt(Prefs.SIZE, size)
            .putInt(Prefs.LIFT, lift)
            .putInt(Prefs.BG_REV, rev)
            .apply();
    }

    Look withPreset(String name) {
        return new Look(Prefs.KIND_PRESET, name, dim, size, lift, false, 0);
    }

    /** My wallpaper behind her (files/original.jpg). */
    Look withOriginal() {
        return new Look(Prefs.KIND_ORIGINAL, preset, dim, size, lift, false, 0);
    }

    /** A photo just imported into files/bg_draft.jpg. */
    Look withDraftPhoto(long when) {
        return new Look(Prefs.KIND_PHOTO, preset, dim, size, lift, true, when);
    }

    Look withDim(int v) {
        return new Look(kind, preset, v, size, lift, draftPhoto, stamp);
    }

    Look withSize(int v) {
        return new Look(kind, preset, dim, v, lift, draftPhoto, stamp);
    }

    Look withLift(int v) {
        return new Look(kind, preset, dim, size, v, draftPhoto, stamp);
    }

    /** Her size and height from this one, the backdrop from `o`. */
    Look withBackgroundOf(Look o) {
        return new Look(o.kind, o.preset, o.dim, size, lift, o.draftPhoto, o.stamp);
    }

    /** As it is once applied: its photo, if any, is files/bg.jpg. */
    Look applied() {
        return new Look(kind, preset, dim, size, lift, false, 0);
    }

    /** What the page's boot config and Wall.apply() take. */
    String pageConfig() {
        return Prefs.pageConfig(size, lift);
    }

    /* ---- carried in a Bundle: onSaveInstanceState, and the preview's Intent both ways ---- */

    Bundle toBundle() {
        Bundle b = new Bundle();
        b.putString("kind", kind);
        b.putString("preset", preset);
        b.putInt("dim", dim);
        b.putInt("size", size);
        b.putInt("lift", lift);
        b.putBoolean("draft_photo", draftPhoto);
        b.putLong("stamp", stamp);
        return b;
    }

    /** Null when there is none or it cannot be read; every value checked again by the constructor. */
    static Look fromBundle(Bundle b) {
        if (b == null) return null;
        try {
            if (!b.containsKey("size")) return null;
            String kind = b.getString("kind");
            if (kind == null) kind = b.getBoolean("photo") ? Prefs.KIND_PHOTO : Prefs.KIND_PRESET;  /* an older build's */
            return new Look(kind, b.getString("preset"), b.getInt("dim", Prefs.DEF_DIM),
                b.getInt("size", Prefs.DEF_SIZE), b.getInt("lift", Prefs.DEF_LIFT),
                b.getBoolean("draft_photo"), b.getLong("stamp"));
        } catch (RuntimeException e) {
            return null;                          /* a Bundle that does not unparcel */
        }
    }

    void into(Intent i) {
        i.putExtra(EXTRA, toBundle());
    }

    /** The look an Intent carries, or null. */
    static Look from(Intent i) {
        if (i == null) return null;
        try {
            return fromBundle(i.getBundleExtra(EXTRA));
        } catch (RuntimeException e) {
            return null;
        }
    }

    @Override
    public boolean equals(Object o) {
        if (o == this) return true;
        if (!(o instanceof Look)) return false;
        Look l = (Look) o;
        if (!kind.equals(l.kind) || size != l.size || lift != l.lift) return false;
        if (!picture()) return preset.equals(l.preset);
        if (dim != l.dim) return false;
        return !photo || (draftPhoto == l.draftPhoto && stamp == l.stamp);
    }

    @Override
    public int hashCode() {
        int h = kind.hashCode() * 31 + size;
        h = h * 31 + lift;
        if (!picture()) return h * 31 + preset.hashCode();
        h = h * 31 + dim;
        h = h * 31 + (draftPhoto ? 1 : 0);
        return h * 31 + (int) (stamp ^ (stamp >>> 32));
    }

    @Override
    public String toString() {
        String bg = photo ? "photo" + (draftPhoto ? " (draft " + stamp + ")" : "") + " dim " + dim
                  : original ? "my wallpaper dim " + dim : preset;
        return bg + ", size " + size + ", lift " + lift;
    }
}
