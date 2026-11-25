(() => {
  if (window.__kpotifyLoaded) return;
  window.__kpotifyLoaded = true;

  const STORAGE_MODE_KEY = "kpotify:mode:v1";
  const STORAGE_CACHE_KEY = "kpotify:cache:v1";
  const MAX_CACHE_ENTRIES = 3000;
  const BATCH_MAX_LINES = 20;
  const BATCH_MAX_ENCODED_LEN = 1600;

  // Modes: "both" (원문+번역), "ko" (번역만), "off" (끄기)
  let currentMode = localStorage.getItem(STORAGE_MODE_KEY) || "both";
  if (!["both", "ko", "off"].includes(currentMode)) currentMode = "both";

  /** @type {Map<string, string>} */
  const cache = new Map();
  /** @type {Set<string>} */
  const inFlight = new Set();
  /** @type {Set<string>} */
  const queuedTexts = new Set();

  let scanTimer = null;
  let isProcessingQueue = false;
  let pillEl = null;
  let menuEl = null;
  let statusBadgeEl = null;
  let lastErrorMsg = "";

  function loadCache() {
    try {
      const raw = localStorage.getItem(STORAGE_CACHE_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) {
        for (const [k, v] of entries) {
          if (typeof k === "string" && typeof v === "string") {
            cache.set(k, v);
          }
        }
      }
    } catch {
      // Ignore corrupted cache
    }
  }

  let saveCacheTimer = null;
  function scheduleSaveCache() {
    if (saveCacheTimer) return;
    saveCacheTimer = setTimeout(() => {
      saveCacheTimer = null;
      try {
        while (cache.size > MAX_CACHE_ENTRIES) {
          const oldestKey = cache.keys().next().value;
          cache.delete(oldestKey);
        }
        localStorage.setItem(
          STORAGE_CACHE_KEY,
          JSON.stringify(Array.from(cache.entries()))
        );
      } catch {
        // Ignore storage quota errors
      }
    }, 1000);
  }

  function injectStyles() {
    if (document.getElementById("kpotify-styles")) return;
    const style = document.createElement("style");
    style.id = "kpotify-styles";
    style.textContent = `
      .kpotify-ko-line {
        display: block;
        opacity: 0.72;
        font-size: 0.62em;
        font-weight: 400;
        line-height: 1.35;
        margin-top: 2px;
        font-family: "Pretendard Variable", "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
        word-break: keep-all;
        transition: opacity 0.15s ease;
      }
      body.kpotify-mode-off .kpotify-ko-line {
        display: none !important;
      }
      body.kpotify-mode-ko [data-testid="lyrics-line"] > div:not(.kpotify-ko-line):first-child {
        display: none !important;
      }
      body.kpotify-mode-ko .kpotify-ko-line {
        opacity: 1;
        font-size: 1em;
        font-weight: 700;
        margin-top: 0;
      }

      #kpotify-ui {
        position: fixed;
        right: 20px;
        bottom: 102px;
        z-index: 9999;
        font-family: "Pretendard Variable", "Pretendard", "Malgun Gothic", sans-serif;
        user-select: none;
      }
      #kpotify-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(18, 18, 18, 0.82);
        backdrop-filter: blur(10px);
        color: #ffffff;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      }
      #kpotify-pill:hover {
        background: rgba(30, 30, 30, 0.95);
        border-color: rgba(29, 185, 84, 0.7);
        transform: translateY(-1px);
      }
      #kpotify-pill .kpotify-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #1db954;
        flex-shrink: 0;
      }
      #kpotify-pill.is-off .kpotify-dot {
        background: #777777;
      }
      #kpotify-pill.is-loading .kpotify-dot {
        background: #f59b23;
        animation: kpotify-pulse 1s infinite ease-in-out;
      }
      @keyframes kpotify-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      #kpotify-menu {
        position: absolute;
        right: 0;
        bottom: 38px;
        min-width: 152px;
        padding: 6px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(24, 24, 24, 0.96);
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
        display: none;
        flex-direction: column;
        gap: 2px;
      }
      #kpotify-menu.open {
        display: flex;
      }
      .kpotify-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: #e5e5e5;
        font-size: 12px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        font-family: inherit;
      }
      .kpotify-menu-item:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .kpotify-menu-item.active {
        color: #1db954;
        font-weight: 700;
      }
      .kpotify-menu-divider {
        height: 1px;
        margin: 4px 2px;
        background: rgba(255, 255, 255, 0.1);
      }
    `;
    document.head.appendChild(style);
  }

  function applyModeClass() {
    document.body.classList.remove(
      "kpotify-mode-both",
      "kpotify-mode-ko",
      "kpotify-mode-off"
    );
    document.body.classList.add(`kpotify-mode-${currentMode}`);
    if (pillEl) {
      pillEl.classList.toggle("is-off", currentMode === "off");
    }
    if (statusBadgeEl) {
      const labels = {
        both: "가사 번역",
        ko: "번역만",
        off: "번역 꺼짐",
      };
      statusBadgeEl.textContent = labels[currentMode] || "가사 번역";
    }
    if (menuEl) {
      menuEl.querySelectorAll("[data-mode]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === currentMode);
      });
    }
  }

  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem(STORAGE_MODE_KEY, mode);
    applyModeClass();
    if (mode !== "off") {
      scheduleScan();
    }
  }

  function createControlUI() {
    if (document.getElementById("kpotify-ui")) return;

    const container = document.createElement("div");
    container.id = "kpotify-ui";

    const menu = document.createElement("div");
    menu.id = "kpotify-menu";
    menu.innerHTML = `
      <button type="button" class="kpotify-menu-item" data-mode="both"><span>원문 + 번역</span><span>✓</span></button>
      <button type="button" class="kpotify-menu-item" data-mode="ko"><span>번역만 보기</span><span>✓</span></button>
      <button type="button" class="kpotify-menu-item" data-mode="off"><span>번역 끄기</span><span>✓</span></button>
      <div class="kpotify-menu-divider"></div>
      <button type="button" class="kpotify-menu-item" data-action="clear-cache"><span>번역 캐시 비우기</span></button>
    `;

    menu.querySelectorAll(".kpotify-menu-item").forEach((btn) => {
      const check = btn.querySelector("span:last-child");
      if (btn.dataset.mode && check) {
        check.style.opacity = "0";
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.mode) {
          setMode(btn.dataset.mode);
          menu.classList.remove("open");
        } else if (btn.dataset.action === "clear-cache") {
          cache.clear();
          localStorage.removeItem(STORAGE_CACHE_KEY);
          document.querySelectorAll(".kpotify-ko-line").forEach((el) => el.remove());
          menu.classList.remove("open");
          scheduleScan();
        }
      });
    });

    const pill = document.createElement("button");
    pill.id = "kpotify-pill";
    pill.type = "button";
    pill.title = "Kpotify 가사 번역 설정";

    const dot = document.createElement("span");
    dot.className = "kpotify-dot";
    const label = document.createElement("span");
    label.textContent = "가사 번역";

    pill.appendChild(dot);
    pill.appendChild(label);

    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("open");
      menu.querySelectorAll("[data-mode]").forEach((btn) => {
        const check = btn.querySelector("span:last-child");
        if (check) {
          check.style.opacity = btn.dataset.mode === currentMode ? "1" : "0";
        }
      });
    });

    document.addEventListener("click", () => {
      menu.classList.remove("open");
    });

    container.appendChild(menu);
    container.appendChild(pill);
    document.body.appendChild(container);

    pillEl = pill;
    menuEl = menu;
    statusBadgeEl = label;
    applyModeClass();
  }

  function updatePillVisibility() {
    if (!pillEl) return;
    const hasLyrics = Boolean(
      document.querySelector('[data-testid="lyrics-line"], [data-testid="lyrics-line-always-visible"]')
    );
    pillEl.parentElement.style.display = hasLyrics ? "block" : "none";
  }

  function shouldTranslate(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Skip pure symbols / musical notes / numbers
    if (/^[\s\d♪♫♬♩•·.\-–—~!?,'"`()[\]{}]+$/.test(trimmed)) return false;

    // Skip if already predominantly Korean
    const nonSpace = trimmed.replace(/\s+/g, "");
    if (!nonSpace) return false;
    const hangulCount = (nonSpace.match(/[\uAC00-\uD7AF\u3131-\u318E]/g) || []).length;
    if (hangulCount / nonSpace.length >= 0.35) return false;

    return true;
  }

  function getOriginalText(lineEl) {
    const firstChild = Array.from(lineEl.children).find(
      (el) => !el.classList.contains("kpotify-ko-line")
    );
    return (firstChild ? firstChild.textContent : lineEl.textContent || "").trim();
  }

  function renderTranslation(lineEl, translatedText) {
    let koEl = lineEl.querySelector(":scope > .kpotify-ko-line");
    if (!koEl) {
      koEl = document.createElement("div");
      koEl.className = "kpotify-ko-line";
      lineEl.appendChild(koEl);
    }
    if (koEl.textContent !== translatedText) {
      koEl.textContent = translatedText;
    }
  }

  function polishLyricTranslation(text) {
    return text
      .replace(/\.+$/, "")
      .replace(/\b당신을\b/g, "너를")
      .replace(/\b당신이\b/g, "네가")
      .replace(/\b당신은\b/g, "너는")
      .replace(/\b당신의\b/g, "너의")
      .replace(/\b당신에게\b/g, "너에게")
      .replace(/\b당신과\b/g, "너와")
      .replace(/\b당신\b/g, "너")
      .replace(/습니다([.!?]?)$/g, "어$1")
      .replace(/입니다([.!?]?)$/g, "야$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function fetchGoogleTranslate(text) {
    const gtxUrl =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=" +
      encodeURIComponent(text);

    const parseGtx = (data) => {
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new Error("Unexpected GTX format");
      }
      return data[0].map((seg) => (Array.isArray(seg) ? seg[0] || "" : "")).join("");
    };

    try {
      const res = await fetch(gtxUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseGtx(await res.json());
    } catch (err1) {
      // Fallback 1: XMLHttpRequest
      try {
        const xhrData = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", gtxUrl, true);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`XHR ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("XHR network error"));
          xhr.send();
        });
        return parseGtx(xhrData);
      } catch (err2) {
        // Fallback 2: clients5.google.com
        const c5Url =
          "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=ko&q=" +
          encodeURIComponent(text);
        const res2 = await fetch(c5Url);
        if (!res2.ok) throw new Error(`C5 HTTP ${res2.status} (${err1.message})`);
        const d2 = await res2.json();
        if (Array.isArray(d2)) {
          if (typeof d2[0] === "string") return d2[0];
          if (Array.isArray(d2[0])) return d2[0].map((s) => (Array.isArray(s) ? s[0] : s)).join("");
        }
        throw new Error(`Fallback failed: ${err1.message}`);
      }
    }
  }

  async function translateBatch(lines) {
    if (lines.length === 0) return;

    if (lines.length === 1) {
      const text = lines[0];
      try {
        const translated = polishLyricTranslation(await fetchGoogleTranslate(text));
        if (translated) {
          lastErrorMsg = "";
          cache.set(text, translated);
          scheduleSaveCache();
        }
      } catch (e) {
        lastErrorMsg = e && e.message ? e.message : "번역 실패";
        console.error("[Kpotify]", e);
      }
      return;
    }

    const joined = lines.join("\n");
    try {
      const translatedJoined = await fetchGoogleTranslate(joined);
      const parts = translatedJoined.split("\n");
      if (parts.length === lines.length) {
        lastErrorMsg = "";
        for (let i = 0; i < lines.length; i++) {
          const t = polishLyricTranslation(parts[i]);
          if (t) cache.set(lines[i], t);
        }
        scheduleSaveCache();
        return;
      }
    } catch (e) {
      lastErrorMsg = e && e.message ? e.message : "번역 실패";
      console.error("[Kpotify]", e);
    }

    // Fallback: split in half so line alignment stays exact
    const mid = Math.ceil(lines.length / 2);
    await translateBatch(lines.slice(0, mid));
    await translateBatch(lines.slice(mid));
  }

  async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    if (pillEl) pillEl.classList.add("is-loading");

    try {
      while (queuedTexts.size > 0) {
        const batch = [];
        let encodedLen = 0;
        for (const text of queuedTexts) {
          const itemLen = encodeURIComponent(text).length + 3;
          if (batch.length > 0 && (batch.length >= BATCH_MAX_LINES || encodedLen + itemLen > BATCH_MAX_ENCODED_LEN)) {
            break;
          }
          queuedTexts.delete(text);
          if (!cache.has(text) && !inFlight.has(text)) {
            inFlight.add(text);
            batch.push(text);
            encodedLen += itemLen;
          }
        }

        if (batch.length === 0) continue;

        await translateBatch(batch);
        for (const text of batch) {
          inFlight.delete(text);
        }
        applyCachedTranslations();

        if (queuedTexts.size > 0) {
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    } finally {
      isProcessingQueue = false;
      if (pillEl) pillEl.classList.remove("is-loading");
      if (statusBadgeEl) {
        if (lastErrorMsg && currentMode !== "off") {
          statusBadgeEl.textContent = `오류: ${lastErrorMsg.slice(0, 22)}`;
        } else {
          applyModeClass();
        }
      }
    }
  }

  function applyCachedTranslations() {
    if (currentMode === "off") return;
    const lineEls = document.querySelectorAll(
      '[data-testid="lyrics-line"], [data-testid="lyrics-line-always-visible"]'
    );
    for (const lineEl of lineEls) {
      const orig = getOriginalText(lineEl);
      if (!shouldTranslate(orig)) continue;
      const translated = cache.get(orig);
      if (translated && translated !== orig) {
        renderTranslation(lineEl, translated);
      } else if (!translated && !inFlight.has(orig)) {
        queuedTexts.add(orig);
      }
    }
  }

  function scanLyrics() {
    updatePillVisibility();
    if (currentMode === "off") return;
    applyCachedTranslations();
    if (queuedTexts.size > 0 && !isProcessingQueue) {
      processQueue();
    }
  }

  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanLyrics();
    }, 100);
  }

  function init() {
    loadCache();
    injectStyles();
    createControlUI();

    const observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const m of mutations) {
        if (m.target && m.target.closest && m.target.closest("#kpotify-ui")) continue;
        if (m.target && m.target.classList && m.target.classList.contains("kpotify-ko-line")) continue;
        relevant = true;
        break;
      }
      if (relevant) scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    setInterval(scanLyrics, 1500);
    window.addEventListener("load", scheduleScan);
    scheduleScan();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
