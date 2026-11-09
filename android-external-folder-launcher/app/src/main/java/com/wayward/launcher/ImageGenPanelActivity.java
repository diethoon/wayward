package com.wayward.launcher;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** In-app EasyGen settings panel served by the app-private ImageGen server. */
public final class ImageGenPanelActivity extends Activity {
    static final String EXTRA_MODE = "imagegen.panel.mode";
    private static final String NOVELAI_PANEL_URL = "http://127.0.0.1:8189/?panel=anima";
    private static final String COMFY_PANEL_URL = "http://127.0.0.1:8189/";
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(16, 25, 21));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.setPadding(12, 4, 12, 4);
        Button back = new Button(this);
        back.setText("뒤로");
        back.setAllCaps(false);
        back.setOnClickListener(v -> finish());
        toolbar.addView(back, new LinearLayout.LayoutParams(-2, -2));
        TextView title = new TextView(this);
        String mode=getIntent()==null?"novelai":getIntent().getStringExtra(EXTRA_MODE);
        title.setText("comfy".equals(mode)?"ComfyUI 이미지 서버":"EasyGen · NovelAI 설정");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setPadding(14, 0, 0, 0);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        Button reload = new Button(this);
        reload.setText("새로고침");
        reload.setAllCaps(false);
        reload.setOnClickListener(v -> {
            if (web != null) web.reload();
        });
        toolbar.addView(reload, new LinearLayout.LayoutParams(-2, -2));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setBackgroundColor(Color.rgb(16, 25, 21));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return route(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return route(Uri.parse(url));
            }
            private boolean route(Uri uri) {
                if (uri != null && "http".equalsIgnoreCase(uri.getScheme())
                        && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 8189) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception error) {
                    Toast.makeText(ImageGenPanelActivity.this, "외부 주소를 열 수 없습니다.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                                   android.webkit.WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    Toast.makeText(ImageGenPanelActivity.this,
                            "설정 페이지를 열지 못했습니다. 이미지 생성 서버 상태를 확인해 주세요.",
                            Toast.LENGTH_LONG).show();
                }
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);

        web.loadUrl("comfy".equals(mode)?COMFY_PANEL_URL:NOVELAI_PANEL_URL);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            web.removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
