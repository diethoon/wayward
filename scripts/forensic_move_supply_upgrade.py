from pathlib import Path
import hashlib
import json
import re
import zipfile

SOURCE = Path("Wayward_WML_ko.html")
EXPECTED_SIZE = 4_373_978
EXPECTED_SHA256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d"
CHUNK_SIZE = 4096
CONTEXT = 1800

KOREAN_TERMS = [
    "물자", "시설", "업그레이드", "채우기", "보충", "보급", "재고",
    "선술집", "가게", "상점", "건물", "개선", "수리", "확장", "시장"
]
ENGLISH_TERMS = [
    "supply", "supplies", "stock", "upgrade", "facility", "facilities",
    "restock", "refill", "provision", "tavern", "inn", "shop", "quality"
]

raw = SOURCE.read_bytes()
digest = hashlib.sha256()
chunks = []
offset = 0
while offset < len(raw):
    block = raw[offset:offset + CHUNK_SIZE]
    digest.update(block)
    chunks.append({
        "offset": offset,
        "length": len(block),
        "sha256": hashlib.sha256(block).hexdigest()
    })
    offset += len(block)

actual_sha = digest.hexdigest()
assert len(raw) == EXPECTED_SIZE, (len(raw), EXPECTED_SIZE)
assert actual_sha == EXPECTED_SHA256, (actual_sha, EXPECTED_SHA256)

# Search across the full byte stream. Chunk overlaps ensure boundary hits are retained.
search_terms = KOREAN_TERMS + ENGLISH_TERMS
hits = []
seen = set()
for term in search_terms:
    needle = term.encode("utf-8")
    start = 0
    while True:
        pos = raw.find(needle, start)
        if pos < 0:
            break
        key = (term, pos)
        if key not in seen:
            seen.add(key)
            hits.append({"term": term, "offset": pos})
        start = pos + 1

hits.sort(key=lambda item: (item["offset"], item["term"]))
contexts = []
for hit in hits:
    start = max(0, hit["offset"] - CONTEXT)
    end = min(len(raw), hit["offset"] + CONTEXT)
    chunk = raw[start:end]
    contexts.append({
        **hit,
        "start": start,
        "end": end,
        "context_utf8": chunk.decode("utf-8", errors="replace")
    })

# Capture structural anchors for the story pane, layout owner, and likely action surfaces.
anchors = [
    b"function gat(", b"function vle(", b"function Jrt(", b"function Xrt(",
    b"function Ihe(", b"물자", b"시설", b"업그레이드", b"채우기"
]
anchor_contexts = []
for needle in anchors:
    pos = 0
    while True:
        pos = raw.find(needle, pos)
        if pos < 0:
            break
        start = max(0, pos - CONTEXT)
        end = min(len(raw), pos + CONTEXT)
        anchor_contexts.append({
            "anchor": needle.decode("utf-8", errors="replace"),
            "offset": pos,
            "start": start,
            "end": end,
            "context_utf8": raw[start:end].decode("utf-8", errors="replace")
        })
        pos += 1

manifest = {
    "repository": "diethoon/wayward",
    "branch": "fix/mobile-ui-migration-1.3.13",
    "base_commit": "d80e57258d25261aac0233674a217c7a6cb03aa3",
    "source_path": str(SOURCE),
    "source_git_blob_sha": "d198eacfc127c55dc44bd5d1b8e29ff2bb7d08e6",
    "source_bytes": len(raw),
    "source_sha256": actual_sha,
    "chunk_bytes": CHUNK_SIZE,
    "chunks": chunks,
    "search_terms": search_terms,
    "hit_count": len(hits)
}
Path("forensic-output").mkdir(exist_ok=True)
Path("forensic-output/source-chunk-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
Path("forensic-output/string-contexts.json").write_text(
    json.dumps(contexts, ensure_ascii=False, indent=2), encoding="utf-8"
)
Path("forensic-output/structural-anchors.json").write_text(
    json.dumps(anchor_contexts, ensure_ascii=False, indent=2), encoding="utf-8"
)
Path("forensic-output/summary.txt").write_text(
    f"bytes={len(raw)}\\nsha256={actual_sha}\\nchunks={len(chunks)}\\n"
    f"hits={len(hits)}\\n", encoding="utf-8"
)

with zipfile.ZipFile("forensic-move-supply-upgrade.zip", "w",
                     zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in sorted(Path("forensic-output").iterdir()):
        z.write(file, file.name)
with zipfile.ZipFile("forensic-move-supply-upgrade.zip") as z:
    assert z.testzip() is None
    print("ZIP", [(i.filename, i.file_size) for i in z.infolist()])
print("SOURCE", len(raw), actual_sha, "CHUNKS", len(chunks), "HITS", len(hits))
print("TERMS", json.dumps({t: sum(1 for h in hits if h["term"] == t) for t in search_terms if any(h["term"] == t for h in hits)}, ensure_ascii=False))
