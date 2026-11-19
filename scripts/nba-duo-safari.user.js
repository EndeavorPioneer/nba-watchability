// ==UserScript==
// @name         NBA Watchability for iPhone Duo
// @namespace    nba-watchability-duo
// @version      1.0.0
// @description  Reload when returning to the scoreboard and help the live site's game cards fit Safari.
// @match        https://nba-watchability.streamlit.app/*
// @run-at       document-end
// @inject-into content
// @grant        none
// ==/UserScript==

(() => {
  "use strict";
  if (location.hostname !== "nba-watchability.streamlit.app") return;
  if (location.pathname.startsWith("/-/")) return;

  // The Streamlit app runs in a same-origin iframe. Reload only the outer
  // page so one return to Safari does not cause two reloads.
  if (window.self === window.top) {
    let wasHidden = document.visibilityState === "hidden";
    let reloading = false;
    const reloadOnReturn = () => {
      if (reloading || document.visibilityState !== "visible") return;
      reloading = true;
      location.reload();
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
      } else if (wasHidden) {
        wasHidden = false;
        reloadOnReturn();
      }
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) reloadOnReturn();
    });
  }

  const style = document.createElement("style");
  style.textContent = `
    html .menu-matchup img, html .rec-teamline img, html .nba-duo-logo-fallback {
      flex: 0 0 34px; width: 34px; height: 34px; object-fit: contain;
    }
    html .nba-duo-logo-fallback {
      display: inline-grid; place-items: center; border-radius: 50%;
      box-sizing: border-box; border: 1px solid #777;
      font-size: 10px; font-weight: 700;
    }
    @media (max-width: 640px) {
      html .block-container { padding-inline: 12px; }
      html .menu-row {
        display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px;
      }
      html .menu-awi { width: auto; }
      html .menu-matchup .teamline { flex-wrap: nowrap; }
      html .menu-matchup .name { white-space: normal; overflow-wrap: anywhere; }
      html .menu-meta {
        grid-column: 1 / -1; width: auto; padding-left: 0;
      }
      html [data-testid="stSegmentedControl"] [role="radiogroup"] {
        flex-wrap: wrap; max-width: 100%; overflow: visible;
      }
      html [data-testid="stSegmentedControl"] [role="radiogroup"] label { min-height: 44px; }
    }
    @media (max-width: 400px) {
      html .menu-matchup img, html .rec-teamline img, html .nba-duo-logo-fallback {
        flex-basis: 28px; width: 28px; height: 28px;
      }
      html .matchup-badges { margin-left: 0; }
    }
  `;
  (document.head || document.documentElement).append(style);

  const imageSelector = ".menu-matchup img, .rec-teamline img";
  const cdnLogo = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nba\/(?:200|500)\/([a-z]{2,4})\.png$/i;

  function repairImage(img) {
    if (img.dataset.nbaDuoPrepared) return;
    const original = img.getAttribute("src") || "";
    const match = original.match(cdnLogo);
    if (!match) return;
    img.dataset.nbaDuoPrepared = "true";
    if (!img.hasAttribute("alt")) img.alt = "";
    const abbr = match[1].toUpperCase();
    const corrected = "https://a.espncdn.com/i/teamlogos/nba/500/" + abbr.toLowerCase() + ".png";

    function onFailure() {
      if (img.getAttribute("src") !== corrected) {
        img.src = corrected;
        return;
      }
      const fallback = document.createElement("span");
      fallback.className = "nba-duo-logo-fallback";
      fallback.setAttribute("aria-hidden", "true"); // Adjacent team name stays visible.
      fallback.textContent = abbr;
      img.replaceWith(fallback);
    }
    img.addEventListener("error", onFailure);
    if (img.complete && img.naturalWidth === 0) onFailure();
  }

  function scan(root) {
    if (root instanceof Element && root.matches(imageSelector)) repairImage(root);
    if (root.querySelectorAll) root.querySelectorAll(imageSelector).forEach(repairImage);
  }
  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scan);
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
