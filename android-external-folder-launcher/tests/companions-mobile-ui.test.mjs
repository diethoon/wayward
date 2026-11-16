import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app/src/main/assets/launcher-companions-mobile-ui.js", import.meta.url), "utf8");
const java = fs.readFileSync(new URL("../app/src/main/java/com/wayward/launcher/MainActivity.java", import.meta.url), "utf8");

assert.ok(!source.includes("ui-customize"), "The built-in companion module must not depend on UI_customize.");
assert.ok(source.includes('WML.use("companions")'));
assert.ok(source.includes("live.createCard(person.id)"));
assert.ok(source.includes("live.updateCard(entry.card, state)"));
assert.ok(source.includes("live.destroyCard(entry.card)"));
assert.ok(java.includes('BUILTIN_COMPANIONS_MOD_ID = "launcher-mobile-companions"'));
assert.ok(java.includes('BUILTIN_COMPANIONS_MOD_FILE = "wml/mods/" + BUILTIN_COMPANIONS_MOD_ID + "/mod.js"'));
assert.ok(java.includes('assets.open("launcher-companions-mobile-ui.js")'));

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
    this.id = "";
    this.className = "";
  }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  click() { this.listeners.click?.({ currentTarget: this }); }
}

const document = {
  body: new FakeElement("body"),
  head: new FakeElement("head"),
  createElement(tag) { return new FakeElement(tag); }
};
const pendingFrames = [];
const windowListeners = Object.create(null);
let definition = null;
const requestedModules = [];
let gameState = { companions: [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
let subscriber = null;
let unsubscribed = false;
const created = [];
const updated = [];
const destroyed = [];
let provided = null;

const WML = {
  define(value) { definition = value; },
  use(id) {
    requestedModules.push(id);
    assert.equal(id, "companions");
    return {
      list(state) { return state.companions; },
      live: {
        createCard(id) {
          const card = { id, el: new FakeElement("article") };
          created.push(card);
          return card;
        },
        updateCard(card, state) { updated.push({ id: card.id, count: state.companions.length }); },
        destroyCard(card) { destroyed.push(card.id); },
        subscribe(callback) { subscriber = callback; return () => { unsubscribed = true; }; }
      }
    };
  }
};
const api = {
  store: { game() { return gameState; } },
  ui: {
    settings(callback) { callback(new FakeElement("div")); },
    h(tag) { return new FakeElement(tag); },
    button(label, callback) {
      const button = new FakeElement("button");
      button.textContent = label;
      button.addEventListener("click", callback);
      return button;
    }
  },
  provide(value) { provided = value; }
};
const sandbox = {
  WML, document,
  window: { addEventListener(name, callback) { windowListeners[name] = callback; } },
  requestAnimationFrame(callback) { pendingFrames.push(callback); },
  console: { warn() {} }
};
vm.runInNewContext(source, sandbox, { filename: "launcher-companions-mobile-ui.js" });
assert.ok(definition, "WML module should register");
assert.equal(definition.id, "launcher-mobile-companions");
assert.deepEqual(Array.from(definition.requires), ["companions"]);
assert.equal(typeof definition.setup, "function");

definition.setup(api);
assert.deepEqual(requestedModules, ["companions"]);
assert.equal(typeof provided.open, "function");
assert.equal(typeof subscriber, "function");

function flushFrames() {
  while (pendingFrames.length) pendingFrames.shift()();
}
flushFrames();
assert.equal(created.length, 0, "Cards are not generated while the panel is closed.");

const host = document.body.children[0];
const toggle = host.children[0];
const panel = host.children[1];
toggle.click();
flushFrames();
assert.equal(panel.hidden, false);
assert.equal(created.length, 2);
assert.equal(updated.length, 2);
assert.equal(panel.children[2].children.length, 2);

gameState = { companions: [{ id: "b", name: "B" }] };
subscriber();
flushFrames();
assert.deepEqual(destroyed, ["a"]);
assert.equal(panel.children[2].children.length, 1);
assert.equal(updated.at(-1).id, "b");

toggle.click();
assert.equal(panel.hidden, true);
const previousUpdates = updated.length;
subscriber();
flushFrames();
assert.equal(updated.length, previousUpdates, "Hidden cards should not trigger renderer updates.");

windowListeners.pagehide();
assert.equal(unsubscribed, true);
assert.equal(document.body.children.length, 0);
assert.equal(document.head.children.length, 0);
assert.deepEqual(destroyed, ["a", "b"]);

console.log("Companions mobile adapter contract tests passed.");
