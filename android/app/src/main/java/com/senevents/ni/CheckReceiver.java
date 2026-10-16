package com.senevents.ni;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires at ~09:45 / ~17:45 Europe/London (and on boot / app update): run the check and re-arm. */
public class CheckReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a);
        if (!boot && NewEventsJobService.enabled(ctx)) NewEventsJobService.runSoon(ctx);
        NewEventsJobService.schedule(ctx);
    }
}
