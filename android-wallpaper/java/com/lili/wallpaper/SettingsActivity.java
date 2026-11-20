package com.lili.wallpaper;

import android.Manifest;
import android.app.Activity;
import android.app.Dialog;
import android.app.WallpaperInfo;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * The launcher icon and the wallpaper picker's settings button both open this.
 *
 * Native views built in code, framework only, on an opaque screen (nothing of
 * the wallpaper shows through): WHERE LILI LIVES - two switches, Home screen
 * and Lock screen, each with a line saying what that screen shows now; the
 * backdrop presets, a photo of one's own, how dark that photo is, her size and
 * how high she stands, Preview; and the caveats.
 *
 * The look - background, photo, darkening, size, height - is a DRAFT (a Look)
 * held here. Nothing of it reaches prefs, so neither the running wallpaper nor
 * the lock picture changes, until the user applies it: Preview shows the draft
 * full screen (PreviewActivity), and its Apply comes back here to commit()
 * - the one place the look is written, in one apply(). Its Cancel, or Back,
 * keeps the draft as it was. A line says "Changes not applied yet" while the
 * draft differs from what is applied, and Preview is then the primary button.
 * Back with changes waiting asks: Apply, Discard or Keep editing. The draft
 * survives a recreation (onSaveInstanceState); a fresh open starts from prefs.
 * The switches are not part of it: they act at once.
 *
 * A photo chosen here is imported into files/bg_draft.jpg, never bg.jpg; Apply
 * moves it over bg.jpg and bumps bg_rev (Backdrop.adoptDraft), and a draft
 * that lets go of it deletes it. The file is shared by every settings screen
 * in the process (the launcher's and the picker's), so the one that imported
 * last owns it (photoOwner), and no other deletes it from under it.
 *
 * The switches show the real state of the phone, read again on every resume
 * and after every action, never only what was asked for.
 *
 * Home screen: on when getWallpaperInfo() is LiliWallpaper. Turning it on
 * saves what is on both screens now (Backup.beforeHome: on stock Android the
 * picker's "Home screen and lock screen" replaces the lock wallpaper too; it
 * asks for READ_EXTERNAL_STORAGE where that helps, API 23-32, and carries on
 * without it), then opens the system picker for Lili. Turning it off puts the
 * saved home wallpaper back - and the saved lock wallpaper as well, when her
 * live wallpaper was covering the lock screen. The preview's "Apply and set as
 * wallpaper" commits, then turns it on the same way.
 *
 * Lock screen: can no longer be turned on (Android has no API to animate the
 * lock screen, and the still picture of her is blocked in this version; see
 * docs/WALLPAPER.md section 8 - LockPicture and LockJob stay in the tree).
 *   on, enabled   her picture from an earlier build is still on the lock screen
 *                 (getWallpaperId(FLAG_LOCK) is the id we stored), or her live
 *                 wallpaper is on the lock screen alone (API 34+). It can only
 *                 be turned off: the saved lock wallpaper back.
 *   on, disabled  her live wallpaper covers the lock screen with the home
 *                 screen: getWallpaperInfo(FLAG_LOCK) is ours (API 34+), or the
 *                 lock screen has no wallpaper of its own (getWallpaperId(
 *                 FLAG_LOCK) < 0, or below API 24) while Home is on. Turning
 *                 Home off ends it.
 *   off           disabled, saying why and what works instead.
 * With nothing saved for a screen being turned off, a small dialog offers a
 * photo, the system default, or Cancel, which leaves the switch on.
 *
 * Setting a live wallpaper: CHANGE_LIVE_WALLPAPER naming it; failing that the
 * live wallpaper chooser; failing that a hint. resolveActivity() is not used -
 * on Android 11+ package visibility makes it answer "no" for things that are
 * there - so the intents are simply tried.
 *
 * Colours: nothing on this screen, or on the preview's buttons, takes a colour
 * from the theme. On Huawei the theme's Button was drawn white while its text
 * stayed white. Every view gets its text colour and its background from the
 * constants below, and tools/check-wallpaper.js (group I) checks their contrast
 * and that no other colour or unstyled control sneaks in.
 *
 * The photo comes from the system picker and is copied once, on a worker
 * thread, so no URI grant is kept.
 */
public class SettingsActivity extends Activity {

    private static final String TAG = LiliWeb.TAG;
    private static final int REQ_PHOTO = 1, REQ_RESTORE_HOME = 2, REQ_RESTORE_LOCK = 3, REQ_READ = 4, REQ_PREVIEW = 5;
    private static final int HOME = 1, LOCK = 2;                    /* the screens; 0 = none */
    private static final int PICK_LILI = 1, PICK_OLD = 2;           /* what the system picker was opened for */
    private static final int S_DIM = 0, S_SIZE = 1, S_LIFT = 2;     /* the sliders */
    private static final String STATE_DRAFT = "draft";

    /* ---- every colour on this screen and the preview's buttons (group I of check-wallpaper.js reads these lines) ---- */
    static final int PANEL = 0xFF121821;            /* the whole screen, opaque: nothing shows through */
    static final int TEXT = 0xFFE6E9EE;             /* labels on the panel and in the dialogs */
    static final int TEXT_DIM = 0xFFAAB2BF;         /* headings, status lines, tips; a disabled label */
    static final int BUTTON = 0xFF2B3546;           /* a button's face */
    static final int BUTTON_DOWN = 0xFF3A475D;      /* ...pressed */
    static final int BUTTON_TEXT = 0xFFF2F4F7;
    static final int BUTTON_OFF = 0xFF1C2330;       /* a disabled button's face */
    static final int BUTTON_OFF_TEXT = 0xFF8C95A3;
    static final int PRIMARY = 0xFF2F64B8;          /* the step to take next: Apply; Preview with changes waiting */
    static final int PRIMARY_DOWN = 0xFF214A85;     /* ...pressed */
    static final int EDGE = 0xFF6B7385;             /* a button's outline; a switch's track when off; a slider's rail */
    static final int OUTLINE = 0xFF8089A0;          /* a button's outline over her backdrop (the preview): any preset, white, black */
    static final int ACCENT = 0xFF4F86D9;           /* a switch's track when on; a slider's fill */
    static final int KNOB = 0xFFF5F7FA;             /* a switch's and a slider's knob; the chosen swatch's ring */
    static final int DISABLED = 0xFF343C4A;         /* a disabled switch's track, off */
    static final int DISABLED_ON = 0xFF33507D;      /* a disabled switch's track, on: still reads as on */
    static final int KNOB_OFF = 0xFFA3ABB8;         /* a disabled switch's knob */
    static final int DIALOG = 0xFF1A2230;           /* the dialogs */
    static final int RIPPLE = 0x33FFFFFF;           /* touch feedback */

