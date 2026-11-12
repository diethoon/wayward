package com.wayward.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native provider hub: profiles, encrypted credentials, and real sample-generation tests. */
public final class ImageProviderActivity extends Activity {
    private static final int BG = Color.rgb(246, 247, 248);
    private static final int SURFACE = Color.WHITE;
    private static final int SURFACE_ALT = Color.rgb(244, 245, 246);
    private static final int TEXT = Color.rgb(27, 30, 34);
    private static final int MUTED = Color.rgb(109, 117, 125);
    private static final int GREEN = Color.rgb(43, 47, 52);
    private static final int AMBER = Color.rgb(145, 105, 34);

    private final ExecutorService tests = Executors.newFixedThreadPool(2);
    private ImageProviderStore store;
    private ImageProviderStore.Snapshot data;
    private boolean loadFailed;
    private boolean editorShowing;
    private boolean testRunning;
    private FrameLayout frame;

    private static final class GameProfile {
        final String id;
        final String label;
        GameProfile(String id, String label) { this.id = id; this.label = label; }
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.setStatusBarColor(BG);
        window.setNavigationBarColor(BG);
        store = new ImageProviderStore(this);
        try {
            data = store.load();
        } catch (Exception error) {
            loadFailed = true;
            data = new ImageProviderStore.Snapshot();
        }
        renderList();
    }

    @Override public void onBackPressed() {
        if (editorShowing) {
            renderList();
            return;
        }
        super.onBackPressed();
    }

