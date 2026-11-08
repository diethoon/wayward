from pathlib import Path
import hashlib, json, re, zipfile

SOURCE = Path("Wayward_WML_ko.html")
EXPECTED_BYTES = 4_373_978
EXPECTED_SHA256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d"
CHUNK = 4096
TARGETS = {"SB", "yst", "wst", "gat", "Zot", "Hst"}

# Sequential 4096-byte binary verification. Keep only bounded carry for
# cross-chunk declaration detection; every source byte is hashed to EOF.
digest = hashlib.sha256()
chunks = []
declarations = {}
carry = b""
offset = 0
pattern = re.compile(rb"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(")
with SOURCE.open("rb") as f:
    while True:
        block = f.read(CHUNK)
        if not block:
            break
        digest.update(block)
        chunks.append({
            "offset": offset,
            "length": len(block),
            "sha256": hashlib.sha256(block).hexdigest()
        })
        scan = carry + block
        base = offset - len(carry)
        for m in pattern.finditer(scan):
            name = m.group(1).decode("ascii")
            if name in TARGETS:
                absolute = base + m.start()
                declarations.setdefault(name, []).append(absolute)
        carry = scan[-128:]
        offset += len(block)

actual_sha = digest.hexdigest()
assert offset == EXPECTED_BYTES, (offset, EXPECTED_BYTES)
assert actual_sha == EXPECTED_SHA256, (actual_sha, EXPECTED_SHA256)

expected_offsets = {
    "SB": 3583670,
    "yst": 3596625,
    "wst": 3597305,
    "gat": 3744307,
}
for name, expected in expected_offsets.items():
    assert expected in declarations.get(name, []), (name, expected, declarations.get(name))

def extract_function(start):
    # Read and retain only this function's bytes. Lexical states skip quotes,
    # comments and template literals so nested object/JSX-expression braces
    # do not terminate extraction early.
    state = "normal"
    stack = []  # template and template-expression return states
    depth = 0
    started = False
    out = bytearray()
    prev_sig = None
    with SOURCE.open("rb") as f:
        f.seek(start)
        while True:
            block = f.read(CHUNK)
            if not block:
                raise RuntimeError(f"EOF before function close at {start}")
            for i, c in enumerate(block):
                n = block[i + 1] if i + 1 < len(block) else None
                out.append(c)

                if state == "single" or state == "double":
                    quote = 39 if state == "single" else 34
                    if c == 92:
                        if n is not None:
                            out.append(n)
                            # The next byte is consumed as an escape.
                            # Advance the loop by replacing it with a sentinel.
                            block = block[:i+1] + b"\x00" + block[i+2:]
                        continue
                    if c == quote:
                        state = "normal"
                    continue

                if state == "line_comment":
                    if c == 10:
                        state = "normal"
                    continue

                if state == "block_comment":
                    if c == 42 and n == 47:
                        out.append(n)
                        block = block[:i+1] + b"\x00" + block[i+2:]
                        state = "normal"
                    continue

                if state == "template":
                    if c == 92:
                        if n is not None:
                            out.append(n)
                            block = block[:i+1] + b"\x00" + block[i+2:]
                        continue
                    if c == 96:
                        state = "normal"
                        if stack and stack[-1][0] == "template":
                            stack.pop()
                        continue
                    if c == 36 and n == 123:
                        out.append(n)
                        block = block[:i+1] + b"\x00" + block[i+2:]
                        stack.append(("template_expr", depth))
                        depth += 1
                        state = "normal"
                    continue

                # Normal JavaScript lexical state.
                if c == 39:
                    state = "single"
                elif c == 34:
                    state = "double"
                elif c == 96:
                    stack.append(("template", None))
                    state = "template"
                elif c == 47 and n == 47:
                    out.append(n)
                    block = block[:i+1] + b"\x00" + block[i+2:]
                    state = "line_comment"
                elif c == 47 and n == 42:
                    out.append(n)
                    block = block[:i+1] + b"\x00" + block[i+2:]
                    state = "block_comment"
                elif c == 123:
                    depth += 1
                    started = True
                elif c == 125:
                    depth -= 1
                    if depth < 0:
                        raise RuntimeError(f"negative brace depth at {start}")
                    if stack and stack[-1][0] == "template_expr" and depth == stack[-1][1]:
                        stack.pop()
                        state = "template"
                    elif started and depth == 0:
                        return bytes(out)

                if c not in b" \t\r\n":
                    prev_sig = c

def write_function_parts(name, start, raw):
    directory = Path("forensic-functions") / name
    directory.mkdir(parents=True, exist_ok=True)
    parts = []
    for index, pos in enumerate(range(0, len(raw), CHUNK), 1):
        part = raw[pos:pos + CHUNK]
        path = directory / f"part-{index:03d}.js"
        path.write_bytes(part)
        parts.append({
            "file": str(path),
            "offset_in_function": pos,
            "length": len(part),
            "sha256": hashlib.sha256(part).hexdigest()
        })
    return {
        "name": name,
        "source_offset": start,
        "function_bytes": len(raw),
        "function_sha256": hashlib.sha256(raw).hexdigest(),
        "parts": parts
    }

functions = []
for name in ["SB", "yst", "wst", "Zot", "Hst", "gat"]:
    positions = declarations.get(name, [])
    if not positions:
        continue
    # Keep declaration list for context, but extract the first declaration only.
    start = positions[0]
    body = extract_function(start)
    functions.append(write_function_parts(name, start, body))

manifest = {
    "repository": "diethoon/wayward",
    "branch": "forensic/complete-ui-functions-20261108",
    "base_commit": "d1ad04c261cb503309a7d5d51f6c1998712c0383",
    "source_path": str(SOURCE),
    "source_bytes": offset,
    "source_sha256": actual_sha,
    "chunk_bytes": CHUNK,
    "source_chunks": chunks,
    "declarations": declarations,
    "functions": functions
}
Path("forensic-functions-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
base = Path("/tmp/mobile-ui-v1313.zip")
assert base.exists() and base.stat().st_size == 14576
with zipfile.ZipFile(base) as z:
    assert z.testzip() is None
    entries = {x.filename: x.file_size for x in z.infolist()}
    assert "mobile-ui-migration/mod.js" in entries
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
    print("FUNCTION", item["name"], item["source_offset"], item["function_bytes"], item["function_sha256"], "PARTS", len(item["parts"]))
print("DECLARATIONS", json.dumps(declarations))
