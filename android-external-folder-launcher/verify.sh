#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
git -C "$REPO_ROOT" diff --check 95cd3b67b2da75c3c6c81f9409bb1a6e6cc41d06 "${GITHUB_SHA:-HEAD}"
node --check app/src/main/assets/wml-folder-bootstrap.js
node tests/wml-folder-bootstrap.test.mjs
node tests/web-file-chooser-contract.test.mjs
ZIP_TEST_BUILD="$(mktemp -d)"
trap 'rm -rf "$ZIP_TEST_BUILD"' EXIT
javac -d "$ZIP_TEST_BUILD" app/src/main/java/com/wayward/launcher/ZipModStore.java tests/ZipModStoreTest.java
java -cp "$ZIP_TEST_BUILD" com.wayward.launcher.ZipModStoreTest
WML_ROOT="../Wayward_MOD_v4.0_WML_검수완료/wml"
node --check "$WML_ROOT/runtime/wml-core.js"
for file in "$WML_ROOT"/mods/*/mod.js; do [ -f "$file" ] && node --check "$file"; done
gradle --no-daemon assembleDebug
test -s app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose app/build/outputs/apk/debug/app-debug.apk
