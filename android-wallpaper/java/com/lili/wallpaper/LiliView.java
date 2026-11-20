package com.lili.wallpaper;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * Lili and what is behind her: the backdrop, and the transparent WebView over
 * it. The one view every host shows - each wallpaper engine's presentation and
 * the preview activity.
 *
 * setShown() is the only lifecycle it has. Shown: the WebView resumes and the
 * page hears Wall.show(); hidden: the page hears Wall.hide() (which freezes its
 * timers) and the WebView pauses. evaluateJavascript before the page exists does
 * nothing, so until onPageFinished the wanted state is only recorded, and
 * onPageFinished pushes it.
 *
 * Never blank: if a WebView cannot be made, the backdrop shows alone and a new
 * WebView is tried on a later show, at most once every 30 s. If the renderer is
 * reclaimed, the WebView is dropped and rebuilt the same way.
 *
 * Settings, as applied, arrive through SharedPreferences: bg_* repaints the
 * backdrop, size/lift go to the page as one Wall.apply() (one per Apply, not
 * one per key). SharedPreferences holds its listeners weakly, so whoever
 * creates a LiliView must keep a reference to it.
 *
 * With a Look (the preview of a draft): that look and nothing else - the
 * backdrop drawn from it, its size and height in the page's boot config - and
 * no prefs listener, so applying elsewhere does not change what is previewed.
 *
 * still(): the variant LockPicture renders offscreen for the lock screen. It
 * loads the page in still mode (#still=1), never tells it show() or hide(),
 * does not listen to the settings (it is a snapshot of them), and reports the
 * page's stillReady() - or a lost renderer - to its StillListener.
 *
 * Chroma mode (Chroma, while CaptureActivity takes the real home screen): a
 * view that follows prefs - the wallpaper's - draws solid Chroma.KEY instead of
 * the backdrop and hides the WebView, until it is off again. The preview of a
 * draft and the still view never take part.
 */
final class LiliView extends FrameLayout implements SharedPreferences.OnSharedPreferenceChangeListener, Chroma.Listener {

    private static final String TAG = LiliWeb.TAG;
    private static final long RETRY_MS = 30000;

    /** What a still LiliView reports, on the main thread. */
    interface StillListener {
        void ready(String state);
        void failed(String why);
    }

    private final String ep;
    private final StillListener still;      /* null: the live wallpaper or the preview */
    private final Look look;                /* null: as applied (prefs); else this draft, fixed */
    private final boolean follows;          /* listens to prefs: neither still nor a fixed look */
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final View backdrop;
    private WebView web;
    private boolean pageReady;
    private boolean shown;
    private boolean destroyed;
    private long lastAttempt = -RETRY_MS;

    private final LiliWeb.Callbacks callbacks = new LiliWeb.Callbacks() {
        public void pageFinished(WebView w) {
            if (w != web || destroyed) return;
            pageReady = true;
            push();
        }

        public void rendererGone(WebView w) {
            if (w != web || destroyed) return;
            Log.w(TAG, "[VIEW] renderer gone - dropping the WebView");
            dropWeb();
            if (still != null) { still.failed("the WebView renderer went away"); return; }
            /* Reclaimed while hidden: a new one at the next show, at once. Gone
             * while in view (a crash): a new one now - outside the dead one's
             * callback - but not more than every 30 s. */
            if (!shown) { lastAttempt = -RETRY_MS; return; }
            post(new Runnable() {
                public void run() { if (shown && !destroyed) createWeb(); }
            });
        }

        public void stillReady(WebView w, String state) {
            if (w != web || destroyed || still == null) return;
            still.ready(state);
        }

        /* the JavaBridge thread: `look` is final and immutable, prefs are thread-safe */
        public String config() {
            return look != null ? look.pageConfig() : Prefs.pageConfig(getContext());
        }
    };

    /* size and height as applied, to the page once however many keys changed */
    private final Runnable sendConfig = new Runnable() {
        public void run() {
            if (!destroyed) js("window.Wall&&Wall.apply(" + Prefs.pageConfig(getContext()) + ")");
        }
    };

    /** Lili as applied, following every change: the wallpaper, and the preview without a draft. */
    LiliView(Context context, String ep) {
        this(context, ep, null, null);
    }

    /** Lili as `look` has her, a draft not applied yet: the preview. Deaf to prefs. */
    LiliView(Context context, String ep, Look look) {
        this(context, ep, null, look);
    }

    /** The lock-screen picture's view: the page in still mode, settings as they are now. */
    static LiliView still(Context context, StillListener listener) {
        return new LiliView(context, null, listener, null);
    }

    private LiliView(Context context, String ep, StillListener still, final Look look) {
        super(context);
        this.ep = ep;
        this.still = still;
        this.look = look;
        follows = still == null && look == null;
        backdrop = new View(context) {
            @Override
            protected void onDraw(Canvas canvas) {
                if (follows && Chroma.on()) canvas.drawColor(Chroma.KEY);
                else if (look != null) Backdrop.draw(canvas, getWidth(), getHeight(), getContext(), look);
                else Backdrop.draw(canvas, getWidth(), getHeight(), getContext());
            }
        };
        addView(backdrop, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        prefs = Prefs.of(context);
        if (follows) {
            prefs.registerOnSharedPreferenceChangeListener(this);
            Chroma.listen(this);
        }
        createWeb();
    }

    boolean hasWeb() {
        return web != null;
    }

    /** At most once every 30 s; the backdrop alone until it works. */
    private void createWeb() {
        if (web != null || destroyed) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastAttempt < RETRY_MS) return;
        lastAttempt = now;
        try {
            web = LiliWeb.create(getContext(), callbacks);
            pageReady = false;
            addView(web, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
            if (follows && Chroma.on()) web.setVisibility(INVISIBLE);
            web.loadUrl(still != null ? LiliWeb.stillUrl() : LiliWeb.url(ep));
            if (!shown) web.onPause();
            Log.i(TAG, "[VIEW] WebView created" + (look != null ? " for a draft: " + look : ""));
        } catch (Throwable t) {
            Log.w(TAG, "[VIEW] no WebView - the backdrop alone for now", t);
            LiliWeb.destroy(web);
            web = null;
        }
    }

    private void dropWeb() {
        LiliWeb.destroy(web);
        web = null;
        pageReady = false;
    }

    void setShown(boolean on) {
        shown = on;
        if (destroyed) return;
        if (on && web == null) createWeb();
        if (web == null) return;
        if (on) {
            web.onResume();
            push();
        } else {
            push();
            web.onPause();
        }
    }

    private void push() {
        if (!pageReady || still != null) return;     /* a still page is never shown or hidden */
        js(shown ? "window.Wall&&Wall.show()" : "window.Wall&&Wall.hide()");
    }

    private void js(String code) {
        if (web == null || !pageReady) return;
        try { web.evaluateJavascript(code, null); } catch (Throwable t) { Log.w(TAG, "[VIEW] js failed: " + code, t); }
    }

    /** Chroma mode on or off (main thread): the key colour and no Lili, or the backdrop and her again. */
    @Override
    public void chroma(boolean on) {
        if (destroyed) return;
        backdrop.invalidate();
        if (web != null) web.setVisibility(on ? INVISIBLE : VISIBLE);
    }

    /**
     * Only while it follows prefs. One Apply changes several keys: the page hears
     * it once. orig_at: My wallpaper was kept, which may be the look (before the
     * first Apply it is the default).
     */
    @Override
    public void onSharedPreferenceChanged(SharedPreferences p, String key) {
        if (destroyed || key == null) return;
        if (key.startsWith("bg_") || Prefs.ORIG_AT.equals(key)) {
            backdrop.invalidate();
        } else if (Prefs.SIZE.equals(key) || Prefs.LIFT.equals(key)) {
            main.removeCallbacks(sendConfig);
            main.post(sendConfig);
        }
    }

    void destroy() {
        if (destroyed) return;
        destroyed = true;
        if (follows) {
            prefs.unregisterOnSharedPreferenceChangeListener(this);
            Chroma.unlisten(this);
        }
        main.removeCallbacks(sendConfig);
        dropWeb();
    }
}
