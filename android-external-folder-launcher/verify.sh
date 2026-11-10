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
python3 -c "compile(open('scripts/embed_imagegen_backend.py', encoding='utf-8').read(), 'scripts/embed_imagegen_backend.py', 'exec')"
test -s app/src/main/assets/imagegen-backend/launcher-bundle.json
test -s app/src/main/assets/imagegen-backend/wayward-imagegen/src/cli.ts
test -s app/src/main/assets/imagegen-backend/wayward-imagegen/src/nai/client.ts
node --check app/src/main/assets/wml-folder-bootstrap.js
node --check app/src/main/assets/imagegen-proxy.js
node --check app/src/main/assets/image-provider-bridge.js
node --check app/src/main/assets/imagegen-studio-bridge.js
node tests/imagegen-studio-bridge.test.mjs
node tests/imagegen-proxy.test.mjs
node tests/image-provider-bridge.test.mjs
node tests/wml-folder-bootstrap.test.mjs
node tests/launcher-companions-removal.test.mjs
node tests/web-file-chooser-contract.test.mjs
node tests/imagegen-session-contract.test.mjs
node tests/imagegen-runtime-launch.test.mjs
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
ZIP_TEST_BUILD="$(mktemp -d)"
trap 'rm -rf "$ZIP_TEST_BUILD"' EXIT
javac -d "$ZIP_TEST_BUILD" app/src/main/java/com/wayward/launcher/ZipModStore.java tests/ZipModStoreTest.java
java -cp "$ZIP_TEST_BUILD" com.wayward.launcher.ZipModStoreTest
javac -d "$ZIP_TEST_BUILD" app/src/main/java/com/wayward/launcher/ImageGenStatusStore.java tests/ImageGenStatusStoreTest.java
java -cp "$ZIP_TEST_BUILD" com.wayward.launcher.ImageGenStatusStoreTest
javac -d "$ZIP_TEST_BUILD" app/src/main/java/com/wayward/launcher/ComfyEndpoint.java tests/ComfyEndpointTest.java
java -cp "$ZIP_TEST_BUILD" com.wayward.launcher.ComfyEndpointTest
SAF_TEST_CLASSES="$ZIP_TEST_BUILD/saf-image-cache"
mkdir -p "$SAF_TEST_CLASSES"
javac -d "$SAF_TEST_CLASSES" \
  tests/saf-image-cache-stubs/android/net/Uri.java \
  tests/saf-image-cache-stubs/android/content/Context.java \
  tests/saf-image-cache-stubs/android/content/ContentResolver.java \
  tests/saf-image-cache-stubs/org/json/JSONObject.java \
  tests/saf-image-cache-stubs/com/wayward/launcher/ImagePipelineDiagnostics.java \
  app/src/main/java/com/wayward/launcher/SafImageCache.java \
  tests/SafImageCacheTest.java
java -cp "$SAF_TEST_CLASSES" com.wayward.launcher.SafImageCacheTest
test -s ../Wayward_WML_ko.html
gradle --no-daemon assembleDebug
test -s app/build/outputs/apk/debug/app-debug.apk
python3 - <<'PY'
import json
import zipfile

apk = "app/build/outputs/apk/debug/app-debug.apk"
with zipfile.ZipFile(apk) as bundle:
    names = set(bundle.namelist())
    root = "assets/imagegen-backend/"
    manifest_path = root + "launcher-bundle.json"
    package_path = root + "wayward-imagegen/package.json"
    nai_path = root + "wayward-imagegen/src/nai/client.ts"
    cli_path = root + "wayward-imagegen/src/cli.ts"
    settings_path = root + "wayward-imagegen/src/routes/generationSettings.ts"
    queue_path = root + "wayward-imagegen/src/batch/queue.ts"
    runner_path = root + "wayward-imagegen/src/comfy/jobRunner.ts"
    config_path = root + "wayward-imagegen/src/config.ts"
    catalogue_path = root + "wayward-imagegen/src/routes/catalogue.ts"
    ui_path = root + "wayward-imagegen/ui/index.html"
    for path in (manifest_path, package_path, nai_path, cli_path, settings_path,
                 queue_path, runner_path, config_path, catalogue_path, ui_path):
        assert path in names, "APK is missing embedded server file: " + path
    manifest = json.loads(bundle.read(manifest_path))
    package = json.loads(bundle.read(package_path))
    assert package.get("version") == "0.8.4"
    assert manifest.get("backendVersion") == "0.8.4"
    assert manifest.get("fileCount", 0) > 0
    assert manifest.get("sourceArchiveSha256") == "dfd25e050dd0b98ec1c99c09634bd92b509efac428788273f84884e713e2c553"
    assert "persist-discovered-character-filter" in manifest.get("launcherPatches", [])
    assert "redact-persisted-novelai-token" in manifest.get("launcherPatches", [])
    for patch in (
        "add-launcher-provider-config",
        "load-launcher-provider-config",
        "route-launcher-provider-through-serialized-nai-job-queue",
        "serialize-launcher-provider-image-requests",
        "add-guarded-loopback-provider-job-adapter",
        "save-launcher-provider-image-through-normal-finalize-cache-path",
        "probe-native-provider-adapter-for-imagegen-health",
    ):
        assert patch in manifest.get("launcherPatches", []), "APK is missing Image Studio native-provider patch: " + patch
    settings_source = bundle.read(settings_path).decode("utf-8")
    queue_source = bundle.read(queue_path).decode("utf-8")
    runner_source = bundle.read(runner_path).decode("utf-8")
    config_source = bundle.read(config_path).decode("utf-8")
    catalogue_source = bundle.read(catalogue_path).decode("utf-8")
    ui_source = bundle.read(ui_path).decode("utf-8")
    assert "discoveredCharacterDirs" in settings_source
    assert "const persistedSettings = { ...settings, naiToken: '' }" in settings_source
    assert "config.imageProvider === 'launcher'" in runner_source
    assert "launcherGenerate(config, args, job.promptId)" in runner_source
    assert "launcherProviderToken" in config_source
    assert "launcher-provider-v1" in catalogue_source
    assert "token missing" in ui_source
    assert "ImageGenLocalProviderServer.java" in open(
        "app/src/main/java/com/wayward/launcher/ImageGenLocalProviderServer.java",
        encoding="utf-8"
    ).read() or "ImageGenLocalProviderServer.java"
print("APK embedded ImageGen and native-provider pipeline assets verified.")
PY
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose app/build/outputs/apk/debug/app-debug.apk
