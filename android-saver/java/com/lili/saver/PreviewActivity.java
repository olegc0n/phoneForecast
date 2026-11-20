package com.lili.saver;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.TextView;

/**
 * Lili on screen for as long as this is open - the fallback for phones whose
 * maker removed the screen saver setting, and the quickest way to look at her.
 *
 *   adb shell am start -n com.lili.saver/.PreviewActivity
 *   adb shell am start -n com.lili.saver/.PreviewActivity -e ep snowball
 *
 * The screen is kept on, and there is no dimming: night() is a no-op here,
 * because somebody who opened the preview is looking at it. Back closes it.
 */
public class PreviewActivity extends Activity {

    private static final String TAG = LiliWeb.TAG;

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        Log.i(TAG, "[LIFE] preview onCreate " + getPackageName());
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String ep = getIntent() != null ? getIntent().getStringExtra("ep") : null;
        try {
            web = LiliWeb.create(this, new LiliWeb.Listener() {
                public void night(boolean on) { /* the preview never dims */ }
            });
            setContentView(web);
            web.loadUrl(LiliWeb.url(ep));
        } catch (Throwable t) {
            Log.w(TAG, "[LIFE] preview: no WebView", t);
            LiliWeb.destroy(web);
            web = null;
            TextView msg = new TextView(this);
            msg.setText(R.string.no_webview);
            msg.setTextColor(0xFFD8D8D8);
            msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
            msg.setGravity(Gravity.CENTER);
            msg.setBackgroundColor(Color.BLACK);
            setContentView(msg);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        /* onPause only: pauseTimers() is process-wide and would stop a dream */
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        Log.i(TAG, "[LIFE] preview onDestroy");
        LiliWeb.destroy(web);
        web = null;
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override
    public void onBackPressed() {
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
}
