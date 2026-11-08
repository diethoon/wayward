WML.define({
  id: "launcher-mobile-companions",
  name: "Wayward Launcher · 동료 모바일 실시간 창",
  author: "Wayward Launcher",
  version: "0.1.0",
  game: "2026-11-09",
  lang: "ko",
  tags: ["ui", "mobile"],
  description: "UI_customize 없이 Companions 원본 실시간 카드와 초상화를 모바일 고정 패널로 표시합니다.",
  requires: ["companions"],
  requiresVersion: { companions: ">=2.6.0" },
  loadAfter: ["companions"],
  setup(api) {
    const people = WML.use("companions");
    const live = people && people.live;
    if (!people || typeof people.list !== "function" ||
        !live || typeof live.createCard !== "function" ||
        typeof live.updateCard !== "function" ||
        typeof live.destroyCard !== "function" ||
        typeof live.subscribe !== "function") {
      throw new Error("Companions 2.6.0 이상의 실시간 카드 API를 찾지 못했습니다.");
    }

    const host = document.createElement("div");
    host.id = "launcher-mobile-companions";
    host.setAttribute("data-launcher-mobile-companions", "1");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "동료";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "launcher-mobile-companions-panel");

    const panel = document.createElement("section");
    panel.id = "launcher-mobile-companions-panel";
    panel.setAttribute("aria-label", "동료 실시간");
    panel.hidden = true;

    const heading = document.createElement("div");
    heading.className = "launcher-mobile-companions-heading";
    heading.textContent = "동료 실시간";

    const status = document.createElement("div");
    status.className = "launcher-mobile-companions-status";
    status.textContent = "동료 정보를 확인하는 중…";

    const track = document.createElement("div");
    track.className = "launcher-mobile-companions-track";
    panel.append(heading, status, track);
    host.append(toggle, panel);

    const style = document.createElement("style");
    style.id = "launcher-mobile-companions-style";
    style.textContent = [
      "#launcher-mobile-companions{position:fixed;right:8px;bottom:8px;z-index:2147483000;pointer-events:none;font:inherit;color:#f5f5f4}",
      "#launcher-mobile-companions button{pointer-events:auto;border:1px solid #78716c;border-radius:999px;background:#292524;color:#fff;padding:8px 14px;font:inherit;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.35)}",
      "#launcher-mobile-companions-panel{position:absolute;right:0;bottom:46px;width:min(92vw,440px);max-height:min(42vh,360px);box-sizing:border-box;display:flex;flex-direction:column;gap:7px;padding:9px;background:rgba(28,25,23,.97);border:1px solid #57534e;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.42);pointer-events:auto}",
      "#launcher-mobile-companions-panel[hidden]{display:none!important}",
      ".launcher-mobile-companions-heading{font-weight:700;font-size:13px}",
      ".launcher-mobile-companions-status{font-size:11px;color:#d6d3d1}",
      ".launcher-mobile-companions-track{display:flex;align-items:stretch;gap:8px;overflow-x:auto;overflow-y:auto;min-height:0;padding-bottom:3px;overscroll-behavior:contain}",
      ".launcher-mobile-companions-track>.companions-live-card{flex:0 0 min(48vw,180px);width:min(48vw,180px);max-width:180px;min-width:132px;min-height:0;box-sizing:border-box}",
      "@media(orientation:landscape){#launcher-mobile-companions-panel{max-height:56vh;width:min(72vw,560px)}}"
    ].join("");
    document.head.appendChild(style);
    document.body.appendChild(host);

    const entries = new Map();
    let opened = false;
    let queued = false;
    let stopped = false;

    function destroyEntry(id, entry) {
      try { live.destroyCard(entry.card); } catch (error) {
        console.warn("[Wayward Launcher] companion card cleanup failed", id, error);
      }
      if (entry.card && entry.card.el && entry.card.el.parentNode) {
        entry.card.el.parentNode.removeChild(entry.card.el);
      }
    }

    function scan() {
      queued = false;
      if (stopped) return;

      let state;
      let list;
      try {
        state = api.store.game();
        list = people.list(state);
        if (!Array.isArray(list)) list = [];
      } catch (error) {
        status.textContent = "동료 상태를 읽지 못했습니다.";
        console.warn("[Wayward Launcher] companion state read failed", error);
        return;
      }

      const keep = new Set(list.filter(person => person && person.id != null).map(person => String(person.id)));
      for (const [id, entry] of entries) {
        if (!keep.has(id)) {
          destroyEntry(id, entry);
          entries.delete(id);
        }
      }

      if (!opened) {
        status.textContent = list.length ? "동료 " + list.length + "명 · 눌러서 초상화 표시" : "등록된 동료가 없습니다.";
        return;
      }

      for (const person of list) {
        if (!person || person.id == null) continue;
        const id = String(person.id);
        let entry = entries.get(id);
        if (!entry) {
          try {
            const card = live.createCard(person.id);
            if (!card || !card.el) throw new Error("카드 요소가 반환되지 않았습니다.");
            track.appendChild(card.el);
            entry = { card };
            entries.set(id, entry);
          } catch (error) {
            console.warn("[Wayward Launcher] companion card creation failed", id, error);
            continue;
          }
        }
        try {
          live.updateCard(entry.card, state);
        } catch (error) {
          console.warn("[Wayward Launcher] companion card update failed", id, error);
        }
      }
      status.textContent = list.length ? "동료 " + list.length + "명" : "등록된 동료가 없습니다.";
    }

    function schedule() {
      if (queued || stopped) return;
      queued = true;
      requestAnimationFrame(scan);
    }

    function setOpened(value) {
      opened = Boolean(value);
      panel.hidden = !opened;
      toggle.setAttribute("aria-expanded", opened ? "true" : "false");
      toggle.textContent = opened ? "동료 닫기" : "동료";
      if (opened) schedule();
    }

    toggle.addEventListener("click", () => setOpened(!opened));

    const unsubscribe = live.subscribe(schedule);
    api.ui.settings(root => {
      root.append(
        api.ui.h("p", {}, "UI_customize를 켜지 않고 Companions의 원본 실시간 초상화를 런처 고정 패널에서 표시합니다."),
        api.ui.button("동료 실시간 창 열기", () => setOpened(true))
      );
    });

    api.provide({
      open() { setOpened(true); },
      close() { setOpened(false); },
      refresh: scan,
      ids: () => Array.from(entries.keys())
    });

    schedule();
    window.addEventListener("pagehide", () => {
      stopped = true;
      if (typeof unsubscribe === "function") unsubscribe();
      for (const [id, entry] of entries) destroyEntry(id, entry);
      entries.clear();
      if (host.parentNode) host.parentNode.removeChild(host);
      if (style.parentNode) style.parentNode.removeChild(style);
    }, { once: true });
  }
});