    /* The settings screen whose draft holds files/bg_draft.jpg (it imported it
     * last). The launcher and the wallpaper picker can each open one; a fresh
     * one must not delete a draft photo that another live one still holds. */
    private static WeakReference<SettingsActivity> photoOwner;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private Context app;

    private Switch homeSwitch, lockSwitch;
    private TextView homeLine, lockLine;
    private TextView hint, huaweiTip;
    private final Swatch[] swatches = new Swatch[Backdrop.PRESETS.length];
    private Button photoButton, previewButton;
    private View dimRow;
    private SeekBar dimBar, sizeBar, liftBar;
    private TextView notApplied;
    private Dialog dialog;          /* the no-backup dialog */
    private Dialog leaving;         /* Back with changes waiting: Apply, Discard, Keep editing */

    private Look saved;             /* the look as applied (prefs), as last read */
    private Look draft;             /* the look as set here; it reaches prefs only through commit() */
    private boolean shownDirty;     /* the "not applied" line is up and Preview is the primary button */

    private boolean importing;      /* a photo is being copied into the draft */
    private int saving;             /* the screen whose wallpaper is being saved before Lili takes it */
    private int waiting;            /* ...whose turn-on waits for the READ_EXTERNAL_STORAGE answer */
    private boolean asked;          /* READ_EXTERNAL_STORAGE asked for, for this turn-on */
    private int restoring;          /* the screen whose previous wallpaper is being put back */
    private int asking;             /* the screen the no-backup dialog is about */
    private int picking;            /* the system picker is open for Home: PICK_LILI or PICK_OLD, until we are back */
    private boolean alsoLock;       /* Home is being turned off while her live wallpaper covers the lock screen:
                                     * the lock screen gets its saved wallpaper back too */
    private boolean lockAfterPicker;/* ...and that waits for the picker to have put the old live wallpaper back */

    private final Runnable refresher = new Runnable() {
        public void run() { refresh(); }
    };
    /* after a resume: once more, in case the system was a moment behind; the
     * last chance for the lock screen to follow an old live wallpaper back */
    private final Runnable recheck = new Runnable() {
        public void run() {
            refresh();
            if (lockAfterPicker) {                /* the picker was cancelled: Lili is still at home */
                lockAfterPicker = false;
                alsoLock = false;
            }
        }
    };

    private final CompoundButton.OnCheckedChangeListener homeFlip = new CompoundButton.OnCheckedChangeListener() {
        public void onCheckedChanged(CompoundButton b, boolean on) {
            if (on) homeOn(); else homeOff();
        }
    };

    /* enabled only while it is on and can be turned off; nothing turns lock mode on */
    private final CompoundButton.OnCheckedChangeListener lockFlip = new CompoundButton.OnCheckedChangeListener() {
        public void onCheckedChanged(CompoundButton b, boolean on) {
            if (on) refresh(); else lockOff();
        }
    };

    /* Prefs changed: the lock screen's state (a picture set, lock mode off), the
     * backups, or the look applied (here, or by another settings screen). The
     * panel again, once. The lock picture's re-render after an Apply is asked
     * for by commit() itself, once. A field: prefs hold listeners weakly. */
    private final SharedPreferences.OnSharedPreferenceChangeListener watch =
        new SharedPreferences.OnSharedPreferenceChangeListener() {
            public void onSharedPreferenceChanged(SharedPreferences p, String key) {
                if (key == null) return;
                main.removeCallbacks(refresher);
                main.post(refresher);
            }
        };