    @Override protected void onDestroy() {
        tests.shutdownNow();
        super.onDestroy();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable shape(int color, int stroke, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        if (stroke != 0) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    private TextView label(String value, float size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        return view;
    }

    private void addGap(LinearLayout parent, int height) {
        View gap = new View(this);
        parent.addView(gap, new LinearLayout.LayoutParams(1, dp(height)));
    }

    private LinearLayout card() {
        LinearLayout layout = column();
        layout.setPadding(dp(16), dp(15), dp(16), dp(15));
        layout.setBackground(shape(SURFACE, Color.rgb(228, 231, 234), 15));
        return layout;
    }

    private TextView action(String text, boolean primary, Runnable callback) {
        TextView view = label(text, 14, TEXT, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(14), dp(11), dp(14), dp(11));
        view.setMinHeight(dp(44));
        view.setBackground(shape(primary ? GREEN : SURFACE_ALT, 0, 12));
        view.setClickable(true);
        view.setFocusable(true);
        view.setOnClickListener(v -> callback.run());
        return view;
    }

    private void renderShell(String title, String subtitle) {
        frame = new FrameLayout(this);
        frame.setBackgroundColor(BG);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout page = column();
        page.setPadding(dp(16), dp(9), dp(16), dp(24));
        scroll.addView(page);
        frame.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        LauncherWindowInsets.apply(frame);

        LinearLayout top = row();
        TextView back = label("‹", 34, TEXT, false);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("뒤로");
        top.addView(back, new LinearLayout.LayoutParams(dp(44), dp(48)));
        back.setOnClickListener(v -> {
            if (editorShowing) renderList();
            else finish();
        });
        LinearLayout heading = column();
        heading.addView(label(title, 20, TEXT, true));
        heading.addView(label(subtitle, 12, MUTED, false));
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(0, -2, 1);
        headingParams.leftMargin = dp(8);
        top.addView(heading, headingParams);
        page.addView(top);
        addGap(page, 10);
    }

    private void renderList() {
        editorShowing = false;
        renderShell("이미지 서비스", "공급자 등록 · 게임별 기본 엔진");
        LinearLayout page = (LinearLayout) ((ScrollView) frame.getChildAt(0)).getChildAt(0);

        LinearLayout intro = card();
        intro.addView(label("한 번 등록하고, 게임마다 선택", 16, TEXT, true));
        addGap(intro, 7);
        intro.addView(label("연결 정보는 기기 내부에서 암호화해 보관합니다.", 12, MUTED, false));
        page.addView(intro);
        addGap(page, 12);

        LinearLayout novelAiCard = card();
        novelAiCard.addView(label("NovelAI · 런처 내장 서버", 15, TEXT, true));
        addGap(novelAiCard, 5);
        novelAiCard.addView(label("토큰은 기기 내부에서 암호화해 보관합니다.", 11, MUTED, false));
        addGap(novelAiCard, 8);
        novelAiCard.addView(label(data.novelAiToken == null || data.novelAiToken.isEmpty()
                ? "상태: 토큰 미등록" : "상태: 토큰 등록됨 · 암호화 저장", 12, data.novelAiToken == null || data.novelAiToken.isEmpty() ? AMBER : GREEN, true));
        addGap(novelAiCard, 6);
        EditText novelAiTokenInput = field("새 NovelAI API 토큰 입력", true, false);
        novelAiTokenInput.setSingleLine(true);
        novelAiCard.addView(novelAiTokenInput, new LinearLayout.LayoutParams(-1, dp(48)));
        addGap(novelAiCard, 6);
        TextView saveNovelAiToken = action("NovelAI 토큰 저장", true, () -> {
            String token = value(novelAiTokenInput);
            if (token.isEmpty()) {
                showError("토큰이 비어 있습니다", "새 토큰을 입력해 주세요. 기존 토큰은 변경되지 않았습니다.");
                return;
            }
            if (token.length() > 4096 || token.indexOf(13) >= 0 || token.indexOf(10) >= 0) {
                showError("토큰 형식 확인", "토큰은 줄바꿈 없이 4096자 이내로 입력해 주세요.");
                return;
            }
            try {
                data.novelAiToken = token;
                store.save(data);
                Toast.makeText(this, "NovelAI 토큰을 암호화해 저장했습니다. NovelAI 서버가 실행 중이라면 중지 후 다시 시작해야 새 토큰이 반영됩니다.", Toast.LENGTH_LONG).show();
                renderList();
            } catch (Exception error) {
                showError("토큰을 저장하지 못했습니다", error.getMessage());
            }
        });
        novelAiCard.addView(saveNovelAiToken);
        TextView clearNovelAiToken = action("저장된 토큰 삭제", false, () -> {
            if (data.novelAiToken == null || data.novelAiToken.isEmpty()) return;
            new AlertDialog.Builder(this)
                    .setTitle("NovelAI 토큰 삭제")
                    .setMessage("기기에 암호화 저장된 NovelAI 토큰을 삭제할까요?")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("삭제", (dialog, which) -> {
                        try {
                            data.novelAiToken = "";
                            store.save(data);
                            renderList();
                        } catch (Exception error) {
                            showError("토큰을 삭제하지 못했습니다", error.getMessage());
                        }
                    }).show();
        });
        LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(-1, -2);
        clearParams.topMargin = dp(5);
        novelAiCard.addView(clearNovelAiToken, clearParams);
        if (loadFailed) {
            novelAiTokenInput.setEnabled(false);
            saveNovelAiToken.setEnabled(false);
            clearNovelAiToken.setEnabled(false);
            novelAiCard.setAlpha(0.45f);
        }
        page.addView(novelAiCard);
        addGap(page, 12);

        if (loadFailed) {
            LinearLayout warning = card();
            warning.setBackground(shape(Color.rgb(65, 43, 35), Color.rgb(152, 93, 65), 14));
            warning.addView(label("저장된 서비스 설정을 복호화하지 못했습니다.", 14, TEXT, true));
            addGap(warning, 5);
            warning.addView(label("기기의 암호화 키를 찾지 못했거나 저장 파일이 손상됐습니다. 기존 파일을 덮어쓰지 않도록 편집과 저장을 잠갔습니다.", 12, MUTED, false));
            page.addView(warning);
            addGap(page, 12);
        }

        page.addView(label("게임별 기본 서비스", 16, TEXT, true));
        addGap(page, 7);
        renderProfileDefaults(page);
        addGap(page, 18);

        LinearLayout titleRow = row();
        titleRow.addView(label("등록된 서비스", 16, TEXT, true),
                new LinearLayout.LayoutParams(0, -2, 1));
        TextView count = label(data.providers.size() + " / 100", 12, MUTED, false);
        titleRow.addView(count);
        page.addView(titleRow);
        addGap(page, 8);

        if (data.providers.isEmpty()) {
            LinearLayout empty = card();
            TextView icon = label("✦", 28, AMBER, true);
            icon.setGravity(Gravity.CENTER);
            empty.addView(icon, new LinearLayout.LayoutParams(-1, dp(48)));
            TextView emptyTitle = label("아직 등록된 서비스가 없습니다", 15, TEXT, true);
            emptyTitle.setGravity(Gravity.CENTER);
            empty.addView(emptyTitle);
            addGap(empty, 5);
            TextView emptyDesc = label("첫 서비스를 추가하고 샘플 이미지 생성으로 연결을 확인하세요.", 12, MUTED, false);
            emptyDesc.setGravity(Gravity.CENTER);
            empty.addView(emptyDesc);
            page.addView(empty);
        } else {
            for (ImageProviderStore.Provider provider : data.providers) {
                page.addView(providerCard(provider));
                addGap(page, 9);
            }
        }

        TextView add = action("＋  이미지 서비스 추가", true, () -> {
            if (!loadFailed) renderEditor(null);
        });
        add.setEnabled(!loadFailed);
        add.setAlpha(loadFailed ? 0.45f : 1f);
        LinearLayout.LayoutParams addParams = new LinearLayout.LayoutParams(-1, -2);
        addParams.topMargin = dp(12);
        page.addView(add, addParams);

        addGap(page, 14);
        page.addView(label("지원 범위", 13, TEXT, true));
        addGap(page, 5);
        page.addView(label("현재 기본 어댑터는 Cloudflare Worker(프롬프트 JSON → Base64 이미지), OpenAI 호환 Images API, 사용자 지정 JSON POST입니다. 비동기 작업 큐·WebSocket·파일 업로드 방식은 별도 어댑터가 필요하며 자동 호환된다고 가정하지 않습니다.", 11, MUTED, false));
    }

    private void renderProfileDefaults(LinearLayout page) {
        List<GameProfile> profiles = loadGameProfiles();
        if (profiles.isEmpty()) {
            LinearLayout empty = card();
            empty.addView(label("등록된 게임 폴더가 없습니다. 게임 폴더를 추가하면 여기에서 Wayward와 Faith별 기본 서비스를 따로 선택할 수 있습니다.", 12, MUTED, false));
            page.addView(empty);
            return;
        }
        for (GameProfile profile : profiles) {
            LinearLayout item = card();
            item.addView(label(profile.label, 14, TEXT, true));
            addGap(item, 7);
            ArrayList<String> names = new ArrayList<>();
            names.add("서비스 선택 안 함");
            for (ImageProviderStore.Provider provider : data.providers) {
                names.add(provider.name + ("".equals(provider.model) ? "" : " · " + provider.model));
            }

            item.addView(label("기본 생성 서비스", 12, MUTED, true));
            Spinner primarySpinner = spinner(names);
            String primaryId = data.defaults.get(profile.id);
            int primarySelection = 0;
            if (primaryId != null) {
                for (int i = 0; i < data.providers.size(); i++) {
                    if (primaryId.equals(data.providers.get(i).id)) primarySelection = i + 1;
                }
            }
            primarySpinner.setSelection(primarySelection);
            primarySpinner.setEnabled(!loadFailed);
            primarySpinner.setAlpha(loadFailed ? 0.45f : 1f);

            addGap(item, 9);
            item.addView(label("실패 시 대체 서비스", 12, MUTED, true));
            Spinner fallbackSpinner = spinner(names);
            String fallbackId = data.fallbacks.get(profile.id);
            int fallbackSelection = 0;
            if (fallbackId != null) {
                for (int i = 0; i < data.providers.size(); i++) {
                    if (fallbackId.equals(data.providers.get(i).id)) fallbackSelection = i + 1;
                }
            }
            fallbackSpinner.setSelection(fallbackSelection);
            fallbackSpinner.setEnabled(!loadFailed && primaryId != null);
            fallbackSpinner.setAlpha(loadFailed ? 0.45f : 1f);

            primarySpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
                private boolean first = true;
                @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                    if (first) { first = false; return; }
                    if (loadFailed) return;
                    if (position == 0) {
                        data.defaults.remove(profile.id);
                        data.fallbacks.remove(profile.id);
                        fallbackSpinner.setEnabled(false);
                        fallbackSpinner.setSelection(0);
                    } else {
                        String selectedProvider = data.providers.get(position - 1).id;
                        ImageProviderStore.setDefaultForGame(data, profile.id, selectedProvider);
                        fallbackSpinner.setEnabled(!loadFailed);
                        if (selectedProvider.equals(data.fallbacks.get(profile.id))) {
                            data.fallbacks.remove(profile.id);
                            fallbackSpinner.setSelection(0);
                        }
                    }
                    persist();
                    renderList();
                }
                @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
            });
            fallbackSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
                private boolean first = true;
                @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                    if (first) { first = false; return; }
                    if (loadFailed) return;
                    if (position == 0) {
                        data.fallbacks.remove(profile.id);
                    } else {
                        String selectedProvider = data.providers.get(position - 1).id;
                        if (selectedProvider.equals(data.defaults.get(profile.id))) {
                            Toast.makeText(ImageProviderActivity.this,
                                    "대체 서비스는 기본 서비스와 다른 서비스를 선택해 주세요.",
                                    Toast.LENGTH_SHORT).show();
                            data.fallbacks.remove(profile.id);
                            fallbackSpinner.setSelection(0);
                            persist();
                            return;
                        }
                        ImageProviderStore.enableForGame(data, selectedProvider);
                        data.fallbacks.put(profile.id, selectedProvider);
                    }
                    persist();
                }
                @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
            });

            item.addView(primarySpinner, new LinearLayout.LayoutParams(-1, dp(48)));
            ImageProviderStore.Provider primary = ImageProviderStore.find(data, primaryId);
            if (primary != null && primary.enabled && primary.allowInGame) {
                addGap(item, 4);
                item.addView(label("인게임 이미지 생성 연결됨", 11, GREEN, true));
            } else if (primary != null) {
                addGap(item, 4);
                item.addView(action("인게임 생성 연결 허용", true, () -> {
                    try {
                        ImageProviderStore.setDefaultForGame(data, profile.id, primary.id);
                        persist();
                        renderList();
                    } catch (Exception error) {
                        showError("게임 연결을 허용하지 못했습니다", error.getMessage());
                    }
                }));
            } else if (primaryId != null && !primaryId.trim().isEmpty()) {
                addGap(item, 4);
                item.addView(label("저장된 기본 서비스를 찾을 수 없습니다. 다시 선택해 주세요.", 11, AMBER, true));
            } else {
                addGap(item, 4);
                item.addView(label("기본 서비스를 선택하면 이 게임의 인게임 사용도 자동으로 허용됩니다.", 10, MUTED, false));
            }
            addGap(item, 5);
            item.addView(fallbackSpinner, new LinearLayout.LayoutParams(-1, dp(48)));
            addGap(item, 5);
            item.addView(label("기본 서비스가 실패하면 대체 서비스를 한 번 시도합니다. 대체 요청도 별도 생성 비용이 발생할 수 있습니다.", 10, MUTED, false));
            page.addView(item);
            addGap(page, 8);
        }
    }

    private View providerCard(ImageProviderStore.Provider provider) {
        LinearLayout item = card();
        LinearLayout top = row();
        LinearLayout identity = column();
        identity.addView(label(provider.name, 16, TEXT, true));
        addGap(identity, 3);
        identity.addView(label(typeName(provider.type), 11, AMBER, true));
        boolean gameUsable = provider.enabled && provider.allowInGame;
        identity.addView(label(gameUsable ? "게임 연결 허용" : "게임 연결 차단", 10, gameUsable ? GREEN : MUTED, true));
        top.addView(identity, new LinearLayout.LayoutParams(0, -2, 1));
        boolean isDefault = data.defaults.containsValue(provider.id);
        TextView state = label(isDefault ? "기본 서비스" : (provider.enabled ? "사용 가능" : "사용 안 함"), 10,
                isDefault ? AMBER : MUTED, true);
        state.setPadding(dp(9), dp(5), dp(9), dp(5));
        state.setBackground(shape(SURFACE_ALT, 0, 20));
        top.addView(state);
        item.addView(top);
        addGap(item, 8);
        item.addView(label(provider.endpoint, 11, MUTED, false));
        if (provider.model != null && !provider.model.isEmpty()) {
            addGap(item, 4);
            item.addView(label("모델  " + provider.model, 11, MUTED, false));
        }
        addGap(item, 12);
        LinearLayout buttons = row();
        TextView test = action("연결 테스트", true, () -> confirmTest(provider));
        TextView edit = action("편집", false, () -> renderEditor(provider));
        TextView delete = action("삭제", false, () -> confirmDelete(provider));
        buttons.addView(test, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(dp(7), 1);
        buttons.addView(new View(this), gap);
        buttons.addView(edit, new LinearLayout.LayoutParams(0, -2, 0.72f));
        LinearLayout.LayoutParams gap2 = new LinearLayout.LayoutParams(dp(7), 1);
        buttons.addView(new View(this), gap2);
        buttons.addView(delete, new LinearLayout.LayoutParams(0, -2, 0.62f));
        item.addView(buttons);
        if (!gameUsable && !loadFailed) {
            addGap(item, 8);
            item.addView(action("인게임 생성 연결 허용", true, () -> {
                try {
                    ImageProviderStore.enableForGame(data, provider.id);
                    persist();
                    renderList();
                } catch (Exception error) {
                    showError("게임 연결을 허용하지 못했습니다", error.getMessage());
                }
            }));
        }
        if (loadFailed) item.setAlpha(0.45f);
        return item;
    }

    private void renderEditor(ImageProviderStore.Provider existing) {
        if (loadFailed) return;
        editorShowing = true;
        ImageProviderStore.Provider original = existing == null ? null : copy(existing);
        renderShell(existing == null ? "서비스 추가" : "서비스 편집",
                "연결 방식을 고른 뒤 주소와 인증 정보를 입력하세요.");
        LinearLayout page = (LinearLayout) ((ScrollView) frame.getChildAt(0)).getChildAt(0);

        LinearLayout typeCard = card();
        typeCard.addView(label("1. 연결 방식", 14, TEXT, true));
        addGap(typeCard, 6);
        Spinner type = spinner(new String[] {
                "Cloudflare FLUX Worker",
                "OpenAI 호환 Images API",
                "사용자 지정 REST · JSON"
        });
        type.setSelection(typeIndex(existing == null ? "cloudflare-worker" : existing.type));
        typeCard.addView(type, new LinearLayout.LayoutParams(-1, dp(48)));
        addGap(typeCard, 5);
        typeCard.addView(label("템플릿은 요청 형식과 이미지 응답 해석을 자동으로 설정합니다. 제공자가 다른 규격을 쓰면 사용자 지정 REST를 선택하세요.", 11, MUTED, false));
        page.addView(typeCard);
        addGap(page, 10);

        LinearLayout fields = card();
        fields.addView(label("2. 서비스 정보", 14, TEXT, true));
        addGap(fields, 10);
        EditText name = field("화면에 표시할 이름", false, false);
        name.setText(existing == null ? "" : existing.name);
        fields.addView(fieldBlock("서비스 이름", name));
        addGap(fields, 8);

        EditText endpoint = field("https://...", false, false);
        endpoint.setSingleLine(true);
        endpoint.setText(existing == null ? "" : existing.endpoint);
        fields.addView(fieldBlock("API 주소", endpoint));
        addGap(fields, 8);

        EditText model = field("모델 ID 또는 Worker 내부 모델", false, false);
        model.setSingleLine(true);
        model.setText(existing == null ? "" : existing.model);
        fields.addView(fieldBlock("모델", model));
        addGap(fields, 8);

        EditText key = field("새 키 입력 · 비워두면 기존 키 유지", true, false);
        key.setSingleLine(true);
        key.setText("");
        fields.addView(fieldBlock("API 키 / 토큰", key));
        addGap(fields, 8);
        CheckBox gameAccess = new CheckBox(this);
        gameAccess.setText("게임 WML 모드에서 이 서비스 사용 허용");
        gameAccess.setTextColor(TEXT);
        gameAccess.setTextSize(13);
        gameAccess.setButtonTintList(android.content.res.ColorStateList.valueOf(GREEN));
        gameAccess.setChecked(existing != null && existing.allowInGame);
        fields.addView(gameAccess);
        TextView accessNote = label("게임별 기본 서비스로 지정하면 인게임 사용이 자동 허용됩니다. 이 항목을 끄면 해당 서비스의 인게임 요청이 차단됩니다. 실제 생성 시 Worker 사용량이 발생할 수 있습니다.", 11, MUTED, false);
        fields.addView(accessNote);
        addGap(fields, 8);

        EditText authHeader = field("Authorization", false, false);
        authHeader.setSingleLine(true);
        authHeader.setText(existing == null ? "Authorization" : existing.authHeader);
        fields.addView(fieldBlock("인증 헤더 이름", authHeader));
        addGap(fields, 8);

        EditText authPrefix = field("Bearer ", false, false);
        authPrefix.setSingleLine(true);
        authPrefix.setText(existing == null ? "Bearer " : existing.authPrefix);
        fields.addView(fieldBlock("인증 접두사", authPrefix));
        page.addView(fields);
        addGap(page, 10);

        LinearLayout custom = card();
        custom.addView(label("3. 사용자 지정 요청 / 응답", 14, TEXT, true));
        addGap(custom, 5);
        custom.addView(label("JSON POST 요청 본문 템플릿입니다. {{prompt}}, {{model}}, {{width}}, {{height}}, {{size}} 값을 사용할 수 있습니다.", 11, MUTED, false));
        addGap(custom, 8);
        EditText template = field("요청 JSON", false, true);
        template.setMinLines(5);
        template.setGravity(Gravity.TOP | Gravity.START);
        template.setText(existing == null || existing.requestTemplate.isEmpty()
                ? "{\"model\":\"{{model}}\",\"prompt\":\"{{prompt}}\",\"n\":1,\"size\":\"{{size}}\"}"
                : existing.requestTemplate);
        custom.addView(fieldBlock("요청 본문", template));
        addGap(custom, 8);
        EditText responsePath = field("예: data.0.b64_json 또는 image", false, false);
        responsePath.setSingleLine(true);
        responsePath.setText(existing == null ? "data.0.b64_json" : existing.responsePath);
        custom.addView(fieldBlock("응답 이미지 JSON 경로", responsePath));
        addGap(custom, 8);
        Spinner encoding = spinner(new String[] { "AUTO · URL/Base64 자동 판별", "BASE64 · Base64 이미지", "URL · 이미지 주소 다운로드" });
        encoding.setSelection(encodingIndex(existing == null ? "AUTO" : existing.responseEncoding));
        custom.addView(fieldBlock("응답 형식", encoding));
        page.addView(custom);

        Runnable updateCustomVisibility = () -> {
            boolean show = type.getSelectedItemPosition() == 2;
            custom.setVisibility(show ? View.VISIBLE : View.GONE);
            model.setHint(type.getSelectedItemPosition() == 0
                    ? "Worker 내부에서 모델을 고정했다면 비워둘 수 있습니다."
                    : "서비스에서 사용하는 모델 ID");
            endpoint.setHint(type.getSelectedItemPosition() == 0
                    ? "https://your-worker.workers.dev"
                    : type.getSelectedItemPosition() == 1
                    ? "https://api.example.com"
                    : "https://api.example.com/generate");
            if (type.getSelectedItemPosition() == 1) model.setHint("예: gpt-image-1 또는 제공자 모델 ID");
            if (type.getSelectedItemPosition() == 0 && responsePath.getText().length() == 0) responsePath.setText("image");
        };
        type.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                updateCustomVisibility.run();
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        updateCustomVisibility.run();

        addGap(page, 10);
        LinearLayout actions = row();
        TextView test = action("실제 생성 테스트", false, () -> {
            ImageProviderStore.Provider draft = buildProvider(original, type, name, endpoint, model, key, gameAccess,
                    authHeader, authPrefix, template, responsePath, encoding);
            if (draft == null) return;
            confirmTest(draft);
        });
        TextView save = action("저장", true, () -> {
            ImageProviderStore.Provider draft = buildProvider(original, type, name, endpoint, model, key, gameAccess,
                    authHeader, authPrefix, template, responsePath, encoding);
            if (draft == null) return;
            try {
                ImageProviderStore.validateProvider(draft);
                ImageProviderClient.validateEndpoint(draft.endpoint);
                if ("openai-compatible".equals(draft.type) && draft.apiKey.isEmpty()) {
                    throw new IllegalArgumentException("OpenAI 호환 API 키를 입력해 주세요.");
                }
                if ("openai-compatible".equals(draft.type) && draft.model.trim().isEmpty()) {
                    throw new IllegalArgumentException("모델 ID를 입력해 주세요.");
                }
                int index = -1;
                for (int i = 0; i < data.providers.size(); i++) if (data.providers.get(i).id.equals(draft.id)) index = i;
                if (index >= 0) data.providers.set(index, draft);
                else data.providers.add(draft);
                store.save(data);
                Toast.makeText(this, "이미지 서비스를 안전하게 저장했습니다.", Toast.LENGTH_SHORT).show();
                renderList();
            } catch (Exception error) {
                showError("저장할 수 없습니다", error.getMessage());
            }
        });
        actions.addView(test, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams actionGap = new LinearLayout.LayoutParams(dp(8), 1);
        actions.addView(new View(this), actionGap);
        actions.addView(save, new LinearLayout.LayoutParams(0, -2, 1));
        page.addView(actions);
        addGap(page, 10);
        page.addView(label("연결 테스트는 샘플 이미지를 실제로 생성합니다. 서비스 요금이나 크레딧이 사용될 수 있습니다. 키는 게임 브라우저 저장소나 WML 모드에 전달하지 않습니다.", 11, MUTED, false));
    }

    private ImageProviderStore.Provider buildProvider(ImageProviderStore.Provider original,
            Spinner type, EditText name, EditText endpoint, EditText model, EditText key, CheckBox gameAccess,
            EditText authHeader, EditText authPrefix, EditText template, EditText responsePath,
            Spinner encoding) {
        ImageProviderStore.Provider provider = original == null ? new ImageProviderStore.Provider() : copy(original);
        if (provider.id == null || provider.id.isEmpty()) {
            provider.id = UUID.randomUUID().toString().replace("-", "");
        }
        provider.name = value(name);
        provider.type = typeValue(type.getSelectedItemPosition());
        provider.endpoint = value(endpoint);
        provider.model = value(model);
        String newKey = value(key);
        if (!newKey.isEmpty()) provider.apiKey = newKey;
        provider.authHeader = value(authHeader).isEmpty() ? "Authorization" : value(authHeader);
        provider.authPrefix = authPrefix.getText().toString();
        provider.requestTemplate = value(template);
        provider.responsePath = value(responsePath);
        provider.responseEncoding = encodingValue(encoding.getSelectedItemPosition());
        provider.enabled = true;
        provider.allowInGame = gameAccess.isChecked();
        try {
            ImageProviderStore.validateProvider(provider);
            ImageProviderClient.validateEndpoint(provider.endpoint);
            if ("openai-compatible".equals(provider.type) && provider.model.trim().isEmpty()) {
                throw new IllegalArgumentException("모델 ID를 입력해 주세요.");
            }
            return provider;
        } catch (Exception error) {
            showError("입력 내용을 확인해 주세요", error.getMessage());
            return null;
        }
    }

    private void confirmTest(ImageProviderStore.Provider provider) {
        new AlertDialog.Builder(this)
                .setTitle("샘플 이미지 생성")
                .setMessage("연결 테스트는 상태 조회가 아니라 실제 이미지 생성 요청을 보냅니다. 선택한 서비스의 요금 또는 크레딧이 사용될 수 있습니다. 계속할까요?")
                .setNegativeButton("취소", null)
                .setPositiveButton("생성 테스트", (dialog, which) -> runTest(provider))
                .show();
    }

    private void runTest(ImageProviderStore.Provider provider) {
        if (testRunning) {
            Toast.makeText(this, "이미 연결 테스트가 진행 중입니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        testRunning = true;
        Toast.makeText(this, "샘플 이미지를 생성하고 있습니다…", Toast.LENGTH_SHORT).show();
        tests.execute(() -> {
            try {
                ImageProviderClient.Result result = ImageProviderClient.generate(provider,
                        "A clean simple illustration of a small orange circle on a warm off-white background, centered, no text.",
                        512, 512);
                runOnUiThread(() -> {
                    testRunning = false;
                    if (!isFinishing()) showPreview(provider.name, result);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    testRunning = false;
                    if (!isFinishing()) showError("연결 테스트 실패", error.getMessage());
                });
            }
        });
    }

    private void showPreview(String providerName, ImageProviderClient.Result result) {
        Bitmap bitmap = BitmapFactory.decodeByteArray(result.image, 0, result.image.length);
        if (bitmap == null) {
            showError("응답 확인 실패", "이미지 바이트를 받았지만 Android에서 미리보기로 열지 못했습니다.");
            return;
        }
        LinearLayout content = column();
        content.setPadding(dp(8), dp(8), dp(8), dp(4));
        ImageView preview = new ImageView(this);
        preview.setImageBitmap(bitmap);
        preview.setAdjustViewBounds(true);
        preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        content.addView(preview, new LinearLayout.LayoutParams(-1, dp(280)));
        content.addView(label("실제 이미지 응답을 받았습니다 · " + result.mimeType, 12, MUTED, false));
        new AlertDialog.Builder(this)
                .setTitle(providerName + " 연결 성공")
                .setView(content)
                .setPositiveButton("확인", null)
                .show();
    }

    private void confirmDelete(ImageProviderStore.Provider provider) {
        new AlertDialog.Builder(this)
                .setTitle("서비스 삭제")
                .setMessage("'" + provider.name + "' 설정과 암호화된 인증정보를 삭제할까요?")
                .setNegativeButton("취소", null)
                .setPositiveButton("삭제", (dialog, which) -> {
                    for (int i = data.providers.size() - 1; i >= 0; i--) {
                        if (data.providers.get(i).id.equals(provider.id)) data.providers.remove(i);
                    }
                    ArrayList<String> remove = new ArrayList<>();
                    for (String profile : data.defaults.keySet()) {
                        if (provider.id.equals(data.defaults.get(profile))) remove.add(profile);
                    }
                    for (String profile : remove) data.defaults.remove(profile);
                    persist();
                    renderList();
                })
                .show();
    }

    private void persist() {
        try {
            store.save(data);
            Toast.makeText(this, "설정을 저장했습니다.", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            showError("저장 실패", error.getMessage());
        }
    }

    private void showError(String title, String message) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message == null || message.isEmpty() ? "원인을 확인하지 못했습니다." : message)
                .setPositiveButton("확인", null)
                .show();
    }

    private LinearLayout fieldBlock(String title, View field) {
        LinearLayout block = column();
        block.addView(label(title, 12, MUTED, true));
        addGap(block, 5);
        block.addView(field);
        return block;
    }

    private EditText field(String hint, boolean password, boolean multiline) {
        EditText edit = new EditText(this);
        edit.setTextColor(TEXT);
        edit.setHintTextColor(Color.rgb(120, 139, 127));
        edit.setTextSize(14);
        edit.setHint(hint);
        edit.setPadding(dp(12), dp(10), dp(12), dp(10));
        edit.setBackground(shape(Color.rgb(18, 29, 23), Color.rgb(61, 79, 67), 10));
        int input = InputType.TYPE_CLASS_TEXT;
        if (password) input |= InputType.TYPE_TEXT_VARIATION_PASSWORD;
        if (multiline) input |= InputType.TYPE_TEXT_FLAG_MULTI_LINE;
        if (password) edit.setInputType(input);
        else edit.setInputType(input | (multiline ? 0 : InputType.TYPE_TEXT_FLAG_CAP_SENTENCES));
        if (!multiline) edit.setSingleLine(true);
        return edit;
    }

    private Spinner spinner(String[] values) {
        ArrayList<String> list = new ArrayList<>();
        java.util.Collections.addAll(list, values);
        return spinner(list);
    }

    private Spinner spinner(List<String> values) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setBackground(shape(Color.rgb(18, 29, 23), Color.rgb(61, 79, 67), 10));
        return spinner;
    }

    private List<GameProfile> loadGameProfiles() {
        ArrayList<GameProfile> result = new ArrayList<>();
        String raw = getSharedPreferences("wayward_launcher", MODE_PRIVATE).getString("game_profiles", null);
        if (raw == null) return result;
        try {
            JSONArray profiles = new JSONArray(raw);
            for (int i = 0; i < profiles.length(); i++) {
                JSONObject item = profiles.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                String label = item.optString("label", "Wayward");
                if (id.matches("[a-f0-9]{32}")) result.add(new GameProfile(id, label));
            }
        } catch (Exception ignored) {}
        return result;
    }

    private ImageProviderStore.Provider copy(ImageProviderStore.Provider original) {
        ImageProviderStore.Provider item = new ImageProviderStore.Provider();
        item.id = original.id;
        item.name = original.name;
        item.type = original.type;
        item.endpoint = original.endpoint;
        item.model = original.model;
        item.apiKey = original.apiKey;
        item.authHeader = original.authHeader;
        item.authPrefix = original.authPrefix;
        item.requestTemplate = original.requestTemplate;
        item.responsePath = original.responsePath;
        item.responseEncoding = original.responseEncoding;
        item.enabled = original.enabled;
        item.allowInGame = original.allowInGame;
        return item;
    }

    private String value(EditText edit) {
        return edit.getText() == null ? "" : edit.getText().toString().trim();
    }

    private int typeIndex(String type) {
        if ("openai-compatible".equals(type)) return 1;
        if ("custom-json".equals(type)) return 2;
        return 0;
    }

    private String typeValue(int index) {
        return index == 1 ? "openai-compatible" : index == 2 ? "custom-json" : "cloudflare-worker";
    }

    private String typeName(String type) {
        if ("openai-compatible".equals(type)) return "OPENAI COMPATIBLE";
        if ("custom-json".equals(type)) return "CUSTOM REST · JSON";
        return "CLOUDFLARE WORKER";
    }

    private int encodingIndex(String value) {
        if ("BASE64".equalsIgnoreCase(value)) return 1;
        if ("URL".equalsIgnoreCase(value)) return 2;
        return 0;
    }

    private String encodingValue(int index) {
        return index == 1 ? "BASE64" : index == 2 ? "URL" : "AUTO";
    }
}
