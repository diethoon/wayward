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
                    "      (body.imageProvider === 'nai' ? (body.novelai === 'configured' ? 'token saved · authentication not verified' : '<b>token missing</b>') : (body.comfyui === 'connected' ? 'ready' : '<b>ComfyUI not reachable</b>'));",
                    "show-novelai-token-state-not-server-state",
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
