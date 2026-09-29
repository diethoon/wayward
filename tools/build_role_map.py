from pathlib import Path
import re
import sys

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "Wayward_MOD_v2.107.html")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "analysis_parts/role_map")

ROLE_RULES = {
    "app": [r"^nce$", r"^Ihe$"],
    "layout": [r"^vle$", r"^zse$", r"^whe$", r"^The$"],
    "mobile-status": [r"^Pie$", r"^R3$", r"status", r"상태"],
    "movement": [r"^jre$", r"^a5$", r"map", r"지도", r"이동", r"위치"],
    "debug": [r"^She$", r"debug", r"toggle", r"wc2"],
    "screens": [r"^Phe$", r"^zhe$", r"^Vhe$", r"^Khe$", r"^Jhe$", r"^Qhe$", r"^K5$"],
    "storage": [r"save", r"load", r"autosave", r"storage", r"import", r"export"],
}

def find_body_end(text, open_index):
    depth = 0
    quote = None
    escape = False
    line_comment = False
    block_comment = False
    i = open_index
    while i < len(text):
        ch = text[i]
        nx = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if ch == "\n":
                line_comment = False
        elif block_comment:
            if ch == "*" and nx == "/":
                block_comment = False
                i += 1
        elif quote:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
        else:
            if ch in ("'", '"') or ord(ch) == 96:
                quote = ch
            elif ch == "/" and nx == "/":
                line_comment = True
                i += 1
            elif ch == "/" and nx == "*":
                block_comment = True
                i += 1
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i + 1
        i += 1
    return None

raw = SOURCE.read_text(encoding="utf-8")
script_blocks = re.findall(r"<script\b[^>]*>(.*?)</script\s*>", raw, flags=re.I | re.S)
js = "\n".join(script_blocks)

found = []
for m in re.finditer(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(", js):
    name = m.group(1)
    brace = js.find("{", m.end())
    if brace < 0:
        continue
    end = find_body_end(js, brace)
    if not end:
        continue
    body = js[m.start():end]
    line = js.count("\n", 0, m.start()) + 1
    found.append((name, line, len(body), body))

roles = {k: [] for k in ROLE_RULES}
roles["shared"] = []

for name, line, size, body in found:
    hay = name + " " + body[:12000]
    matched = []
    for role, rules in ROLE_RULES.items():
        if any(re.search(rule, hay, re.I) for rule in rules):
            matched.append(role)
    if not matched:
        matched = ["shared"]
    for role in matched[:2]:
        roles[role].append((name, line, size))

OUT.mkdir(parents=True, exist_ok=True)
manifest = []
for role, rows in roles.items():
    rows.sort(key=lambda x: x[1])
    p = OUT / f"{role}.md"
    lines = [f"Role: {role}", "", f"Functions: {len(rows)}", ""]
    for name, line, size in rows:
        lines.append(f"- {name} — script line {line}, {size} chars")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest.append(f"- {role}: {len(rows)} functions")

(OUT / "README.md").write_text(
    "Generated semantic role map. This directory is analysis output, not executable source. "
    "It maps semantic owners before code is physically extracted into src/.\n\n"
    + "\n".join(manifest) + "\n",
    encoding="utf-8",
)

print(f"source={SOURCE} functions={len(found)}")
print("\n".join(manifest))
