package com.lili.wallpaper;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Lili full screen, as she will look on the home screen. The screen is kept on.
 *
 * From the settings screen it shows the DRAFT it was given (Look.EXTRA) - not
 * applied, so the running wallpaper does not change - in layers, bottom to
 * top: the draft's backdrop; Lili (the WebView, at the draft's size and
 * height); the icons layer (IconsView: drawn mock icons, or the user's real
 * home screen once captured); the controls.
 *
 * The controls, at the top (she stands at the bottom):
 *   Cancel  (and Back) RESULT_CANCELED: nothing changes, the draft and the
 *           plan are thrown away.
 *   Apply   RESULT_OK with the look and the plan; the settings screen applies
 *           the look and then carries out the plan's differences.
 *   and a compact panel below them:
 *   Home screen  the plan for the home screen. It starts as the system has it,
 *                except that it starts ON when Lili is not the home wallpaper
 *                yet: the user is previewing to set her.
 *   Lock screen  blocked as before (SettingsActivity, docs section 8): off and
 *                disabled with "Not available..."; on and disabled while her live
 *                wallpaper covers the lock screen with the home screen; on and
 *                enabled only for turning off her picture from an earlier build
 *                (or her live wallpaper on the lock screen alone).
 *   Show icons   the icons layer, on by default; Drawn icons / Real icons when
 *                there is a capture for this screen size; "Use my real home
 *                screen" (only while Lili is the home wallpaper; otherwise a
 *                note says to set her first) starts CaptureActivity in a task of
 *                its own and moves this task to the back, so the launcher shows
 *                behind it. Back here, onResume loads the capture.
 * A tap on the picture hides the panel, and another shows it.
 *
 * Every control comes from the settings screen's factories, painted for a
 * backdrop: opaque faces and an outline, legible over any picture (group I of
 * check-wallpaper.js). The preview writes nothing itself.
 *
 * Without a draft it is the plain preview of what is applied, no controls,
 * Back closes it - and the quickest way to look at one scene:
 *
 *   adb shell am start -n com.lili.wallpaper/.PreviewActivity
 *   adb shell am start -n com.lili.wallpaper/.PreviewActivity -e ep snowball
 */
public class PreviewActivity extends Activity {

    private static final String TAG = LiliWeb.TAG;

    /** In: what the lock screen shows now (SettingsActivity.L_*), and the line for under its switch. */
    static final String EXTRA_LOCK_STATE = "com.lili.wallpaper.LOCK_STATE";
    static final String EXTRA_LOCK_NOTE = "com.lili.wallpaper.LOCK_NOTE";
    /** Out, with Apply: the plan - Lili on the home screen or not, her old lock picture off. */
    static final String EXTRA_HOME = "com.lili.wallpaper.PLAN_HOME";
    static final String EXTRA_LOCK_OFF = "com.lili.wallpaper.PLAN_LOCK_OFF";

    private LiliView view;          /* a strong reference: without a draft it is a prefs listener */
    private Look look;              /* the draft shown; null: as applied, no controls */
    private IconsView icons;
    private View panel;
    private Switch homeSwitch, lockSwitch, iconsSwitch;
    private TextView homeNote, lockNote, captureNote;
    private View choiceRow;
    private Button drawnButton, realButton, captureButton;

    private boolean home;           /* Lili is the home wallpaper, as of the last resume */
    private int lockState = SettingsActivity.L_PREVIOUS;
    private String lockText;
    private boolean planHome = true;
    private boolean planLockOff;
    private boolean showIcons = true;
    private boolean useReal = true; /* the capture rather than the drawn icons, when there is one */
    private boolean panelShown = true;
    private long shotAt;            /* the capture in the icons layer; 0: none */
    private long keptAt;            /* ...as saved across a recreation, to keep the user's choice */
    private boolean shotBusy;

