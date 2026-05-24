(() => {
  const APP_ID = "safe-confirm-helper";
  const INPUTS = "#prompt-textarea,textarea,[contenteditable='true']";
  const FIELDS = ["status", "covered", "proof", "unverified", "risks", "verdict"];
  const UNBLOCK = `当前任务尚未完成。不要做停机前自检，不要输出 SCH_FINAL。

请把刚才提到的未完成项、未验证项或阻塞点转化为下一步行动：
- 能继续执行的，直接继续执行；
- 能换工具或换路径的，换方案继续；
- 单一路径失败时，不要直接视为最终阻塞，优先尝试其他可用工具路径、文件包、补丁或可复制命令；
- 能降级交付的，先完成可执行替代方案；
- 只有确实必须用户外部操作且你无法继续推进时，才暂停并明确说明需要用户做什么。

现在继续推进原始任务。`;
  const old = window.__safeConfirmHelperEnhancementsCleanup;
  if (typeof old === "function") old();

  const ac = new AbortController();
  let observer;
  let timer = 0;
  let loop = 0;
  let lastHash = "";
  let lastSig = "";
  let staleCount = 0;
  let lastRiskAt = 0;
  let lastStaleAt = 0;
  let lastAuditHash = "";
  let repeatedAuditCount = 0;
  let lastUserScroll = 0;
  let programmaticScrollUntil = 0;
  let lastSettingsRead = 0;
  let keepSettings = { enabled: true, keepAtBottom: false, userScrollPauseMs: 12000 };

  const norm = (value) => String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  const hash = (value) => { let h = 2166136261; const s = String(value || ""); for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const riskHard = (value) => /阻塞|高风险|未验证|未测试|未运行|无法确认|not verified|not tested|not run|cannot confirm/i.test(String(value || ""));
  const riskWeak = (value) => /可能|大概|理论上|应该|如果|尚未|未确认|推测|估计|probably|maybe|should|if\b|likely|assume|theoretically|could be|might/i.test(String(value || ""));
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
    return [...new Set([el.getAttribute?.("aria-label"), el.getAttribute?.("title"), el.getAttribute?.("value"), el.textContent, el.innerText].filter(Boolean).map((item) => item.trim()).filter(Boolean))].join(" ").replace(/\s+/g, " ").trim();
  }

  function cleanAssistantText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.(".safe-confirm-final-toggle").forEach((node) => node.remove());
    return text(clone);
  }

  function assistantEls() {
    return Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).filter(visible);
  }

  function lastAssistantText() {
    return cleanAssistantText(assistantEls().at(-1));
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

  function strictFinalBody(raw) {
    const match = String(raw || "").match(/<\s*SCH_FINAL\s*>([\s\S]*?)<\/\s*SCH_FINAL\s*>/i);
    return match ? match[1].trim() : null;
  }

  function field(body, name) {
    const names = FIELDS.join("|");
    const match = String(body || "").match(new RegExp(`(?:^|\\s|[·;])${name}\\s*:\\s*([\\s\\S]*?)(?=(?:\\s|[·;])(?:${names})\\s*:|$)`, "i"));
    return match ? match[1].trim().replace(/[·;]\s*$/, "").trim() : "";
  }

  function parseFinal(raw) {
    const body = strictFinalBody(raw);
    if (!body) return null;
    const out = { raw: body };
    FIELDS.forEach((name) => { out[name] = field(body, name); });
    if (!out.status && /^[^\p{L}\p{N}]*done\b/iu.test(norm(body))) out.status = "done";
    return out;
  }

  function usableFinal(raw) {
    const finalBlock = parseFinal(raw);
    return !!finalBlock && FIELDS.some((name) => String(finalBlock[name] || "").trim());
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

  function installStyle() {
    if (document.getElementById(`${APP_ID}-final-fold-style`)) return;
    const style = document.createElement("style");
    style.id = `${APP_ID}-final-fold-style`;
    style.textContent = `.safe-confirm-final-toggle{margin:8px 0;padding:6px 10px;border:1px solid rgba(148,163,184,.6);border-radius:8px;background:rgba(248,250,252,.95);color:#0f172a;font:12px/1.35 system-ui,sans-serif;cursor:pointer;text-align:left;max-width:100%}[data-safe-confirm-final-collapsed="true"]{max-height:76px!important;overflow:hidden!important;position:relative!important}`;
    document.documentElement.appendChild(style);
  }

  function finalContainer(assistantEl) {
    const nodes = Array.from(assistantEl.querySelectorAll("pre, code, p, li, blockquote, div")).filter((node) => /<\s*SCH_FINAL\s*>[\s\S]*?<\/\s*SCH_FINAL\s*>/i.test(text(node)));
    return nodes.length === 1 ? (nodes[0].closest("pre") || nodes[0]) : null;
  }

  function insertToggle(target, finalBlock, collapseTarget) {
    if (!target || target.dataset.safeConfirmFinalProcessed === "true" || !usableFinal(text(target))) return;
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
    const raw = cleanAssistantText(assistantEl);
    if (!usableFinal(raw)) return;
    const bridge = window.__safeConfirmHelperBridge;
    const snapshot = bridge?.getSnapshot?.();
    if (!snapshot?.taskActive || !snapshot?.promptInjected) return;
    bridge.reportSignal?.({ type: "final_ui_seen", taskId: snapshot.taskId, conversationKey: snapshot.conversationKey, messageHash: hash(raw), reason: "strict_final_block_seen", confidence: 1, createdAt: Date.now() });
  }

  function foldFinals() {
    installStyle();
    assistantEls().forEach((assistantEl) => {
      if (assistantEl.dataset.safeConfirmFinalProcessed === "true") return;
      const raw = cleanAssistantText(assistantEl);
      const finalBlock = parseFinal(raw);
      if (!finalBlock) return;
      const container = finalContainer(assistantEl);
      insertToggle(container || assistantEl, finalBlock, container);
      assistantEl.dataset.safeConfirmFinalProcessed = "true";
      reportFinalSeen(assistantEl);
    });
  }

  function snapshot() {
    return window.__safeConfirmHelperBridge?.getSnapshot?.() || null;
  }

  function refreshKeepSettings() {
    const now = Date.now();
    if (now - lastSettingsRead < 1000) return;
    lastSettingsRead = now;
    chrome?.storage?.local?.get?.(["settings"]).then((result) => {
      const current = result?.settings || {};
      keepSettings = {
        enabled: current.enabled !== false,
        keepAtBottom: !!current.keepAtBottom,
        userScrollPauseMs: Number(current.userScrollPauseMs) || 12000
      };
    }).catch(() => {});
  }

  function supervisionForcesBottom() {
    const info = snapshot();
    return !!(info?.enabled && info?.superviseLongTasks && info?.taskActive && info?.taskStatus !== "stopped_valid_final");
  }

  function shouldKeepBottom() {
    const info = snapshot();
    if (info && !info.enabled) return false;
    if (!info && !keepSettings.enabled) return false;
    return !!keepSettings.keepAtBottom || supervisionForcesBottom();
  }

  function keepBottom() {
    refreshKeepSettings();
    if (document.visibilityState === "hidden" || !shouldKeepBottom()) return;
    if (Date.now() - lastUserScroll < keepSettings.userScrollPauseMs) return;
    programmaticScrollUntil = Date.now() + 500;
    scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
    Array.from(document.querySelectorAll("main,[role='main'],[class*='scroll'],[data-testid*='conversation'],div"))
      .filter((el) => visible(el) && el.scrollHeight - el.clientHeight > 80)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 4)
      .forEach((el) => { el.scrollTop = el.scrollHeight; });
  }

  function report(type, reason, messageHash, confidence) {
    const info = snapshot();
    if (!info?.enabled || !info?.autoContinue || !info?.superviseLongTasks || !info?.taskActive || !info?.promptInjected || info.pausedReason || info.sending) return false;
    return !!window.__safeConfirmHelperBridge?.reportSignal?.({ type, taskId: info.taskId, conversationKey: info.conversationKey, messageHash, reason, confidence, createdAt: Date.now() });
  }

  function blockedOrIncomplete(raw) {
    return /没有全部覆盖|未完成|未覆盖|未验证|未测试|未运行|无法验证|无法确认|不能输出\s*SCH_FINAL|不要输出\s*SCH_FINAL|不能结束|阻塞|失败|被拦截|权限不足|无法访问|不能部署|not complete|incomplete|not verified|not tested|not run|cannot verify|cannot confirm|blocked|failed|permission denied|unable to access|cannot deploy|do not output\s*SCH_FINAL/i.test(String(raw || "")) || /不应视为\s*ready_to_stop|不是\s*ready_to_stop|不能.*ready_to_stop|not\s+ready_to_stop|not.*ready to stop/i.test(String(raw || ""));
  }

  function auditPrompt(raw) {
    const value = norm(raw);
    return /停机前自检|最终自检|原始需求是否全部覆盖|哪些内容只是推测而非验证/.test(value) && /SCH_FINAL/i.test(value);
  }

  function completionIntent(raw) {
    return /任务全部完成|已经完成全部|全部要求已完成|可以结束|任务已完成|已完成全部|ready_to_stop/i.test(String(raw || "")) && !blockedOrIncomplete(raw);
  }

  function rewriteAuditDraft() {
    const editor = input();
    if (!editor) return false;
    const draft = inputText(editor);
    if (!auditPrompt(draft)) return false;
    const last = lastAssistantText();
    if (!last) return false;
    const targetHash = hash(last);
    if (lastAuditHash === targetHash) repeatedAuditCount += 1;
    else repeatedAuditCount = 0;
    lastAuditHash = targetHash;
    if (!blockedOrIncomplete(last) && !repeatedAuditCount) return false;
    if (completionIntent(last) && validFinal(parseFinal(last))) return false;
    return setInput(editor, UNBLOCK);
  }

  function signature(raw) {
    return norm(raw).replace(/<SCH_FINAL>[\s\S]*?<\/SCH_FINAL>/gi, "").replace(/任务已完成|已完成|完成了|done|completed|finished|ready_to_stop/gi, "").replace(/[0-9a-f]{7,40}/gi, "#hash").replace(/\d+/g, "#").toLowerCase().slice(-1200);
  }

  function progressSignals() {
    const info = snapshot();
    if (!info?.enabled || !info?.autoContinue || !info?.superviseLongTasks || !info?.taskActive || !info?.promptInjected || info.conversationKey !== info.pageKey) return;
    const raw = lastAssistantText();
    if (!raw || validFinal(parseFinal(raw))) return;
    const currentHash = hash(raw);
    if (currentHash === lastHash) return;
    const currentSig = signature(raw);
    if (lastSig && currentSig && (currentSig === lastSig || currentSig.includes(lastSig))) staleCount += 1;
    else staleCount = 0;
    lastSig = currentSig;
    lastHash = currentHash;
    const now = Date.now();
    if ((riskHard(raw) || riskWeak(raw) || blockedOrIncomplete(raw)) && now - lastRiskAt > 30000 && report("risk_word", "assistant_reply_contains_unfinished_or_risk_signal", currentHash, 0.9)) lastRiskAt = now;
    if (staleCount >= 2 && now - lastStaleAt > 30000 && report("stale_progress", "assistant_reply_low_progress", currentHash, 0.75)) { lastStaleAt = now; staleCount = 0; }
  }

  function wrapBridge() {
    const bridge = window.__safeConfirmHelperBridge;
    if (!bridge || bridge.__safeConfirmEnhancementWrapped || typeof bridge.reportSignal !== "function") return false;
    const original = bridge.reportSignal.bind(bridge);
    bridge.reportSignal = (signal) => {
      if (signal?.type === "final_ui_seen" && !usableFinal(lastAssistantText())) return false;
      return original(signal);
    };
    bridge.__safeConfirmEnhancementWrapped = true;
    return true;
  }

  function removeUnknownToggles() {
    document.querySelectorAll(".safe-confirm-final-toggle").forEach((node) => {
      if (!/unknown/i.test(text(node))) return;
      const target = node.nextElementSibling;
      if (target?.getAttribute?.("data-safe-confirm-final-collapsed") === "true" && !usableFinal(text(target))) target.removeAttribute("data-safe-confirm-final-collapsed");
      node.remove();
    });
  }

  function tick() {
    timer = 0;
    wrapBridge();
    removeUnknownToggles();
    foldFinals();
    progressSignals();
    rewriteAuditDraft();
    keepBottom();
  }
  function scheduleTick() { if (!timer) timer = setTimeout(tick, 120); }

  observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-safe-confirm-final-collapsed", "data-safe-confirm-final-processed", "class", "style"] });
  loop = setInterval(scheduleTick, 1500);
  document.addEventListener("input", scheduleTick, { capture: true, signal: ac.signal });
  document.addEventListener("visibilitychange", scheduleTick, { signal: ac.signal });
  document.addEventListener("scroll", () => { if (Date.now() > programmaticScrollUntil) lastUserScroll = Date.now(); }, { capture: true, passive: true, signal: ac.signal });

  window.__safeConfirmHelperEnhancementsCleanup = () => {
    ac.abort();
    observer?.disconnect();
    clearInterval(loop);
    clearTimeout(timer);
    document.getElementById(`${APP_ID}-final-fold-style`)?.remove();
    document.querySelectorAll(".safe-confirm-final-toggle").forEach((el) => el.remove());
    document.querySelectorAll("[data-safe-confirm-final-processed='true']").forEach((el) => {
      el.removeAttribute("data-safe-confirm-final-processed");
      el.removeAttribute("data-safe-confirm-final-collapsed");
    });
  };
  scheduleTick();
})();
