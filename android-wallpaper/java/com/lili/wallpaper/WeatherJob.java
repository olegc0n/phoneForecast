package com.lili.wallpaper;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Keeps the real weather fresh: every 3 hours, with any network, a new
 * forecast for the place (Forecast.job, which skips it when one is less than an
 * hour old, or when the last failure says to wait).
 *
 * Persisted, so it survives a reboot (RECEIVE_BOOT_COMPLETED); it needs a
 * network, so the system runs it only when there is one. Scheduled while a
 * place is set and Real weather is on - when the place is chosen, when the
 * switch goes on, and again, idempotently, whenever the settings screen opens
 * or a wallpaper engine is created (Forecast.ensureJob). Cancelled when the
 * switch goes off; a run that finds weather off cancels it too. Its own job id,
 * next to LockJob's.
 */
public class WeatherJob extends JobService {

    private static final String TAG = LiliWeb.TAG;
    static final int ID = 2;                          /* LockJob is 1 */
    static final long EVERY_MS = 3L * 60 * 60 * 1000;

    /** Idempotent: an identical pending job is left as it is. JobScheduler is API 21, like minSdk. */
    static void schedule(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            for (JobInfo j : js.getAllPendingJobs()) {
                if (j.getId() == ID && j.isPeriodic() && j.getIntervalMillis() == EVERY_MS && j.isPersisted() &&
                    j.getNetworkType() == JobInfo.NETWORK_TYPE_ANY) return;
            }
            JobInfo job = new JobInfo.Builder(ID, new ComponentName(context, WeatherJob.class))
                .setPeriodic(EVERY_MS)
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build();
            int r = js.schedule(job);
            Log.i(TAG, "[WX] job scheduled every " + (EVERY_MS / 60000) + " min: " +
                (r == JobScheduler.RESULT_SUCCESS ? "ok" : "refused"));
        } catch (Throwable t) {
            Log.w(TAG, "[WX] could not schedule the job", t);
        }
    }

    static void cancel(Context context) {
        try {
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            for (JobInfo j : js.getAllPendingJobs()) {
                if (j.getId() == ID) {
                    js.cancel(ID);
                    Log.i(TAG, "[WX] job cancelled");
                    return;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "[WX] could not cancel the job", t);
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        Log.i(TAG, "[WX] job run");
        if (!Forecast.enabled(this)) {
            cancel(this);
            return false;
        }
        Forecast.job(this, new Forecast.Done() {
            public void done(boolean ok, String detail) {
                Log.i(TAG, "[WX] job done, ok=" + ok + ": " + detail);
                jobFinished(params, false);       /* a failure waits for the next period (and the backoff) */
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Log.i(TAG, "[WX] job stopped by the system");
        return false;
    }
}
