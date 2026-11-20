package com.lili.saver;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Resources;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * What the launcher icon opens: how to switch the screen saver on.
 *
 * Built in code, framework views only. The button goes straight to the screen
 * saver picker. resolveActivity() is not used to decide whether that exists -
 * on Android 11+ package visibility makes it answer "no" for things that are
 * there - so the intent is simply tried, and if it fails the display settings,
 * then the settings home, are opened instead and the hint is shown.
 *
 * If the framework itself says dreams are not supported, the hint is shown
 * from the start, and Preview is the way to see her.
 */
public class SetupActivity extends Activity {

    private static final String TAG = LiliWeb.TAG;

    private TextView hint;

    @Override
    protected void onCreate(Bundle state) {
        Log.i(TAG, "[LIFE] setup onCreate " + getPackageName());
        super.onCreate(state);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        col.setPadding(pad, pad, pad, pad);

        TextView intro = text(R.string.setup_intro, 17);
        col.addView(intro, wrap(0, dp(20)));

        col.addView(step(1, R.string.step1), wrap(0, dp(12)));
        col.addView(step(2, R.string.step2), wrap(0, dp(12)));
        col.addView(step(3, R.string.step3), wrap(0, dp(20)));

        Button open = new Button(this);
        open.setText(R.string.open_settings);
        open.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { openSettings(); }
        });
        col.addView(open, wrap(0, dp(8)));

        hint = text(R.string.hint_missing, 15);
        hint.setVisibility(Boolean.FALSE.equals(dreamsSupported()) ? View.VISIBLE : View.GONE);
        col.addView(hint, wrap(dp(8), dp(8)));

        Button preview = new Button(this);
        preview.setText(R.string.preview);
        preview.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                startActivity(new Intent(SetupActivity.this, PreviewActivity.class));
            }
        });
        col.addView(preview, wrap(0, dp(24)));

        TextView note = text(R.string.setup_note, 14);
        note.setAlpha(0.7f);
        col.addView(note, wrap(0, 0));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(col);
        setContentView(scroll);
    }

    /* the picker; failing that, Display; failing that, Settings - and the hint */
    private void openSettings() {
        if (start(Settings.ACTION_DREAM_SETTINGS)) return;
        hint.setVisibility(View.VISIBLE);
        if (start(Settings.ACTION_DISPLAY_SETTINGS)) return;
        start(Settings.ACTION_SETTINGS);
    }

    private boolean start(String action) {
        try {
            startActivity(new Intent(action));
            Log.i(TAG, "[LIFE] setup opened " + action);
            return true;
        } catch (ActivityNotFoundException e) {
            Log.i(TAG, "[LIFE] setup: no activity for " + action);
        } catch (SecurityException e) {
            Log.i(TAG, "[LIFE] setup: not allowed to open " + action);
        }
        return false;
    }

    /** The framework's own config_dreamsSupported, or null if it will not say. */
    private static Boolean dreamsSupported() {
        try {
            Resources sys = Resources.getSystem();
            int id = sys.getIdentifier("config_dreamsSupported", "bool", "android");
            if (id == 0) return null;
            return sys.getBoolean(id);
        } catch (Exception e) {
            return null;
        }
    }

    private View step(int n, int text) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        TextView num = new TextView(this);
        num.setText(n + ".");
        num.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        num.setTypeface(Typeface.DEFAULT_BOLD);
        num.setMinWidth(dp(28));
        row.addView(num);
        TextView body = text(text, 17);
        row.addView(body, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        return row;
    }

    private TextView text(int res, int sp) {
        TextView t = new TextView(this);
        t.setText(res);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    private LinearLayout.LayoutParams wrap(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.bottomMargin = bottom;
        return p;
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }
}