    @Override
    protected void onCreate(Bundle state) {
        Log.i(TAG, "[LIFE] settings onCreate " + getPackageName());
        super.onCreate(state);
        app = getApplicationContext();
        prefs = Prefs.of(this);
        saved = Look.fromPrefs(prefs);
        Look kept = null;
        if (state != null) {
            /* recreated: while the permission question was up, or after the
             * process was reclaimed in the background - the draft as it was */
            waiting = state.getInt("waiting");
            asked = state.getBoolean("asked");
            kept = Look.fromBundle(state.getBundle(STATE_DRAFT));
        }
        if (kept != null) {
            draft = kept;
            if (draft.draftPhoto && otherPhotoOwner() == null) photoOwner = new WeakReference<SettingsActivity>(this);
        } else {
            /* a fresh open starts from what is applied; a draft photo left by a
             * settings screen that is gone (Home, then swiped away) goes */
            draft = saved;
            if (otherPhotoOwner() == null) Backdrop.dropDraft(app);
        }
        prefs.registerOnSharedPreferenceChangeListener(watch);

        /* opaque, all of it, the system bars too: nothing of any wallpaper shows */
        Window win = getWindow();
        win.setBackgroundDrawable(new ColorDrawable(PANEL));
        win.setStatusBarColor(PANEL);
        win.setNavigationBarColor(PANEL);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        col.setPadding(pad, pad, pad, pad);

        /* ---- where she lives: these act at once ---- */
        col.addView(text(getString(R.string.where_heading), 15, TEXT_DIM), wrap(0, dp(2)));
        homeSwitch = toggle(R.string.where_home);
        homeLine = text("", 14, TEXT_DIM);
        col.addView(homeSwitch, wrap(0, 0));
        col.addView(homeLine, wrap(0, dp(6)));
        lockSwitch = toggle(R.string.where_lock);
        lockLine = text("", 14, TEXT_DIM);
        col.addView(lockSwitch, wrap(0, 0));
        col.addView(lockLine, wrap(0, dp(6)));

        hint = text(getString(R.string.hint_manual), 14, TEXT_DIM);
        hint.setVisibility(getPackageManager().hasSystemFeature(PackageManager.FEATURE_LIVE_WALLPAPER)
            ? View.GONE : View.VISIBLE);
        col.addView(hint, wrap(dp(4), 0));

        /* only while her picture from an earlier build is kept fresh */
        huaweiTip = text(getString(R.string.huawei_tip), 14, TEXT_DIM);
        col.addView(huaweiTip, wrap(dp(6), 0));

        /* ---- the look: the backdrop, her size and height - a draft until applied ---- */
        col.addView(text(getString(R.string.background), 15, TEXT_DIM), wrap(dp(16), dp(8)));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < Backdrop.PRESETS.length; i++) {
            final String name = Backdrop.PRESETS[i];
            Swatch s = new Swatch(this, name);
            s.setContentDescription(name);
            s.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) { setDraft(draft.withPreset(name)); }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(52), 1f);
            lp.rightMargin = i < Backdrop.PRESETS.length - 1 ? dp(8) : 0;
            row.addView(s, lp);
            swatches[i] = s;
        }
        col.addView(row, wrap(0, dp(12)));

        photoButton = button(R.string.choose_photo, new View.OnClickListener() {
            public void onClick(View v) { pickPhoto(REQ_PHOTO); }
        });
        col.addView(photoButton, wrap(0, dp(4)));

        TextView dimLabel = text("", 15, TEXT);
        dimBar = slider(Prefs.DIM_MIN, Prefs.DIM_MAX, draft.dim, S_DIM, dimLabel, R.string.darken_photo);
        LinearLayout dimBox = new LinearLayout(this);
        dimBox.setOrientation(LinearLayout.VERTICAL);
        dimBox.addView(dimLabel, wrap(dp(8), 0));
        dimBox.addView(dimBar, wrap(0, 0));
        dimRow = dimBox;
        col.addView(dimBox, wrap(0, dp(4)));

        TextView sizeLabel = text("", 15, TEXT);
        sizeBar = slider(Prefs.SIZE_MIN, Prefs.SIZE_MAX, draft.size, S_SIZE, sizeLabel, R.string.size);
        col.addView(sizeLabel, wrap(dp(12), 0));
        col.addView(sizeBar, wrap(0, 0));

        TextView liftLabel = text("", 15, TEXT);
        liftBar = slider(Prefs.LIFT_MIN, Prefs.LIFT_MAX, draft.lift, S_LIFT, liftLabel, R.string.height);
        col.addView(liftLabel, wrap(dp(12), 0));
        col.addView(liftBar, wrap(0, dp(12)));

        /* only while the draft differs from what is applied */
        notApplied = text(getString(R.string.not_applied), 15, TEXT);
        col.addView(notApplied, wrap(dp(4), dp(8)));
        previewButton = button(R.string.preview, new View.OnClickListener() {
            public void onClick(View v) { preview(); }
        });
        col.addView(previewButton, wrap(0, dp(16)));

        col.addView(text(getString(R.string.note_touch), 14, TEXT_DIM), wrap(0, 0));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(PANEL);
        scroll.setFillViewport(true);
        scroll.addView(col);

        FrameLayout root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        root.addView(scroll, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        homeSwitch.setOnCheckedChangeListener(homeFlip);
        lockSwitch.setOnCheckedChangeListener(lockFlip);
        showDraft(false);                         /* the sliders were made at the draft's values */
    }

    @Override
    protected void onResume() {
        super.onResume();
        /* idempotent; puts the job back if something (a force stop) dropped it */
        if (Prefs.lockOn(prefs)) LockJob.schedule(app);
        checkDraftPhoto();
        /* back from the picker, if it was open: the system says how it went */
        lockAfterPicker = picking == PICK_OLD && alsoLock;
        picking = 0;
        refresh();
        main.removeCallbacks(recheck);
        main.postDelayed(recheck, 800);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt("waiting", waiting);
        out.putBoolean("asked", asked);
        out.putBundle(STATE_DRAFT, draft.toBundle());
    }

    /* Changes not applied: ask first. Home or recents simply leave; a fresh
     * open starts from what is applied. */
    @Override
    public void onBackPressed() {
        if (!draft.equals(saved)) {
            askLeave();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        prefs.unregisterOnSharedPreferenceChangeListener(watch);
        main.removeCallbacks(refresher);
        main.removeCallbacks(recheck);
        if (dialog != null) {
            dialog.setOnDismissListener(null);
            dialog.dismiss();
            dialog = null;
        }
        if (leaving != null) {
            leaving.setOnDismissListener(null);
            leaving.dismiss();
            leaving = null;
        }
        /* gone for good (Back, Discard, the task swiped away): a draft photo nobody applied */
        if (isFinishing() && draft.draftPhoto) dropDraftPhoto();
        super.onDestroy();
    }

    /* ---- the state of things ---- */

    /* what the lock screen shows */
    private static final int L_PREVIOUS = 0;      /* not Lili */
    private static final int L_UPDATING = 1;      /* her picture, a new one on its way */
    private static final int L_PICTURE = 2;       /* her picture, kept fresh */
    private static final int L_STALE = 3;         /* her picture, no longer kept fresh */
    private static final int L_WITH_HOME = 4;     /* her live wallpaper, with the home screen */
    private static final int L_LIVE_ALONE = 5;    /* her live wallpaper, on the lock screen alone (API 34+) */

    /** Everything on the panel that depends on the state of things: the switches from the system, never from prefs alone. */
    private void refresh() {
        if (isDestroyed()) return;
        main.removeCallbacks(refresher);
        boolean homeOurs = homeIsOurs();
        boolean idle = saving == 0 && waiting == 0 && restoring == 0 && asking == 0;

        /* back from the picker, the old live wallpaper in place: the lock screen's turn */
        if (lockAfterPicker && idle && !homeOurs) {
            lockAfterPicker = false;
            alsoLock = false;
            inBackground(LOCK, new Job() {
                public void run() throws Exception { Backup.restoreLockAfterHome(app); }
            });
            return;                               /* inBackground refreshes */
        }

        /* the home screen */
        boolean home = homeOurs;
        String homeText = getString(homeOurs ? R.string.home_on : R.string.screen_previous);
        if (saving == HOME || waiting == HOME) {
            home = true;
            homeText = getString(R.string.saving);
        } else if (restoring == HOME) {
            home = false;
            homeText = getString(R.string.restoring);
        } else if (asking == HOME || picking == PICK_OLD) {
            home = false;
        } else if (picking == PICK_LILI) {
            home = true;
        }
        show(homeSwitch, home, homeFlip);
        homeSwitch.setEnabled(idle);
        homeLine.setText(homeText);

        /* the lock screen */
        boolean lock;
        boolean offable = false;
        String lockText;
        if (restoring == LOCK || (restoring == HOME && alsoLock)) {
            lock = false;
            lockText = getString(R.string.restoring);
        } else {
            int now = lockNow(homeOurs);
            lock = now != L_PREVIOUS && asking != LOCK;
            offable = now != L_PREVIOUS && now != L_WITH_HOME;
            switch (now) {
                case L_UPDATING:
                    lockText = getString(R.string.lock_updating);
                    break;
                case L_PICTURE:
                    lockText = getString(R.string.lock_on, when(prefs.getLong(Prefs.LOCK_AT, 0)));
                    break;
                case L_STALE:
                    lockText = getString(R.string.lock_stale, when(prefs.getLong(Prefs.LOCK_AT, 0)));
                    break;
                case L_WITH_HOME:
                    lockText = getString(R.string.lock_with_home);
                    break;
                case L_LIVE_ALONE:
                    lockText = getString(R.string.home_on);
                    break;
                default:
                    lockText = getString(R.string.lock_unavailable);
            }
        }
        show(lockSwitch, lock, lockFlip);
        lockSwitch.setEnabled(idle && offable);
        lockLine.setText(lockText);
        huaweiTip.setVisibility(huawei() && Prefs.lockOn(prefs) ? View.VISIBLE : View.GONE);

        /* the look as applied - by another settings screen, perhaps; a draft
         * nobody has touched here follows it */
        Look now = Look.fromPrefs(prefs);
        boolean follow = !now.equals(saved) && draft.equals(saved);
        saved = now;
        if (follow) draft = now;
        showDraft(follow);
    }

    /*
     * What the lock screen shows. Lock mode whose picture is no longer there is
     * turned off here, by the same rule as the 3-hourly job: a lock wallpaper
     * changed outside Lili is left alone. When that cannot be told (the call
     * failed), the picture is taken to be still there, as the job does.
     */
    private int lockNow(boolean homeOurs) {
        boolean mode = Prefs.lockOn(prefs);
        if (mode && LockPicture.busy()) return L_UPDATING;
        int state = LockPicture.lockState(this);
        if (state == LockPicture.LOCK_OURS) return mode ? L_PICTURE : L_STALE;
        if (mode) {
            if (prefs.getInt(Prefs.LOCK_ID, 0) <= 0) {
                LockPicture.turnOff(app, "");                       /* a picture that never came */
            } else if (LockPicture.changedByUser(app)) {
                LockPicture.turnOff(app, Prefs.NOTE_CHANGED);
            } else {
                return L_PICTURE;
            }
        }
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                WallpaperInfo info = WallpaperManager.getInstance(this).getWallpaperInfo(WallpaperManager.FLAG_LOCK);
                if (info != null) return !ours(info) ? L_PREVIOUS : homeOurs ? L_WITH_HOME : L_LIVE_ALONE;
            } catch (Throwable ignored) {
                /* fall back to the id */
            }
        }
        /* no lock wallpaper of its own (below API 24 there never is one): it shows the home screen */
        boolean mirror = state == LockPicture.LOCK_MIRROR || state == LockPicture.LOCK_UNSUPPORTED;
        return homeOurs && mirror ? L_WITH_HOME : L_PREVIOUS;
    }

    /** Lili's live wallpaper is on the home screen. The preview asks too, for its Apply button. */
    static boolean homeIsOurs(Context c) {
        try {
            return ours(c, WallpaperManager.getInstance(c).getWallpaperInfo());
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean ours(Context c, WallpaperInfo info) {
        return info != null && c.getPackageName().equals(info.getPackageName()) &&
            LiliWallpaper.class.getName().equals(info.getServiceName());
    }

    private boolean homeIsOurs() {
        return homeIsOurs(this);
    }

    private boolean ours(WallpaperInfo info) {
        return ours(this, info);
    }

    /* "14:05" today, "20 Nov, 14:05" otherwise; 12/24 h as the phone says */
    private String when(long at) {
        if (at <= 0) return "?";
        int f = DateUtils.FORMAT_SHOW_TIME;
        if (!DateUtils.isToday(at)) f |= DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_ABBREV_MONTH;
        return DateUtils.formatDateTime(this, at, f);
    }

    private static boolean huawei() {
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(Locale.ROOT);
        return m.contains("huawei") || m.contains("honor");
    }

    private boolean busy() {
        return saving != 0 || waiting != 0 || restoring != 0 || asking != 0;
    }

    /* ---- the draft: background, photo, darkening, size, height ---- */

    /** The draft on the panel: the chosen swatch, the darkening (photo only), the sliders if asked, and whether it is applied. */
    private void showDraft(boolean sliders) {
        for (Swatch s : swatches) s.setChosen(!draft.photo && s.name.equals(draft.preset));
        dimRow.setVisibility(draft.photo ? View.VISIBLE : View.GONE);
        if (sliders) {
            /* not from the user: the listeners only relabel */
            dimBar.setProgress(draft.dim - Prefs.DIM_MIN);
            sizeBar.setProgress(draft.size - Prefs.SIZE_MIN);
            liftBar.setProgress(draft.lift - Prefs.LIFT_MIN);
        }
        photoButton.setEnabled(!importing);
        previewButton.setEnabled(!importing);     /* a second, until the photo is in the draft */
        boolean dirty = !draft.equals(saved);
        notApplied.setVisibility(dirty ? View.VISIBLE : View.GONE);
        if (dirty != shownDirty) {
            shownDirty = dirty;
            paint(previewButton, dirty);
        }
    }

    /** A new draft from a swatch, a slider or a photo. A draft photo let go of is deleted. */
    private void setDraft(Look next) {
        if (draft.draftPhoto && !next.draftPhoto) dropDraftPhoto();
        draft = next;
        showDraft(false);
    }

    /** Another live settings screen whose draft holds the draft photo, or null. */
    private SettingsActivity otherPhotoOwner() {
        SettingsActivity o = photoOwner != null ? photoOwner.get() : null;
        if (o == null || o == this || o.isDestroyed() || o.isFinishing()) return null;
        return o.draft != null && o.draft.draftPhoto ? o : null;
    }

    /** This draft's photo is still the one in files/bg_draft.jpg. */
    private boolean draftPhotoHere() {
        return draft.draftPhoto && otherPhotoOwner() == null && Backdrop.draftFile(app).isFile();
    }

    /* The draft photo is not wanted any more: deleted, unless another settings
     * screen has imported its own since (the file is theirs now). */
    private void dropDraftPhoto() {
        if (otherPhotoOwner() != null) return;
        Backdrop.dropDraft(app);
        photoOwner = null;
    }

    /* A draft photo that is gone (another settings screen took the file over):
     * the backdrop as applied instead, her size and height kept. */
    private void checkDraftPhoto() {
        if (!draft.draftPhoto || importing || draftPhotoHere()) return;
        Log.i(TAG, "[LIFE] settings: the draft photo is gone");
        setDraft(draft.withBackgroundOf(saved));
        toast(getString(R.string.photo_failed));
    }

    /* Preview: the draft full screen, whether or not anything changed. */
    private void preview() {
        if (importing) return;
        checkDraftPhoto();
        Intent i = new Intent(this, PreviewActivity.class);
        draft.into(i);
        try {
            startActivityForResult(i, REQ_PREVIEW);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "[LIFE] settings: no preview", e);
        }
    }

    /* Back from the preview. Apply: the draft it showed is applied, and when
     * the button said "Apply and set as wallpaper", Home is turned on as by
     * the switch. Cancel or Back: the draft stays as it was. */
    private void previewed(int result, Intent data) {
        if (result != RESULT_OK) return;
        Look look = Look.from(data);
        if (look == null) look = draft;
        boolean setHome = data != null && data.getBooleanExtra(PreviewActivity.EXTRA_SET_HOME, false);
        if (!commit(look)) return;
        if (setHome && !homeIsOurs()) homeOn();               /* its own toasts follow */
        else toast(getString(R.string.applied), Toast.LENGTH_SHORT);
    }

    /**
     * Apply: the only place the look reaches prefs (group I checks it). A draft
     * photo is moved over bg.jpg first, its bg_rev bumped; then every look key
     * in one apply(), so the engines and the lock picture hear it once. The
     * draft is then what is applied, and the "not applied" line goes.
     */
    private boolean commit(Look look) {
        if (look.draftPhoto && !(draft.draftPhoto && draft.stamp == look.stamp && draftPhotoHere())) {
            /* not this draft's photo, or not there any more: nothing is applied */
            boolean gone = draft.draftPhoto && !importing && !draftPhotoHere();
            if (gone) checkDraftPhoto();          /* says so, and falls back to the applied background */
            else toast(getString(R.string.photo_failed));
            return false;
        }
        if (!look.equals(Look.fromPrefs(prefs))) {
            int rev = prefs.getInt(Prefs.BG_REV, 0);
            if (look.draftPhoto) {
                if (!Backdrop.adoptDraft(app, look.stamp, rev + 1)) {
                    toast(getString(R.string.photo_failed));
                    return false;
                }
                rev++;
                photoOwner = null;                /* the file is bg.jpg now */
            }
            look.applied().toPrefs(prefs, rev);
            Log.i(TAG, "[LIFE] settings: applied " + look);
            /* her lock picture from an earlier build, while lock mode is on: one new picture */
            if (Prefs.lockOn(prefs)) LockPicture.requestSoon(app);
        }
        if (draft.draftPhoto && !look.draftPhoto) dropDraftPhoto();
        saved = Look.fromPrefs(prefs);
        draft = saved;
        showDraft(true);
        return true;
    }

    /* Leaving without applying: the draft photo, if any, deleted; prefs untouched. */
    private void discard() {
        if (draft.draftPhoto) dropDraftPhoto();
        draft = saved;
        Log.i(TAG, "[LIFE] settings: draft discarded");
    }

    /* Back with changes not applied: Apply, Discard, or Keep editing (as the dialog's own Back does). */
    private void askLeave() {
        if (leaving != null) return;
        final Dialog d = newDialog();
        LinearLayout box = dialogBox(getString(R.string.leave_unapplied));
        Button apply = button(R.string.apply, new View.OnClickListener() {
            public void onClick(View v) {
                d.dismiss();
                if (!commit(draft)) return;
                toast(getString(R.string.applied), Toast.LENGTH_SHORT);
                finish();
            }
        });
        paint(apply, true);
        box.addView(apply, wrap(0, dp(8)));
        box.addView(button(R.string.discard, new View.OnClickListener() {
            public void onClick(View v) {
                d.dismiss();
                discard();
                finish();
            }
        }), wrap(0, dp(8)));
        box.addView(button(R.string.keep_editing, new View.OnClickListener() {
            public void onClick(View v) { d.cancel(); }
        }), wrap(0, 0));
        d.setOnDismissListener(new DialogInterface.OnDismissListener() {
            public void onDismiss(DialogInterface di) {
                if (leaving == d) leaving = null;
            }
        });
        leaving = d;
        open(d, box);
    }

    /* ---- Home on: save what is there, then the picker ---- */

    private void homeOn() {
        if (busy()) { refresh(); return; }
        asked = false;
        save(HOME);
    }

    private void save(final int screen) {
        saving = screen;
        refresh();
        new Thread(new Runnable() {
            public void run() {
                final int r = Backup.beforeHome(app);
                main.post(new Runnable() {
                    public void run() { saved(screen, r); }
                });
            }
        }, "lili-backup").start();
    }

    private void saved(int screen, int result) {
        saving = 0;
        if (result == Backup.DENIED && !asked && canAskRead() && !isDestroyed()) {
            asked = true;
            waiting = screen;
            Log.i(TAG, "[LIFE] settings: asking for READ_EXTERNAL_STORAGE to save the wallpaper");
            requestPermissions(new String[] { Manifest.permission.READ_EXTERNAL_STORAGE }, REQ_READ);
            refresh();
            return;                               /* onRequestPermissionsResult carries on */
        }
        takeHome(result == Backup.DENIED);
    }

    /* Asking can only help on API 23-32, and only if it is not granted yet. */
    private boolean canAskRead() {
        return Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 32 &&
            checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request != REQ_READ || waiting == 0) return;
        int screen = waiting;
        waiting = 0;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        Log.i(TAG, "[LIFE] settings: READ_EXTERNAL_STORAGE " + (granted ? "granted" : "denied"));
        if (granted) save(screen);                /* `asked` is set: no second question */
        else takeHome(true);
    }

    /* The picker for Lili; denied: a wallpaper could not be saved. */
    private void takeHome(boolean denied) {
        if (isDestroyed()) return;
        String pick = getString(R.string.pick_home_hint);
        Toast t = toast(denied ? getString(R.string.backup_denied) + "\n\n" + pick : pick);
        if (setWallpaper()) {
            picking = PICK_LILI;                  /* on until we are back and the system says otherwise */
        } else {
            t.cancel();                           /* there is no picker: the manual hint shows */
            if (denied) toast(getString(R.string.backup_denied));
        }
        refresh();
    }

    /* the picker naming Lili; failing that, the chooser; failing that, the hint */
    private boolean setWallpaper() {
        if (openPicker(new ComponentName(this, LiliWallpaper.class))) return true;
        hint.setVisibility(View.VISIBLE);
        return start(new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER));
    }

    private boolean openPicker(ComponentName c) {
        Intent change = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
        change.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, c);
        return start(change);
    }

    private boolean start(Intent i) {
        try {
            startActivity(i);
            Log.i(TAG, "[LIFE] settings opened " + i.getAction());
            return true;
        } catch (ActivityNotFoundException e) {
            Log.i(TAG, "[LIFE] settings: no activity for " + i.getAction());
        } catch (SecurityException e) {
            Log.i(TAG, "[LIFE] settings: not allowed to open " + i.getAction());
        }
        return false;
    }

    /* ---- switching off: the previous wallpaper back ---- */

    private void homeOff() {
        if (busy()) { refresh(); return; }
        /* her live wallpaper on the lock screen too: it leaves both */
        alsoLock = LockPicture.supported() && lockNow(true) == L_WITH_HOME;
        int plan = Backup.homePlan(app);
        if (plan == Backup.PICTURE) {
            final boolean lock = alsoLock;
            inBackground(HOME, new Job() {
                public void run() throws Exception {
                    Backup.restore(app, false, Backup.PICTURE);
                    if (lock) Backup.restoreLockAfterHome(app);
                }
            });
            return;
        }
        if (plan == Backup.LIVE_PICKER) {
            /* a live wallpaper of someone else's: only the picker can set it */
            Toast t = toast(getString(alsoLock ? R.string.pick_old_both : R.string.pick_old_home));
            ComponentName c = Backup.component(Backup.home(prefs));
            if (openPicker(c) || start(new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER))) {
                picking = PICK_OLD;               /* off until we are back and the system says otherwise */
                refresh();
                return;
            }
            t.cancel();
        }
        askNoBackup(HOME);
    }

    /* Her picture from an earlier build (or her live wallpaper on the lock screen alone) leaves it. */
    private void lockOff() {
        if (busy()) { refresh(); return; }
        /* with the live Lili at home, the lock screen needs a wallpaper of its own */
        int plan = Backup.lockPlan(app, homeIsOurs());
        if (plan == Backup.NONE) {
            askNoBackup(LOCK);
            return;
        }
        leaveLock();
        final int p = plan;
        inBackground(LOCK, new Job() {
            public void run() throws Exception { Backup.restore(app, true, p); }
        });
    }

    /* Lock mode off first, so no render in flight or queued can put her picture back. */
    private void leaveLock() {
        prefs.edit().putBoolean(Prefs.LOCK_ON, false).putString(Prefs.LOCK_NOTE, "").apply();
        LockJob.cancel(app);
        LockPicture.cancel("the Lock screen switch was turned off");
        Log.i(TAG, "[LIFE] settings: lock off");
    }

    /* "System default" from the no-backup dialog */
    private void systemDefault(int screen) {
        final boolean lock = screen == LOCK, homeOurs = homeIsOurs(), lockToo = !lock && alsoLock;
        if (lock) leaveLock();
        inBackground(screen, new Job() {
            public void run() throws Exception {
                Backup.systemDefault(app, lock, homeOurs);
                if (lockToo) Backup.restoreLockAfterHome(app);
            }
        });
    }

    /* "Choose photo..." from the no-backup dialog, once a photo was picked: the
     * same import as the backdrop photo (upright, screen-sized), then set */
    private void restorePhoto(final Uri uri, final boolean lock) {
        final boolean lockToo = !lock && alsoLock;
        if (lock) leaveLock();
        inBackground(lock ? LOCK : HOME, new Job() {
            public void run() throws Exception {
                File f = new File(app.getCacheDir(), "restore.jpg");
                try {
                    Backdrop.importPhoto(app, uri, f);
                    Backup.setPicture(app, f, lock);
                } finally {
                    f.delete();
                }
                if (lockToo) Backup.restoreLockAfterHome(app);
            }
        });
    }

    private interface Job {
        void run() throws Exception;
    }

    /* A restore on a worker thread; both switches read again after it. */
    private void inBackground(final int screen, final Job job) {
        restoring = screen;
        refresh();
        new Thread(new Runnable() {
            public void run() {
                String error = null;
                try {
                    job.run();
                } catch (Throwable t) {
                    Log.w(TAG, "[BACKUP] restore failed", t);
                    error = t.getMessage() != null ? t.getMessage() : t.toString();
                }
                final String why = error;
                main.post(new Runnable() {
                    public void run() { restored(why); }
                });
            }
        }, "lili-restore").start();
    }

    /* Done. A lock screen still showing her picture shows the switch on again, to try once more. */
    private void restored(String error) {
        restoring = 0;
        alsoLock = false;
        if (error != null) toast(getString(R.string.restore_failed, error));
        refresh();
    }

    /* Nothing saved for that screen: a photo, the system default, or leave Lili there. */
    private void askNoBackup(final int screen) {
        final boolean lock = screen == LOCK;
        asking = screen;
        refresh();
        final Dialog d = newDialog();
        LinearLayout box = dialogBox(getString(lock ? R.string.none_lock : R.string.none_home));
        box.addView(button(R.string.choose_photo, new View.OnClickListener() {
            public void onClick(View v) {
                d.setOnCancelListener(null);
                d.dismiss();
                pickPhoto(lock ? REQ_RESTORE_LOCK : REQ_RESTORE_HOME);
            }
        }), wrap(0, dp(8)));
        box.addView(button(R.string.system_default, new View.OnClickListener() {
            public void onClick(View v) {
                d.setOnCancelListener(null);
                d.dismiss();
                systemDefault(screen);
            }
        }), wrap(0, dp(8)));
        box.addView(button(R.string.cancel, new View.OnClickListener() {
            public void onClick(View v) { d.cancel(); }
        }), wrap(0, 0));

        d.setOnCancelListener(new DialogInterface.OnCancelListener() {
            public void onCancel(DialogInterface di) { alsoLock = false; }
        });
        d.setOnDismissListener(new DialogInterface.OnDismissListener() {
            public void onDismiss(DialogInterface di) {
                if (dialog == d) dialog = null;
                asking = 0;
                refresh();                        /* Cancel: the switch is on again */
            }
        });
        dialog = d;
        open(d, box);
    }

    /* ---- our own dialogs: no AlertDialog, whose colours come from the theme ---- */

    private Dialog newDialog() {
        Dialog d = new Dialog(this);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);
        return d;
    }

    /** A rounded DIALOG panel with the message on top; the caller adds the buttons. */
    private LinearLayout dialogBox(String message) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(20), dp(20), dp(16));
        box.setBackground(rounded(DIALOG, dp(12)));
        box.addView(text(message, 16, TEXT), wrap(0, dp(16)));
        return box;
    }

    private void open(Dialog d, View box) {
        d.setContentView(box);
        d.show();
        Window w = d.getWindow();
        if (w != null) {
            /* our own panel, not the theme's dialog frame */
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(420));
            w.setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }

    /* ---- photos ---- */

    private void pickPhoto(int request) {
        Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        open.setType("image/*");
        open.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(open, request);
            return;
        } catch (ActivityNotFoundException e) {
            Log.i(TAG, "[LIFE] settings: no ACTION_OPEN_DOCUMENT, trying GET_CONTENT");
        }
        Intent get = new Intent(Intent.ACTION_GET_CONTENT);
        get.setType("image/*");
        get.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(get, request);
        } catch (ActivityNotFoundException e) {
            toast(getString(R.string.photo_failed));
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQ_PREVIEW) {
            previewed(result, data);
            return;
        }
        boolean restore = request == REQ_RESTORE_HOME || request == REQ_RESTORE_LOCK;
        /* no photo picked for a restore: nothing changed, the switch shows Lili still there */
        if (result != RESULT_OK || data == null || data.getData() == null) {
            if (restore) alsoLock = false;
            return;
        }
        final Uri uri = data.getData();
        if (restore) {
            if (busy()) return;
            restorePhoto(uri, request == REQ_RESTORE_LOCK);
            return;
        }
        if (request != REQ_PHOTO) return;
        /* the backdrop photo: into the draft file, never straight into bg.jpg */
        importing = true;
        refresh();
        final File dst = Backdrop.draftFile(app);
        new Thread(new Runnable() {
            public void run() {
                Throwable failure = null;
                try {
                    Backdrop.importPhoto(app, uri, dst);
                } catch (Throwable t) {
                    failure = t;
                    Log.w(TAG, "[BG] import failed", t);
                }
                final boolean ok = failure == null;
                main.post(new Runnable() {
                    public void run() { imported(ok); }
                });
            }
        }, "lili-photo").start();
    }

    private void imported(boolean ok) {
        importing = false;
        if (isFinishing() || isDestroyed()) {
            /* left while it was copied: nobody will apply it */
            if (ok && otherPhotoOwner() == null) Backdrop.dropDraft(app);
            return;
        }
        if (ok) {
            /* the file is this screen's now; a new stamp on every import, so the
             * preview decodes this photo, not the one picked before */
            photoOwner = new WeakReference<SettingsActivity>(this);
            setDraft(draft.withDraftPhoto(System.currentTimeMillis()));
        } else {
            toast(getString(R.string.photo_failed));
        }
        refresh();
    }

    /* ---- views: every one coloured here, from the constants above ---- */

    private Toast toast(String s) {
        return toast(s, Toast.LENGTH_LONG);
    }

    private Toast toast(String s, int length) {
        Toast t = Toast.makeText(app, s, length);
        t.show();
        return t;
    }

    /* enabled / disabled */
    private static ColorStateList states(int enabled, int disabled) {
        return new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[0] },
            new int[] { disabled, enabled });
    }

    private static GradientDrawable rounded(int color, float radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radius);
        return g;
    }

    /** A switch with its label: our knob and track, so no theme or vendor colours it. */
    private Switch toggle(int label) {
        Switch s = new Switch(this);
        s.setText(label);
        s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        s.setTextColor(states(TEXT, TEXT_DIM));
        s.setShowText(false);
        s.setSplitTrack(false);

        int knob = dp(18), gap = dp(3);
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(states(KNOB, KNOB_OFF));
        dot.setSize(knob, knob);
        LayerDrawable thumb = new LayerDrawable(new Drawable[] { dot });
        thumb.setLayerInset(0, gap, gap, gap, gap);          /* 24 x 24, the knob inside */
        s.setThumbDrawable(thumb);

        GradientDrawable track = new GradientDrawable();
        track.setCornerRadius(dp(12));
        track.setSize(dp(48), dp(24));
        track.setColor(new ColorStateList(
            new int[][] {
                new int[] { -android.R.attr.state_enabled, android.R.attr.state_checked },
                new int[] { -android.R.attr.state_enabled },
                new int[] { android.R.attr.state_checked },
                new int[0] },
            new int[] { DISABLED_ON, DISABLED, ACCENT, EDGE }));
        s.setTrackDrawable(track);
        s.setSwitchMinWidth(dp(48));
        s.setSwitchPadding(dp(16));
        if (Build.VERSION.SDK_INT >= 23) {
            s.setThumbTintList(null);                        /* no vendor tint over our colours */
            s.setTrackTintList(null);
        }
        /* the mask only bounds the ripple; its colour is never drawn */
        s.setBackground(new RippleDrawable(ColorStateList.valueOf(RIPPLE), null, new ColorDrawable(KNOB)));
        s.setBackgroundTintList(null);
        s.setPadding(0, dp(8), 0, dp(2));
        return s;
    }

    /** A button: our face, outline and text, so no theme or vendor colours it. The preview's buttons too. */
    static Button button(Context c, int label, View.OnClickListener click) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        paint(b, false);
        b.setStateListAnimator(null);
        b.setMinHeight(px(c, 48));
        b.setMinimumHeight(px(c, 48));
        b.setPadding(px(c, 16), px(c, 10), px(c, 16), px(c, 10));
        b.setOnClickListener(click);
        return b;
    }

    private Button button(int label, View.OnClickListener click) {
        return button(this, label, click);
    }

    /** A button's colours on this screen: primary (the step to take next - Apply, or Preview with changes waiting) or plain. */
    static void paint(Button b, boolean primary) {
        paint(b, primary, false);
    }

    /**
     * ...and over her backdrop (the preview's buttons): the face is opaque in
     * every state, so the text reads the same on a dark preset, a bright photo
     * or black, and the outline is OUTLINE, 2 dp, which stands out from all of
     * them (group I checks both).
     */
    static void paint(Button b, boolean primary, boolean overBackdrop) {
        Context c = b.getContext();
        b.setTextColor(states(BUTTON_TEXT, BUTTON_OFF_TEXT));
        GradientDrawable face = new GradientDrawable();
        face.setCornerRadius(px(c, 8));
        face.setColor(new ColorStateList(
            new int[][] {
                new int[] { -android.R.attr.state_enabled },
                new int[] { android.R.attr.state_pressed },
                new int[0] },
            new int[] { BUTTON_OFF, primary ? PRIMARY_DOWN : BUTTON_DOWN, primary ? PRIMARY : BUTTON }));
        face.setStroke(px(c, overBackdrop ? 2 : 1), states(overBackdrop ? OUTLINE : EDGE, BUTTON_OFF));
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(RIPPLE), face, null));
        b.setBackgroundTintList(null);                       /* no vendor tint over our face */
    }

    /** A slider from lo to hi (SeekBar.setMin is API 26, so it is offset by hand), in our colours; it moves the draft. */
    private SeekBar slider(final int lo, int hi, int value, final int which, final TextView label, final int title) {
        SeekBar bar = new SeekBar(this);
        bar.setProgressTintList(ColorStateList.valueOf(ACCENT));
        bar.setProgressBackgroundTintList(ColorStateList.valueOf(EDGE));
        bar.setThumbTintList(ColorStateList.valueOf(KNOB));
        bar.setMax(hi - lo);
        bar.setProgress(value - lo);
        label.setText(getString(title) + "  " + value + "%");
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar b, int progress, boolean fromUser) {
                int v = lo + progress;
                label.setText(getString(title) + "  " + v + "%");
                if (!fromUser) return;
                setDraft(which == S_DIM ? draft.withDim(v) : which == S_SIZE ? draft.withSize(v) : draft.withLift(v));
            }
            public void onStartTrackingTouch(SeekBar b) {}
            public void onStopTrackingTouch(SeekBar b) {}
        });
        return bar;
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    /* the checked state set by us, not by a tap: no listener fires */
    private static void show(Switch s, boolean on, CompoundButton.OnCheckedChangeListener listener) {
        if (s.isChecked() == on) return;
        s.setOnCheckedChangeListener(null);
        s.setChecked(on);
        s.setOnCheckedChangeListener(listener);
    }

    private LinearLayout.LayoutParams wrap(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.bottomMargin = bottom;
        return p;
    }

    private int dp(float v) {
        return px(this, v);
    }

    private static int px(Context c, float dp) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, c.getResources().getDisplayMetrics());
    }

    /** One preset, drawn by the routine the wallpaper uses, ringed when chosen. */
    private static final class Swatch extends View {
        final String name;
        private boolean chosen;
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path clip = new Path();
        private final RectF box = new RectF();

        Swatch(Context context, String name) {
            super(context);
            this.name = name;
            ring.setStyle(Paint.Style.STROKE);
            ring.setColor(KNOB);
            setClickable(true);
            setFocusable(true);
        }

        void setChosen(boolean on) {
            if (on == chosen) return;
            chosen = on;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float d = getResources().getDisplayMetrics().density;
            float r = 8 * d;
            box.set(0, 0, getWidth(), getHeight());
            clip.reset();
            clip.addRoundRect(box, r, r, Path.Direction.CW);
            canvas.save();
            canvas.clipPath(clip);
            Backdrop.drawPreset(canvas, getWidth(), getHeight(), name);
            canvas.restore();
            float w = (chosen ? 3 : 1) * d;
            ring.setStrokeWidth(w);
            ring.setAlpha(chosen ? 255 : 90);
            box.inset(w / 2, w / 2);
            canvas.drawRoundRect(box, r, r, ring);
        }
    }
}
