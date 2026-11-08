import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("../app/src/main/assets/wml-folder-bootstrap.js", import.meta.url), "utf8");
function run(result, initial = ["stale"]) {
  const values = new Map([["wml.folders", JSON.stringify(initial)]]);
  const context = {
    window: { WMLHost: { listModIds: () => JSON.stringify(result) } },
    localStorage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) },
    console: { warn() {} }
  };
  vm.runInNewContext(source, context);
  return JSON.parse(values.get("wml.folders"));
}
assert.deepEqual(run({ok:true,ids:["cloud-save","faith-image-loader","cloud-save","../bad"]}),["cloud-save","faith-image-loader"]);
assert.deepEqual(run({ok:false,ids:[]}),["stale"]);
assert.deepEqual(run({ok:true,ids:[]}),[]);
console.log("WML folder bootstrap tests passed.");
