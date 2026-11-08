from pathlib import Path
import hashlib, json, re, zipfile, subprocess

SOURCE = Path("Wayward_WML_ko.html")
EXPECTED_BYTES = 4_373_978
EXPECTED_SHA256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d"
CHUNK = 4096
TARGETS = {"SB", "yst", "wst", "gat", "Zot", "Hst"}
EXPECTED = {"SB": 3583670, "yst": 3596625, "wst": 3597305, "gat": 3744307}
pattern = re.compile(rb"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(")

digest = hashlib.sha256()
chunks = []
declarations = []
carry = b""
offset = 0
with SOURCE.open("rb") as f:
    while True:
        block = f.read(CHUNK)
        if not block:
            break
        digest.update(block)
        chunks.append({"offset": offset, "length": len(block),
                       "sha256": hashlib.sha256(block).hexdigest()})
        scan = carry + block
        base = offset - len(carry)
        for match in pattern.finditer(scan):
            declarations.append({
                "name": match.group(1).decode("ascii"),
                "offset": base + match.start()
            })
        carry = scan[-256:]
        offset += len(block)

actual_sha = digest.hexdigest()
assert offset == EXPECTED_BYTES, (offset, EXPECTED_BYTES)
assert actual_sha == EXPECTED_SHA256, (actual_sha, EXPECTED_SHA256)

by_name = {}
for item in declarations:
    if item["name"] in TARGETS:
        by_name.setdefault(item["name"], []).append(item["offset"])
for name, expected in EXPECTED.items():
    assert expected in by_name.get(name, []), (name, expected, by_name.get(name))

def read_at(pos, size):
    with SOURCE.open("rb") as f:
        f.seek(pos)
        return f.read(size)

def extract_by_next_decl(name, start):
    next_decl = next((d for d in declarations if d["offset"] > start), None)
    if not next_decl:
        raise RuntimeError(f"No following function boundary for {name}")
    end = next_decl["offset"]
    boundary = read_at(end - 2, 2)
    assert boundary in (b"};", b"} "), {
        "name": name, "candidate_next": next_decl, "boundary": boundary.hex()
    }
    length = end - start
    assert 0 < length < 300_000, (name, length, next_decl)
    outdir = Path("forensic-functions") / name
    outdir.mkdir(parents=True, exist_ok=True)
    parts = []
    assembled = Path("/tmp") / f"forensic-{name}.js"
    function_hash = hashlib.sha256()
    with SOURCE.open("rb") as src, assembled.open("wb") as combined:
        src.seek(start)
        consumed = 0
        index = 1
        while consumed < length:
            part = src.read(min(CHUNK, length - consumed))
            if not part:
                raise RuntimeError(f"short read for {name}: {consumed}/{length}")
            function_hash.update(part)
            combined.write(part)
            dest = outdir / f"part-{index:03d}.js"
            dest.write_bytes(part)
            parts.append({
                "file": str(dest),
                "offset_in_function": consumed,
                "length": len(part),
                "sha256": hashlib.sha256(part).hexdigest()
            })
            consumed += len(part)
            index += 1
    check = subprocess.run(["node", "--check", str(assembled)],
                           capture_output=True, text=True)
    if check.returncode:
        raise RuntimeError(f"node --check failed for {name}: {check.stderr[-2000:]}")
    return {
        "name": name, "source_offset": start, "source_end": end,
        "function_bytes": length, "function_sha256": function_hash.hexdigest(),
        "next_declaration": next_decl, "node_check": "PASS", "parts": parts
    }

functions = []
for name in ["SB", "yst", "wst", "Zot", "Hst", "gat"]:
    positions = by_name.get(name, [])
    if positions:
        functions.append(extract_by_next_decl(name, positions[0]))

manifest = {
    "repository": "diethoon/wayward",
    "branch": "forensic/complete-ui-functions-20261108",
    "base_commit": "d1ad04c261cb503309a7d5d51f6c1998712c0383",
    "source_path": str(SOURCE), "source_bytes": offset,
    "source_sha256": actual_sha, "chunk_bytes": CHUNK,
    "source_chunks": chunks, "relevant_declarations": by_name,
    "functions": functions
}
Path("forensic-functions-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)

base = Path("/tmp/mobile-ui-v1313.zip")
assert base.exists() and base.stat().st_size == 14576
assert hashlib.sha256(base.read_bytes()).hexdigest() == "61ccf0f6cbfe00a9f039e466e11f7d3b9ce81e916724002ffd1d8f3f9657bbc6"
with zipfile.ZipFile(base) as z:
    assert z.testzip() is None
    assert "mobile-ui-migration/mod.js" in [x.filename for x in z.infolist()]
Path("base-mobile-ui-v1313.zip").write_bytes(base.read_bytes())

with zipfile.ZipFile("target-ui-functions.zip", "w", zipfile.ZIP_DEFLATED, 9) as z:
    z.write("forensic-functions-manifest.json")
    for p in sorted(Path("forensic-functions").rglob("*.js")):
        z.write(p, p.as_posix())
with zipfile.ZipFile("target-ui-functions.zip") as z:
    assert z.testzip() is None
    print("FUNCTION ZIP", [(x.filename, x.file_size) for x in z.infolist()])
print("SOURCE", offset, actual_sha, "CHUNKS", len(chunks))
for item in functions:
    print("FUNCTION", item["name"], item["source_offset"], item["source_end"],
          item["function_bytes"], item["function_sha256"], item["node_check"],
          "NEXT", item["next_declaration"])
