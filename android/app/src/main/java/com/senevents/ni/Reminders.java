package com.senevents.ni;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** v1.9.0: local reminders for saved items (evening before, booking-opens morning). The web UI sends the full list. */
public class Reminders extends BroadcastReceiver {
    static final String KEY_JSON = "reminders_json", KEY_CODES = "reminder_codes", CHANNEL = "plan_reminders";

    static void set(Context ctx, String json) {
        ctx.getSharedPreferences(NewEventsJobService.PREFS, Context.MODE_PRIVATE).edit().putString(KEY_JSON, json).apply();
        schedule(ctx);
    }

    private static PendingIntent pi(Context ctx, int code, Intent i) {
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Cancels previously armed reminders and arms every future one in the stored list (inexact, 10-min window). */
    static void schedule(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(NewEventsJobService.PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        for (String c : p.getStringSet(KEY_CODES, new HashSet<>())) {
            try { am.cancel(pi(ctx, Integer.parseInt(c), new Intent(ctx, Reminders.class))); } catch (Exception ignored) {}
        }
        Set<String> codes = new HashSet<>();
        long now = System.currentTimeMillis();
        try {
            JSONArray a = new JSONArray(p.getString(KEY_JSON, "[]"));
            for (int k = 0; k < a.length(); k++) {
                JSONObject r = a.getJSONObject(k);
                long at = r.optLong("at");
                if (at <= now) continue;
                String key = r.optString("key", r.optString("id"));
                int code = 50000 + (key.hashCode() & 0x3fffffff) % 1000000;
                Intent i = new Intent(ctx, Reminders.class).putExtra("id", r.optString("id"))
                        .putExtra("title", r.optString("title")).putExtra("text", r.optString("text")).putExtra("code", code);
                am.setWindow(AlarmManager.RTC_WAKEUP, at, 10L * 60 * 1000, pi(ctx, code, i));
                codes.add(String.valueOf(code));
            }
        } catch (Exception ignored) {}
        p.edit().putStringSet(KEY_CODES, codes).apply();
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (Build.VERSION.SDK_INT >= 33 &&
                ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "My plan reminders", NotificationManager.IMPORTANCE_DEFAULT));
        int code = intent.getIntExtra("code", 2);
        Intent open = new Intent(ctx, MainActivity.class).putExtra("openId", intent.getStringExtra("id"))
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent cp = PendingIntent.getActivity(ctx, code, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        String text = intent.getStringExtra("text");
        b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(intent.getStringExtra("title")).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(cp).setAutoCancel(true);
        nm.notify(code, b.build());
    }
}
