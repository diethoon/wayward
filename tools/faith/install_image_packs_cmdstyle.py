#!/usr/bin/env python3
"""Install Faith image-pack pack.js files with CMD-style overwrite semantics.

Put this script and image-packs-packjs-only.zip in packs_to_install/.
By default the game root is the parent of the script directory, matching:
  Wayward_Faith/packs_to_install/install_image_packs.py

The ZIP collector intentionally keeps only pack.js files, so this installer
reconstructs the canonical image-packs/<maker>-<character>/base layout from
the ZIP member path and wfImagePack metadata. It never uses the pack's
" name " field to determine the folder or preview label.
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

ZIP_NAME = "image-packs-packjs-only.zip"
PACK_MARKER = "/* WAYWARD_FAITH_IMAGE_PACK */"
PACK_ID_RE = re.compile(r'\)\["((?:[^"\\]|\\.)*)"\]\s*=')
FOLDER_RE = re.compile(r'(["\']folderName["\']\s*:\s*)["\'][^"\']*["\']')
META_RE = re.compile(r'["\']wfImagePack["\']\s*:\s*\{')
STRING_FIELD = lambda key: re.compile(
    r'["\']' + re.escape(key) + r'["\']\s*:\s*["\']([^"\']+)["\']'
)


def safe_member_path(raw: str) -> PurePosixPath | None:
    normalized = raw.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (not normalized or path.is_absolute()
            or any(part in ("", ".", "..") for part in path.parts)
            or (path.parts and re.match(r"^[A-Za-z]:", path.parts[0]))):
        return None
    return path


def read_metadata(text: str, member_name: ¶»§q«^