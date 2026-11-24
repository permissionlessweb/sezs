/* SEZS calendars: public (timeline + Cal.com discovery + NIP-52) | private (holds only). A hold is not attendance. */
(function (root) {
  "use strict";

  var RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
  var TAG = "sezs-speakeasy";
  var NIGHT = "2026-10-18";
  var DEFAULT_SLUG = "sezs-speakeasy/discovery";
  var CAL_ORIGIN_KEY = "sezs-cal-origin";
  var DEFAULT_CAL_ORIGIN = "https://cal.com";
  var CAL_LINK_KEY = "sezs-cal-link";
  var KEY = "sezs-reservations-v1";
  var KEY_BAK = KEY + ".bak";
  var NIP_FETCH_KINDS = [31922, 31923, 31924];
  var FETCH_MS = 4000;
  var PUBLISH_MS = 1500;

  var PUBLIC_TIMELINE = [
    { t: "19:00", title: "Doors · check-in", where: "Door", d: "doors" },
    { t: "20:00", title: "Morphics", where: "Cellar", d: "morphics" },
    { t: "20:50", title: "Trey", where: "Cellar", d: "trey" },
    { t: "21:40", title: "Treebug", where: "Cellar", d: "treebug" },
    { t: "22:20", title: "Bodywork · poem desk", where: "Alcove", d: "bodywork" },
    { t: "22:30", title: "Chris Baker", where: "Cellar", d: "chris" },
    { t: "22:00", title: "Live painting", where: "Floor", d: "paint" },
    { t: "23:20", title: "babypufff", where: "Cellar", d: "babypufff" },
    { t: "00:00", title: "Limbus · raffle draw", where: "Floor", d: "limbus" },
    { t: "00:50", title: "Howhippie", where: "Cellar", d: "howhippie" },
    { t: "Late", title: "The void", where: "Back", d: "void" }
  ];

  var RESERVE_KINDS = [
    { id: "hydro", label: "Hydromassage" },
    { id: "needle", label: "Dry needling" },
    { id: "iv", label: "IV therapy" },
    { id: "bodywork", label: "Bodywork alcove" },
    { id: "ink", label: "Ink chair" }
  ];

  function $(sel, elRoot) { return (elRoot || document).querySelector(sel); }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function storageGet(key) {
    try {
      if (typeof localStorage === "undefined") return "";
      return localStorage.getItem(key) || "";
    } catch (_) {
      return "";
    }
  }
  function storageSet(key, val) {
    if (typeof localStorage === "undefined") throw new Error("no storage");
    localStorage.setItem(key, val);
  }
  function parseSlug(raw) {
    var v = String(raw == null ? "" : raw).trim();
    v = v.replace(/^https?:\/\/cal\.com\//i, "");
    v = v.replace(/^https?:\/\/cal\.terp\.network\//i, "");
    v = v.split("?")[0].split("#")[0].replace(/^\/+/, "").replace(/\/+$/, "");
    if (!v || !/^[A-Za-z0-9._/-]+$/.test(v)) return "";
    return v;
  }
  function calOrigin() {
    var o = String(storageGet(CAL_ORIGIN_KEY) || DEFAULT_CAL_ORIGIN).trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(o)) return DEFAULT_CAL_ORIGIN;
    return o;
  }
  function calLink() {
    return parseSlug(storageGet(CAL_LINK_KEY)) || DEFAULT_SLUG;
  }
  function embedUrl(slug) {
    return calOrigin() + "/" + (parseSlug(slug) || DEFAULT_SLUG) + "?embed=true&theme=dark";
  }
  function kindOf(id) {
    var i, k;
    for (i = 0; i < RESERVE_KINDS.length; i++) {
      k = RESERVE_KINDS[i];
      if (k.id === id) return k;
    }
    return null;
  }
  function parseHolds(raw) {
    if (!raw) return null;
    var o, i, r, k, start, who, out;
    try { o = JSON.parse(raw); } catch (_) { return null; }
    if (!Array.isArray(o)) return null;
    out = [];
    for (i = 0; i < o.length; i++) {
      r = o[i];
      if (!r || typeof r !== "object") continue;
      if (typeof r.id !== "string" || !r.id) continue;
      k = kindOf(r.kind);
      if (!k) continue;
      if (typeof r.who !== "string") continue;
      who = r.who.trim();
      if (!who) continue;
      start = new Date(r.start);
      if (Number.isNaN(start.getTime())) continue;
      out.push({ id: r.id, kind: k.id, label: k.label, who: who, start: start.toISOString() });
    }
    if (o.length && out.length === 0) return null;
    return out;
  }
  function loadHolds() {
    var a = parseHolds(storageGet(KEY));
    if (a) return a;
    return parseHolds(storageGet(KEY_BAK)) || [];
  }
  function saveHolds(rows) {
    if (!Array.isArray(rows)) return false;
    try {
      var json = JSON.stringify(rows);
      var prev = storageGet(KEY);
      if (prev && parseHolds(prev)) storageSet(KEY_BAK, prev);
      storageSet(KEY, json);
      return true;
    } catch (_) {
      return false;
    }
  }
  function holdRow(kindId, who, when, id) {
    var k = kindOf(kindId);
    var w = String(who == null ? "" : who).trim();
    var start;
    if (!k || !w || !when) return null;
    start = new Date(when);
    if (Number.isNaN(start.getTime())) return null;
    return { id: id || "", kind: k.id, label: k.label, who: w, start: start.toISOString() };
  }
  function holdId() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return "";
  }
  function nightEvents(pubkey, created) {
    var out = [];
    var i = 0;
    PUBLIC_TIMELINE.forEach(function (row) {
      if (row.t === "Late") return;
      var parts = String(row.t).split(":");
      var hh = parts[0] || "";
      var mm = parts[1] || "";
      var day, startMs, start, end, D;
      if (!/^\d{2}$/.test(hh) || !/^\d{2}$/.test(mm)) return;
      day = String(row.t).slice(0, 2) === "00" ? "2026-10-19" : NIGHT;
      startMs = new Date(day + "T" + hh + ":" + mm + ":00").getTime();
      if (!Number.isFinite(startMs)) return;
      start = Math.floor(startMs / 1000);
      end = start + 50 * 60;
      D = String(Math.floor(start / 86400));
      out.push({
        kind: 31923,
        pubkey: pubkey,
        created_at: created + i,
        content: row.title + " · SEZS Speakeasy",
        tags: [
          ["d", "sezs-" + row.d],
          ["title", row.title],
          ["start", String(start)],
          ["end", String(end)],
          ["D", D],
          ["location", row.where],
          ["t", TAG]
        ]
      });
      i += 1;
    });
    return out;
  }

  function mountPublic(elRoot, opts) {
    var base = (opts && opts.lineupBase) || "sezs/lineup.html";
    var tl, frame;
    elRoot.innerHTML =
      '<div class="cal-board" data-plane="public">' +
        '<div class="cal-col">' +
          "<h3>October 18</h3>" +
          '<p class="muted">Public timeline. Sets, vendors, rooms.</p>' +
          '<ol class="timeline" id="tl"></ol>' +
        "</div>" +
        '<div class="cal-col person" id="discovery">' +
          "<h3>Discovery · 20 min</h3>" +
          '<p class="muted">Cal.com on this board. Discovery, not a paid ticket.</p>' +
          "<label>Cal.com link</label>" +
          '<div class="row">' +
            '<input id="calLinkIn" value="' + escapeHtml(calLink()) + '" />' +
            '<button class="btn ghost" id="saveCal">Use</button>' +
          "</div>" +
          '<button class="btn ghost" id="loadCal" type="button">Load Cal.com</button>' +
          '<iframe id="calFrame" title="Cal.com discovery" class="cal-embed" loading="lazy" hidden></iframe>' +
        "</div>" +
        '<div class="cal-col">' +
          "<h3>Nostr NIP-52</h3>" +
          '<p class="muted">kind 31923 time-based events tagged <span class="mono">' + escapeHtml(TAG) + "</span>. Relays: Damus, nos.lol, Primal.</p>" +
          '<div class="cta-row" style="justify-content:flex-start;margin:.6rem 0;">' +
            '<button class="btn" id="nipFetch">Fetch</button>' +
            '<button class="btn ghost" id="nipPub">Publish night</button>' +
          "</div>" +
          '<p class="msg" id="nipMsg"></p>' +
          '<ul id="nipList" class="muted"></ul>' +
        "</div>" +
      "</div>";
    tl = $("#tl", elRoot);
    PUBLIC_TIMELINE.forEach(function (row) {
      tl.appendChild(el(
        "<li><span class=\"mono\">" + escapeHtml(row.t) + "</span> <a href=\"" +
        escapeHtml(base) + "#" + encodeURIComponent(row.d) + "\">" + escapeHtml(row.title) +
        "</a> <em>" + escapeHtml(row.where) + "</em></li>"
      ));
    });
    frame = $("#calFrame", elRoot);
    function setFrame() {
      var link = calLink();
      $("#calLinkIn", elRoot).value = link;
      frame.hidden = false;
      frame.src = embedUrl(link);
    }
    $("#loadCal", elRoot).onclick = function () { setFrame(); };
    $("#saveCal", elRoot).onclick = function () {
      var v = parseSlug($("#calLinkIn", elRoot).value);
      if (!v) return;
      try { storageSet(CAL_LINK_KEY, v); } catch (_) {}
      $("#calLinkIn", elRoot).value = v;
    };
    try {
      if (typeof location !== "undefined" && location.hash === "#discovery") setFrame();
    } catch (_) {}
    $("#nipFetch", elRoot).onclick = function () { nipFetch(elRoot); };
    $("#nipPub", elRoot).onclick = function () { nipPublishNight(elRoot); };
    try {
      if (typeof location !== "undefined" && location.hash === "#discovery") {
        var col = $("#discovery", elRoot);
        if (col && col.scrollIntoView) col.scrollIntoView();
      }
    } catch (_) {}
  }

  function mountPrivate(elRoot) {
    elRoot.innerHTML =
      '<div class="cal-board" data-plane="private">' +
        '<div class="cal-col">' +
          "<h3>Reservations</h3>" +
          '<p class="muted">Private. Hydromassage, dry needling, IV, bodywork, ink. A hold is not attendance. No Cal.com.</p>' +
          '<div class="row">' +
            "<div>" +
              "<label>What</label>" +
              '<select id="rk">' + RESERVE_KINDS.map(function (k) {
                return '<option value="' + escapeHtml(k.id) + '">' + escapeHtml(k.label) + "</option>";
              }).join("") + "</select>" +
            "</div>" +
            "<div>" +
              "<label>Name / alias</label>" +
              '<input id="who" />' +
            "</div>" +
          "</div>" +
          "<label>When</label>" +
          '<input type="datetime-local" id="when" />' +
          '<div class="cta-row" style="justify-content:flex-start;margin-top:1rem;">' +
            '<button class="btn" id="hold">Hold 20 min</button>' +
          "</div>" +
          '<p class="msg" id="rMsg"></p>' +
        "</div>" +
        '<div class="cal-col">' +
          "<h3>Booked</h3>" +
          "<table><thead><tr><th>When</th><th>What</th><th></th></tr></thead><tbody id=\"rTable\"></tbody></table>" +
        "</div>" +
      "</div>";
    function render() {
      var rows = loadHolds().slice().sort(function (a, b) { return a.start.localeCompare(b.start); });
      $("#rTable", elRoot).innerHTML = rows.map(function (r) {
        var d = new Date(r.start);
        var when = Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        return "<tr><td>" + escapeHtml(when) + "</td><td>" + escapeHtml(r.label) + " · " + escapeHtml(r.who) +
          '</td><td><button class="btn ghost" data-id="' + escapeHtml(r.id) + '">Drop</button></td></tr>';
      }).join("") || '<tr><td colspan="3" class="muted">None.</td></tr>';
    }
    $("#hold", elRoot).onclick = function () {
      var msg = $("#rMsg", elRoot);
      var id = holdId();
      var row = holdRow($("#rk", elRoot).value, $("#who", elRoot).value, $("#when", elRoot).value, id);
      if (!row || !id) {
        msg.className = "msg bad";
        msg.textContent = "Need a name and a time.";
        return;
      }
      var rows = loadHolds();
      var i;
      for (i = 0; i < rows.length; i++) {
        if (rows[i].kind === row.kind && rows[i].start === row.start) {
          msg.className = "msg bad";
          msg.textContent = "Slot taken.";
          return;
        }
      }
      rows.push(row);
      if (!saveHolds(rows)) return;
      msg.className = "msg ok";
      msg.textContent = "Held.";
      render();
    };
    $("#rTable", elRoot).addEventListener("click", function (e) {
      var b = e.target.closest("button[data-id]");
      if (!b) return;
      saveHolds(loadHolds().filter(function (r) { return r.id !== b.dataset.id; }));
      render();
    });
    render();
  }

  function tag(ev, name) {
    var t = (ev.tags || []).find(function (x) { return x[0] === name; });
    return t ? t[1] : "";
  }

  function nipFetch(elRoot) {
    var list = $("#nipList", elRoot);
    var msg = $("#nipMsg", elRoot);
    var seen = new Map();
    var open = 0;
    msg.className = "msg";
    msg.textContent = "Asking relays…";
    list.innerHTML = "";
    RELAYS.forEach(function (url) {
      var ws, sub;
      try { ws = new WebSocket(url); } catch (_) { return; }
      open += 1;
      sub = "sezs" + Math.random().toString(36).slice(2, 8);
      ws.onopen = function () {
        try {
          ws.send(JSON.stringify(["REQ", sub, { kinds: NIP_FETCH_KINDS.slice(), "#t": [TAG], limit: 40 }]));
        } catch (_) {}
        setTimeout(function () {
          try { ws.send(JSON.stringify(["CLOSE", sub])); ws.close(); } catch (_) {}
        }, FETCH_MS);
      };
      ws.onmessage = function (ev) {
        var msgd, n, title, start;
        try { msgd = JSON.parse(ev.data); } catch (_) { return; }
        if (msgd[0] !== "EVENT") return;
        n = msgd[2];
        if (!n || !n.id || seen.has(n.id)) return;
        if (NIP_FETCH_KINDS.indexOf(n.kind) < 0) return;
        seen.set(n.id, n);
        title = tag(n, "title") || n.content || String(n.id).slice(0, 8);
        start = tag(n, "start");
        list.appendChild(el(
          '<li class="mono">' + escapeHtml(String(n.kind)) + " · " + escapeHtml(title) + " · " + escapeHtml(start) + "</li>"
        ));
      };
      ws.onerror = function () { try { ws.close(); } catch (_) {} };
      ws.onclose = function () {
        open -= 1;
        if (open <= 0) msg.textContent = seen.size ? seen.size + " NIP-52 events." : "No tagged events on those relays yet.";
      };
    });
    if (!open) msg.textContent = "No tagged events on those relays yet.";
  }

  async function nipPublishNight(elRoot) {
    var msg = $("#nipMsg", elRoot);
    var pubkey, events, n, i, unsigned, signed;
    if (!msg) return;
    if (!root.nostr || !root.nostr.signEvent) {
      msg.className = "msg bad";
      msg.textContent = "Needs a NIP-07 extension to sign. Timeline still shows locally.";
      return;
    }
    try { pubkey = await root.nostr.getPublicKey(); } catch (_) {
      msg.className = "msg bad";
      msg.textContent = "Needs a NIP-07 extension to sign. Timeline still shows locally.";
      return;
    }
    events = nightEvents(pubkey, Math.floor(Date.now() / 1000));
    msg.textContent = "Signing…";
    n = 0;
    for (i = 0; i < events.length; i++) {
      unsigned = events[i];
      try { signed = await root.nostr.signEvent(unsigned); } catch (_) { continue; }
      n += 1;
      RELAYS.forEach(function (url) {
        var ws;
        try { ws = new WebSocket(url); } catch (_) { return; }
        ws.onopen = function () {
          try { ws.send(JSON.stringify(["EVENT", signed])); } catch (_) {}
          setTimeout(function () { try { ws.close(); } catch (_) {} }, PUBLISH_MS);
        };
        ws.onerror = function () { try { ws.close(); } catch (_) {} };
      });
    }
    if (!n) {
      msg.className = "msg bad";
      msg.textContent = "Needs a NIP-07 extension to sign. Timeline still shows locally.";
      return;
    }
    msg.className = "msg ok";
    msg.textContent = "Published " + n + " kind 31923 events.";
  }

  var api = {
    mountPublic: mountPublic,
    mountPrivate: mountPrivate,
    PUBLIC_TIMELINE: PUBLIC_TIMELINE,
    RESERVE_KINDS: RESERVE_KINDS,
    RELAYS: RELAYS,
    TAG: TAG,
    NIGHT: NIGHT,
    DEFAULT_SLUG: DEFAULT_SLUG,
    CAL_LINK_KEY: CAL_LINK_KEY,
    KEY: KEY,
    KEY_BAK: KEY_BAK,
    NIP_FETCH_KINDS: NIP_FETCH_KINDS,
    escapeHtml: escapeHtml,
    parseSlug: parseSlug,
    parseHolds: parseHolds,
    loadHolds: loadHolds,
    saveHolds: saveHolds,
    holdRow: holdRow,
    calLink: calLink,
    embedUrl: embedUrl,
    nightEvents: nightEvents
  };

  root.SEZSCal = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
