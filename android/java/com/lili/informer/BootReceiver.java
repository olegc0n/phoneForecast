package com.lili.informer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Brings the display back by itself after a power cut, which is the difference
 * between a shelf clock and a shelf clock someone has to go and restart.
 *
 * Starting an activity from a boot broadcast works on Android 7 and 8, which is
 * what this phone runs. Newer Android restricts background activity starts; if
 * this app ever moves to a newer device this becomes a foreground service or a
 * notification the user taps.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        Intent go = new Intent(context, MainActivity.class);
        go.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(go);
        } catch (Exception ignored) {
            /* a newer Android refusing the background start is not worth crashing over */
        }
    }
}
