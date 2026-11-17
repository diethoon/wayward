package com.wayward.launcher;

import android.app.ActivityManager;
import android.app.Application;
import android.app.ApplicationExitInfo;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

import java.util.List;

/** Captures Java crashes and Android's historical process-exit summaries. */
public final class LauncherApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        installCrashHandler();
        if (getPackageName().equals(Application.getProcessName())) {
            capturePreviousExitReasons();
            DiagnosticsLogger.event(this, "INFO", "launcher", "process_started", null);
            DiagnosticsUploader.uploadPending(this);
        } else {
            DiagnosticsLogger.event(this, "INFO", "imagegen_service", "process_started", null);
        }
    }

    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            DiagnosticsLogger.error(this, "launcher", "uncaught_exception", error);
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    private void capturePreviousExitReasons() {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (manager == null) return;
            List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(getPackageName(), 0, 8);
            SharedPreferences prefs = getSharedPreferences("wayward_launcher_diagnostics", MODE_PRIVATE);
            long last = prefs.getLong("last_exit_timestamp", 0L);
            long newest = last;
            for (ApplicationExitInfo info : exits) {
                if (info.getTimestamp() <= last) continue;
                JSONObject details = new JSONObject();
                details.put("reason", info.getReason());
                details.put("status", info.getStatus());
                details.put("timestamp", info.getTimestamp());
                details.put("pssKb", info.getPss());
                details.put("rssKb", info.getRss());
                details.put("process", info.getProcessName());
                details.put("description", info.getDescription() == null ? "" : info.getDescription());
                DiagnosticsLogger.event(this, "WARN", "android", "previous_process_exit", details);
                newest = Math.max(newest, info.getTimestamp());
            }
            if (newest > last) prefs.edit().putLong("last_exit_timestamp", newest).apply();
        } catch (Throwable error) {
            DiagnosticsLogger.error(this, "android", "exit_history_read_failed", error);
        }
    }
}
