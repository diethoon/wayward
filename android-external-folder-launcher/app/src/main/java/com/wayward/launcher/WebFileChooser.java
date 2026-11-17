package com.wayward.launcher;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import android.webkit.WebView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Connects HTML <input type="file"> requests in the game WebView to Android's
 * Storage Access Framework. The page receives the selected content:// URIs
 * through the standard WebView callback; no game HTML changes are required.
 */
final class WebFileChooser extends WebChromeClient {
    static final int REQUEST_CODE = 4103;

    private final Activity activity;
    private final java.util.concurrent.atomic.AtomicInteger consoleErrorSamples =
            new java.util.concurrent.atomic.AtomicInteger();
    private ValueCallback<Uri[]> pendingCallback;
    private boolean allowMultiple;

    WebFileChooser(Activity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage message) {
        if (message != null && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                && consoleErrorSamples.getAndIncrement() < 16) {
            org.json.JSONObject details = new org.json.JSONObject();
            try {
                String source = message.sourceId();
                Uri sourceUri = source == null ? null : Uri.parse(source);
                String sourcePath = sourceUri == null ? "" : sourceUri.getPath();
                if (sourcePath == null || sourcePath.isEmpty()) sourcePath = source == null ? "" : source;
                if (sourcePath.length() > 240) sourcePath = sourcePath.substring(0, 240);
                details.put("sourcePath", sourcePath);
                details.put("line", message.lineNumber());
                details.put("level", message.messageLevel().name());
            } catch (Exception ignored) {}
            // Deliberately omit message text: it can contain game content or user data.
            DiagnosticsLogger.event(activity, "ERROR", "webview", "javascript_console_error", details);
        }
        return super.onConsoleMessage(message);
    }

    @Override
    public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            FileChooserParams fileChooserParams) {
        cancelPending();
        pendingCallback = filePathCallback;
        allowMultiple = fileChooserParams != null
                && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;

        Intent picker = buildPickerIntent(fileChooserParams);
        try {
            activity.startActivityForResult(picker, REQUEST_CODE);
        } catch (Exception e) {
            deliver(null);
        }
        return true;
    }

    private Intent buildPickerIntent(FileChooserParams params) {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);

        List<String> accepted = acceptedMimeTypes(
                params == null ? null : params.getAcceptTypes());
        if (accepted.isEmpty()) {
            picker.setType("*/*");
        } else if (accepted.size() == 1) {
            picker.setType(accepted.get(0));
        } else {
            picker.setType("*/*");
            picker.putExtra(Intent.EXTRA_MIME_TYPES, accepted.toArray(new String[0]));
        }

        picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple);
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        picker.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        return picker;
    }

    private static List<String> acceptedMimeTypes(String[] acceptTypes) {
        List<String> result = new ArrayList<>();
        if (acceptTypes == null) return result;

        for (String accepted : acceptTypes) {
            if (accepted == null) continue;
            for (String raw : accepted.split("[,;\\s]+")) {
                String value = raw.trim().toLowerCase(Locale.ROOT);
                if (value.isEmpty()) continue;

                if (value.startsWith(".")) {
                    String extension = value.substring(1);
                    String mime = "zip".equals(extension)
                            ? "application/zip"
                            : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                    if (mime != null && !result.contains(mime)) result.add(mime);
                } else if (value.contains("/") && !value.contains(" ")
                        && !result.contains(value)) {
                    result.add(value);
                }
            }
        }
        return result;
    }

    void handleActivityResult(int resultCode, Intent data) {
        if (pendingCallback == null) return;
        if (resultCode != Activity.RESULT_OK || data == null) {
            deliver(null);
            return;
        }

        List<Uri> selected = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null && !selected.contains(uri)) selected.add(uri);
            }
        }

        Uri single = data.getData();
        if (single != null && !selected.contains(single)) selected.add(single);

        if (!allowMultiple && selected.size() > 1) {
            selected = new ArrayList<>(selected.subList(0, 1));
        }
        deliver(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
    }

    void cancelPending() {
        deliver(null);
    }

    private void deliver(Uri[] result) {
        ValueCallback<Uri[]> callback = pendingCallback;
        pendingCallback = null;
        allowMultiple = false;
        if (callback != null) callback.onReceiveValue(result);
    }
}
