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

# Preserve the exact emulator profile and installed system-image revision with
# each run. The hosted AVD is disposable; this manifest makes its runtime
# environment reproducible and lets later failures be compared byte-for-byte.
{
  echo "profile=pixel_7"
  echo "api_level=35"
  echo "target=google_apis"
  echo "arch=x86_64"
  echo "emulator_options=-no-window -gpu swiftshader_indirect -noaudio -no-boot-anim -camera-back none"
  echo
  echo "[emulator]"
  emulator -version 2>&1 | head -n 6 || true
  echo
  echo "[adb]"
  adb version 2>&1 | head -n 4 || true
  echo
  echo "[device properties]"
  for property in ro.build.fingerprint ro.build.id ro.build.version.incremental ro.product.manufacturer ro.product.model ro.product.device ro.hardware ro.boot.qemu.avd_name ro.dalvik.vm.native.bridge ro.enable.native.bridge.exec; do
    printf '%s=' "$property"
    adb shell getprop "$property"
  done
  echo
  echo "[installed Android 35 Google APIs x86_64 image]"
  SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  IMAGE_ROOT="$SDK_ROOT/system-images/android-35/google_apis/x86_64"
  for metadata in "$IMAGE_ROOT/source.properties" "$IMAGE_ROOT/package.xml"; do
    if [ -f "$metadata" ]; then
      echo "--- $metadata"
      if [[ "$metadata" == *.xml ]]; then
        sed -n '1,180p' "$metadata"
      else
        cat "$metadata"
      fi
    fi
  done
  echo
  echo "[AVD configuration]"
  AVD_ROOT="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
  if [ -d "$AVD_ROOT" ]; then
    find "$AVD_ROOT" -maxdepth 3 -type f -name config.ini -print | while IFS= read -r ini; do
      echo "--- $ini"
      sed -n '1,180p' "$ini"
    done
  else
    echo "AVD directory not exposed: $AVD_ROOT"
  fi
} > "$OUT/emulator-manifest.txt" 2>&1
adb shell ls -l /system/bin/arm64/linker64 > "$OUT/arm64-linker.txt" 2>&1 || true
adb shell ls -l /system/bin/ndk_translation_program_runner_binfmt_misc_arm64 > "$OUT/arm64-runner.txt" 2>&1 || true
adb shell cat /proc/sys/fs/binfmt_misc/arm64_exe > "$OUT/arm64-binfmt.txt" 2>&1 || true
adb install -r "$APK" | tee "$OUT/install.txt"
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS
adb shell mkdir -p /sdcard/Download/Wayward-CI

set +e
gradle -p android-external-folder-launcher --no-daemon --stacktrace :app:connectedDebugAndroidTest > "$OUT/instrumentation.txt" 2>&1
TEST_EXIT=$?
set -e

# connectedDebugAndroidTest uninstalls the target APK after instrumentation.
# The test exports its app-private logs/screenshot to shared Download storage
# before teardown, so collect those durable files instead of run-as afterwards.
for artifact in \
  Wayward-Android15-Cloudflare-Game-Logs.txt \
  Wayward-Android15-Cloudflare-Game-Screen.png; do
  if adb shell test -s "/sdcard/Download/Wayward-CI/$artifact"; then
    adb pull "/sdcard/Download/Wayward-CI/$artifact" "$OUT/$artifact"
  else
    echo "MISSING_ANDROID_GAME_ARTIFACT: $artifact" | tee -a "$OUT/artifact-export.txt"
  fi
done
if [ -d "$RUNNER_TEMP/wayward-game-fixture" ]; then
  cp "$RUNNER_TEMP/wayward-game-fixture/game-html-forensics.txt" "$OUT/" 2>/dev/null || true
  cp "$RUNNER_TEMP/wayward-game-fixture/game-html-chunks.sha256.jsonl" "$OUT/" 2>/dev/null || true
fi
if [ -s "$RUNNER_TEMP/imagestudio-archive-index.txt" ]; then
  cp "$RUNNER_TEMP/imagestudio-archive-index.txt" "$OUT/"
fi
if [ -s "$RUNNER_TEMP/imagestudio-source-index.txt" ]; then
  cp "$RUNNER_TEMP/imagestudio-source-index.txt" "$OUT/"
fi
if [ -s "$RUNNER_TEMP/mods-wml-entrypoints-index.txt" ]; then
  cp "$RUNNER_TEMP/mods-wml-entrypoints-index.txt" "$OUT/"
fi
if [ -s "$RUNNER_TEMP/wml-runtime-module-zips-index.txt" ]; then
  cp "$RUNNER_TEMP/wml-runtime-module-zips-index.txt" "$OUT/"
fi
SOURCE_DIR="$PWD/android-external-folder-launcher/app/src/androidTest/assets/imagestudio-source"
if [ -d "$SOURCE_DIR" ]; then
  cp -R "$SOURCE_DIR" "$OUT/imagestudio-source"
fi
adb logcat -d -t 12000 > "$OUT/logcat.txt"

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