    private final CompoundButton.OnCheckedChangeListener homeFlip = new CompoundButton.OnCheckedChangeListener() {
        public void onCheckedChanged(CompoundButton b, boolean on) {
            planHome = on;
            refreshPanel();
        }
    };
    /* enabled only where it can be turned off; turning it on again just drops that from the plan */
    private final CompoundButton.OnCheckedChangeListener lockFlip = new CompoundButton.OnCheckedChangeListener() {
        public void onCheckedChanged(CompoundButton b, boolean on) {
            planLockOff = !on;
            refreshPanel();
        }
    };
    private final CompoundButton.OnCheckedChangeListener iconsFlip = new CompoundButton.OnCheckedChangeListener() {
        public void onCheckedChanged(CompoundButton b, boolean on) {
            showIcons = on;
            refreshPanel();
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        Log.i(TAG, "[LIFE] preview onCreate " + getPackageName());
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Intent in = getIntent();
        String ep = in != null ? in.getStringExtra("ep") : null;
        look = Look.from(in);
        view = look != null ? new LiliView(this, ep, look) : new LiliView(this, ep);

        FrameLayout root = new FrameLayout(this);
        root.addView(view, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (look != null) {
            Log.i(TAG, "[LIFE] preview of a draft: " + look);
            lockState = in.getIntExtra(EXTRA_LOCK_STATE, SettingsActivity.L_PREVIOUS);
            lockText = in.getStringExtra(EXTRA_LOCK_NOTE);
            if (lockText == null) lockText = getString(R.string.lock_unavailable);
            if (state != null) {
                planHome = state.getBoolean("plan_home", true);
                planLockOff = state.getBoolean("plan_lock_off");
                showIcons = state.getBoolean("show_icons", true);
                useReal = state.getBoolean("use_real", true);
                panelShown = state.getBoolean("panel_shown", true);
                keptAt = state.getLong("shot_at");
            }
            icons = new IconsView(this);
            icons.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) { togglePanel(); }
            });
            root.addView(icons, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            root.addView(controls(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        }
        setContentView(root);
        if (!view.hasWeb()) Toast.makeText(this, R.string.no_webview, Toast.LENGTH_LONG).show();
    }

    /** Cancel and Apply (the primary one, on the right), then the panel; clear of the status bar and a cutout. */
    private View controls() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        Button cancel = SettingsActivity.button(this, R.string.cancel, new View.OnClickListener() {
            public void onClick(View v) { cancel(); }
        });
        Button apply = SettingsActivity.button(this, R.string.apply, new View.OnClickListener() {
            public void onClick(View v) { apply(); }
        });
        SettingsActivity.paint(cancel, false, true);
        SettingsActivity.paint(apply, true, true);
        LinearLayout.LayoutParams lc = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lc.rightMargin = dp(12);
        bar.addView(cancel, lc);
        bar.addView(apply, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        col.addView(bar, full(0));

        /* the panel: the plan, the icons */
        LinearLayout p = new LinearLayout(this);
        p.setOrientation(LinearLayout.VERTICAL);
        p.setBackground(SettingsActivity.panelOverBackdrop(this));
        p.setPadding(dp(14), dp(8), dp(14), dp(10));

        homeSwitch = SettingsActivity.toggle(this, R.string.where_home);
        homeNote = SettingsActivity.text(this, "", 12, SettingsActivity.TEXT_DIM);
        p.addView(homeSwitch, full(0));
        p.addView(homeNote, full(dp(4)));
        lockSwitch = SettingsActivity.toggle(this, R.string.where_lock);
        lockNote = SettingsActivity.text(this, "", 12, SettingsActivity.TEXT_DIM);
        p.addView(lockSwitch, full(0));
        p.addView(lockNote, full(dp(6)));

        iconsSwitch = SettingsActivity.toggle(this, R.string.show_icons);
        p.addView(iconsSwitch, full(dp(2)));

        LinearLayout choice = new LinearLayout(this);
        choice.setOrientation(LinearLayout.HORIZONTAL);
        drawnButton = SettingsActivity.button(this, R.string.icons_drawn, new View.OnClickListener() {
            public void onClick(View v) {
                useReal = false;
                refreshPanel();
            }
        });
        realButton = SettingsActivity.button(this, R.string.icons_real, new View.OnClickListener() {
            public void onClick(View v) {
                useReal = true;
                refreshPanel();
            }
        });
        LinearLayout.LayoutParams ld = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        ld.rightMargin = dp(8);
        choice.addView(compact(drawnButton), ld);
        choice.addView(compact(realButton), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        choiceRow = choice;
        p.addView(choice, full(dp(6)));

        captureButton = SettingsActivity.button(this, R.string.capture_real, new View.OnClickListener() {
            public void onClick(View v) { capture(); }
        });
        SettingsActivity.paint(captureButton, false, true);
        p.addView(compact(captureButton), full(dp(6)));
        captureNote = SettingsActivity.text(this, getString(R.string.capture_need_lili), 12, SettingsActivity.TEXT_DIM);
        p.addView(captureNote, full(dp(4)));
        p.addView(SettingsActivity.text(this, getString(R.string.preview_tap_hint), 12, SettingsActivity.TEXT_DIM), full(dp(6)));
        panel = p;
        panel.setVisibility(panelShown ? View.VISIBLE : View.GONE);
        LinearLayout.LayoutParams lp = full(0);
        lp.topMargin = dp(10);
        col.addView(p, lp);

        homeSwitch.setOnCheckedChangeListener(homeFlip);
        lockSwitch.setOnCheckedChangeListener(lockFlip);
        iconsSwitch.setOnCheckedChangeListener(iconsFlip);

        final int pad = dp(16);
        col.setPadding(pad, pad, pad, pad);
        col.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top = insets.getSystemWindowInsetTop();
                if (Build.VERSION.SDK_INT >= 28) {
                    DisplayCutout cut = insets.getDisplayCutout();
                    if (cut != null) top = Math.max(top, cut.getSafeInsetTop());
                }
                v.setPadding(pad, pad + top, pad, pad);
                return insets;
            }
        });
        /* on a short screen (landscape) the panel scrolls rather than hangs off it */
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(false);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.addView(col);
        return scroll;
    }

    /* the panel's buttons a little lower than the settings screen's */
    private Button compact(Button b) {
        b.setMinHeight(dp(40));
        b.setMinimumHeight(dp(40));
        b.setPadding(dp(12), dp(6), dp(12), dp(6));
        return b;
    }

