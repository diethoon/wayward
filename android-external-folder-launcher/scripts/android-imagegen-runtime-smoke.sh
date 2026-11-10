#!/usr/bin/env bash
set -euo pipefail

cd "${GITHUB_WORKSPACE:-$(pwd)}"
APK="$PWD/android-external-folder-launcher/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="com.wayward.launcher.imagegen039"
OUT="${RUNNER_TEMP:-/tmp}/android-launcher-smoke"
mkdir -p "$OUT"

adb wait-for-device
adb shell getprop ro.build.version.release > "$OUT/android-release.txt"
adb shell getprop ro.build.version.sdk > "$OUT/android-sdk.txt"
adb shell getprop ro.product.cpu.abilist > "$OUT/android-abilist.txt"
adb shell getprop ro.dalvik.vm.native.bridge > "$OUT/native-bridge.txt"
adb shell getprop ro.enable.native.bridge.exec > "$OUT/native-bridge-exec.txt"
adb shell ls -l /system/bin/arm64/linker64 > "$OUT/arm64-linker.txt" 2>&1 || true
adb shell ls -l /system/bin/ndk_translation_program_runner_binfmt_misc_arm64 > "$OUT/arm64-runner.txt" 2>&1 || true
adb shell cat /proc/sys/fs/binfmt_misc/arm64_exe > "$OUT/arm64-binfmt.txt" 2>&1 || true
adb install -r "$APK" | tee "$OUT/install.txt"
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS

set +e
gradle -p android-external-folder-launcher --no-daemon --stacktrace :app:connectedDebugAndroidTest > "$OUT/instrumentation.txt" 2>&1
TEST_EXIT=$?
set -e

adb shell run-as "$PACKAGE" cat files/imagegen/bun-version.log > "$OUT/bun-version.txt" 2>&1 || true
adb shell run-as "$PACKAGE" cat files/imagegen/startup.log > "$OUT/startup.log" 2>&1 || true
adb shell run-as "$PACKAGE" cat files/imagegen/server.log > "$OUT/server.log" 2>&1 || true
adb shell run-as "$PACKAGE" cat files/imagegen-status.properties > "$OUT/imagegen-status.properties" 2>&1 || true
adb logcat -d -t 6000 > "$OUT/logcat.txt"

{
  echo "device=Android 15 API 35 Google APIs x86_64 emulator"
  echo "abi=$(tr -d '[:space:]' < "$OUT/android-abilist.txt")"
  echo "native_bridge=$(tr -d '[:space:]' < "$OUT/native-bridge.txt")"
  echo "native_bridge_exec=$(tr -d '[:space:]' < "$OUT/native-bridge-exec.txt")"
  echo "arm64_linker=$(head -n 1 "$OUT/arm64-linker.txt")"
  echo "arm64_runner=$(head -n 1 "$OUT/arm64-runner.txt")"
  echo "arm64_binfmt=$(head -n 4 "$OUT/arm64-binfmt.txt" | tr '\\n' ' ')"
  echo "instrumentation_exit=$TEST_EXIT"
} | tee "$OUT/result.txt"

exit "$TEST_EXIT"
