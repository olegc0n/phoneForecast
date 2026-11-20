package com.lili.wallpaper;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Keeps the lock-screen picture fresh: every 3 hours, while lock mode is on,
 * a new pose and outfit (and asleep, if the run falls in her sleep window - so
 * a day/night flip shows up at the next run).
 *
 * Persisted, so it survives a reboot; that is what RECEIVE_BOOT_COMPLETED in
 * the manifest is for. Scheduled when lock mode was turned on (and again,
 * idempotently, whenever the settings screen opens with lock mode on);
 * cancelled when lock mode goes off. Lock mode can no longer be turned on in
 * this version (see LockPicture), so this only runs on a phone that still has
 * it from an earlier build, until the Lock screen switch is turned off.
 *
 * Each run is an "auto" render: if the user has put another picture on the
 * lock screen since ours, it is left alone and lock mode is turned off
 * (LockPicture.changedByUser).
 *
 * The system calls onStartJob on the main thread, which is where the offscreen
 * render has to be built anyway; jobFinished comes from the render's callback.
 * Vendors that restrict background work (Huawei's "App launch") may delay or
 * skip runs unless Lili is allowed to run in the background.
 */
public class LockJob extends JobService {

    private static final String TAG = LiliWeb.TAG;
    static final int ID = 1;
    static final long EVERY_MS = 3L * 60 * 60 * 1000;

    /** Idempotent: an identical pending job is left as it is. API 24+ (lock mode's minimum). */
    static void schedule(Context context) {
        if (!LockPicture.supported()) return;
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            JobInfo pending = js.getPendingJob(ID);
            if (pending != null && pending.isPeriodic() && pending.getIntervalMillis() == EVERY_MS &&
                pending.isPersisted()) return;
            JobInfo job = new JobInfo.Builder(ID, new ComponentName(context, LockJob.class))
                .setPeriodic(EVERY_MS)
                .setPersisted(true)
                .build();
            int r = js.schedule(job);
            Log.i(TAG, "[JOB] scheduled every " + (EVERY_MS / 60000) + " min: " +
                (r == JobScheduler.RESULT_SUCCESS ? "ok" : "refused"));
        } catch (Throwable t) {
            Log.w(TAG, "[JOB] could not schedule", t);
        }
    }

    static void cancel(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js != null) js.cancel(ID);
            Log.i(TAG, "[JOB] cancelled");
        } catch (Throwable t) {
            Log.w(TAG, "[JOB] could not cancel", t);
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        Log.i(TAG, "[JOB] lock picture refresh");
        if (!Prefs.lockOn(Prefs.of(this))) {
            cancel(this);
            return false;
        }
        LockPicture.request(this, true, new LockPicture.Done() {
            public void done(boolean ok, String detail) {
                Log.i(TAG, "[JOB] done, ok=" + ok + ": " + detail);
                jobFinished(params, false);       /* a failure waits for the next period */
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Log.i(TAG, "[JOB] stopped by the system");
        LockPicture.cancel("the job was stopped");
        return false;
    }
}
