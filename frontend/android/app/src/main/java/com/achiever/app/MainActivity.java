package com.achiever.app;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The app's pages load from https://localhost and call the ACHIEVER API on its own
        // domain. The API marks the app's session cookies SameSite=None; Secure and
        // HTTP-only, so the WebView must accept them for that API (JavaScript can still
        // never read them). Cookies stay in the app's private storage.
        WebView webView = getBridge().getWebView();
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Persist the session cookies so a signed-in member stays signed in.
        CookieManager.getInstance().flush();
    }
}
