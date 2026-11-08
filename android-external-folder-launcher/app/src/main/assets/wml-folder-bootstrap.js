(function () {
  try {
    var bridge = window.WMLHost;
    if (!bridge || typeof bridge.listModIds !== "function") return;
    var r = JSON.parse(bridge.listModIds());
    if (!r || r.ok !== true || !Array.isArray(r.ids)) return;
    var ids = [], seen = Object.create(null);
    for (var i = 0; i < r.ids.length; i++) {
      var id = r.ids[i];
      if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || seen[id]) continue;
      seen[id] = true;
      ids.push(id);
    }
    localStorage.setItem("wml.folders", JSON.stringify(ids));
  } catch (e) {
    console.warn("[Wayward Launcher] folder scan skipped", e);
  }
})();
