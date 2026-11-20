package com.lili.wallpaper;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

/**
 * How Lili looks: what is behind her (a preset, or a photo and how dark it
 * is), her size and how high she stands. Immutable.
 *
 * The settings screen edits one of these as a draft. Nothing reaches prefs -
 * so neither the running wallpaper nor the lock picture changes - until the
 * user applies it: SettingsActivity.commit() is the one caller of toPrefs()
 * (group I of check-wallpaper.js checks that). The preview draws a draft as it
 * is (a LiliView given a Look). The live wallpaper and the lock picture read
 * prefs, as they always did.
 *
 * The photo. draftPhoto false is the applied one, files/bg.jpg. True is one
 * chosen in the settings screen and not applied yet, files/bg_draft.jpg
 * (Backdrop.DRAFT_FILE), imported at `stamp`, which tells two picks apart for
 * the decode cache. A preset look has neither: the constructor drops them, so
 * a draft that moves to a preset no longer refers to the draft photo.
 *
 * equals() compares what is seen: the preset only when there is no photo, the
 * darkening and the photo only when there is one.
 */
final class Look {

    /** An Intent extra (a Bundle) carrying a look: settings to the preview, and back on Apply. */
    static final String EXTRA = "com.lili.wallpaper.LOOK";

    final boolean photo;        /* a photo behind her, not a preset */
    final String preset;        /* a name in Backdrop.PRESETS */
    final int dim;              /* % of black over the photo */
    final int size;             /* stage width, % of the largest 9:16 box */
    final int lift;             /* stage bottom, % of the screen height */
    final boolean draftPhoto;   /* the photo is files/bg_draft.jpg, not applied yet */
    final long stamp;           /* ...imported then; 0 without a draft photo */

    Look(boolean photo, String preset, int dim, int size, int lift, boolean draftPhoto, long stamp) {
        this.photo = photo;
        this.preset = Backdrop.known(preset) ? preset : Prefs.DEF_PRESET;
        this.dim = Prefs.clamp(dim, Prefs.DIM_MIN, Prefs.DIM_MAX);
        this.size = Prefs.clamp(size, Prefs.SIZE_MIN, Prefs.SIZE_MAX);
        this.lift = Prefs.clamp(lift, Prefs.LIFT_MIN, Prefs.LIFT_MAX);
        this.draftPhoto = photo && draftPhoto;
        this.stamp = this.draftPhoto ? stamp : 0;
    }

    /** What is applied now. */
    static Look fromPrefs(SharedPreferences p) {
        return new Look(Prefs.photo(p), p.getString(Prefs.BG_PRESET, Prefs.DEF_PRESET),
            Prefs.dim(p), Prefs.size(p), Prefs.lift(p), false, 0);
    }

    /**
     * Apply: every look key in one editor, one apply(). A key whose value does
     * not change notifies nobody; each one that does is heard once.
     * rev: the bg_rev to store (one more than before when a photo was moved in).
     */
    void toPrefs(SharedPreferences p, int rev) {
        p.edit()
            .putString(Prefs.BG_KIND, photo ? Prefs.KIND_PHOTO : Prefs.KIND_PRESET)
            .putString(Prefs.BG_PRESET, preset)
            .putInt(Prefs.BG_DIM, dim)
            .putInt(Prefs.SIZE, size)
            .putInt(Prefs.LIFT, lift)
            .putInt(Prefs.BG_REV, rev)
            .apply();
    }

    Look withPreset(String name) {
        return new Look(false, name, dim, size, lift, false, 0);
    }

    /** A photo just imported into files/bg_draft.jpg. */
    Look withDraftPhoto(long when) {
        return new Look(true, preset, dim, size, lift, true, when);
    }

    Look withDim(int v) {
        return new Look(photo, preset, v, size, lift, draftPhoto, stamp);
    }

    Look withSize(int v) {
        return new Look(photo, preset, dim, v, lift, draftPhoto, stamp);
    }

    Look withLift(int v) {
        return new Look(photo, preset, dim, size, v, draftPhoto, stamp);
    }

    /** Her size and height from this one, the backdrop from `o`. */
    Look withBackgroundOf(Look o) {
        return new Look(o.photo, o.preset, o.dim, size, lift, o.draftPhoto, o.stamp);
    }

    /** As it is once applied: its photo, if any, is files/bg.jpg. */
    Look applied() {
        return new Look(photo, preset, dim, size, lift, false, 0);
    }

    /** What the page's boot config and Wall.apply() take. */
    String pageConfig() {
        return Prefs.pageConfig(size, lift);
    }

    /* ---- carried in a Bundle: onSaveInstanceState, and the preview's Intent both ways ---- */

    Bundle toBundle() {
        Bundle b = new Bundle();
        b.putBoolean("photo", photo);
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
            return new Look(b.getBoolean("photo"), b.getString("preset"), b.getInt("dim", Prefs.DEF_DIM),
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
        if (photo != l.photo || size != l.size || lift != l.lift) return false;
        if (!photo) return preset.equals(l.preset);
        return dim == l.dim && draftPhoto == l.draftPhoto && stamp == l.stamp;
    }

    @Override
    public int hashCode() {
        int h = (photo ? 1 : 0) * 31 + size;
        h = h * 31 + lift;
        if (!photo) return h * 31 + preset.hashCode();
        h = h * 31 + dim;
        h = h * 31 + (draftPhoto ? 1 : 0);
        return h * 31 + (int) (stamp ^ (stamp >>> 32));
    }

    @Override
    public String toString() {
        return (photo ? "photo" + (draftPhoto ? " (draft " + stamp + ")" : "") + " dim " + dim : preset) +
            ", size " + size + ", lift " + lift;
    }
}
