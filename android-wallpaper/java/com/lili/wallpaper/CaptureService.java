package com.lili.wallpaper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * The foreground service a screen capture needs, and nothing else: it holds a
 * notification ("Lili is capturing your home screen") for the second or two
 * CaptureActivity uses its MediaProjection, and is stopped right after.
 *
 * With targetSdk 29+ Android refuses getMediaProjection() unless a foreground
 * service of type mediaProjection is running (API 29+), and on API 34+ that
 * service may only start once the user has agreed to the capture and needs the
 * FOREGROUND_SERVICE_MEDIA_PROJECTION permission. So CaptureActivity starts it
 * after the consent, and asks for the projection only when start()'s callback
 * says it is in the foreground. Below API 29 no service is needed.
 *
 * Not exported; started and stopped only by CaptureActivity, in this process.
 */
public class CaptureService extends Service {

    private static final String TAG = LiliWeb.TAG;
    private static final String CHANNEL = "capture";
    private static final int NOTE_ID = 7;

    /** What start() reports, on the main thread: null when it is in the foreground, else why not. */
    interface Started {
        void started(String error);
    }

    private static Started waiting;      /* main thread only */

    /** API 29+: into the foreground, then `then` hears it. */
    static void start(Context context, Started then) {
        waiting = then;
        Intent i = new Intent(context, CaptureService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
        } catch (Throwable t) {
            waiting = null;
            then.started("could not start the capture service: " + t);
        }
    }

    /** Asked to start, but the capture is over before it did: it stops itself once it is in the foreground. */
    static void abandon() {
        waiting = null;
    }

    /** Only once it has started (start()'s callback came): stopping one that has not reached startForeground() crashes some versions. */
    static void stop(Context context) {
        waiting = null;
        try {
            context.stopService(new Intent(context, CaptureService.class));
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] stopService", t);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int id) {
        Started then = waiting;
        waiting = null;
        String error = null;
        try {
            Notification n = notification();
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(NOTE_ID, n);
            Log.i(TAG, "[CAPTURE] service in the foreground");
        } catch (Throwable t) {
            Log.w(TAG, "[CAPTURE] startForeground failed", t);
            error = "startForeground: " + t;
        }
        /* nobody waits any more (the capture ended meanwhile), or it failed: done */
        if (then == null || error != null) stopSelf();
        if (then != null) then.started(error);
        return START_NOT_STICKY;
    }

    private Notification notification() {
        String text = getString(R.string.capture_notice);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.capture_channel),
                NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            if (nm != null) nm.createNotificationChannel(ch);
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        return b.setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .build();
    }

    @Override
    public void onDestroy() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        Log.i(TAG, "[CAPTURE] service stopped");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
