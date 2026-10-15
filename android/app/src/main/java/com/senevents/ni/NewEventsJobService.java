package com.senevents.ni;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Notification;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

/** Daily background check: fetch live events.json, notify about ids not seen before. */
public class NewEventsJobService extends JobService {
    static final int JOB_ID = 4201;
    static final String CHANNEL_ID = "new_events";
    static final String PREFS = "sen_events";
    static final String KEY_IDS = "seen_ids";
    static final String[] URLS = {
        "https://malexander88.github.io/sen-events-ni/events.json",
        "https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json"
    };

    public static void schedule(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return;
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, NewEventsJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(24L * 60 * 60 * 1000)
                .setPersisted(true)
                .build();
        js.schedule(info);
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            boolean retry = false;
            try { check(getApplicationContext()); } catch (Exception e) { retry = true; }
            jobFinished(params, retry);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    static String fetch() throws Exception {
        Exception last = null;
        for (String u : URLS) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(u + "?t=" + System.currentTimeMillis()).openConnection();
                c.setConnectTimeout(15000); c.setReadTimeout(20000); c.setUseCaches(false);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                    String line; while ((line = r.readLine()) != null) sb.append(line).append('\n');
                }
                return sb.toString();
            } catch (Exception e) { last = e; }
        }
        throw last;
    }

    /** Stores ids; on first run only stores (no notification). Returns number of new ids. */
    static int check(Context ctx) throws Exception {
        JSONArray events = new JSONObject(fetch()).getJSONArray("events");
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < events.length(); i++) ids.add(events.getJSONObject(i).optString("id"));
        SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean firstRun = !p.contains(KEY_IDS);
        Set<String> seen = new HashSet<>(p.getStringSet(KEY_IDS, new HashSet<>()));
        int fresh = 0;
        for (String id : ids) if (!seen.contains(id)) fresh++;
        seen.addAll(ids);
        p.edit().putStringSet(KEY_IDS, seen).apply();
        if (!firstRun && fresh > 0) notifyNew(ctx, fresh);
        return firstRun ? 0 : fresh;
    }

    static void notifyNew(Context ctx, int n) {
        if (Build.VERSION.SDK_INT >= 33 &&
                ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "New SEN-friendly finds", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(ctx, MainActivity.class).putExtra("showNew", true)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = n + " new SEN-friendly find" + (n == 1 ? "" : "s") + " near you";
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle("SEN Events NI").setContentText(text)
                .setContentIntent(pi).setAutoCancel(true);
        nm.notify(1, b.build());
    }
}
