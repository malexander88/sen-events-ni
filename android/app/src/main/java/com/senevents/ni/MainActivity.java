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
    private String geoOrigin;
    private android.webkit.GeolocationPermissions.Callback geoCallback;
    private static final int REQ_LOC = 11;

    @SuppressLint({"SetJavaScriptEnabled", "SetJavaScriptEnabled"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        // v1.7.3: paint the saved theme's background before the page loads (no white flash in dark mode)
        applyTheme(isDarkFor(getSharedPreferences(NewEventsJobService.PREFS, MODE_PRIVATE).getString(KEY_THEME, "auto")));
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
        // v1.9.2: OpenStreetMap's tile policy asks apps to identify themselves
        settings.setUserAgentString(settings.getUserAgentString() + " OutAndAboutNI/1.9 (com.senevents.ni; +https://github.com/malexander88/sen-events-ni)");

        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void addEvent(String title, double begin, double end, boolean allDay, String location, String details) {
                Intent i = new Intent(Intent.ACTION_INSERT)
                        .setData(android.provider.CalendarContract.Events.CONTENT_URI)
                        .putExtra(android.provider.CalendarContract.Events.TITLE, title)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_BEGIN_TIME, (long) begin)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_END_TIME, (long) end)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
                        .putExtra(android.provider.CalendarContract.Events.EVENT_LOCATION, location)
                        .putExtra(android.provider.CalendarContract.Events.DESCRIPTION, details);
                if (!allDay) i.putExtra(android.provider.CalendarContract.Events.EVENT_TIMEZONE, "Europe/London");
                try { startActivity(i); } catch (Exception e) {
                    android.widget.Toast.makeText(MainActivity.this, "No calendar app found", android.widget.Toast.LENGTH_SHORT).show();
                }
            }

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

            @android.webkit.JavascriptInterface
            public void setReminders(String json) {
                Reminders.set(MainActivity.this, json);
                if (android.os.Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7));
                }
            }

            @android.webkit.JavascriptInterface
            public boolean hasReminders() { return true; }

            @android.webkit.JavascriptInterface
            public boolean getNotifications() { return NewEventsJobService.enabled(MainActivity.this); }

            @android.webkit.JavascriptInterface
            public void setNotifications(boolean on) {
                getSharedPreferences(NewEventsJobService.PREFS, MODE_PRIVATE).edit().putBoolean(NewEventsJobService.KEY_NOTIFY, on).apply();
                NewEventsJobService.schedule(MainActivity.this);
                if (on && android.os.Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7));
                }
            }

            @android.webkit.JavascriptInterface
            public void setTheme(String mode, boolean dark) {
                getSharedPreferences(NewEventsJobService.PREFS, MODE_PRIVATE).edit().putString(KEY_THEME, mode).apply();
                runOnUiThread(() -> applyTheme(dark));
            }

            @android.webkit.JavascriptInterface
            public void setHidden(String json) {
                java.util.Set<String> ids = new java.util.HashSet<>();
                try {
                    org.json.JSONArray a = new org.json.JSONArray(json);
                    for (int k = 0; k < a.length(); k++) ids.add(a.optString(k));
                } catch (Exception ignored) { return; }
                getSharedPreferences(NewEventsJobService.PREFS, MODE_PRIVATE).edit()
                        .putStringSet(NewEventsJobService.KEY_HIDDEN, ids).apply();
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

        settings.setGeolocationEnabled(true);
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                if (hasLocation()) { callback.invoke(origin, true, false); return; }
                geoOrigin = origin; geoCallback = callback;
                requestPermissions(new String[]{"android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"}, REQ_LOC);
            }
        });

        boolean showNew = getIntent() != null && getIntent().getBooleanExtra("showNew", false);
        String openId = getIntent() != null ? getIntent().getStringExtra("openId") : null;
        webView.loadUrl("file:///android_asset/index.html" + (showNew ? "?new=1" : "") + (openId != null ? "#e/" + Uri.encode(openId) : ""));

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

    private static final String KEY_THEME = "theme";
    private static final int BG_LIGHT = 0xFFFFFAF0, BG_DARK = 0xFF0F1726, BAR = 0xFF173766;

    private boolean isDarkFor(String mode) {
        if ("dark".equals(mode)) return true;
        if ("light".equals(mode)) return false;
        int night = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return night == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    @SuppressWarnings("deprecation")
    private void applyTheme(boolean dark) {
        int bg = dark ? BG_DARK : BG_LIGHT;
        android.view.Window w = getWindow();
        w.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(bg));
        w.setStatusBarColor(BAR);
        w.setNavigationBarColor(bg);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            android.view.View d = w.getDecorView();
            int f = d.getSystemUiVisibility();
            f = dark ? (f & ~android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (f | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            f &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR; // navy status bar keeps white icons
            d.setSystemUiVisibility(f);
        }
        if (webView != null) webView.setBackgroundColor(bg);
    }

    private boolean hasLocation() {
        int ok = android.content.pm.PackageManager.PERMISSION_GRANTED;
        return checkSelfPermission("android.permission.ACCESS_FINE_LOCATION") == ok
                || checkSelfPermission("android.permission.ACCESS_COARSE_LOCATION") == ok;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOC && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null; geoOrigin = null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getBooleanExtra("showNew", false) && webView != null) {
            webView.evaluateJavascript("window.senShowNew && window.senShowNew()", null);
        }
        String openId = intent != null ? intent.getStringExtra("openId") : null;
        if (openId != null && webView != null) {
            webView.evaluateJavascript("location.hash = 'e/' + encodeURIComponent(" + org.json.JSONObject.quote(openId) + ")", null);
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
