package com.lili.saver;

import android.graphics.Color;
import android.os.Build;
import android.service.dreams.DreamService;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextClock;

/**
 * Lili as the system screen saver: Settings, Display, Screen saver.
 *
 * One WebView per dream - created when the dream's window is attached,
 * destroyed when it is detached. A fresh page load on every start is what makes
 * "a random animation every time" true with no hook into the page, and nothing
 * is kept between dreams.
 *
 * Any touch ends the dream, as people expect of a screen saver.
 *
 * Timers are resumed, never paused: WebView.pauseTimers() is process-wide and
 * would freeze the preview and the next dream along with this one.
 */
public class LiliDream extends DreamService {

    private static final String TAG = LiliWeb.TAG;

    private WebView web;
    private boolean attached;

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        Log.i(TAG, "[LIFE] dream attached " + getPackageName());
        attached = true;
        setInteractive(false);
        setFullscreen(true);
        setScreenBright(true);

        try {
            web = LiliWeb.create(this, new LiliWeb.Listener() {
                /* she is asleep: let the backlight down for the night */
                public void night(boolean on) {
                    if (!attached) return;
                    Log.i(TAG, "[LIFE] dream screen " + (on ? "dim" : "bright"));
                    setScreenBright(!on);
                }
            });
            setContentView(web);
            web.loadUrl(LiliWeb.url(null));
        } catch (Throwable t) {
            /* The WebView package is updating or missing. A plain clock is a
             * better screen saver than a crashed one. */
            Log.w(TAG, "[LIFE] no WebView, showing a plain clock", t);
            LiliWeb.destroy(web);
            web = null;
            setContentView(plainClock());
        }
        immersive();
    }

    @Override
    public void onDreamingStarted() {
        super.onDreamingStarted();
        Log.i(TAG, "[LIFE] dreaming started");
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        immersive();
    }

    @Override
    public void onDreamingStopped() {
        Log.i(TAG, "[LIFE] dreaming stopped");
        if (web != null) web.onPause();
        super.onDreamingStopped();
    }

    @Override
    public void onDetachedFromWindow() {
        Log.i(TAG, "[LIFE] dream detached");
        attached = false;
        LiliWeb.destroy(web);
        web = null;
        super.onDetachedFromWindow();
    }

    private View plainClock() {
        FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(Color.BLACK);
        TextClock clock = new TextClock(this);
        clock.setFormat12Hour("h:mm");
        clock.setFormat24Hour("HH:mm");
        clock.setTextColor(0xFFD8D8D8);
        clock.setTextSize(TypedValue.COMPLEX_UNIT_SP, 72);
        box.addView(clock, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        return box;
    }

    /* the same flags MainActivity uses: no status bar, no navigation bar */
    private void immersive() {
        if (getWindow() == null) return;
        int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN;
        if (Build.VERSION.SDK_INT >= 19) f |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        getWindow().getDecorView().setSystemUiVisibility(f);
    }
}
