(() => {
  const APP_ID = "safe-confirm-helper";
  const INPUTS = "#prompt-textarea,textarea,[contenteditable='true']";
  const FIELDS = ["status", "covered", "proof", "unverified", "risks", "verdict"];
  const old = window.__safeConfirmHelperEnhancementsCleanup;
  if (typeof old === "function") old();

  const ac = new AbortController();
  let intervalId = 0;
  let tickTimer = 0;
  let lastHash = "";
  let lastSig = "";
  let staleCount = 0;
  let lastRiskSignalAt = 0;
  let lastStaleSignalAt = 0;

  const norm = (value) => String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  const hash = (value) => { let h = 2166136261; const s = String(value || ""); for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const riskHard = (value) => /阻塞|高风险|未验证|未测试|未运行|无法确认|需要.*确认|not verified|not tested|not run|cannot confirm|need.*confirmation/i.test(String(value || ""));
  const riskWeak = (value) => /可能|大概|理论上|应该|如果|尚未|未确认|推测|估计|probably|maybe|should|if\b|likely|assume|assumption|theoretically|could be|might/i.test(String(value || ""));
  const empty = (value) => ["", "none", "no", "无", "没有", "空", "n/a", "na"].includes(norm(value).toLowerCase());

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
    const out = { raw: match[1].trim() };
    FIELDS.forEach((name) => { out[name] = field(out.raw, name); });
    return out;
  }

  function validFinal(finalBlock) {
    if (!finalBlock) return false;
    if (FIELDS.some((name) => !String(finalBlock[name] || "").trim())) return false;
    if (!/^done$/i.test(norm(finalBlock.status))) return false;
    if (!/ready_to_stop/i.test(norm(finalBlock.verdict))) return false;
    if (!empty(finalBlock.unverified)) return false;
    if (!empty(finalBlock.risks) && (riskHard(finalBlock.risks) || riskWeak(finalBlock.risks))) return false;
    return !(riskHard(finalBlock.raw) || riskWeak(finalBlock.raw));
  }

  function assistantEls() {
    const direct = Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).filter(visible);
    if (direct.length) return direct;
    return Array.from(document.querySelectorAll("article,[data-testid*='conversation-turn']")).filter((el) => visible(el) && !el.querySelector(INPUTS));
  }

  function installStyle() {
    if (document.getElementById(`${APP_ID}-final-fold-style`)) return;
    const style = document.createElement("style");
    style.id = `${APP_ID}-final-fold-style`;
    style.textContent = `.safe-confirm-final-toggle{margin:8px 0;padding:6px 10px;border:1px solid rgba(148,163,184,.6);border-radius:8px;background:rgba(248,250,252,.95);color:#0f172a;font:12px/1.35 system-ui,sans-serif;cursor:pointer;text-align:left;max-width:100%}.safe-confirm-final-toggle:hover{background:#eef2ff}[data-safe-confirm-final-collapsed="true"]{max-height:76px!important;overflow:hidden!important;position:relative!important}[data-safe-confirm-final-collapsed="true"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:32px;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.96));pointer-events:none}`;
    document.documentElement.appendChild(style);
  }

  function finalContainer(assistantEl) {
    const nodes = Array.from(assistantEl.querySelectorAll("pre, code, p, li, blockquote, div")).filter((node) => text(node).includes("<SCH_FINAL>"));
    const exact = nodes.find((node) => /^\s*<SCH_FINAL>[\s\S]*?<\/SCH_FINAL>\s*$/i.test(text(node)));
    if (exact) return exact.closest("pre") || exact;
    return nodes.length === 1 ? (nodes[0].closest("pre") || nodes[0]) : null;
  }

  function insertToggle(target, finalBlock, collapseTarget) {
    if (!target || target.dataset.safeConfirmFinalProcessed === "true") return;
    const summary = () => `SafeConfirm Final · ${norm(finalBlock.status) || "unknown"} · unverified: ${norm(finalBlock.unverified) || "unknown"} · risks: ${norm(finalBlock.risks) || "unknown"}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "safe-confirm-final-toggle";
    button.textContent = collapseTarget ? `${summary()} · 点击展开` : `${summary()} · 已检测`;
    button.addEventListener("click", () => {
      if (!collapseTarget) return;
      const collapsed = collapseTarget.getAttribute("data-safe-confirm-final-collapsed") === "true";
      collapseTarget.setAttribute("data-safe-confirm-final-collapsed", collapsed ? "false" : "true");
      button.textContent = `${summary()} · ${collapsed ? "点击折叠" : "点击展开"}`;
    }, { signal: ac.signal });
    target.parentElement?.insertBefore(button, target);
    target.dataset.safeConfirmFinalProcessed = "true";
    if (collapseTarget) collapseTarget.setAttribute("data-safe-confirm-final-collapsed", "true");
  }

  function reportFinalSeen(assistantEl) {
    const bridge = window.__safeConfirmHelperBridge;
    const snapshot = bridge?.getSnapshot?.();
    if (!snapshot?.taskActive) return;
    bridge.reportSignal?.({ type: "final_ui_seen", taskId: snapshot.taskId, conversationKey: snapshot.conversationKey, messageHash: hash(text(assistantEl)), reason: "final_block_seen", confidence: 1, createdAt: Date.now() });
  }

  function foldFinals() {
    installStyle();
    assistantEls().forEach((assistantEl) => {
      if (assistantEl.dataset.safeConfirmFinalProcessed === "true") return;
      const finalBlock = parseFinal(text(assistantEl));
      if (!finalBlock) return;
      const container = finalContainer(assistantEl);
      if (container) insertToggle(container, finalBlock, container);
      else insertToggle(assistantEl, finalBlock, null);
      assistantEl.dataset.safeConfirmFinalProcessed = "true";
      reportFinalSeen(assistantEl);
    });
  }

  function signature(raw) {
    return norm(raw)
      .replace(/<SCH_FINAL>[\s\S]*?<\/SCH_FINAL>/gi, "")
      .replace(/任务已完成|已完成|完成了|done|completed|finished|ready_to_stop/gi, "")
      .replace(/[0-9a-f]{7,40}/gi, "#hash")
      .replace(/\d+/g, "#")
      .toLowerCase()
      .slice(-1200);
  }

  function similarity(a, b) {
    const split = (value) => new Set(String(value || "").split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length >= 2).slice(-160));
    const left = split(a);
    const right = split(b);
    if (!left.size || !right.size) return 0;
    let same = 0;
    left.forEach((token) => { if (right.has(token)) same += 1; });
    return same / Math.max(left.size, right.size);
  }

  function snapshot() {
    return window.__safeConfirmHelperBridge?.getSnapshot?.() || null;
  }

  function report(type, reason, messageHash, confidence) {
    const info = snapshot();
    if (!info?.enabled || !info?.autoContinue || !info?.superviseLongTasks || !info?.taskActive || info.pausedReason || info.sending) return false;
    return !!window.__safeConfirmHelperBridge?.reportSignal?.({ type, taskId: info.taskId, conversationKey: info.conversationKey, messageHash, reason, confidence, createdAt: Date.now() });
  }

  function progressSignals() {
    const info = snapshot();
    if (!info?.enabled || !info?.autoContinue || !info?.superviseLongTasks || !info?.taskActive || info.conversationKey !== info.pageKey) return;
    const last = assistantEls().at(-1);
    const raw = text(last);
    if (!raw || validFinal(parseFinal(raw))) return;
    const currentHash = hash(raw);
    if (currentHash === lastHash) return;
    const currentSig = signature(raw);
    const hasRisk = riskHard(raw) || riskWeak(raw);
    if (lastSig && currentSig && (currentSig === lastSig || currentSig.includes(lastSig) || similarity(lastSig, currentSig) >= 0.88)) staleCount += 1;
    else staleCount = 0;
    lastSig = currentSig;
    lastHash = currentHash;
    const now = Date.now();
    if (hasRisk && now - lastRiskSignalAt > 30000 && report("risk_word", "assistant_reply_contains_risk_word", currentHash, 0.9)) lastRiskSignalAt = now;
    if (staleCount >= 2 && now - lastStaleSignalAt > 30000 && report("stale_progress", "assistant_reply_low_progress", currentHash, 0.75)) { lastStaleSignalAt = now; staleCount = 0; }
  }

  function tick() { tickTimer = 0; foldFinals(); progressSignals(); }
  function scheduleTick() { if (!tickTimer) tickTimer = setTimeout(tick, 250); }

  const observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  intervalId = setInterval(scheduleTick, 2500);
  document.addEventListener("visibilitychange", scheduleTick, { signal: ac.signal });

  window.__safeConfirmHelperEnhancementsCleanup = () => {
    ac.abort();
    observer.disconnect();
    clearInterval(intervalId);
    clearTimeout(tickTimer);
    document.getElementById(`${APP_ID}-final-fold-style`)?.remove();
    document.querySelectorAll(".safe-confirm-final-toggle").forEach((el) => el.remove());
    document.querySelectorAll("[data-safe-confirm-final-processed='true']").forEach((el) => {
      el.removeAttribute("data-safe-confirm-final-processed");
      el.removeAttribute("data-safe-confirm-final-collapsed");
    });
  };
  scheduleTick();
})();
