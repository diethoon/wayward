#!/usr/bin/env python3
"""Extract the pinned Image Studio backend from the user's forensic mods.zip into APK assets."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import zipfile

SOURCE_COMMIT = "26d6c32e0b0abbb886e3029efd548b7ca6774401"
ARCHIVE_SHA256 = "dfd25e050dd0b98ec1c99c09634bd92b509efac428788273f84884e713e2c553"
PREFIX = "imagestudio/backend/"
EXPECTED_VERSION = "0.8.4"
MAX_FILES = 128
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_SINGLE_FILE = 2 * 1024 * 1024


def fail(message: str) -> None:
    raise SystemExit("embed-imagegen-backend: " + message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(name: str) -> str:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        fail("unsafe ZIP path: " + name)
    if any(":" in part or "\\x00" in part for part in path.parts):
        fail("unsafe ZIP path component: " + name)
    return path.as_posix()


def extract(archive: Path, output: Path) -> None:
    if not archive.is_file():
        fail("mods.zip not found: " + str(archive))
    actual_archive_hash = sha256_file(archive)
    if actual_archive_hash != ARCHIVE_SHA256:
        fail("mods.zip SHA-256 mismatch: " + actual_archive_hash)

    if output.exists():
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="imagegen-assets-", dir=str(output.parent)))
    files: dict[str, str] = {}
    total = 0
    try:
        with zipfile.ZipFile(archive, "r") as bundle:
            seen: set[str] = set()
            for entry in bundle.infolist():
                raw_name = entry.filename.replace("\\", "/")
                if not raw_name.startswith(PREFIX):
                    continue
                relative = raw_name[len(PREFIX):]
                if not relative or entry.is_dir():
                    continue
                relative = safe_relative(relative)
                if relative in seen:
                    fail("duplicate backend ZIP entry: " + relative)
                seen.add(relative)
                mode = (entry.external_attr >> 16) & 0xFFFF
                if stat.S_ISLNK(mode):
                    fail("symbolic links are not allowed: " + relative)
                if entry.flag_bits & 0x1:
                    fail("encrypted backend entry is not supported: " + relative)
                if entry.file_size > MAX_SINGLE_FILE:
                    fail("backend file exceeds size limit: " + relative)
                total += entry.file_size
                if total > MAX_TOTAL_BYTES:
                    fail("backend exceeds total size limit")
                target = staging.joinpath(*PurePosixPath(relative).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                written = 0
                with bundle.open(entry, "r") as source, target.open("wb") as destination:
                    while True:
                        chunk = source.read(4096)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > entry.file_size or written > MAX_SINGLE_FILE:
                            fail("backend entry expanded beyond declared size: " + relative)
                        digest.update(chunk)
                        destination.write(chunk)
                if written != entry.file_size:
                    fail("backend entry size mismatch: " + relative)
                files[relative] = digest.hexdigest()
                if len(files) > MAX_FILES:
                    fail("backend file count exceeds limit")

        required = {
            "wayward-imagegen/package.json",
            "wayward-imagegen/src/cli.ts",
            "wayward-imagegen/src/server.ts",
            "wayward-imagegen/src/config.ts",
            "wayward-imagegen/src/nai/client.ts",
            "wayward-imagegen/src/routes/image.ts",
        }
        missing = sorted(required - set(files))
        if missing:
            fail("required server files are missing: " + ", ".join(missing))
        package = json.loads((staging / "wayward-imagegen/package.json").read_text(encoding="utf-8"))
        if package.get("version") != EXPECTED_VERSION:
            fail("unexpected wayward-imagegen version: " + str(package.get("version")))
        dependencies = package.get("dependencies") or {}
        if dependencies != {"sharp": "0.35.5"}:
            fail("unexpected backend dependency set: " + json.dumps(dependencies, sort_keys=True))

        launcher_patches: list[str] = []

        def patch_backend_text(relative: str, replacements: list[tuple[str, str, str]]) -> None:
            nonlocal total
            target = staging / relative
            original = target.read_text(encoding="utf-8")
            updated = original
            for before, after, label in replacements:
                count = updated.count(before)
                if count != 1:
                    fail(f"launcher patch '{label}' expected one match in {relative}, found {count}")
                updated = updated.replace(before, after, 1)
            if updated == original:
                return
            encoded = updated.encode("utf-8")
            previous_size = target.stat().st_size
            target.write_bytes(encoded)
            total += len(encoded) - previous_size
            if total > MAX_TOTAL_BYTES:
                fail("patched backend exceeds total size limit")
            files[relative] = hashlib.sha256(encoded).hexdigest()
            launcher_patches.extend(label for _, _, label in replacements)

        patch_backend_text(
            "wayward-imagegen/src/routes/generationSettings.ts",
            [
                (
                    "  config.characterDirs = settings.characters.map(character => character.id).filter(Boolean)",
                    """  const discoveredCharacterDirs = settings.characters
    .map(character => String(character.id || '').trim().toLowerCase())
    .filter(id => /^[a-z0-9][a-z0-9_-]{0,99}$/.test(id))
  config.characterDirs = [...new Set([...(config.characterDirs || []), ...discoveredCharacterDirs])]""",
                    "persist-discovered-character-filter",
                ),
                (
                    "  fs.writeFileSync(settingsFile(config), JSON.stringify(settings, null, 2) + '\\n')",
                    """  // NovelAI credentials are supplied by the launcher from Android Keystore.
  // Keep the active token in memory, but never persist it in this JSON file.
  const persistedSettings = { ...settings, naiToken: '' }
  fs.writeFileSync(settingsFile(config), JSON.stringify(persistedSettings, null, 2) + '\\n')""",
                    "redact-persisted-novelai-token",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/ui/index.html",
            [
                (
                    "      (body.comfyui === 'connected' ? 'ready' : '<b>not running</b>');",
                    "      (body.imageProvider === 'launcher' ? (body.comfyui === 'connected' ? 'ready' : '<b>launcher provider unavailable</b>') : body.imageProvider === 'nai' ? (body.novelai === 'configured' ? 'token saved · authentication not verified' : '<b>token missing</b>') : (body.comfyui === 'connected' ? 'ready' : '<b>ComfyUI not reachable</b>'));",
                    "show-novelai-token-state-not-server-state",
                ),
            ],
        )


        patch_backend_text(
            "wayward-imagegen/src/config.ts",
            [
                (
                    "  imageProvider: 'sdxl' | 'anima' | 'nai'\n  naiToken: string",
                    """  imageProvider: 'sdxl' | 'anima' | 'nai' | 'launcher'
  launcherProviderUrl: string
  launcherProfileId: string
  launcherProviderId: string
  launcherProviderSignature: string
  launcherProviderToken: string
  naiToken: string""",
                    "add-launcher-provider-config",
                ),
                (
                    "    imageProvider: file.imageProvider === 'nai' ? 'nai' : file.imageProvider === 'anima' ? 'anima' : 'sdxl',\n    naiToken:",
                    """    imageProvider: file.imageProvider === 'launcher' ? 'launcher' : file.imageProvider === 'nai' ? 'nai' : file.imageProvider === 'anima' ? 'anima' : 'sdxl',
    launcherProviderUrl: pick('launcher-provider-url', 'LAUNCHER_PROVIDER_URL', 'launcherProviderUrl', ''),
    launcherProfileId: pick('launcher-profile-id', 'LAUNCHER_PROFILE_ID', 'launcherProfileId', ''),
    launcherProviderId: pick('launcher-provider-id', 'LAUNCHER_PROVIDER_ID', 'launcherProviderId', ''),
    launcherProviderSignature: pick('launcher-provider-signature', 'LAUNCHER_PROVIDER_SIGNATURE', 'launcherProviderSignature', ''),
    launcherProviderToken: pick('launcher-provider-token', 'LAUNCHER_PROVIDER_TOKEN', 'launcherProviderToken', ''),
    naiToken:""",
                    "load-launcher-provider-config",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/routes/generationSettings.ts",
            [
                (
                    "  imageProvider: 'sdxl' | 'anima' | 'nai'\n  naiToken: string",
                    """  imageProvider: 'sdxl' | 'anima' | 'nai' | 'launcher'
  naiToken: string""",
                    "generation-settings-launcher-provider-type",
                ),
                (
                    "    imageProvider: raw.imageProvider === 'nai' ? 'nai' : raw.imageProvider === 'anima' ? 'anima' : 'sdxl',",
                    """    imageProvider: base.imageProvider === 'launcher' ? 'launcher' : raw.imageProvider === 'nai' ? 'nai' : raw.imageProvider === 'anima' ? 'anima' : 'sdxl',""",
                    "preserve-launcher-provider-selection",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/batch/queue.ts",
            [
                (
                    "    return this.config.imageProvider === 'nai' ? 'nai' : this.config.imageProvider === 'anima' ? 'anima' : 'illustrious'",
                    """    return this.config.imageProvider === 'nai' || this.config.imageProvider === 'launcher' ? 'nai' : this.config.imageProvider === 'anima' ? 'anima' : 'illustrious'""",
                    "route-launcher-provider-through-serialized-nai-job-queue",
                ),
                (
                    "    if (workflow === 'nai') return NovelAI_프롬프트만들기(this.config, item.prompt, item.negativePrompt)",
                    """    if (workflow === 'nai') return this.config.imageProvider === 'launcher'
      ? { prompt: item.prompt, negativePrompt: item.negativePrompt?.trim() ?? '' }
      : NovelAI_프롬프트만들기(this.config, item.prompt, item.negativePrompt)""",
                    "preserve-game-prompts-for-launcher-provider",
                ),
                (
                    """  private generationParams(item: BatchItem, workflow: WorkflowType): BatchItem {
    return workflow === 'anima'
      ? { ...item, steps: this.config.animaSteps, cfg: this.config.animaCfg, width: this.config.animaWidth, height: this.config.animaHeight }
      : workflow === 'illustrious' && (this.config.sdxlWidth !== 1024 || this.config.sdxlHeight !== 1024 || item.width !== undefined || item.height !== undefined)
        ? { ...item, width: this.config.sdxlWidth, height: this.config.sdxlHeight }
        : item
  }""",
                    """  private generationParams(item: BatchItem, workflow: WorkflowType): BatchItem {
    if (this.config.imageProvider === 'launcher') {
      return { ...item, width: item.width ?? this.config.sdxlWidth, height: item.height ?? this.config.sdxlHeight }
    }
    return workflow === 'anima'
      ? { ...item, steps: this.config.animaSteps, cfg: this.config.animaCfg, width: this.config.animaWidth, height: this.config.animaHeight }
      : workflow === 'illustrious' && (this.config.sdxlWidth !== 1024 || this.config.sdxlHeight !== 1024 || item.width !== undefined || item.height !== undefined)
        ? { ...item, width: this.config.sdxlWidth, height: this.config.sdxlHeight }
        : item
  }""",
                    "use-game-dimensions-for-launcher-provider",
                ),
                (
                    "    const baseHash = workflow === 'nai' ? NovelAI_생성해시만들기(this.config, prompts.prompt, prompts.negativePrompt)\n      : derivePromptHash(prompts.prompt, prompts.negativePrompt, { ...generationParams, loras })",
                    """    const baseHash = workflow === 'nai' && this.config.imageProvider === 'launcher'
      ? derivePromptHash(prompts.prompt, prompts.negativePrompt, { ...generationParams, launcherProviderSignature: this.config.launcherProviderSignature })
      : workflow === 'nai' ? NovelAI_생성해시만들기(this.config, prompts.prompt, prompts.negativePrompt)
        : derivePromptHash(prompts.prompt, prompts.negativePrompt, { ...generationParams, loras })""",
                    "include-launcher-provider-in-cache-key",
                ),
                (
                    "...(workflow === 'nai' ? { steps: this.config.naiSteps, cfg: this.config.naiScale, checkpoint: this.config.naiModel,\n          width: this.config.naiWidth, height: this.config.naiHeight, sampler: this.config.naiSampler, noiseSchedule: this.config.naiNoiseSchedule } : {}),",
                    "...(workflow === 'nai' && this.config.imageProvider === 'nai' ? { steps: this.config.naiSteps, cfg: this.config.naiScale, checkpoint: this.config.naiModel,\n          width: this.config.naiWidth, height: this.config.naiHeight, sampler: this.config.naiSampler, noiseSchedule: this.config.naiNoiseSchedule } : {}),",
                    "do-not-override-launcher-provider-generation-options",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/batch/queue.ts",
            [
                (
                    "        const limit = this.config.imageProvider === 'nai' ? 1 : Math.min(normalizePromptBatchSize(this.config.promptBatchSize), this.effectiveBatchLimit)",
                    "        const limit = this.config.imageProvider === 'nai' || this.config.imageProvider === 'launcher' ? 1 : Math.min(normalizePromptBatchSize(this.config.promptBatchSize), this.effectiveBatchLimit)",
                    "serialize-launcher-provider-image-requests",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/comfy/jobRunner.ts",
            [
                (
                    "const JOB_TTL_MS = 60_000\n",
                    """const JOB_TTL_MS = 60_000

