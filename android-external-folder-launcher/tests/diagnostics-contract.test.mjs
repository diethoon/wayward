import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");
const manifest = read("app/src/main/AndroidManifest.xml");
const application = read("app/src/main/java/com/wayward/launcher/LauncherApplication.java");
const logger = read("app/src/main/java/com/wayward/launcher/DiagnosticsLogger.java");
const uploader = read("app/src/main/java/com/wayward/launcher/DiagnosticsUploader.java");
const main = read("app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("app/src/main/java/com/wayward/launcher/ImageGenService.java");
const chooser = read("app/src/main/java/com/wayward/launcher/WebFileChooser.java");
const proxy = read("app/src/main/java/com/wayward/launcher/ImageGenProxy.java");
const readApi = read("diagnostics-vercel/api/v1/read.js");
const ingestApi = read("diagnostics-vercel/api/v1/ingest.js");
const common = read("diagnostics-vercel/lib/common.js");
const cleanupApi = read("diagnostics-vercel/api/v1/cleanup.js");

assert.match(manifest, /android:name=".LauncherApplication"/);
assert.match(application, /setDefaultUncaughtExceptionHandler/);
assert.match(application, /getHistoricalProcessExitReasons/);
assert.match(logger, /launcher\.ndjson/);
assert.match(logger, /MAX_FILE_BYTES/);
assert.match(logger, /REDACTED/);
assert.match(uploader, /https:\/\/wayward-launcher-diagnostics-hoon-ead4\.vercel\.app/);
assert.match(uploader, /56 \* 1024/);
assert.doesNotMatch(uploader, /Application\.getProcessName\(\)/,
  "the :imagegen service process must be allowed to upload its own startup failures");
assert.match(uploader, /uploader\.lock/);
assert.match(uploader, /channel\.tryLock\(\)/,
  "cross-process upload must be serialized to prevent duplicate journal batches");
assert.match(uploader, /try \(UploadLock lock = tryAcquireUploadLock\(app\)\)/);
assert.doesNotMatch(uploader, /Authorization|DiagnosticsTokenStore|verifyAndSave/);
assert.doesNotMatch(main, /진단 로그 자동 전송 설정|진단 서버 연결 코드|showDiagnosticsSettings|DiagnosticsTokenStore/);
assert.match(main, /DiagnosticsUploader\.uploadPending\(this\)/);
assert.match(main, /failure\.startsWith\("서버 시작 실패"\)/,
  "the home status monitor must detect ImageGen startup failures");
assert.match(main, /now - lastImageGenDiagnosticUploadAt >= 30_000L/,
  "diagnostic upload retries must be rate limited");
assert.match(main, /compactButton\("진단 로그 공유",false,this::shareDiagnostics\)/);
assert.match(main, /Intent\.ACTION_SEND/);
assert.match(logger, /static String exportText\(Context context\)/);
assert.match(logger, /startup\.log/);
assert.match(logger, /bun-version\.log/);
assert.match(logger, /new File\(imageGen, "server\.log"\)/,
  "manual diagnostics must include a filtered tail of the runtime log");
assert.match(logger, /appendFilteredLogTail/);
assert.match(logger, /request\\[_ -\\]\\?body/);
assert.match(logger, /data:image/);
assert.match(logger, /new File\(imageGen, "install\.log"\)/);
assert.match(service, /new File\(getFilesDir\(\), "imagegen\/install\.log"\)/);
assert.match(service, /진단 로그 공유에서 설치 로그를 확인하세요/);
assert.doesNotMatch(ingestApi, /authorized\(/);
assert.match(ingestApi, /parseBody\(req\)/);
assert.match(common, /MAX_IP_BATCHES_PER_MINUTE/);
assert.match(main, /onRenderProcessGone/);
assert.match(main, /folder_picker_opened/);
assert.match(main, /folder_permission_failed/);
assert.match(main, /game_session_open_requested/);
assert.match(service, /runtime_start_failed/);
assert.match(chooser, /javascript_console_error/);
assert.match(chooser, /sourcePath/);
assert.match(chooser, /consoleErrorSamples\.getAndIncrement\(\) < 16/);
assert.doesNotMatch(chooser, /details\.put\(["']message["']/);

assert.match(proxy, /api_response/);
assert.match(readApi, /adminAuthorized/);
assert.match(readApi, /access: "private"/);
assert.match(cleanupApi, /CRON_SECRET/);
assert.doesNotMatch(proxy, /diagnostic\.put\(["']headers["']/);
assert.doesNotMatch(proxy, /diagnostic\.put\(["']body["']/);
console.log("Diagnostics launcher contract tests passed.");
