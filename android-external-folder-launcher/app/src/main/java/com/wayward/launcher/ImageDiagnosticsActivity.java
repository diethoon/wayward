package com.wayward.launcher;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** User-facing viewer for local-only image pipeline diagnostics. */
public final class ImageDiagnosticsActivity extends Activity {
    private static final int BG = Color.rgb(16, 25, 21);
    private static final int CARD = Color.rgb(35, 48, 40);
    private static final int TEXT = Color.rgb(232, 239, 233);
    private static final int MUTED = Color.rgb(164, 182, 170);
    private TextView logText;
    private String lastLog = "";

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(18), dp(18), dp(18), dp(18));
        page.setBackgroundColor(BG);

        TextView title = new TextView(this);
        title.setText("이미지 전달 진단");
        title.setTextColor(TEXT);
        title.setTextSize(22);
        title.setTypeface(null, 1);
        page.addView(title);

        TextView description = new TextView(this);
        description.setText("① 아래에서 ‘새 진단 시작’을 누르고 ② 게임으로 돌아가 이미지 한 장을 생성한 뒤 ③ 이 화면으로 돌아와 로그를 확인하세요.\n\n요청 프롬프트 원문, API 토큰, 이미지 데이터, 전체 URL은 기록하지 않습니다. 로그는 이 기기 안에만 저장되며 자동 업로드하지 않습니다.");
        description.setTextColor(MUTED);
        description.setTextSize(13);
        description.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams descParams = new LinearLayout.LayoutParams(-1, -2);
        descParams.topMargin = dp(10);
        descParams.bottomMargin = dp(12);
        page.addView(description, descParams);

        page.addView(actionButton("새 진단 시작 · 이전 로그 지우기", true, this::startCapture));
        page.addView(actionButton("로그 새로고침", false, this::refreshLog));
        page.addView(actionButton("로그 복사", false, this::copyLog));
        page.addView(actionButton("로그 초기화", false, this::clearLog));

        TextView legend = new TextView(this);
        legend.setText("주요 단계: game_generate_requested → native_request_received → native_image_received → js_resolver_invoked → data_url_probe_loaded / img_element_error");
        legend.setTextColor(MUTED);
        legend.setTextSize(11);
        legend.setLineSpacing(dp(2), 1f);
        LinearLayout.LayoutParams legendParams = new LinearLayout.LayoutParams(-1, -2);
        legendParams.topMargin = dp(12);
        legendParams.bottomMargin = dp(8);
        page.addView(legend, legendParams);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        logText = new TextView(this);
        logText.setTextColor(TEXT);
        logText.setTextSize(11);
        logText.setTextIsSelectable(true);
        logText.setTypeface(android.graphics.Typeface.MONOSPACE);
        logText.setPadding(dp(12), dp(12), dp(12), dp(12));
        logText.setBackgroundColor(CARD);
        scroll.addView(logText, new ScrollView.LayoutParams(-1, -2));
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        scrollParams.topMargin = dp(4);
        page.addView(scroll, scrollParams);

        setContentView(page);
        refreshLog();
    }

    @Override protected void onResume() {
        super.onResume();
        refreshLog();
    }

    private Button actionButton(String label, boolean primary, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(
                primary ? Color.rgb(54, 105, 76) : Color.rgb(55, 68, 59)));
        button.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(46));
        params.bottomMargin = dp(6);
        button.setLayoutParams(params);
        return button;
    }

    private void startCapture() {
        try {
            ImagePipelineDiagnostics.clear(this);
            JSONObject details = new JSONObject();
            details.put("stage", "capture");
            ImagePipelineDiagnostics.record(this, "capture_started", details);
            refreshLog();
            Toast.makeText(this, "진단을 시작했습니다. 게임에서 이미지 한 장을 생성하세요.", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            showError("진단 시작 실패", error);
        }
    }

    private void refreshLog() {
        try {
            JSONArray events = ImagePipelineDiagnostics.readRecent(this, 200);
            StringBuilder out = new StringBuilder();
            out.append("최근 이벤트 ").append(events.length()).append("개\n");
            out.append("────────────────────────────────\n");
            SimpleDateFormat format = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.KOREA);
            for (int i = 0; i < events.length(); i++) {
                JSONObject item = events.getJSONObject(i);
                long timestamp = item.optLong("timestamp", 0);
                out.append(format.format(new Date(timestamp))).append("  ")
                        .append(item.optString("event", "unknown")).append('\n');
                JSONObject details = item.optJSONObject("details");
                if (details != null && details.length() > 0) {
                    out.append("  ").append(details.toString()).append('\n');
                }
                out.append('\n');
            }
            if (events.length() == 0) out.append("아직 기록이 없습니다. ‘새 진단 시작’을 누른 뒤 게임에서 생성해 주세요.\n");
            lastLog = out.toString();
            logText.setText(lastLog);
        } catch (Exception error) {
            showError("로그 읽기 실패", error);
        }
    }

    private void copyLog() {
        if (TextUtils.isEmpty(lastLog)) refreshLog();
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            Toast.makeText(this, "클립보드를 사용할 수 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("Wayward image diagnostics", lastLog));
        Toast.makeText(this, "진단 로그를 복사했습니다.", Toast.LENGTH_SHORT).show();
    }

    private void clearLog() {
        try {
            ImagePipelineDiagnostics.clear(this);
            ImagePipelineDiagnostics.record(this, "log_cleared", null);
            refreshLog();
        } catch (Exception error) {
            showError("로그 초기화 실패", error);
        }
    }

    private void showError(String title, Throwable error) {
        new android.app.AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())
                .setPositiveButton("확인", null)
                .show();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
