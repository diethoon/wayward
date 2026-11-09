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
grep -Fq 'bunProcess(bun, "src/cli.ts", "--no-webp")' app/src/main/java/com/wayward/launcher/ImageGenService.java
grep -Fq 'while (!stopping && !Thread.currentThread().isInterrupted())' app/src/main/java/com/wayward/launcher/ImageGenService.java
! grep -Fq '60초 안에 /api/image/health' app/src/main/java/com/wayward/launcher/ImageGenService.java
grep -Fq 'task.cancel(true)' app/src/main/java/com/wayward/launcher/ImageGenService.java
grep -Fq 'private void checkStartupActive()' app/src/main/java/com/wayward/launcher/ImageGenService.java
grep -Fq 'imageGenStartButton.setEnabled(true)' app/src/main/java/com/wayward/launcher/MainActivity.java
grep -Fq 'imageGenRestartButton.setEnabled(true)' app/src/main/java/com/wayward/launcher/MainActivity.java
grep -Fq 'imageGenStopButton.setEnabled(true)' app/src/main/java/com/wayward/launcher/MainActivity.java
grep -Fq 'web.loadUrl(gameUrl);' app/src/main/java/com/wayward/launcher/MainActivity.java
grep -Fq 'ensureImageGenServer(sessionTree, null)' app/src/main/java/com/wayward/launcher/MainActivity.java
! grep -Fq 'pendingGameLoad = true' app/src/main/java/com/wayward/launcher/MainActivity.java
node --check app/src/main/assets/wml-folder-bootstrap.js
node --check app/src/main/assets/imagegen-proxy.js
node tests/imagegen-proxy.test.mjs
node tests/wml-folder-bootstrap.test.mjs
node tests/web-file-chooser-contract.test.mjs
node tests/imagegen-session-contract.test.mjs
node tests/image-resource-performance.test.mjs
node tests/diagnostics-contract.test.mjs
node diagnostics-server/server.test.mjs
node diagnostics-vercel/test.mjs
node --check diagnostics-vercel/lib/common.js
node --check diagnostics-vercel/api/v1/ping.js
node --check diagnostics-vercel/api/v1/ingest.js
node --check diagnostics-vercel/api/v1/read.js
node --check diagnostics-vercel/api/v1/cleanup.js
node --check diagnostics-vercel/lib/cleanup.js
node --check diagnostics-vercel/lib/cleanup-core.js
STATUS_TEST_BUILD="$(mktemp -d)"
trap 'rm -rf "$STATUS_TEST_BUILD"' EXIT
javac -d "$STATUS_TEST_BUILD" app/src/main/java/com/wayward/launcher/ImageGenStatusStore.java tests/ImageGenStatusStoreTest.java
java -cp "$STATUS_TEST_BUILD" com.wayward.launcher.ImageGenStatusStoreTest
test -s ../Wayward_WML_ko.html
gradle --no-daemon assembleDebug
test -s app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose app/build/outputs/apk/debug/app-debug.apk