    /** The panel from the plan, the system and the capture. */
    private void refreshPanel() {
        if (look == null || homeSwitch == null) return;
        SettingsActivity.show(homeSwitch, planHome, homeFlip);
        homeNote.setText(planHome ? (home ? R.string.home_on : R.string.home_will_set)
                                  : (home ? R.string.home_will_restore : R.string.home_will_keep));

        boolean withHome = lockState == SettingsActivity.L_WITH_HOME;
        boolean offable = lockState != SettingsActivity.L_PREVIOUS && !withHome;
        boolean lockOn = lockState != SettingsActivity.L_PREVIOUS && !(withHome && !planHome) && !planLockOff;
        SettingsActivity.show(lockSwitch, lockOn, lockFlip);
        lockSwitch.setEnabled(offable);
        lockNote.setText(withHome && !planHome ? getString(R.string.lock_leaves_with_home) : lockText);

        SettingsActivity.show(iconsSwitch, showIcons, iconsFlip);
        boolean real = icons.hasShot();
        choiceRow.setVisibility(showIcons && real ? View.VISIBLE : View.GONE);
        boolean realShown = useReal && real;
        SettingsActivity.paint(drawnButton, !realShown, true);
        SettingsActivity.paint(realButton, realShown, true);
        captureButton.setVisibility(showIcons ? View.VISIBLE : View.GONE);
        captureButton.setEnabled(home);
        captureNote.setVisibility(showIcons && !home ? View.VISIBLE : View.GONE);
        icons.setMode(!showIcons ? IconsView.NONE : realShown ? IconsView.REAL : IconsView.DRAWN);
    }

    private void togglePanel() {
        if (panel == null) return;
        panelShown = !panelShown;
        panel.setVisibility(panelShown ? View.VISIBLE : View.GONE);
    }

    /* The capture for this screen size into the icons layer, decoded off the main thread; a new one is shown at once. */
    private void loadShot() {
        if (icons == null || shotBusy) return;
        final long at = HomeShot.fits(this) ? HomeShot.at(this) : 0;
        if (at == shotAt) return;
        if (at == 0) {
            shotAt = 0;
            icons.setShot(null);
            refreshPanel();
            return;
        }
        shotBusy = true;
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            public void run() {
                final Bitmap b = HomeShot.load(app);
                runOnUiThread(new Runnable() {
                    public void run() {
                        shotBusy = false;
                        if (isDestroyed() || icons == null) return;
                        shotAt = b != null ? at : 0;
                        icons.setShot(b);
                        if (b != null && at != keptAt) useReal = true;    /* a new capture: show it */
                        keptAt = 0;
                        refreshPanel();
                    }
                });
            }
        }, "lili-shot").start();
    }

    /* "Use my real home screen": the capture in a task of its own, this task behind the launcher. */
    private void capture() {
        if (!SettingsActivity.homeIsOurs(this)) {
            home = false;
            refreshPanel();
            return;
        }
        Intent i = new Intent(this, CaptureActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        i.putExtra(CaptureActivity.EXTRA_TASK, getTaskId());
        try {
            startActivity(i);
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] could not start", t);
            Toast.makeText(this, getString(R.string.capture_failed, String.valueOf(t.getMessage())), Toast.LENGTH_LONG).show();
            return;
        }
        overridePendingTransition(0, 0);
        moveTaskToBack(true);
        Log.i(TAG, "[CAPTURE] preview task " + getTaskId() + " moved back");
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        home = SettingsActivity.homeIsOurs(this);
        if (view != null) view.setShown(true);
        refreshPanel();
        loadShot();
    }

    @Override
    protected void onPause() {
        if (view != null) view.setShown(false);
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("plan_home", planHome);
        out.putBoolean("plan_lock_off", planLockOff);
        out.putBoolean("show_icons", showIcons);
        out.putBoolean("use_real", useReal);
        out.putBoolean("panel_shown", panelShown);
        out.putLong("shot_at", shotAt);
    }

    @Override
    protected void onDestroy() {
        Log.i(TAG, "[LIFE] preview onDestroy");
        if (view != null) view.destroy();
        view = null;
        if (icons != null) icons.setShot(null);
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override
    public void onBackPressed() {
        cancel();
    }

    /* The look and the plan back to the settings screen, which applies the one and carries out the other; nothing is written here. */
    private void apply() {
        Intent out = new Intent();
        look.into(out);
        out.putExtra(EXTRA_HOME, planHome);
        out.putExtra(EXTRA_LOCK_OFF, planLockOff);
        setResult(RESULT_OK, out);
        Log.i(TAG, "[LIFE] preview: apply, home " + planHome + (planLockOff ? ", lock off" : ""));
        finish();
    }

    private void cancel() {
        setResult(RESULT_CANCELED);
        finish();
    }

    private void immersive() {
        View d = getWindow().getDecorView();
        int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN;
        if (Build.VERSION.SDK_INT >= 19) f |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        d.setSystemUiVisibility(f);
    }

    private LinearLayout.LayoutParams full(int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.bottomMargin = bottom;
        return p;
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }
}
