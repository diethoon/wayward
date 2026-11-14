const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('cloud-save/mod.js', 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}()`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}()`);
}

const validGameOrigin = extractFunction('validGameOrigin');

function runOrigin(protocol, origin) {
  const window = { location: { protocol, origin } };
  return vm.runInNewContext(`(${validGameOrigin})()`, { window, URL });
}

test('file:// opaque origins normalize to serialized null', () => {
  for (const origin of ['null', '', 'file://', 'file:///']) {
    assert.equal(runOrigin('file:', origin), 'null');
  }
});

test('file:// rejects an inconsistent non-file origin', () => {
  assert.throws(() => runOrigin('file:', 'https://example.com'));
});

test('HTTP and HTTPS retain their exact origins', () => {
  assert.equal(runOrigin('http:', 'http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(runOrigin('https:', 'https://example.com'), 'https://example.com');
});

test('unsupported schemes remain rejected', () => {
  assert.throws(() => runOrigin('content:', 'null'));
  assert.throws(() => runOrigin('data:', 'null'));
});

test('file-origin bridge remains bound to the fixed auth page and popup', () => {
  assert.match(source, /const AUTH_PAGE_URL = 'https:\/\/jeiky224\.github\.io\/cloud\/auth\.html'/);
  assert.match(source, /authPopup\.postMessage\([\s\S]*?AUTH_PAGE_ORIGIN\)/);
  assert.match(source, /event\.source !== authPopup \|\| event\.origin !== AUTH_PAGE_ORIGIN/);
  assert.match(source, /url\.searchParams\.set\('origin', gameOrigin\)/);
});
