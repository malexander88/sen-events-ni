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
    private android.widget.LinearLayout root;
    private android.view.View statusStrip;
    private Object backCallback; // android.window.OnBackInvokedCallback on API 33+
    private boolean backRegistered;
    private String geoOrigin;
    private android.webkit.GeolocationPermissions.Callback geoCallback;
    private static final int REQ_LOC = 11;

    @SuppressLint({"SetJavaScriptEnabled", "SetJavaScriptEnabled"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        // v2.0: targetSdk 36 forces edge-to-edge, so lay out a navy status-bar strip above the WebView
        // and pad the root for the navigation bar / keyboard ourselves.
        statusStrip = new android.view.View(this);
        statusStrip.setBackgroundColor(BAR);
        root = new android.widget.LinearLayout(this);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.addView(statusStrip, new android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 0));
        root.addView(webView, new android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, left, right, bottom;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets sb = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime());
                top = sb.top; left = sb.left; right = sb.right; bottom = Math.max(sb.bottom, ime.bottom);
            } else {
                top = insets.getSystemWindowInsetTop(); left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            android.view.ViewGroup.LayoutParams lp = statusStrip.getLayoutParams();
            if (lp.height != top) { lp.height = top; statusStrip.setLayoutParams(lp); }
            v.setPadding(left, 0, right, bottom);
            return android.os.Build.VERSION.SDK_INT >= 30 ? android.view.WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        // v1.7.3: paint the saved theme's background before the page loads (no white flash in dark mode)
        applyTheme(isDarkFor(getSharedPreferences(NewEventsJobService.PREFS, MODE_PRIVATE).getString(KEY_THEME, "auto")));
        setContentView(root);

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
        settings.setUserAgentString(settings.getUserAgentString() + " OutAndAboutNI/" + appVersion() + " (com.senevents.ni; +https://github.com/malexander88/sen-events-ni)");

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

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                updateBackCallback();
            }
        });

        settings.setGeolocationEnabled(true);
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                if (hasLocation()) { callback.invoke(origin, true, false); return; }
                geoOrigin = origin; geoCallback = callback;
                requestPermissions(new String[]{"android.permission.ACCESS_COARSE_LOCATION"}, REQ_LOC);
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
        if (root != null) root.setBackgroundColor(bg); // fills the nav-bar / keyboard padding
    }

    private String appVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "2"; }
    }

    /** targetSdk 36: onBackPressed is no longer called on Android 16+, so register an
     *  OnBackInvokedCallback only while the WebView has history (keeps predictive back-to-home). */
    private void updateBackCallback() {
        if (android.os.Build.VERSION.SDK_INT < 33 || webView == null) return;
        boolean want = webView.canGoBack();
        if (want == backRegistered) return;
        if (backCallback == null) backCallback = (android.window.OnBackInvokedCallback) () -> { if (webView.canGoBack()) webView.goBack(); };
        if (want) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, (android.window.OnBackInvokedCallback) backCallback);
        else getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((android.window.OnBackInvokedCallback) backCallback);
        backRegistered = want;
    }

    private boolean hasLocation() {
        return checkSelfPermission("android.permission.ACCESS_COARSE_LOCATION") == android.content.pm.PackageManager.PERMISSION_GRANTED;
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
