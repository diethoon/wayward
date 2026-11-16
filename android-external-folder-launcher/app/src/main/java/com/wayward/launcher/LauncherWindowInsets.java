package com.wayward.launcher;

import android.os.Build;
import android.view.View;
import android.view.WindowInsets;

/** Applies Android system-bar and display-cutout insets to an Activity content root. */
final class LauncherWindowInsets {
    private LauncherWindowInsets() {}

    static void apply(View root) {
        if (root == null) return;

        final int baseLeft = root.getPaddingLeft();
        final int baseTop = root.getPaddingTop();
        final int baseRight = root.getPaddingRight();
        final int baseBottom = root.getPaddingBottom();

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left;
            int top;
            int right;
            int bottom;

            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = safe.left;
                top = safe.top;
                right = safe.right;
                bottom = safe.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }

            view.setPadding(baseLeft + left, baseTop + top,
                    baseRight + right, baseBottom + bottom);
            return insets;
        });

        root.requestApplyInsets();
    }
}