async function launcherGenerate(
  config: Config,
  args: SubmitArgs,
  requestId: string,
): Promise<{ bytes: Buffer; filename: string }> {
  const endpoint = new URL(config.launcherProviderUrl)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
    || endpoint.port !== '8190' || endpoint.pathname !== '/generate'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('런처 이미지 서비스 주소가 안전한 로컬 어댑터 주소가 아닙니다.')
  }
  if (!/^[a-f0-9]{32}$/.test(config.launcherProfileId) || !/^[a-f0-9]{32}$/.test(config.launcherProviderId)
    || typeof config.launcherProviderToken !== 'string' || config.launcherProviderToken.length < 40) {
    throw new Error('런처 이미지 서비스 프로필 또는 공급자 ID가 올바르지 않습니다.')
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'image/*', authorization: 'Bearer ' + config.launcherProviderToken },
    body: JSON.stringify({
      profileId: config.launcherProfileId,
      requestId,
      prompt: args.prompt,
      negativePrompt: args.negativePrompt || '',
      width: args.overrides?.width ?? config.sdxlWidth,
      height: args.overrides?.height ?? config.sdxlHeight,
    }),
    signal: AbortSignal.timeout(185_000),
  })
  if (!response.ok) {
    let detail = '런처 이미지 서비스 요청 실패(HTTP ' + response.status + ').'
    try {
      const body = await response.json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) detail = body.error.trim().slice(0, 240)
    } catch { /* keep the status-based diagnostic */ }
    throw new Error(detail)
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    throw new Error('런처 이미지 서비스가 지원하지 않는 이미지 MIME 형식을 반환했습니다.')
  }
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > 25 * 1024 * 1024) throw new Error('생성 이미지가 25MB 제한을 초과했습니다.')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) {
    throw new Error('생성 이미지가 비어 있거나 25MB 제한을 초과했습니다.')
  }
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
  return { bytes, filename: 'launcher.' + extension }
}
""",
                    "add-guarded-loopback-provider-job-adapter",
                ),
                (
                    "        if (!this.config.naiToken.trim()) throw new Error('NovelAI API 토큰을 이미지 생성 방식 설정에서 저장하세요.')",
                    "        if (this.config.imageProvider === 'nai' && !this.config.naiToken.trim()) throw new Error('NovelAI API 토큰을 이미지 생성 방식 설정에서 저장하세요.')",
                    "require-novelai-token-only-for-novelai-provider",
                ),
                (
                    """            const result = await NovelAI_이미지생성하기(config, job.prompt, job.negativePrompt || '', args.seed)
            job.genParams = { ...job.genParams, seed: result.seed }
            await this.finalize(job, [{ filename: 'novelai.png', subfolder: '', type: 'output' }], [], undefined, result.bytes)""",
                    """            if (config.imageProvider === 'launcher') {
              const rendered = await launcherGenerate(config, args, job.promptId)
              await this.finalize(job, [{ filename: rendered.filename, subfolder: '', type: 'output' }], [], undefined, rendered.bytes)
            } else {
              const result = await NovelAI_이미지생성하기(config, job.prompt, job.negativePrompt || '', args.seed)
              job.genParams = { ...job.genParams, seed: result.seed }
              await this.finalize(job, [{ filename: 'novelai.png', subfolder: '', type: 'output' }], [], undefined, result.bytes)
            }""",
                    "save-launcher-provider-image-through-normal-finalize-cache-path",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/routes/catalogue.ts",
            [
                (
                    """    const nai = config.imageProvider === 'nai'
    const comfyUp = nai ? false : await comfy.isReachable()
    const ready = nai ? Boolean(config.naiToken.trim()) : comfyUp""",
                    """    const nai = config.imageProvider === 'nai'
    const launcher = config.imageProvider === 'launcher'
    let launcherUp = false
    if (launcher && config.launcherProviderUrl) {
      try {
        const healthUrl = new URL('/health', config.launcherProviderUrl)
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) })
        if (response.ok) {
          const health = await response.json() as { ready?: boolean }
          launcherUp = health.ready === true
        }
      } catch { /* unavailable native adapter */ }
    }
    const comfyUp = nai || launcher ? false : await comfy.isReachable()
    const ready = nai ? Boolean(config.naiToken.trim()) : launcher ? launcherUp : comfyUp""",
                    "probe-native-provider-adapter-for-imagegen-health",
                ),
                (
                    "      comfyuiRequired: !nai,",
                    "      comfyuiRequired: !nai && !launcher,",
                    "mark-comfyui-optional-for-native-provider",
                ),
                (
                    "      capabilities: ['h-status-character-keys', 'shared-core-v1', 'img2img-reference-v1', 'novelai-v1'],",
                    "      capabilities: ['h-status-character-keys', 'shared-core-v1', 'img2img-reference-v1', 'novelai-v1', ...(launcher ? ['launcher-provider-v1'] : [])],",
                    "advertise-native-provider-capability",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/routes/image.ts",
            [
                (
                    """function activeImageWorkflow(requested: WorkflowType, config: Config): WorkflowType {
  // Image Studio and the stock game identify ordinary stills as illustrious.
  // The saved provider setting is authoritative for those normal requests.
  if (requested !== 'anima' && requested !== 'illustrious') return requested
  return config.imageProvider === 'nai' ? 'nai' : config.imageProvider === 'anima' ? 'anima' : 'illustrious'
}""",
                    """function activeImageWorkflow(_requested: WorkflowType, config: Config): WorkflowType {
  // The running server mode is selected by the launcher. Ignore the game's workflow selector.
  return config.imageProvider === 'nai' || config.imageProvider === 'launcher'
    ? 'nai'
    : config.imageProvider === 'anima' ? 'anima' : 'illustrious'
}""",
                    "force-direct-image-route-through-launcher-selected-engine",
                ),
                (
                    """    if(reference){
      if(!deps.comfy)throw new HttpError(501,'img2img를 지원하는 공통 서버가 필요합니다.')
      const uploaded=await deps.comfy.upload(fs.readFileSync(reference.path),'wwis-reference-'+derivePromptHash(reference.identity,'')+path.extname(reference.path))
      if(!uploaded)throw new HttpError(502,'ComfyUI에 기준 이미지를 전송하지 못했습니다.')
      img2imgSource=uploaded
    }""",
                    """    if (reference && workflow === 'nai') {
      throw new HttpError(400, '런처에서 선택한 NAI 엔진은 기준 이미지 입력을 지원하지 않습니다.')
    }
    if(reference){
      if(!deps.comfy)throw new HttpError(501,'img2img를 지원하는 공통 서버가 필요합니다.')
      const uploaded=await deps.comfy.upload(fs.readFileSync(reference.path),'wwis-reference-'+derivePromptHash(reference.identity,'')+path.extname(reference.path))
      if(!uploaded)throw new HttpError(502,'ComfyUI에 기준 이미지를 전송하지 못했습니다.')
      img2imgSource=uploaded
    }""",
                    "never-upload-reference-images-to-comfy-when-launcher-selected-nai",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/batch/queue.ts",
            [
                (
                    """  private workflowFor(item: BatchItem): WorkflowType {
    const requested = item.workflow ?? 'illustrious'
    if (requested !== 'anima' && requested !== 'illustrious') return requested
    return this.config.imageProvider === 'nai' || this.config.imageProvider === 'launcher' ? 'nai' : this.config.imageProvider === 'anima' ? 'anima' : 'illustrious'
  }""",
                    """  private workflowFor(_item: BatchItem): WorkflowType {
    // Ignore workflow requests from the game. Only the launcher's active server mode selects the engine.
    return this.config.imageProvider === 'nai' || this.config.imageProvider === 'launcher'
      ? 'nai'
      : this.config.imageProvider === 'anima' ? 'anima' : 'illustrious'
  }""",
                    "force-batch-queue-through-launcher-selected-engine",
                ),
            ],
        )

        patch_backend_text(
            "wayward-imagegen/src/routes/generationSettings.ts",
            [
                (
                    "    imageProvider: base.imageProvider === 'launcher' ? 'launcher' : raw.imageProvider === 'nai' ? 'nai' : raw.imageProvider === 'anima' ? 'anima' : 'sdxl',",
                    "    imageProvider: base.imageProvider,",
                    "lock-image-provider-to-launcher-server-mode",
                ),
                (
                    "    naiToken: raw.naiToken === undefined || raw.naiToken === '' ? base.naiToken : String(raw.naiToken).trim(),",
                    "    naiToken: base.naiToken,",
                    "lock-novelai-credential-to-launcher-keystore",
                ),
                (
                    "    comfyUrl: String(raw.comfyUrl || base.comfyUrl).trim().replace(/\\/+$/, ''),",
                    "    comfyUrl: base.comfyUrl,",
                    "lock-comfy-endpoint-to-launcher-server-mode",
                ),
                (
                    "function applyRuntime(config: Config, comfy: ComfyClient, settings: GenerationSettings): void {",
                    "function applyRuntime(config: Config, _comfy: ComfyClient, settings: GenerationSettings): void {",
                    "remove-game-comfy-client-mutation-parameter",
                ),
                (
                    "  config.imageProvider = settings.imageProvider\\n",
                    "  // The launcher-selected image engine is immutable while this server is running.\\n",
                    "keep-launcher-image-engine-immutable",
                ),
                (
                    "  config.comfyUrl = settings.comfyUrl\\n  config.promptBatchSize = settings.promptBatchSize\\n  comfy.setBaseUrl(settings.comfyUrl)\\n",
                    "  // ComfyUI endpoint remains the launcher-selected runtime destination.\\n  config.promptBatchSize = settings.promptBatchSize\\n",
                    "keep-launcher-comfy-endpoint-immutable",
                ),
                (
                    "    if (raw.naiTokenClear === true) settings.naiToken = ''\\n",
                    "",
                    "ignore-in-game-novelai-token-clear",
                ),
                (
                    """  router.post('/api/nai/check', async ctx => {
    try { sendJson(ctx.res, 200, await NovelAI_연결확인하기(config)) }
    catch (error) { throw new HttpError(502, (error as Error).message) }
  })""",
                    """  router.post('/api/nai/check', async ctx => {
    if (config.imageProvider !== 'nai') throw new HttpError(409, 'NAI 서버는 런처에서 선택해야 합니다.')
    try { sendJson(ctx.res, 200, await NovelAI_연결확인하기(config)) }
    catch (error) { throw new HttpError(502, (error as Error).message) }
  })""",
                    "only-check-nai-when-launcher-selected-nai-engine",
                ),
                (
                    """  router.get('/api/generation/prompt-batch-support', async ctx => {
    const url = ctx.query.get('comfyUrl')?.trim() || config.comfyUrl
    const info = await new ComfyClient(url).objectInfo()
    sendJson(ctx.res, 200, { reachable: info !== null, supported: Boolean(info?.[PROMPT_BATCH_NODE]), maxPrompts: MAX_PROMPT_BATCH_SIZE })
  })""",
                    """  router.get('/api/generation/prompt-batch-support', async ctx => {
    if (config.imageProvider === 'nai' || config.imageProvider === 'launcher') {
      sendJson(ctx.res, 200, { reachable: false, supported: false, maxPrompts: MAX_PROMPT_BATCH_SIZE })
      return
    }
    const info = await comfy.objectInfo()
    sendJson(ctx.res, 200, { reachable: info !== null, supported: Boolean(info?.[PROMPT_BATCH_NODE]), maxPrompts: MAX_PROMPT_BATCH_SIZE })
  })""",
                    "prevent-game-selected-comfy-probes-when-nai-engine-active",
                ),
                (
                    "    const comfyUrl = (ctx.query.get('comfyUrl')?.trim() || settings.comfyUrl).replace(/\\/+$/, '')",
                    "    const comfyUrl = config.comfyUrl.replace(/\\/+$/, '')",
                    "ignore-game-provided-comfy-url-query",
                ),
                (
                    "    const useRemote = !Object.values(local).some(list => list.length)",
                    "    const useRemote = config.imageProvider !== 'nai' && config.imageProvider !== 'launcher' && !Object.values(local).some(list => list.length)",
                    "do-not-query-comfy-models-during-nai-or-launcher-mode",
                ),
            ],
        )

        manifest = {
            "schemaVersion": 1,
            "sourceCommit": SOURCE_COMMIT,
            "sourceArchiveSha256": ARCHIVE_SHA256,
            "archivePrefix": PREFIX,
            "backendVersion": EXPECTED_VERSION,
            "launcherPatches": launcher_patches,
            "fileCount": len(files),
            "totalBytes": total,
            "files": dict(sorted(files.items())),
        }
        (staging / "launcher-bundle.json").write_text(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        if output.exists():
            shutil.rmtree(output)
        os.replace(staging, output)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    print(
        "Embedded Wayward ImageGen "
        + EXPECTED_VERSION
        + ": files="
        + str(len(files))
        + " bytes="
        + str(total)
        + " source="
        + SOURCE_COMMIT
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage: embed_imagegen_backend.py /path/to/mods.zip")
    extract(Path(sys.argv[1]).resolve(), Path(__file__).resolve().parents[1] / "app/src/main/assets/imagegen-backend")
