#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
if [[ -n "${GITHUB_BASE_REF:-}" ]] && git -C "$REPO_ROOT" rev-parse --verify "origin/${GITHUB_BASE_REF}" >/dev/null 2>&1; then
  DIFF_BASE="$(git -C "$REPO_ROOT" merge-base HEAD "origin/${GITHUB_BASE_REF}")"
else
  DIFF_BASE="HEAD^"
fi
git -C "$REPO_ROOT" diff --check "$DIFF_BASE" HEAD
node --check app/src/main/assets/wml-folder-bootstrap.js
node --check app/src/main/assets/imagegen-proxy.js
node tests/imagegen-proxy.test.mjs
node tests/wml-folder-bootstrap.test.mjs
node tests/web-file-chooser-contract.test.mjs
node tests/imagegen-session-contract.test.mjs
ZIP_TEST_BUILD="$(mktemp -d)"
trap 'rm -rf "$ZIP_TEST_BUILD"' EXIT
javac -d "$ZIP_TEST_BUILD" app/src/main/java/com/wayward/launcher/ZipModStore.java tests/ZipModStoreTest.java
java -cp "$ZIP_TEST_BUILD" com.wayward.launcher.ZipModStoreTest
javac -d "$ZIP_TEST_BUILD" app/src/main/java/com/wayward/launcher/ImageGenStatusStore.java tests/ImageGenStatusStoreTest.java
java -cp "$ZIP_TEST_BUILD" com.wayward.launcher.ImageGenStatusStoreTest
test -s ../Wayward_WML_ko.html
gradle --no-daemon assembleDebug
test -s app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose app/build/outputs/apk/debug/app-debug.apk
