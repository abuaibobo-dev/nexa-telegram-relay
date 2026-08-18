package com.nexa.telegramrelay;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.Manifest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

public class MainActivity extends Activity {
    private WebView webView;
    private NativeBridge bridge;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        webView.setWebChromeClient(new WebChromeClient());
        bridge = NativeBridge.get(this, webView);
        webView.addJavascriptInterface(bridge, "NexaNative");
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (bridge != null) bridge.detach(webView);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
