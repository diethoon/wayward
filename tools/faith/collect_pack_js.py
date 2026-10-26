#!/usr/bin/env python3
"""Collect only pack.js files from image-pack ZIPs into one small ZIP.

Usage:
  Put this script beside the source ZIP files, then run:
    python collect_pack_js.py

Output:
  image-packs-packjs-only.zip beside this script.

Each source archive gets its own top-level folder named after the ZIP file
(without .zip). All pack.js files are included. If an archive has multiple
pack.js files, their relative paths inside that archive are preserved below
that folder so files cannot overwrite each other.

Source ZIPs are never modified. ZIP paths are normalized and traversal paths
are rejected. No image assets or other files are copied.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path, PurePosixPath

OUTPUT_NAME = "image-packs-packjs-only.zip"


def safe_path(name: str) -> PurePosixPath | None:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        not normalized
        or path.is_absolute()
        or any(part in ("", ".", "..") for part in path.parts)
        or (path.parts and ":" in path.parts[0])
    ):
        return None
    return path


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    output_path = script_dir / OUTPUT_NAME
    archives = sorted(
        p for p in script_dir.glob("*.zip")
        if p.is_file() and p.name != OUTPUT_NAME
    )

    if not archives:
        print(f"No source ZIP files found in: {script_dir}")
        return 1

    written = 0
    errors = 0
    # Write to a temporary file so a failed run does not leave a misleading
    # partial output under the final output name.
    temp_path = output_path.with_suffix(".zip.tmp")
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as out:
            for archive in archives:
                try:
                    with zipfile.ZipFile(archive, "r") as src:
                        matches = []
                        for info in src.infolist():
                            if info.is_dir():
                                continue
                            safe = safe_path(info.filename)
                            if safe is None or safe.name.lower() != "pack.js":
                                continue
                            # Do not copy symlink entries.
                            mode = (info.external_attr >> 16) & 0o170000
                            if mode == 0o120000:
                                continue
                            matches.append((info, safe))

                        if not matches:
                            print(f"SKIP  {archive.name}: no safe pack.js found")
                            continue

                        for info, safe in matches:
                            # Normally each archive has one pack.js, resulting
                            # in <archive-name>/pack.js. Preserve internal
                            # paths only when there are multiple pack.js files.
                            if len(matches) == 1:
                                member_name = f"{archive.stem}/pack.js"
                            else:
                                member_name = (
                                    PurePosixPath(archive.stem) / safe
                                ).as_posix()

                            data = src.read(info)
                            out.writestr(member_name, data)
                            written += 1
                            print(f"ADD   {archive.name} :: {info.filename} -> {member_name}")

                except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
                    errors += 1
                    print(f"ERROR {archive.name}: {type(exc).__name__}: {exc}")

        if written == 0:
            temp_path.unlink(missing_ok=True)
            print("No pack.js files were collected; no output ZIP created.")
            return 1

        temp_path.replace(output_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    print(f"\nDone: {written} pack.js file(s) collected.")
    print(f"Output: {output_path}")
    if errors:
        print(f"Warning: {errors} archive(s) could not be read.")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
