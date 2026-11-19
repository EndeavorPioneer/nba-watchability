// ==UserScript==
// @name         NBA Watchability for iPhone Duo
// @namespace    nba-watchability-duo
// @version      2.0.0
// @description  Keep team logos visible and smoothly update live scores without reloading.
// @match        https://nba-watchability.streamlit.app/*
// @run-at       document-start
// @inject-into content
// @grant        none
// ==/UserScript==

(() => {
  "use strict";
  const appHost = "nba-watchability.streamlit.app";
  if (location.hostname !== appHost || location.pathname.startsWith("/-/")) return;
  const styleId = "nba-duo-style-v2";
  const frameSelector = "iframe";
  const rowSelector = ".menu-row:has(> .menu-matchup)";
  const lineSelector = ".menu-matchup .teamline, .rec-teamline";
  const imageSelector = ".menu-matchup img, .rec-teamline img";
  const cdnLogo = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nba\/(?:200|500)\/([a-z]{2,4})\.png$/i;
  const teams = {
    hawks: "ATL", celtics: "BOS", nets: "BKN", hornets: "CHA", bulls: "CHI",
    cavaliers: "CLE", mavericks: "DAL", nuggets: "DEN", pistons: "DET", warriors: "GSW",
    rockets: "HOU", pacers: "IND", clippers: "LAC", lakers: "LAL", grizzlies: "MEM",
    heat: "MIA", bucks: "MIL", timberwolves: "MIN", pelicans: "NO", knicks: "NYK",
    thunder: "OKC", magic: "ORL", "76ers": "PHI", suns: "PHX", "trail blazers": "POR",
    kings: "SAC", spurs: "SAS", raptors: "TOR", jazz: "UTAH", wizards: "WAS",
  };
  const logoUrl = (abbr) => `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;

  const css = `
    html .menu-matchup img, html .rec-teamline img, html .nba-duo-logo-fallback {
      flex: 0 0 34px; width: 34px; height: 34px; object-fit: contain;
    }
    html .nba-duo-logo-fallback {
      display: inline-grid; place-items: center; border-radius: 50%;
      box-sizing: border-box; border: 1px solid #777;
      font-size: 10px; font-weight: 700;
    }
    html [data-testid="stColumn"], html .rec-card, html .menu-row {
      min-inline-size: 0; max-inline-size: 100%;
    }
    /* The game card, not the browser viewport, determines if three columns fit. */
    html .menu-row[data-nba-duo-compact] {
      display: grid !important;
      grid-template-columns: minmax(0, 5.25rem) minmax(0, 1fr) !important;
      align-items: start !important; gap: .5rem .625rem !important;
    }
    html .menu-row[data-nba-duo-compact] > .menu-awi,
    html .menu-row[data-nba-duo-compact] > .menu-matchup,
    html .menu-row[data-nba-duo-compact] > .menu-meta {
      min-width: 0 !important; width: auto !important;
    }
    html .menu-row[data-nba-duo-compact] > .menu-meta {
      grid-column: 1 / -1 !important; padding-left: 0 !important;
    }
    html .menu-row[data-nba-duo-compact] .teamline {
      min-width: 0 !important; flex-wrap: nowrap !important; gap: .375rem !important;
    }
    html .menu-row[data-nba-duo-compact] .name,
    html .rec-teamline .name {
      min-width: 0 !important; white-space: normal !important; overflow-wrap: anywhere;
    }
    html .menu-row[data-nba-duo-compact] .record-inline {
      display: inline-block;
    }
    html .menu-row[data-nba-duo-compact] .matchup-badges {
      margin-left: 0 !important; max-width: 100%; gap: .25rem;
    }
    html .menu-row[data-nba-duo-compact] .badge,
    html .menu-row[data-nba-duo-compact] .chip {
      max-width: 100%; white-space: normal; overflow-wrap: anywhere;
    }
    html .menu-row[data-nba-duo-compact] .name-full { display: none !important; }
    html .menu-row[data-nba-duo-compact] .name-short { display: inline !important; }
    html .menu-row[data-nba-duo-tight] {
      grid-template-columns: minmax(0, 1fr) !important;
    }
    html .menu-row[data-nba-duo-tight] .menu-awi { grid-row: 2; }
    html .menu-row[data-nba-duo-tight] .menu-matchup { grid-row: 1; }
    html .menu-row[data-nba-duo-tight] .menu-meta { grid-row: 3; }
    @media (max-width: 640px), (pointer: coarse) {
      html [data-testid="stSegmentedControl"] [role="radiogroup"],
      html [data-testid="stButtonGroup"] [role="radiogroup"]:has(> button[data-variant="segmented_control"]) {
        display: flex; flex-wrap: wrap; width: 100%; overflow: visible;
      }
      html [data-testid="stSegmentedControl"] [role="radiogroup"] label,
      html [data-testid="stButtonGroup"] button[data-variant="segmented_control"] { min-height: 44px; }
    }
    @media (max-width: 640px) {
      html .block-container { padding-inline: 12px; }
    }
  `;

  function rootReady(doc, ready) {
    if (doc.documentElement) return ready(doc.documentElement);
    const wait = new MutationObserver(() => {
      if (!doc.documentElement) return;
      wait.disconnect();
      ready(doc.documentElement);
    });
    wait.observe(doc, { childList: true });
  }

  function each(node, selector, callback) {
    if (node.nodeType === 1 && node.matches(selector)) callback(node);
    if (node.querySelectorAll) node.querySelectorAll(selector).forEach(callback);
  }

  function install(doc, inspectFrame) {
    rootReady(doc, (root) => {
      if (doc.getElementById(styleId)) return;
      const style = doc.createElement("style");
      style.id = styleId;
      style.textContent = css;
      (doc.head || root).append(style);

      function sizeRow(row, width = row.getBoundingClientRect().width) {
        if (!width) return;
        row.toggleAttribute("data-nba-duo-compact", width < 600);
        row.toggleAttribute("data-nba-duo-tight", width < 240);
      }

      const rows = new ResizeObserver((entries) => {
        for (const entry of entries) sizeRow(entry.target, entry.contentRect.width);
      });

      function repairImage(img) {
        const match = (img.getAttribute("src") || "").match(cdnLogo);
        if (!match || img.hasAttribute("data-nba-duo-prepared")) return;
        img.setAttribute("data-nba-duo-prepared", "");
        if (!img.hasAttribute("alt")) img.alt = "";
        const abbr = match[1].toUpperCase();
        const corrected = logoUrl(abbr);
        function onFailure() {
          if (!img.isConnected) return;
          if (img.getAttribute("src") !== corrected) {
            img.src = corrected;
            return;
          }
          const fallback = doc.createElement("span");
          fallback.className = "nba-duo-logo-fallback";
          fallback.setAttribute("aria-hidden", "true");
          fallback.textContent = abbr;
          img.replaceWith(fallback);
        }
        img.addEventListener("error", onFailure);
        if (img.complete && img.naturalWidth === 0) onFailure();
      }

      function recoverMissing(line) {
        if (line.querySelector("img, .nba-duo-logo-fallback")) return;
        const shortName = (line.querySelector(".name-short")?.textContent || "").trim().toLowerCase();
        const abbr = teams[shortName];
        if (!abbr) return;
        const img = doc.createElement("img");
        img.src = logoUrl(abbr);
        img.alt = "";
        line.prepend(img);
        repairImage(img);
      }

      function scan(node) {
        each(node, rowSelector, (row) => {
          sizeRow(row);
          rows.observe(row);
        });
        each(node, imageSelector, repairImage);
        each(node, lineSelector, recoverMissing);
        if (inspectFrame) each(node, frameSelector, inspectFrame);
      }
      scan(doc);
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          record.removedNodes.forEach((node) => each(node, rowSelector, (row) => rows.unobserve(row)));
          record.addedNodes.forEach(scan);
        }
      });
      observer.observe(root, { subtree: true, childList: true });
    });
  }

  // Safari userscript extensions don't all inject in frames. The Streamlit app
  // may sit in a same-origin iframe, so apply the repair there from the top too.
  const frameSeen = new WeakSet();
  function appDocument(frame) {
    try {
      const doc = frame.contentDocument;
      if (doc?.location.hostname === appHost && !doc.location.pathname.startsWith("/-/")) return doc;
    } catch (_) { /* Leave cross-origin and unrelated frames alone. */ }
    return null;
  }
  function inspectFrame(frame) {
    function apply() {
      const doc = appDocument(frame);
      if (doc) install(doc, inspectFrame);
    }
    if (!frameSeen.has(frame)) {
      frameSeen.add(frame);
      frame.addEventListener("load", apply);
    }
    apply();
  }

  install(document, inspectFrame);
})();

(() => {
function startNbaDuoLiveScores(root, { hosted = false, intervalMs = 20_000 } = {}) {
  const doc = root.document;
  const key = "__nbaDuoLiveScoresV2";
  if (root[key]) return () => {};
  const stopToken = {};
  root[key] = stopToken;
  const getApp = () => {
    if (!hosted) return doc;
    try {
      return doc.querySelector('iframe[title="streamlitApp"]')?.contentDocument || doc;
    } catch { return doc; }
  };
  let scoreCache = new Map();
  let lastAttempt = 0;
  let pending = null;
  let stopped = false;
  let timeoutId;
  let bootstrapId;
  let observer;
  let observing;
  const rowState = new WeakMap();

  function gameId(row) {
    for (const link of row.querySelectorAll('a[href*="gameId/"]')) {
      try {
        const url = new URL(link.href);
        if (url.protocol === "https:" && /^(www\.)?espn\.com$/.test(url.hostname)) {
          const id = url.pathname.match(/^\/nba\/game\/(?:[^/]+\/)*gameId\/(\d+)(?:\/|$)/)?.[1];
          if (id) return id;
        }
      } catch { /* Ignore malformed links. */ }
    }
    return undefined;
  }

  const dayStamp = (offset) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10).replaceAll("-", "");
  };

  function parseGames(payload) {
    const result = new Map();
    for (const event of payload.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      const status = competition.status || event.status;
      const phase = status?.type?.state;
      if (phase !== "in" && !(phase === "post" && status?.type?.completed === true)) continue;
      const away = competition.competitors?.find(c => c.homeAway === "away")?.score;
      const home = competition.competitors?.find(c => c.homeAway === "home")?.score;
      if (!/^\d+$/.test(String(away)) || !/^\d+$/.test(String(home))) continue;
      const detail = String(status.type.shortDetail || status.type.detail || (phase === "post" ? "Final" : "LIVE")).slice(0, 60);
      result.set(String(event.id), { phase, detail, score: away + " - " + home });
    }
    return result;
  }

  function refreshRow(row, game) {
    let info = rowState.get(row);
    const stub = row.querySelector(".live-time,.live-badge,.rec-live,.rec-score");
    if (game.phase === "post" && !info && !stub) return;
    const host = row.querySelector(".menu-awi,.rec-meta");
    if (!host) return;
    if (!info || !info.panel.isConnected) {
      const panel = row.ownerDocument.createElement("div");
      const detail = row.ownerDocument.createElement("div");
      const score = row.ownerDocument.createElement("div");
      panel.className = "nba-duo-live-score";
      detail.className = host.matches(".menu-awi") ? "live-time" : "rec-live";
      score.className = host.matches(".menu-awi") ? "live-badge" : "rec-score";
      panel.append(detail,score);
      for (const old of row.querySelectorAll(".live-time,.live-badge,.rec-live,.rec-score")) old.hidden = true;
      host.append(panel);
      info = {panel, detail, score, value: "", generation: 0};
      rowState.set(row,info);
    }
    const detailText = game.phase === "in" && !/^LIVE\b/i.test(game.detail) ? "LIVE · " + game.detail : game.detail;
    const value = detailText + "|" + game.score;
    if (value === info.value) return;
    const full = ++info.generation;
    const animate = Boolean(info.value) &&
      !root.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      typeof info.panel.animate === "function";
    info.value = value;
    const put = () => {
      if (stopped || full !== info.generation || !info.panel.isConnected) return;
      info.detail.textContent = detailText;
      info.score.textContent = game.score;
      if (animate) info.panel.animate([{opacity: 0.18},{opacity: 1}], {duration: 180,easing:"ease-out"});
    };
    if (animate) {
      const out = info.panel.animate([{opacity: 1},{opacity: 0.18}], {duration: 100, easing:"ease-in", fill:"forwards"});
      out.finished.then(() => {out.cancel(); put();}, put);
    } else put();
  }

  function watch(app) {
    if (observing === app) return;
    observer?.disconnect();
    observing = app;
    if (!app.documentElement) { observing = null; return; }
    observer = new root.MutationObserver(records => {
      if (!records.some(r => [...r.addedNodes].some(n =>
        n.nodeType === 1 && (n.matches(".menu-row,.rec-row") || n.querySelector(".menu-row,.rec-row"))
      ))) return;
      root.clearTimeout(timeoutId);
      timeoutId = root.setTimeout(tick, 100);
    });
    observer.observe(app.documentElement, { childList: true, subtree: true });
  }

  async function tick() {
    if (stopped || doc.visibilityState !== "visible") return;
    const app = getApp();
    watch(app);
    const rows = Array.from(app.querySelectorAll(".menu-row,.rec-row"), r => [r,gameId(r)]).filter(([,id]) => id);
    if (!rows.length) return;
    const apply = () => { for (const [r,id] of rows) if (r.isConnected && scoreCache.has(id)) refreshRow(r,scoreCache.get(id)); };
    apply();
    if (pending || Date.now() - lastAttempt < 1_500) return;
    const api = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
    const url = api + "?dates=" + dayStamp(-1) + "-" + dayStamp(1) + "&limit=100";
    const controller = new AbortController();
    pending = controller;
    lastAttempt = Date.now();
    const requestTimeout = root.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await root.fetch(url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok || stopped) return;
      scoreCache = parseGames(await response.json());
      if (!stopped && doc.visibilityState === "visible" && getApp() === app) apply();
    } catch { /* Preserve the displayed score when ESPN is unavailable. */ }
    finally { root.clearTimeout(requestTimeout); pending = null; }
  }

  const visible = () => { if (doc.visibilityState === "visible") tick(); };
  const onLoad = event => { if (event.target?.matches?.('iframe[title="streamlitApp"]')) tick(); };
  const onShow = event => { if (event.persisted) visible(); };
  doc.addEventListener("visibilitychange", visible);
  doc.addEventListener("DOMContentLoaded", visible);
  root.addEventListener("load", onLoad, true);
  root.addEventListener("pageshow", onShow);
  const interval = root.setInterval(tick, intervalMs);
  function bootstrap(tries) {
    tick();
    if (!stopped && !lastAttempt && tries > 0) bootstrapId = root.setTimeout(() => bootstrap(tries - 1), 500);
  }
  bootstrap(12);
  return () => {
    stopped = true;
    pending?.abort();
    observer?.disconnect();
    root.clearInterval(interval);
    root.clearTimeout(bootstrapId);
    root.clearTimeout(timeoutId);
    doc.removeEventListener("visibilitychange", visible);
    doc.removeEventListener("DOMContentLoaded", visible);
    root.removeEventListener("load", onLoad, true);
    root.removeEventListener("pageshow", onShow);
    if (root[key] === stopToken) delete root[key];
  };
}

  if (location.hostname === "nba-watchability.streamlit.app" &&
      !location.pathname.startsWith("/-/") && window.self === window.top) {
    startNbaDuoLiveScores(window, { hosted: true });
  }
})();
