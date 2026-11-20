package com.lili.wallpaper;

import android.util.Log;

import java.util.ArrayList;
import java.util.WeakHashMap;

/**
 * Chroma-key mode, process-wide: while the real home screen is captured
 * (CaptureActivity), every live wallpaper draws solid KEY instead of the
 * backdrop, and Lili (the WebView) is hidden. What is not KEY in the capture is
 * the launcher - icons, labels, widgets, the status bar - and Keyer cuts the
 * rest out.
 *
 * The flag plus a notification: activities and wallpaper engines share this one
 * process, so the capture switches it here and every LiliView that follows prefs
 * (the engines' views) and every engine drawing flat hears it at once. A view or
 * engine made while it is on reads on() when it draws. Main thread only.
 *
 * It must never stay on: CaptureActivity turns it off in a finally, and a 5 s
 * safety timeout ends the capture whatever happens (group I checks both). It is
 * not persisted, so a process that dies with it on comes back without it.
 */
final class Chroma {

    private static final String TAG = LiliWeb.TAG;

    /** The key colour: pure magenta. Keyer's thresholds are about its hue, not its brightness. */
    static final int KEY = 0xFFFF00FF;

    interface Listener {
        /** Main thread. */
        void chroma(boolean on);
    }

    private static volatile boolean on;
    /* held weakly: a listener's owner keeps it, as with the prefs listeners */
    private static final WeakHashMap<Listener, Boolean> LISTENERS = new WeakHashMap<Listener, Boolean>();

    private Chroma() {}

    static boolean on() {
        return on;
    }

    /** Main thread. */
    static void set(boolean v) {
        if (v == on) return;
        on = v;
        Log.i(TAG, "[CAPTURE] chroma " + (v ? "on" : "off") + ", " + LISTENERS.size() + " views");
        for (Listener l : new ArrayList<Listener>(LISTENERS.keySet())) {
            try {
                l.chroma(v);
            } catch (Throwable t) {
                Log.w(TAG, "[CAPTURE] a chroma listener failed", t);
            }
        }
    }

    static void listen(Listener l) {
        LISTENERS.put(l, Boolean.TRUE);
    }

    static void unlisten(Listener l) {
        LISTENERS.remove(l);
    }
}
