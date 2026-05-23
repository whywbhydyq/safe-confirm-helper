(() => {
  const APP_ID = "safe-confirm-helper";
  const AUDIT = "先不要结束。现在做最终自检：1. 原始需求是否有遗漏？2. 哪些完成声明缺少证据？3. 哪些只是推测而非验证？4. 是否还有阻塞风险？如果出现风险词，请明确它是阻塞风险还是非阻塞风险；如有任何阻塞项，继续修复；只有没有遗漏和未验证项时，才输出 SCH_FINAL。";
  const FIELDS = ["status", "covered", "proof", "unverified", "risks", "verdict"];
  const BTN = "button,[role='button'],input[type='button'],input[type='submit']";
  const INPUTS = "#prompt-textarea,textarea,[contenteditable='true']";
  const old = window.__safeConfirmHelperEnhancementsCleanup;
  if (typeof old === "function") old();

  const ac = new AbortController();
  let timer = 0;
  let lastAssistantHash = "";
  let lastProgressSignature = "";
  let staleProgressCount = 0;
  let lastAuditAt = 0;

  function norm(value) {
    return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  }

  function hash(value) {
    let h = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
  }

  function text(el) {
    if (!el) return "";
    const aria = el.getAttribute?.("aria-label") || el.getAttribute?.("title");
    const value = el.getAttribute?.("value");
    return [...new Set([aria, value, el.textContent, el.innerText].filter(Boolean).map((item) => item.trim()).filter(Boolean))]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function field(body, name) {
    const names = FIELDS.join("|");
    const match = String(body || "").match(new RegExp(`^\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:${names})\\s*:|$)`, "im"));
    return match ? match[1].trim() : "";
  }

  function parseFinal(raw) {
    const match = String(raw || "").match(/<SCH_FINAL>([\s\S]*?)<\/SCH_FINAL>/i);
    if (!match) return null;
    const body = match[1].trim();
    const out = { raw: body };
    for (const name of FIELDS) out[name] = field(body, name);
    return out;
  }

  function empty(value) {
    return ["", "none", "no", "无", "没有", "空", "n/a", "na"].includes(norm(value).toLowerCase());
  }

  function blockingRisk(value) {
    return /阻塞|高风险|未验证|未测试|未运行|无法确认|需要.*确认|not verified|not tested|not run|cannot confirm|need.*confirmation/i.test(String(value || ""));
  }

  function weakRisk(value) {
    return /可能|大概|理论上|应该|如果|尚未|未确认|推测|估计|probably|maybe|should|if\b|likely|assume|assumption|theoretically|could be|might/i.test(String(value || ""));
  }

  function validFinal(finalBlock) {
    if (!finalBlock) return false;
    for (const name of FIELDS) if (!String(finalBlock[name] || "").trim()) return false;
    if (!/^done$/i.test(norm(finalBlock.status))) return false;
    if (!/ready_to_stop/i.test(norm(finalBlock.verdict))) return false;
    if (!empty(finalBlock.unverified)) return false;
    if (!empty(finalBlock.risks) && (blockingRisk(finalBlock.risks) || weakRisk(finalBlock.risks))) return false;
    if (blockingRisk(finalBlock.raw) || weakRisk(finalBlock.raw)) return false;
    return true;
  }

  function assistantElements() {
    const direct = Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).filter(visible);
    if (direct.length) return direct;
    return Array.from(document.querySelectorAll("article,[data-testid*='conversation-turn']")).filter((el) => visible(el) && !el.querySelector(INPUTS));
  }

  function lastAssistantElement() {
    const elements = assistantElements();
    return elements.length ? elements.at(-1) : null;
  }

  function installFoldStyle() {
    if (document.getElementById(`${APP_ID}-final-fold-style`)) return;
    const style = document.createElement("style");
    style.id = `${APP_ID}-final-fold-style`;
    style.textContent = `
      .safe-confirm-final-toggle{margin:8px 0;padding:6px 10px;border:1px solid rgba(148,163,184,.6);border-radius:8px;background:rgba(248,250,252,.95);color:#0f172a;font:12px/1.35 system-ui,sans-serif;cursor:pointer;text-align:left;max-width:100%;}
      .safe-confirm-final-toggle:hover{background:#eef2ff;}
      [data-safe-confirm-final-collapsed="true"]{max-height:76px!important;overflow:hidden!important;position:relative!important;}
      [data-safe-confirm-final-collapsed="true"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:32px;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.96));pointer-events:none;}
    `;
    document.documentElement.appendChild(style);
  }

  function finalSummary(finalBlock) {
    const status = norm(finalBlock.status) || "unknown";
    const unverified = norm(finalBlock.unverified) || "unknown";
    const risks = norm(finalBlock.risks) || "unknown";
    return `SafeConfirm Final · ${status} · unverified: ${unverified} · risks: ${risks}`;
  }

  function foldFinalBlocks() {
    installFoldStyle();
    for (const el of assistantElements()) {
      if (el.dataset.safeConfirmFinalProcessed === "true") continue;
      const finalBlock = parseFinal(text(el));
      if (!finalBlock) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "safe-confirm-final-toggle";
      button.textContent = `${finalSummary(finalBlock)} · 点击展开`;
      button.addEventListener("click", () => {
        const collapsed = el.getAttribute("data-safe-confirm-final-collapsed") === "true";
        el.setAttribute("data-safe-confirm-final-collapsed", collapsed ? "false" : "true");
        button.textContent = `${finalSummary(finalBlock)} · ${collapsed ? "点击折叠" : "点击展开"}`;
      }, { signal: ac.signal });
      el.parentElement?.insertBefore(button, el);
      el.dataset.safeConfirmFinalProcessed = "true";
      el.setAttribute("data-safe-confirm-final-collapsed", "true");
    }
  }

  function running() {
    return Array.from(document.querySelectorAll(BTN)).filter(visible).some((button) => /停止|中止|stop|cancel/i.test(text(button)));
  }

  function supervisedConversationLikelyActive(lastText) {
    const pageText = document.body ? document.body.innerText || "" : "";
    if (!/\[SafeConfirm Supervision\]|继续原始任务|SCH_FINAL|最终自检/.test(pageText)) return false;
    const finalBlock = parseFinal(lastText);
    return !validFinal(finalBlock);
  }

  function progressSignature(raw) {
    return norm(raw)
      .replace(/<SCH_FINAL>[\s\S]*?<\/SCH_FINAL>/gi, "")
      .replace(/任务已完成|已完成|完成了|done|completed|finished|ready_to_stop/gi, "")
      .replace(/[0-9a-f]{7,40}/gi, "#hash")
      .replace(/\d+/g, "#")
      .toLowerCase()
      .slice(-1200);
  }

  function tokens(signature) {
    return new Set(signature.split(/[^\p{L}\p{N}_]+/u).filter((item) => item.length >= 2).slice(-160));
  }

  function similarity(a, b) {
    const left = tokens(a);
    const right = tokens(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const item of left) if (right.has(item)) overlap += 1;
    return overlap / Math.max(left.size, right.size);
  }

  function lowProgress(previous, next) {
    if (!previous || !next || previous === next) return false;
    if (next.includes(previous) || previous.includes(next)) return Math.abs(next.length - previous.length) < 140;
    return similarity(previous, next) >= 0.88;
  }

  function input() {
    return Array.from(document.querySelectorAll(INPUTS)).filter(visible).find((el) => !el.closest(`#${APP_ID}-panel`)) || null;
  }

  function inputText(el) {
    return !el ? "" : ("value" in el ? String(el.value || "") : String(el.textContent || "")).trim();
  }

  function setInput(el, value) {
    if (!el) return false;
    el.focus();
    if ("value" in el) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      setter ? setter.call(el, value) : el.value = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const selection = getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, value);
    }
    if (inputText(el) !== value) el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return inputText(el) === value;
  }

  function sendButton(el) {
    const root = el?.closest?.("form") || document;
    for (const selector of ["button[data-testid='send-button']", "button[aria-label*='发送']", "button[aria-label*='Send']", "button[title*='发送']", "button[title*='Send']", "button[type='submit']"]) {
      const button = root.querySelector(selector);
      if (button && visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") return button;
    }
    return Array.from(root.querySelectorAll(BTN)).filter(visible).find((button) => /发送|send/i.test(text(button)) && !button.disabled && button.getAttribute("aria-disabled") !== "true") || null;
  }

  function click(el) {
    if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click();
  }

  function sendAuditPrompt() {
    const editor = input();
    if (!editor || inputText(editor)) return false;
    if (!setInput(editor, AUDIT)) return false;
    setTimeout(() => {
      const button = sendButton(editor);
      if (button) click(button);
    }, 120);
    lastAuditAt = Date.now();
    staleProgressCount = 0;
    return true;
  }

  function checkProgress() {
    const last = lastAssistantElement();
    const raw = text(last);
    if (!raw || running() || !supervisedConversationLikelyActive(raw)) return;
    const currentHash = hash(raw);
    if (currentHash === lastAssistantHash) return;
    const signature = progressSignature(raw);
    if (lowProgress(lastProgressSignature, signature)) staleProgressCount += 1;
    else staleProgressCount = 0;
    lastProgressSignature = signature;
    lastAssistantHash = currentHash;
    if (staleProgressCount >= 2 && Date.now() - lastAuditAt > 30000) sendAuditPrompt();
  }

  function tick() {
    foldFinalBlocks();
    checkProgress();
  }

  const observer = new MutationObserver(() => tick());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  timer = setInterval(tick, 2500);
  document.addEventListener("visibilitychange", tick, { signal: ac.signal });
  window.__safeConfirmHelperEnhancementsCleanup = () => {
    ac.abort();
    observer.disconnect();
    clearInterval(timer);
    document.getElementById(`${APP_ID}-final-fold-style`)?.remove();
    document.querySelectorAll(".safe-confirm-final-toggle").forEach((el) => el.remove());
    document.querySelectorAll("[data-safe-confirm-final-processed='true']").forEach((el) => {
      el.removeAttribute("data-safe-confirm-final-processed");
      el.removeAttribute("data-safe-confirm-final-collapsed");
    });
  };
  tick();
})();
