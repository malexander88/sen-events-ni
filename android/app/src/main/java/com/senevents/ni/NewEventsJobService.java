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
    static final String KEY_HIDDEN = "hidden_ids";
    static final String[] URLS = {
        "https://malexander88.github.io/sen-events-ni/events.json",
        "https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json"
    };

    static final String KEY_NOTIFY = "notify_on";

    static boolean enabled(Context ctx) { return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_NOTIFY, true); }

    /** Next 09:45 or 17:45 Europe/London after now (epoch ms). */
    static long nextSlot(long now) {
        java.util.Calendar c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Europe/London"));
        c.setTimeInMillis(now);
        int[][] slots = {{9, 45}, {17, 45}};
        for (int day = 0; day < 2; day++) {
            for (int[] sl : slots) {
                java.util.Calendar t = (java.util.Calendar) c.clone();
                t.add(java.util.Calendar.DAY_OF_YEAR, day);
                t.set(java.util.Calendar.HOUR_OF_DAY, sl[0]); t.set(java.util.Calendar.MINUTE, sl[1]);
                t.set(java.util.Calendar.SECOND, 0); t.set(java.util.Calendar.MILLISECOND, 0);
                if (t.getTimeInMillis() > now + 60000) return t.getTimeInMillis();
            }
        }
        return now + 12L * 3600 * 1000;
    }

    /** Arms an inexact alarm (10-min window) for the next check slot; cancels everything if notifications are off. */
    public static void schedule(Context ctx) {
        android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, new Intent(ctx, CheckReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID); // drop the old 24h periodic job from <=1.6
        if (am == null) return;
        am.cancel(pi);
        if (!enabled(ctx)) return;
        am.setWindow(android.app.AlarmManager.RTC_WAKEUP, nextSlot(System.currentTimeMillis()), 10L * 60 * 1000, pi);
    }

    /** One-shot network job to run the check now. */
    static void runSoon(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        js.schedule(new JobInfo.Builder(JOB_ID + 1, new ComponentName(ctx, NewEventsJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setOverrideDeadline(30L * 60 * 1000)
                .build());
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
        java.util.List<String> titles = new java.util.ArrayList<>();
        Set<String> hiddenIds = p.getStringSet(KEY_HIDDEN, new HashSet<>());
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.getJSONObject(i); String id = ev.optString("id");
            if (!seen.contains(id) && !hiddenIds.contains(id)) { fresh++; titles.add(ev.optString("name")); }
        }
        seen.addAll(ids);
        p.edit().putStringSet(KEY_IDS, seen).apply();
        if (!firstRun && fresh > 0 && enabled(ctx)) notifyNew(ctx, fresh, titles);
        return firstRun ? 0 : fresh;
    }

    static void notifyNew(Context ctx, int n, java.util.List<String> titles) {
        if (Build.VERSION.SDK_INT >= 33 &&
                ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "New events found", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(ctx, MainActivity.class).putExtra("showNew", true)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = n + " new event" + (n == 1 ? "" : "s") + " found";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(5, titles.size()); i++) sb.append(i > 0 ? "\n" : "").append("• ").append(titles.get(i));
        if (titles.size() > 5) sb.append("\n…and ").append(titles.size() - 5).append(" more");
        String text = sb.toString();
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(titles.isEmpty() ? "" : "• " + titles.get(0))
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi).setAutoCancel(true);
        nm.notify(1, b.build());
    }
}
