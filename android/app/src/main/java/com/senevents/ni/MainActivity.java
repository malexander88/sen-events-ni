package com.senevents.ni;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "SetJavaScriptEnabled"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        // Allow the bundled file:// UI to fetch https://raw.githubusercontent.com/...events.json
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowFileAccessFromFileURLs(true);

        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void addToCalendar(String title, double begin, double end, String location, String details) {
                Intent i = new Intent(Intent.ACTION_INSERT)
                        .setData(android.provider.CalendarContract.Events.CONTENT_URI)
                        .putExtra(android.provider.CalendarContract.Events.TITLE, title)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_BEGIN_TIME, (long) begin)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_END_TIME, (long) end)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_ALL_DAY, true)
                        .putExtra(android.provider.CalendarContract.Events.EVENT_LOCATION, location)
                        .putExtra(android.provider.CalendarContract.Events.DESCRIPTION, details);
                try { startActivity(i); } catch (Exception e) {
                    android.widget.Toast.makeText(MainActivity.this, "No calendar app found", android.widget.Toast.LENGTH_SHORT).show();
                }
            }
        }, "SENAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String url = uri.toString();
                if (url.startsWith("file://")
                        || url.contains("raw.githubusercontent.com/malexander88/sen-events-ni")
                        || url.contains("malexander88.github.io/sen-events-ni")) {
                    return false;
                }
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                return true;
            }
        });

        boolean showNew = getIntent() != null && getIntent().getBooleanExtra("showNew", false);
        webView.loadUrl("file:///android_asset/index.html" + (showNew ? "?new=1" : ""));

        if (android.os.Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7);
        }
        NewEventsJobService.schedule(this);
        // Seed the seen-id set on first launch (first run stores ids without notifying)
        if (!getSharedPreferences(NewEventsJobService.PREFS, MODE_PRIVATE).contains(NewEventsJobService.KEY_IDS)) {
            final android.content.Context app = getApplicationContext();
            new Thread(() -> { try { NewEventsJobService.check(app); } catch (Exception ignored) {} }).start();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getBooleanExtra("showNew", false) && webView != null) {
            webView.evaluateJavascript("window.senShowNew && window.senShowNew()", null);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
