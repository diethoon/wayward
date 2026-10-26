#!/usr/bin/env python3
"""CMD-style installer for the Faith packjs-only bundle.

Place this script and image-packs-packjs-only.zip in Wayward_Faith/packs_to_install.
The game root defaults to the parent of that directory. Existing pack files are
overwritten, matching normal ZIP/CMD extraction; source ZIPs are retained.
"""
from __future__ import annotations
import argparse, re, sys, zipfile
from pathlib import Path, PurePosixPath

ZIP_NAME = "image-packs-packjs-only.zip"
MARKER = "/* WAYWARD_FAITH_IMAGE_PACK */"
ID_RE = re.compile(r'\)\["([^"]+)"\]\s*=')
META_RE = re.compile(r'"wfImagePack"\s*:\s*\{')
FOLDER_RE = re.compile(r'("folderName"\s*:\s*)"[^"]*"')

def safe_path(raw):
    p = PurePosixPath(raw.replace("\\", "/"))
    if p.is_absolute() or not p.parts or any(x in ("", ".", "..") for x in p.parts):
        return None
    if re.match(r"^[A-Za-z]:", p.parts[0]):
        return None
    return p

def detect(text, member):
    if MARKER not in text.lstrip()[:256]:
        return None
    ident = ID_RE.search(text[:12000])
    start = META_RE.search(text)
    if not ident or not start:
        return None
    meta = text[start.end():start.end()+6000]
    char = re.search(r'"character"\s*:\s*"([^"]+)"', meta)
    basic = bool(re.search(r'"basic"\s*:\s*true\b', meta))
    extra = bool(re.search(r'"extra"\s*:\s*true\b', meta))
    unsupported = any(re.search(p, meta) for p in (
        r'"part"\s*:\s*"extension"', r'"mod"\s*:\s*true\b',
        r'"outfit"\s*:\s*true\b'))
    if unsupported or basic == extra or (basic and not char):
        return None
    source = PurePosixPath(member.replace("\\", "/")).parts[0]
    if basic:
        who = char.group(1)
        suffix = "-" + who + "-basic"
        maker = source[:-len(suffix)] if source.endswith(suffix) else ""
        if not maker:
            return None
        folder = f"{maker}-{who}/base"
        label = f"{source} (character: {who})"
    else:
        maker = source[:-6] if source.endswith("-extra") else source
        folder = f"{maker}-extra/base"
        label = f"{source} (supporting cast)"
    return ident.group(1), label, folder

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-root", type=Path)
    ap.add_argument("--zip", type=Path)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    here = Path(__file__).resolve().parent
    root = a.game_root.resolve() if a.game_root else here.parent
    archive_path = a.zip.resolve() if a.zip else here / ZIP_NAME
    if not archive_path.is_file():
        print(f"ZIP not found: {archive_path}", file=sys.stderr); return 1
    jobs = []
    with zipfile.ZipFile(archive_path) as z:
        for info in z.infolist():
            if info.is_dir() or PurePosixPath(info.filename.replace("\\","/")).name.lower() != "pack.js":
                continue
            if safe_path(info.filename) is None:
                print("SKIP unsafe path:", info.filename); continue
            try:
                text = z.read(info).decode("utf-8-sig")
            except UnicodeDecodeError:
                print("SKIP invalid text:", info.filename); continue
            item = detect(text, info.filename)
            if not item:
                print("SKIP unsupported pack:", info.filename); continue
            ident, label, folder = item
            m = FOLDER_RE.search(text)
            if not m:
                print("SKIP missing folderName:", info.filename); continue
            text = FOLDER_RE.sub(lambda x: x.group(1) + '"' + folder + '"', text, count=1)
            dest = root / "image-packs" / folder / "pack.js"
            jobs.append((ident, label, dest, text))
    if not jobs:
        print("No supported packs found."); return 1
    print("Game root:", root)
    for _, label, dest, _ in jobs:
        print(("OVERWRITE" if dest.exists() else "INSTALL"), label, "->", dest)
    print("Existing destination files will be overwritten; source ZIP is retained.")
    if a.dry_run:
        print("DRY RUN: no files changed."); return 0
    if not a.yes:
        try:
            if input("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
                print("Cancelled."); return 0
        except (EOFError, KeyboardInterrupt):
            print("\nCancelled."); return 130
    errors = 0
    for _, label, dest, text in jobs:
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(".js.tmp")
            tmp.write_text(text, encoding="utf-8", newline="")
            tmp.replace(dest)
            print("OK", label)
        except OSError as e:
            errors += 1; print("FAIL", label, e, file=sys.stderr)
    print(f"Finished: {len(jobs)-errors} installed/updated, {errors} failed.")
    return 1 if errors else 0

if __name__ == "__main__":
    raise SystemExit(main())
