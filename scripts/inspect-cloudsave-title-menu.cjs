const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const filename = path.join(process.cwd(), 'Wayward_WML_ko.html');
const bytes = fs.readFileSync(filename);
const expectedBytes = 4373978;
const expectedGitBlobSha = 'd198eacfc127c55dc44bd5d1b8e29ff2bb7d08e6';
if (bytes.length !== expectedBytes) throw new Error(`Pinned game HTML size mismatch: expected ${expectedBytes}, got ${bytes.length}`);
const gitBlobSha = crypto.createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
if (gitBlobSha !== expectedGitBlobSha) throw new Error(`Pinned game HTML blob mismatch: expected ${expectedGitBlobSha}, got ${gitBlobSha}`);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const needles = ['새 게임', '새로 시작', '계속하기', '게임 시작', '게임 시작하기', '불러오기', 'New Game', 'Start New Game', 'Start Game', 'Load Game'];
const encoded = needles.map(value => ({ value, bytes: Buffer.from(value, 'utf8') }));
const maxNeedle = Math.max(...encoded.map(item => item.bytes.length));
const chunkSize = 4096, chunkManifest = [], found = [], seen = new Set();
let carry = Buffer.alloc(0);
for (let offset = 0; offset < bytes.length; offset += chunkSize) {
  const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
  chunkManifest.push(`${offset}\t${chunk.length}\t${crypto.createHash('sha256').update(chunk).digest('hex')}`);
  const combined = Buffer.concat([carry, chunk]), combinedOffset = offset - carry.length;
  for (const needle of encoded) {
    let cursor = 0;
    while (cursor <= combined.length - needle.bytes.length) {
      const at = combined.indexOf(needle.bytes, cursor);
      if (at < 0) break;
      const absolute = combinedOffset + at;
      if (absolute < offset + chunk.length && absolute + needle.bytes.length > offset) {
        const key = `${needle.value}@${absolute}`;
        if (!seen.has(key)) { seen.add(key); found.push({ needle: needle.value, offset: absolute }); }
      }
      cursor = at + 1;
    }
  }
  carry = combined.subarray(Math.max(0, combined.length - (maxNeedle - 1)));
}
found.sort((a, b) => a.offset - b.offset);
const matches = found.slice(0, 18).map(item => {
  const contextStart = Math.max(0, item.offset - 240);
  const contextEnd = Math.min(bytes.length, item.offset + Buffer.byteLength(item.needle) + 240);
  const context = bytes.subarray(contextStart, contextEnd).toString('utf8').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
  return `MATCH ${item.needle} @ ${item.offset}\n${context}`;
});
const deepTitleContexts = found
  .filter(item => item.needle === '새 게임' && item.offset > 3800000)
  .slice(-3)
  .map(item => {
    const contextStart = Math.max(0, item.offset - 1400);
    const contextEnd = Math.min(bytes.length, item.offset + Buffer.byteLength(item.needle) + 1400);
    return `TITLE_MENU_CONTEXT offset=${item.offset} length=${contextEnd - contextStart}\\n${bytes.subarray(contextStart, contextEnd).toString('utf8')}`;
  });
fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
const report = [
  'Wayward title-screen source scan', `path=${filename}`, `bytes=${bytes.length}`,
  `git_blob_sha1=${gitBlobSha}`, `sha256=${sha256}`, `chunk_size=${chunkSize}`,
  `chunk_count=${chunkManifest.length}`, `match_count=${found.length}`, '',
  'CHUNK_SHA256 offset\\tlength\\tsha256', ...chunkManifest, '', 'MATCH_CONTEXTS', ...matches, '', 'TITLE_MENU_DEEP_CONTEXTS', ...deepTitleContexts
].join('\n');
fs.writeFileSync(path.join(process.cwd(), 'dist', 'title-menu-byte-scan.txt'), report);
console.log(`TITLE_SCAN bytes=${bytes.length} blob=${gitBlobSha} sha256=${sha256} chunks=${chunkManifest.length} matches=${found.length}`);
console.log(deepTitleContexts.join('\n---\n'));
