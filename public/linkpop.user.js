// ==UserScript==
// @name         LinkPop – send page links
// @namespace    https://link-nest-for-later.lovable.app
// @version      1.0
// @description  Purple button that sends this page's download links to LinkPop
// @match        *://*/*
// @exclude      https://link-nest-for-later.lovable.app/*
// @grant        none
// ==/UserScript==
(function () {
  "use strict";
  if (window.top !== window.self) return;
  const APP = "https://link-nest-for-later.lovable.app/";
  const EXT = /\.(mkv|mp4|avi|mov|m4v|webm|zip|rar|7z|iso|mp3|flac|srt|pdf|exe|tar|gz)(\?|#|$)/i;
  const HOSTS =
    /(cdn|vikingfile|pixeldrain|gofile|mega|mediafire|drive\.google|dropbox|download|file)/i;

  function collect() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const u = a.href;
      if (!/^https?:/i.test(u) || seen.has(u)) continue;
      let path = "";
      try {
        path = new URL(u).pathname;
      } catch {
        continue;
      }
      if (!EXT.test(path) && !EXT.test(u) && !(HOSTS.test(u) && path.length > 1)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }

  const btn = document.createElement("button");
  btn.textContent = "🔗 LinkPop";
  btn.title = "Send links on this page to LinkPop (Shift-click: send ALL links)";
  Object.assign(btn.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 2147483647,
    background: "linear-gradient(135deg,#d946ef,#7c3aed)",
    color: "#fff",
    border: "none",
    borderRadius: "999px",
    padding: "10px 16px",
    font: "600 14px system-ui,sans-serif",
    boxShadow: "0 6px 18px rgba(124,58,237,.45)",
    cursor: "pointer",
  });
  btn.addEventListener("click", (e) => {
    let links = collect();
    if (e.shiftKey || !links.length) {
      links = [
        ...new Set(
          [...document.querySelectorAll("a[href]")]
            .map((a) => a.href)
            .filter((u) => /^https?:/i.test(u)),
        ),
      ];
    }
    if (!links.length) {
      btn.textContent = "No links";
      setTimeout(() => (btn.textContent = "🔗 LinkPop"), 1500);
      return;
    }
    window.open(APP + "#add=" + encodeURIComponent(links.join("\n")), "linkpop");
    btn.textContent = "✓ Sent " + links.length;
    setTimeout(() => (btn.textContent = "🔗 LinkPop"), 2000);
  });
  document.body.appendChild(btn);
})();
