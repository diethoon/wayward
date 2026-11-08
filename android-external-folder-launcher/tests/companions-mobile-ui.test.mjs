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
assert.ok(source.includes("installLocalImageBasePath(api)"));
assert.ok(source.includes('new URL(relativePath + parsed.search + parsed.hash, document.baseURI).href'));
assert.ok(java.includes('addPathHandler("/game/",folderHandler)'));
assert.ok(java.includes('InputStream in=isImageAssetPath(p)?tree.openImage(p):tree.open(p);'));
assert.ok(java.includes('n=findIgnoreCase(parent,parts[i],trace,i)'));
assert.ok(java.includes('image_saf_lookup'), "SAF image lookup must expose generic path timing.");
assert.ok(java.includes('image_stream_slow_or_failed'), "Image body reads must be measured after HTTP 200.");
assert.ok(java.includes('openInputStreamMs'), "SAF stream-open time must be separated from path lookup time.");
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
  setAttribute(name, value) {
    const key = String(name);
    this.attributes[key] = String(value);
    if (this instanceof FakeImageElement && key.toLowerCase() === "src") this._src = String(value);
  }
  getAttribute(name) {
    const key = String(name);
    return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
  }
  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      for (const child of node.children) {
        if (selector === "img[src]" && child instanceof FakeImageElement && child.getAttribute("src") !== null) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  click() { this.listeners.click?.({ currentTarget: this }); }
}

class FakeImageElement extends FakeElement {
  constructor() { super("img"); this._src = ""; }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    this.attributes.src = this._src;
  }
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe(target, options) { this.target = target; this.options = options; }
}

const documentElement = new FakeElement("html");
const document = {
  body: new FakeElement("body"),
  head: new FakeElement("head"),
  documentElement,
  baseURI: "https://localhost:8123/game/Wayward_WML_ko.html?launcher=test",
  createElement(tag) { return String(tag).toLowerCase() === "img" ? new FakeImageElement() : new FakeElement(tag); },
  querySelectorAll(selector) { return documentElement.querySelectorAll(selector); }
};
documentElement.append(document.head, document.body);
const preexistingImage = new FakeImageElement();
preexistingImage.src = "https://art.sintention.com/images/illustrious/characters/hina/preexisting.webp";
document.head.appendChild(preexistingImage);
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
          const el = new FakeElement("article");
          const image = new FakeImageElement();
          image.src = "https://art.sintention.com/images/illustrious/characters/" + id + "/portrait.webp";
          el.appendChild(image);
          const card = { id, el, image };
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
  Element: FakeElement,
  HTMLImageElement: FakeImageElement,
  MutationObserver: FakeMutationObserver,
  URL,
  location: { href: document.baseURI },
  window: { addEventListener(name, callback) { windowListeners[name] = callback; } },
  requestAnimationFrame(callback) { pendingFrames.push(callback); },
  console: { info() {}, warn() {} }
};
vm.runInNewContext(source, sandbox, { filename: "launcher-companions-mobile-ui.js" });
assert.ok(definition, "WML module should register");
assert.equal(definition.id, "launcher-mobile-companions");
assert.deepEqual(Array.from(definition.requires), ["companions"]);
assert.equal(typeof definition.setup, "function");

definition.setup(api);
assert.deepEqual(requestedModules, ["companions"]);
assert.equal(typeof provided.open, "function");
assert.equal(typeof provided.imagePathStatus, "function");
assert.equal(typeof subscriber, "function");
assert.equal(
  preexistingImage.getAttribute("src"),
  "https://localhost:8123/game/images/illustrious/characters/hina/preexisting.webp",
  "Images present before the built-in adapter starts must be rewritten."
);

const attributeImage = new FakeImageElement();
attributeImage.setAttribute("src", "https://art.sintention.com/images/illustrious/characters/mika/attribute.webp");
document.head.appendChild(attributeImage);
assert.equal(
  attributeImage.getAttribute("src"),
  "https://localhost:8123/game/images/illustrious/characters/mika/attribute.webp",
  "setAttribute image URLs must be rewritten."
);

const rootImage = new FakeImageElement();
rootImage.src = "https://localhost:8123/images/illustrious/characters/ryza/root.webp";
assert.equal(
  rootImage.src,
  "https://localhost:8123/game/images/illustrious/characters/ryza/root.webp",
  "Same-origin root /images URLs must resolve relative to the launcher game HTML."
);
const initialImageStatus = provided.imagePathStatus();
assert.equal(initialImageStatus.expectedImagesFolder, "https://localhost:8123/game/images/");
assert.equal(initialImageStatus.rewrites, 3);

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
assert.equal(
  created[0].image.src,
  "https://localhost:8123/game/images/illustrious/characters/a/portrait.webp",
  "Companions card images must be rewritten before the card is attached."
);
assert.equal(
  created[1].image.src,
  "https://localhost:8123/game/images/illustrious/characters/b/portrait.webp"
);
assert.equal(provided.imagePathStatus().rewrites, 5);
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
assert.equal(document.head.children.length, 2, "Existing document images must remain in place after adapter cleanup.");
assert.deepEqual(destroyed, ["a", "b"]);

console.log("Companions mobile adapter contract tests passed.");
