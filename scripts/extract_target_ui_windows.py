from pathlib import Path
import hashlib, json, zipfile

SOURCE = Path("Wayward_WML_ko.html")
EXPECTED_BYTES = 4_373_978
EXPECTED_SHA256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d"
CHUNK = 4096
RANGES = {
    "SB_yst_wst_start": (3583670, 3597305),
    "wst_to_Hst": (3597305, 3622331),
    "gat_context": (3744307, 3760000),
    "late_supply_upgrade_context": (3820000, 3840000),
}
digest = hashlib.sha256()
manifest_chunks = []
offset = 0
with SOURCE.open("rb") as f:
    while True:
        block = f.read(CHUNK)
        if not block:
            break
        digest.update(block)
        manifest_chunks.append({
            "offset": offset, "length": len(block),
            "sha256": hashlib.sha256(block).hexdigest()
        })
        offset += len(block)
actual = digest.hexdigest()
assert offset == EXPECTED_BYTES, (offset, EXPECTED_BYTES)
assert actual == EXPECTED_SHA256, (actual, EXPECTED_SHA256)

out = Path("target-ui-windows")
out.mkdir(exist_ok=True)
ranges_manifest = []
for name, (start, end) in RANGES.items():
    assert 0 <= start < end <= offset
    folder = out / name
    folder.mkdir(exist_ok=True)
    chunks = []
    with SOURCE.open("rb") as f:
        f.seek(start)
        consumed = 0
        idx = 1
        while start + consumed < end:
            size = min(CHUNK, end - start - consumed)
            data = f.read(size)
            assert len(data) == size
            path = folder / f"part-{idx:03d}.txt"
            path.write_bytes(data)
            chunks.append({
                "file": str(path), "source_offset": start + consumed,
                "length": len(data), "sha256": hashlib.sha256(data).hexdigest()
            })
            consumed += size
            idx += 1
    ranges_manifest.append({
        "name": name, "start": start, "end": end, "bytes": end-start,
        "parts": chunks
    })

manifest = {
    "repository": "diethoon/wayward",
    "branch": "forensic/complete-ui-functions-20261108",
    "source_commit": "4babcaff70e65af6c804e126d8ff9af5eb19dc6a",
    "path": str(SOURCE), "bytes": offset, "sha256": actual,
    "chunk_bytes": CHUNK, "source_chunks": manifest_chunks,
    "ranges": ranges_manifest
}
Path("target-ui-windows-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
base = Path("/tmp/mobile-ui-v1313.zip")
assert base.exists() and base.stat().st_size == 14576
assert hashlib.sha256(base.read_bytes()).hexdigest() == "61ccf0f6cbfe00a9f039e466e11f7d3b9ce81e916724002ffd1d8f3f9657bbc6"
Path("base-mobile-ui-v1313.zip").write_bytes(base.read_bytes())
with zipfile.ZipFile("target-ui-windows.zip", "w", zipfile.ZIP_DEFLATED, 9) as z:
    z.write("target-ui-windows-manifest.json")
    for p in sorted(out.rglob("*.txt")):
        z.write(p, p.as_posix())
with zipfile.ZipFile("target-ui-windows.zip") as z:
    assert z.testzip() is None
    print("WINDOW ZIP", [(x.filename, x.file_size) for x in z.infolist()])
print("SOURCE", offset, actual, "SOURCE_CHUNKS", len(manifest_chunks))
for item in ranges_manifest:
    print("RANGE", item["name"], item["start"], item["end"], item["bytes"], "PARTS", len(item["parts"]))
