from pathlib import Path
import hashlib, json, re, zipfile

SOURCE = Path("Wayward_WML_ko.html")
EXPECTED_SIZE = 4_373_978
EXPECTED_SHA256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d"
TARGETS = ["물자 채우기", "시설 업그레이드", "전액 상환", "상환:"]
FUNCTIONS = [
    "function SB(", "function Zot(", "function Hst(", "function Yrt(",
    "function yst(", "function wst(", "function gat(", "function Xrt(",
    "function Jrt("
]
WINDOW = 8192
raw = SOURCE.read_bytes()
digest = hashlib.sha256()
chunks=[]
for offset in range(0,len(raw),4096):
    block=raw[offset:offset+4096]
    digest.update(block)
    chunks.append({"offset":offset,"length":len(block),
                   "sha256":hashlib.sha256(block).hexdigest()})
assert len(raw)==EXPECTED_SIZE
assert digest.hexdigest()==EXPECTED_SHA256

matches={}
for label in TARGETS+FUNCTIONS:
    needle=label.encode("utf-8")
    poss=[];start=0
    while True:
        pos=raw.find(needle,start)
        if pos<0:break
        poss.append(pos);start=pos+1
    matches[label]=poss

contexts=[]
with SOURCE.open("rb") as f:
    for label,positions in matches.items():
        for pos in positions[:10]:
            start=max(0,pos-WINDOW//2)
            length=min(WINDOW,len(raw)-start)
            f.seek(start)
            data=f.read(length)
            assert len(data)<=WINDOW
            contexts.append({
              "label":label,"offset":pos,"window_start":start,
              "window_bytes":len(data),
              "window_sha256":hashlib.sha256(data).hexdigest(),
              "context_utf8":data.decode("utf-8","replace")
            })

# List enclosing-candidate function declarations near both requested UI strings.
candidate_functions={}
for label in TARGETS:
    values=[]
    for pos in matches[label]:
        prefix=raw[max(0,pos-200_000):pos]
        base=max(0,pos-200_000)
        declarations=list(re.finditer(rb"function\s+([A-Za-z_$][\w$]*)\s*\(",prefix))
        values.append({
          "target_offset":pos,
          "preceding_functions":[
            {"name":m.group(1).decode("ascii","replace"),"offset":base+m.start()}
            for m in declarations[-30:]
          ]
        })
    candidate_functions[label]=values

out=Path("focused-ui-owner");out.mkdir(exist_ok=True)
manifest={
 "repository":"diethoon/wayward","branch":"main",
 "commit":"4babcaff70e65af6c804e126d8ff9af5eb19dc6a",
 "path":str(SOURCE),"bytes":len(raw),"sha256":digest.hexdigest(),
 "chunk_bytes":4096,"chunks":chunks,
 "matches":matches
}
(out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
(out/"contexts.json").write_text(json.dumps(contexts,ensure_ascii=False,indent=2),encoding="utf-8")
(out/"nearest-functions.json").write_text(json.dumps(candidate_functions,ensure_ascii=False,indent=2),encoding="utf-8")
with zipfile.ZipFile("focused-ui-owner.zip","w",zipfile.ZIP_DEFLATED,9) as z:
 for p in sorted(out.iterdir()):z.write(p,p.name)
with zipfile.ZipFile("focused-ui-owner.zip") as z: assert z.testzip() is None
print("SOURCE",len(raw),digest.hexdigest(),"CHUNKS",len(chunks))
print("MATCHES",json.dumps(matches,ensure_ascii=False))
print("ARTIFACT",Path("focused-ui-owner.zip").stat().st_size)
