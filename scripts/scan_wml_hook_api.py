from pathlib import Path
import hashlib, json, re

P=Path("Wayward_WML_ko.html")
EXPECTED=4_373_978
EXPECTED_SHA="e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d"
CHUNK=4096
patterns={
 "api_hook":re.compile(rb"api\.hook"),
 "hook_method":re.compile(rb"\bhook\s*:\s*(?:function\b|\(|[A-Za-z_$])"),
 "hook_call":re.compile(rb"\.hook\s*\("),
 "WML_define":re.compile(rb"WML\.define"),
 "setup_api":re.compile(rb"setup\s*\(\s*api\s*\)"),
 "around_after":re.compile(rb"\b(?:around|after)\s*:"),
 "hook_reg":re.compile(rb"(?:register|install|create)[A-Za-z_$]*[Hh]ook"),
}
digest=hashlib.sha256(); rows=[]; hits={k:[] for k in patterns}
carry=b""; offset=0
with P.open("rb") as f:
 while True:
  block=f.read(CHUNK)
  if not block: break
  digest.update(block)
  rows.append({"offset":offset,"length":len(block),"sha256":hashlib.sha256(block).hexdigest()})
  scan=carry+block; base=offset-len(carry)
  for name,rx in patterns.items():
   for m in rx.finditer(scan):
    pos=base+m.start()
    if not hits[name] or hits[name][-1]!=pos: hits[name].append(pos)
  carry=scan[-512:]; offset+=len(block)
sha=digest.hexdigest()
assert offset==EXPECTED,(offset,EXPECTED)
assert sha==EXPECTED_SHA,(sha,EXPECTED_SHA)
# Emit only bounded 4096-byte contexts around relevant matches. Prefer earliest
# hook implementation candidates, plus initial WML declarations.
ranges=[]
for name,positions in hits.items():
 for pos in positions[:6]:
  start=max(0,pos-2048); end=min(offset,pos+2048)
  if not any(a<end and start<b for a,b,_ in ranges):
   ranges.append((start,end,name))
out=Path("hook-api-contexts");out.mkdir(exist_ok=True)
manifest={"repo":"diethoon/wayward","commit":"4babcaff70e65af6c804e126d8ff9af5eb19dc6a",
 "path":str(P),"bytes":offset,"sha256":sha,"chunk_bytes":CHUNK,
 "chunks":rows,"hits":hits,"contexts":[]}
for i,(start,end,name) in enumerate(sorted(ranges),1):
 parts=[]
 with P.open("rb") as f:
  f.seek(start); consumed=0; n=1
  while start+consumed<end:
   b=f.read(min(CHUNK,end-start-consumed))
   q=out/f"context-{i:02d}-part-{n:02d}.bin";q.write_bytes(b)
   parts.append({"file":str(q),"offset":start+consumed,"length":len(b),
    "sha256":hashlib.sha256(b).hexdigest()})
   consumed+=len(b);n+=1
 manifest["contexts"].append({"pattern":name,"start":start,"end":end,"parts":parts})
Path("hook-api-manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
import zipfile
with zipfile.ZipFile("hook-api-contexts.zip","w",zipfile.ZIP_DEFLATED,9) as z:
 z.write("hook-api-manifest.json")
 for p in sorted(out.glob("*.bin")):z.write(p,p.as_posix())
with zipfile.ZipFile("hook-api-contexts.zip") as z: assert z.testzip() is None
print("SOURCE VERIFIED",offset,sha,"CHUNKS",len(rows))
for k,v in hits.items():print("HITS",k,len(v),v[:20])
print("CONTEXTS",len(ranges))
