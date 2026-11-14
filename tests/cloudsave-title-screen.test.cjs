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
  let depth = 0, quote = '', lineComment = false, blockComment = false, escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}()`);
}

class FakeClassList {
  constructor(values = []) { this.values = new Set(values); }
  [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  remove(value) { this.values.delete(value); }
}
class FakeElement {
  constructor(tagName = 'button', text = '') {
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.value = '';
    this.attributes = {};
    this.classList = new FakeClassList(['menu-item']);
    this.style = { removeProperty() {} };
    this.listeners = {};
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.nodeType = 1;
    this.type = '';
    this.disabled = false;
    this.tabIndex = -1;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  cloneNode() {
    const clone = new FakeElement(this.tagName);
    clone.classList = new FakeClassList([...this.classList]);
    clone.type = this.type;
    return clone;
  }
  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }
  insertAdjacentElement(position, element) {
    assert.equal(position, 'afterend');
    const parent = this.parentElement;
    assert.ok(parent);
    if (element.parentElement) element.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, element);
    element.parentElement = parent;
    element.isConnected = true;
    return element;
  }
  remove() {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }
    this.isConnected = false;
  }
}
function buildTitleContext() {
  const parent = { children: [] };
  let newGame = new FakeElement('div', '새 게임');
  newGame.parentElement = parent;
  parent.children.push(newGame);
  let nativeLoad = null, opened = 0;
  const marker = '[data-wml-cloud-drive-title-load="true"]';
  const document = {
    querySelectorAll(selector) {
      if (selector !== marker) return [];
      return parent.children.filter(node => node.getAttribute('data-wml-cloud-drive-title-load') === 'true');
    }
  };
  const TITLE_NEW_GAME_LABELS = ['새 게임', '새로 시작', 'New Game', 'Start New Game', 'Start Game'];
  const TITLE_LOAD_LABELS = ['불러오기', '게임 불러오기', '세이브 불러오기', 'Load', 'Load Game', 'Load Save'];
  const findVisibleMenuControl = labels => labels === TITLE_NEW_GAME_LABELS ? newGame : nativeLoad;
  const hasNearbyMenu = () => false;
  const open = () => { opened++; };
  const sync = vm.runInNewContext(`(${extractFunction('syncTitleCloudButton')})`, {
    document, TITLE_NEW_GAME_LABELS, TITLE_LOAD_LABELS, findVisibleMenuControl, hasNearbyMenu, open, Array
  });
  return {
    parent, sync,
    setNewGame(value) { newGame = value; },
    get opened() { return opened; },
    marker
  };
}

test('title cloud menu appears without a local Load button and supports keyboard activation', () => {
  const ctx = buildTitleContext();
  ctx.sync();
  const cloud = ctx.parent.children.find(node => node.getAttribute('data-wml-cloud-drive-title-load') === 'true');
  assert.ok(cloud);
  assert.equal(cloud.textContent, '클라우드세이브 (Google Drive)');
  assert.equal(cloud.getAttribute('aria-label'), '클라우드세이브 (Google Drive)');
  assert.equal(cloud.getAttribute('role'), 'button');
  assert.equal(cloud.tabIndex, 0);
  cloud.listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  cloud.listeners.keydown[0]({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  cloud.listeners.keydown[0]({ key: ' ', preventDefault() {}, stopPropagation() {} });
  assert.equal(ctx.opened, 3);
});

test('title cloud entry is idempotent and removed when the title menu disappears', () => {
  const ctx = buildTitleContext();
  ctx.sync(); ctx.sync();
  assert.equal(ctx.parent.children.filter(n => n.getAttribute('data-wml-cloud-drive-title-load') === 'true').length, 1);
  ctx.setNewGame(null); ctx.sync();
  assert.equal(ctx.parent.children.filter(n => n.getAttribute('data-wml-cloud-drive-title-load') === 'true').length, 0);
});

test('title slots allow load/delete but never save or overwrite before game start', () => {
  const driveSlots = [{ name: 'wayward-cloud-slot-2.json', memo: '', summary: 'Day 12', modifiedTime: '' }];
  const root = { children: [], append(node) { this.children.push(node); } };
  const hasStartedGame = () => false;
  const currentFile = slot => driveSlots.find(file => file.name === `wayward-cloud-slot-${slot}.json`) || null;
  const h = (tag, props, ...text) => ({ tag, props, text, children: [], append(...nodes) { this.children.push(...nodes); } });
  const button = label => ({ label, children: [] });
  const addTitle = (node, label) => node.append(h('h3', {}, label));
  const addText = (node, label, cls) => node.append(h('p', { class: cls }, label));
  const render = vm.runInNewContext(`(${extractFunction('renderSlots')})`, {
    driveSlots, hasStartedGame, currentFile, h, button, addTitle, addText,
    show() {}, runAction() {}, prepareLoadSlot() {}, removeSlot() {}, Array, Map, Set, RegExp, Number
  });
  render(root);
  const labels = [];
  const walk = node => {
    if (!node) return;
    if (node.label) labels.push(node.label);
    for (const child of node.children || []) walk(child);
    for (const child of node.text || []) if (typeof child === 'object') walk(child);
  };
  root.children.forEach(walk);
  assert.ok(labels.includes('불러오기'));
  assert.ok(labels.includes('삭제'));
  assert.ok(!labels.includes('저장'));
  assert.ok(!labels.includes('덮어쓰기'));
});

test('empty title screen shows no artificial empty save slot', () => {
  const root = { children: [], append(node) { this.children.push(node); } };
  const h = (tag, props, ...text) => ({ tag, props, text, children: [], append(...nodes) { this.children.push(...nodes); } });
  const addTitle = (node, label) => node.append(h('h3', {}, label));
  const addText = (node, label, cls) => node.append(h('p', { class: cls }, label));
  const render = vm.runInNewContext(`(${extractFunction('renderSlots')})`, {
    driveSlots: [], hasStartedGame: () => false, currentFile: () => null, h, addTitle, addText, Array, Map, Set, RegExp, Number
  });
  render(root);
  assert.equal(root.children[1].text[0], 'Google Drive에 저장된 세이브가 없습니다.');
});

test('title restore applies the old snapshot and enters started=true without replacing other store fields', () => {
  let current = { started: false, state: null, keep: 'same' };
  const api = { store: { set(update) { current = update(current); } } };
  const apply = vm.runInNewContext(`(${extractFunction('applySnapshot')})`, { api, Object, Array });
  apply({
    schema: 'wayward-cloud-save', version: 1, nativeFormat: 1, gameFamily: 'wayward',
    state: { day: 18, mods: { old: true } }, modData: { cloud: 'ok' }
  });
  assert.equal(current.started, true);
  assert.equal(current.keep, 'same');
  assert.deepEqual(JSON.parse(JSON.stringify(current.state)), { day: 18, mods: { old: true, cloud: 'ok' } });
});

test('invalid restore is rejected before store mutation', () => {
  let writes = 0;
  const apply = vm.runInNewContext(`(${extractFunction('applySnapshot')})`, {
    api: { store: { set() { writes++; } } }, Object, Array
  });
  assert.throws(() => apply({ schema: 'wrong', state: {} }));
  assert.equal(writes, 0);
});

test('saving is rejected on title screen even if a placeholder state object exists', () => {
  const guard = vm.runInNewContext(`(${extractFunction('hasStartedGame')})`, {
    api: { store: { game() { return { day: 0 }; }, get() { return { started: false }; } } }, Object, Array
  });
  assert.equal(guard(), false);
});

test('saving requires a game state and a true started flag when available', () => {
  const active = { store: { game() { return { day: 4 }; }, get() { return { started: true }; } } };
  const absent = { store: { game() { return null; }, get() { return { started: false }; } } };
  const guard = api => vm.runInNewContext(`(${extractFunction('hasStartedGame')})`, { api })();
  assert.equal(guard(active), true);
  assert.equal(guard(absent), false);
});

test('legacy decrypt validates before rewriting the existing Drive slot', () => {
  const legacy = extractFunction('loadSlot');
  assert.ok(legacy.indexOf('restoredStateFromSnapshot(snapshot)') <
    legacy.indexOf('writeSlotEnvelope(slot, await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(snapshot))'));
});
