#!/usr/bin/env python3
"""Install only Wayward Faith basic-character and supporting-cast image packs.

Put this script and the image-pack ZIP files together in:
  /storage/emulated/0/Download/Wayward_Faith/packs_to_install/

Run in Termux:
  python install_image_packs.py

The game root defaults to /storage/emulated/0/Download/Wayward_Faith.
No ZIP is deleted. Existing installed packs are not overwritten.
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

GAME_ROOT = Path("/storage/emulated/0/Download/Wayward_Faith")
PACK_MARKER = "/* WAYWARD_FAITH_IMAGE_PACK */"
IMAGE_PACKS_DIR = "image-packs"
SKIP_FILES = {".image-cache.json"}
PACK_ID_RE = re.compile(r'\)\["((?:[^"\\]|\\.)*)"\]\s*=')
NAME_RE = re.compile(r'["\']name["\']\s*:\s*["\']([^"\']+)["\']')
FOLDER_RE = re.compile(r'(["\']folderName["\']\s*:\s*)["\'][^"\']*["\']')


def safe_member_path(raw: str) -> PurePosixPath | None:
    """Normalize both ZIP slash styles and reject absolute/traversal paths."""
    normalized = raw.replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or any(p in ("", ".", "..") for p in path.parts):
        return None
    if path.parts and re.match(r"^[A-Za-z]:", path.parts[0]):
        return None
    return path


def read_pack_metadata(text: str, zip_path: str):
    if PACK_MARKER not in text.lstrip()[:256]:
        return None

    id_match = PACK_ID_RE.search(text[:12000])
    if not id_match:
        return None
    pack_id = id_match.group(1)
    name_match = NAME_RE.search(text)
    name = name_match.group(1) if name_match else "ImagePack"

    # Only base basic-character packs and supporting-cast ("extra") packs.
    meta_match = re.search(r'["\']wfImagePack["\']\s*:\s*\{', text)
    if not meta_match:
        return None
    meta = text[meta_match.end():meta_match.end() + 6000]
    basic = re.search(r'["\']basic["\']\s*:\s*true\b', meta) is not None
    extra = re.search(r'["\']extra["\']\s*:\s*true\b', meta) is not None
    extension = re.search(r'["\']part["\']\s*:\s*["\']extension["\']', meta) is not None
    mod = re.search(r'["\']mod["\']\s*:\s*true\b', meta) is not None
    outfit = re.search(r'["\']outfit["\']\s*:\s*true\b', meta) is not None
    char_match = re.search(r'["\']character["\']\s*:\s*["\']([^"\']+)["\']', meta)
    character = char_match.group(1) if char_match else ""

    if extension or mod or outfit or (basic == extra) or (basic and not character):
        return None
    kind = "basic" if basic else "extra"
    who = character if basic else "extra"

    # New-layout ZIPs usually store <maker>-<character>/base/pack.js.
    parts = PurePosixPath(zip_path).parts
    if len(parts) >= 3 and parts[-2].lower() in ("base", "extension"):
        parent_name = parts[-3]
        folder = f"{parent_name}/{parts[-2]}"
    else:
        clean_name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-._") or "ImagePack"
        folder = f"{clean_name}-{who}/base"

    return {"id": pack_id, "name": name, "kind": kind, "folder": folder, "zip_pack_js": zip_path}


def find_pack_in_zip(zf: zipfile.ZipFile):
    for info in zf.infolist():
        if info.is_dir() or PurePosixPath(info.filename.replace("\\", "/")).name.lower() != "pack.js":
            continue
        safe = safe_member_path(info.filename)
        if safe is None:
            continue
        try:
            raw = zf.read(info)
            text = raw.decode("utf-8-sig")
        except (UnicodeDecodeError, OSError, RuntimeError, zipfile.BadZipFile):
            continue
        found = read_pack_metadata(text, str(safe))
        if found:
            root = PurePosixPath(str(safe)).parent
            found["root"] = root
            found["pack_text"] = text
            return found
    return None


def installed_pack_ids(image_root: Path):
    found = {}
    if not image_root.exists():
        return found
    for file in image_root.rglob("pack.js"):
        try:
            text = file.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError):
            continue
        if PACK_MARKER not in text.lstrip()[:256]:
            continue
        match = PACK_ID_RE.search(text[:12000])
        if match:
            found[match.group(1)] = file.parent
    return found


def unique_destination(image_root: Path, relative_folder: str) -> Path:
    parts = PurePosixPath(relative_folder).parts
    candidate = image_root.joinpath(*parts)
    n = 2
    while candidate.exists():
        candidate = image_root.joinpath(*parts[:-1], parts[-1] + f"-{n}")
        n += 1
    return candidate


def install_one(zf: zipfile.ZipFile, info: dict, image_root: Path, used_ids: dict):
    pack_id = info["id"]
    if pack_id in used_ids:
        print(f"  SKIP (이미 설치된 packId): {info['name']}")
        return False

    relative_folder = info["folder"]
    destination = unique_destination(image_root, relative_folder)
    root = info["root"]
    members = []
    for entry in zf.infolist():
        safe = safe_member_path(entry.filename)
        if safe is None or entry.is_dir():
            continue
        try:
            rel = safe.relative_to(root)
        except ValueError:
            continue
        if not rel.parts or any(part in ("..", "") for part in rel.parts):
            continue
        if rel.name in SKIP_FILES:
            continue
        # Do not extract symbolic links from an untrusted archive.
        mode = (entry.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            continue
        members.append((entry, rel))

    if not any(rel.name.lower() == "pack.js" for _, rel in members):
        print(f"  FAIL (pack.js를 추출할 수 없음): {info['name']}")
        return False

    destination.mkdir(parents=True, exist_ok=False)
    try:
        for entry, rel in members:
            out = destination.joinpath(*rel.parts)
            out.parent.mkdir(parents=True, exist_ok=True)
            data = zf.read(entry)
            if rel.name.lower() == "pack.js":
                text = data.decode("utf-8-sig")
                installed_folder = (Path(IMAGE_PACKS_DIR) / destination.relative_to(image_root)).as_posix()
                replacement = lambda m: m.group(1) + json.dumps(installed_folder, ensure_ascii=False)
                if FOLDER_RE.search(text):
                    text = FOLDER_RE.sub(replacement, text, count=1)
                data = text.encode("utf-8")
            out.write_bytes(data)
    except Exception:
        # Only remove the newly created, incomplete destination.
        import shutil
        shutil.rmtree(destination, ignore_errors=True)
        raise

    used_ids[pack_id] = destination
    print(f"  OK   {info['name']} -> {destination}")
    return True


def main():
    script_dir = Path(__file__).resolve().parent
    if not (GAME_ROOT / "Wayward_Faith_v3.0.0.html").is_file():
        print("게임 HTML을 찾지 못했습니다:")
        print(f"  {GAME_ROOT / 'Wayward_Faith_v3.0.0.html'}")
        print("스크립트의 GAME_ROOT 경로를 실제 위치에 맞게 수정하거나 게임 폴더에 두세요.")
        return 2

    archives = sorted(p for p in script_dir.glob("*.zip") if p.is_file())
    if not archives:
        print(f"ZIP 파일이 없습니다: {script_dir}")
        print("기본팩/조연팩 ZIP과 이 스크립트를 같은 폴더에 넣으세요.")
        return 1

    image_root = GAME_ROOT / IMAGE_PACKS_DIR
    existing = installed_pack_ids(image_root)
    plans = []
    print("ZIP 검사 중... (파일은 아직 변경하지 않습니다)")
    for archive in archives:
        try:
            with zipfile.ZipFile(archive) as zf:
                info = find_pack_in_zip(zf)
                if info:
                    plans.append((archive, info))
                    print(f"  대상: {archive.name} :: {info['name']} [{info['kind']}]")
                else:
                    print(f"  제외: {archive.name} (기본팩/조연팩 이미지팩이 아님)")
        except (OSError, zipfile.BadZipFile) as exc:
            print(f"  오류: {archive.name} ({exc})")

    if not plans:
        print("설치할 기본 이미지팩 또는 조연 이미지팩을 찾지 못했습니다.")
        return 1

    pending = [(a, i) for a, i in plans if i["id"] not in existing]
    already = len(plans) - len(pending)
    print(f"\n검사 결과: 설치 후보 {len(pending)}개, 이미 설치된 packId {already}개")
    if not pending:
        print("새로 설치할 팩이 없습니다. 기존 파일은 변경하지 않았습니다.")
        return 0
    print("\n설치 대상 경로:")
    for archive, info in pending:
        dest = unique_destination(image_root, info["folder"])
        print(f"  {archive.name} -> {dest}")
    answer = input("\n위 팩만 설치할까요? [y/N]: ").strip().lower()
    if answer not in ("y", "yes"):
        print("취소했습니다. 파일은 변경하지 않았습니다.")
        return 0

    image_root.mkdir(parents=True, exist_ok=True)
    success = 0
    for archive, info in pending:
        try:
            with zipfile.ZipFile(archive) as zf:
                # Re-find the pack to avoid relying on stale ZIP metadata.
                current = find_pack_in_zip(zf)
                if not current or current["id"] != info["id"]:
                    print(f"  FAIL (검사 결과가 달라짐): {archive.name}")
                    continue
                if install_one(zf, current, image_root, existing):
                    success += 1
        except Exception as exc:
            print(f"  FAIL {archive.name}: {type(exc).__name__}: {exc}")

    print(f"\n완료: {success}/{len(pending)}개 설치")
    print("게임 내 이미지팩 설정에서 image-packs 폴더를 등록/새로고침하세요.")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
