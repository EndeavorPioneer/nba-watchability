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
