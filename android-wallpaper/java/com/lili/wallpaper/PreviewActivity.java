package com.lili.wallpaper;

import android.app.Activity;
import android.content.Intent;
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
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;

/**
 * Lili full screen, as she will look on the home screen: the backdrop and her,
 * no launcher icons. The screen is kept on.
 *
 * From the settings screen it shows the DRAFT it was given (Look.EXTRA) - not
 * applied, so the running wallpaper does not change - with two buttons at the
 * top (she stands at the bottom):
 *   Apply   RESULT_OK with the look; the settings screen applies it. When Lili
 *           is not the home wallpaper it reads "Apply and set as wallpaper",
 *           and the settings screen then turns Home on as its switch does.
 *   Cancel  (and Back) RESULT_CANCELED: nothing changes, the draft stays.
 * The buttons come from the settings screen's factory: opaque faces with an
 * outline, legible over any backdrop (group I of check-wallpaper.js).
 *
 * Without a draft it is the plain preview of what is applied, no buttons,
 * Back closes it - and the quickest way to look at one scene:
 *
 *   adb shell am start -n com.lili.wallpaper/.PreviewActivity
 *   adb shell am start -n com.lili.wallpaper/.PreviewActivity -e ep snowball
 */
public class PreviewActivity extends Activity {

    private static final String TAG = LiliWeb.TAG;

    /** A boolean in the result: the button said "Apply and set as wallpaper". */
    static final String EXTRA_SET_HOME = "com.lili.wallpaper.SET_HOME";

    private LiliView view;          /* a strong reference: without a draft it is a prefs listener */
    private Look look;              /* the draft shown; null: as applied, no buttons */
    private Button apply;
    private boolean home;           /* Lili is the home wallpaper, as of the last resume */

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
            root.addView(buttons(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        }
        setContentView(root);
        if (!view.hasWeb()) Toast.makeText(this, R.string.no_webview, Toast.LENGTH_LONG).show();
    }

    /** Cancel, then Apply (the primary one, on the right), clear of the status bar and a cutout. */
    private View buttons() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        Button cancel = SettingsActivity.button(this, R.string.cancel, new View.OnClickListener() {
            public void onClick(View v) { cancel(); }
        });
        apply = SettingsActivity.button(this, R.string.apply, new View.OnClickListener() {
            public void onClick(View v) { apply(); }
        });
        SettingsActivity.paint(cancel, false, true);
        SettingsActivity.paint(apply, true, true);
        LinearLayout.LayoutParams lc = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lc.rightMargin = dp(12);
        bar.addView(cancel, lc);
        bar.addView(apply, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        final int pad = dp(16);
        bar.setPadding(pad, pad, pad, pad);
        bar.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
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
        return bar;
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        home = SettingsActivity.homeIsOurs(this);
        if (apply != null) apply.setText(home ? R.string.apply : R.string.apply_and_set);
        if (view != null) view.setShown(true);
    }

    @Override
    protected void onPause() {
        if (view != null) view.setShown(false);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        Log.i(TAG, "[LIFE] preview onDestroy");
        if (view != null) view.destroy();
        view = null;
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

    /* The look back to the settings screen, which applies it; nothing is written here. */
    private void apply() {
        Intent out = new Intent();
        look.into(out);
        out.putExtra(EXTRA_SET_HOME, !home);
        setResult(RESULT_OK, out);
        Log.i(TAG, "[LIFE] preview: apply" + (home ? "" : " and set as wallpaper"));
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

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }
}
