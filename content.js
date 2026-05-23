(() => {
  const APP_ID = "safe-confirm-helper";
  const STORE = `${APP_ID}:settings`;
  const BTN = "button,[role='button'],input[type='button'],input[type='submit']";
  const DLG = "dialog[open],[role='dialog'],[role='alertdialog'],[aria-modal='true'],[data-radix-dialog-content],[data-headlessui-state],.modal,.popover";
  const CONTINUE = "继续原始任务。优先处理未完成、未验证或有风险的部分。不要总结；不要只说“任务已完成”。若确认全部完成，输出 SCH_FINAL，否则继续执行。";
  const AUDIT = "先不要结束。现在做最终自检：1. 原始需求是否有遗漏？2. 哪些完成声明缺少证据？3. 哪些只是推测而非验证？4. 是否还有阻塞风险？如果出现风险词，请明确它是阻塞风险还是非阻塞风险；如有任何阻塞项，继续修复；只有没有遗漏和未验证项时，才输出 SCH_FINAL。";
  const SUPERVISE = `[SafeConfirm Supervision]\n本任务按长任务处理。不要用一句“任务已完成”结束。\n执行时优先完成原始需求；停止前必须自检是否有遗漏、未验证项和阻塞风险。\n如果仍有未完成或未验证项，继续执行。\n如果确认可以结束，只输出 SCH_FINAL 块，说明覆盖项、证据、未验证项和风险。`;
  const DEF = { enabled: true, autoConfirm: true, keepAtBottom: true, autoContinue: true, superviseLongTasks: true, english: true, highlight: true, continuePrompt: CONTINUE, maxContinueCount: 50, continueCooldownMs: 10000, auditEvery: 3, userScrollPauseMs: 12000 };
  const ZH = [/^确认$/, /^允许$/, /^继续$/, /^批准$/, /确认/, /允许/, /批准/, /继续/];
  const EN = [/^Confirm$/i, /^Approve$/i, /^Allow$/i, /^Continue$/i, /^Accept$/i, /\bConfirm\b/i, /\bApprove\b/i, /\bAllow\b/i, /\bContinue\b/i, /\bAccept\b/i];
  const FIELDS = ["status", "covered", "proof", "unverified", "risks", "verdict"];
  const old = window.__safeConfirmHelperCleanup;
  if (typeof old === "function") old();
  const ac = new AbortController();
  const timers = new Set();
  let settings = { ...DEF };
  let observer, scanTimer = 0, assistTimer = 0, scanLoop = 0, assistLoop = 0, candidate = null, candidateAutoClickable = false;
  let clicked = new WeakSet();
  let lastHiddenScan = 0, lastHiddenAssist = 0, lastUserScroll = 0, programmaticScrollUntil = 0;
  let scanInfo = { roots: 0, candidates: 0, matches: 0, autoClickable: false };
  const runtime = { continueCount: 0, sendFailureCount: 0, composerFailureCount: 0, lastContinueAt: 0, lastAssistantTextHash: "", pausedReason: "", sending: false, externalSignals: blankSignals() };
  let task = blankTask();
  let bridge = null;

  function blankTask() { return { active: false, status: "idle", taskId: "", conversationKey: "", startedAt: 0, loopCount: 0, auditCount: 0, lastFinal: null, lastGateReason: "", stopReason: "" }; }
  function blankSignals() { return { riskWord: false, staleProgress: false, finalUiSeen: false, reasons: [], lastSignalAt: 0, lastMessageHash: "" }; }
  function norm(value) { return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim(); }
  function hash(value) { let h = 2166136261; const text = String(value || ""); for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function cjk(value) { const m = String(value || "").match(/[\u3400-\u9fff\uf900-\ufaff]/g); return m ? m.length : 0; }
  function delay(fn, ms) { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }
  function every(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; }
  function clearTimer(id) { if (!id) return; clearTimeout(id); clearInterval(id); timers.delete(id); }
  function clamp(value, min, max, fallback) { const parsed = parseInt(value, 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
  function getConversationKey() { return `${location.pathname}${location.search}`; }

  function cleanSettings(value) {
    const src = value && typeof value === "object" ? value : {};
    const next = {};
    Object.keys(DEF).forEach((key) => { next[key] = src[key] ?? DEF[key]; });
    next.maxContinueCount = clamp(next.maxContinueCount, 1, 200, 50);
    next.continueCooldownMs = clamp(next.continueCooldownMs, 1000, 120000, 10000);
    next.auditEvery = clamp(next.auditEvery, 1, 20, 3);
    next.userScrollPauseMs = clamp(next.userScrollPauseMs, 1000, 60000, 12000);
    next.continuePrompt = String(next.continuePrompt || CONTINUE).trim() || CONTINUE;
    return next;
  }

  async function loadSettings() {
    try {
      const current = await chrome.storage.local.get(["settings", "migratedFromLocalStorage"]);
      if (!current.migratedFromLocalStorage) {
        const raw = localStorage.getItem(STORE);
        if (raw && !current.settings) await chrome.storage.local.set({ settings: cleanSettings(JSON.parse(raw)) });
        await chrome.storage.local.set({ migratedFromLocalStorage: true });
      }
      const result = await chrome.storage.local.get(["settings"]);
      return cleanSettings(result.settings);
    } catch {
      try { return cleanSettings(JSON.parse(localStorage.getItem(STORE) || "{}")); } catch { return cleanSettings({}); }
    }
  }
  async function saveSettings() { settings = cleanSettings(settings); try { await chrome.storage.local.set({ settings }); } catch { localStorage.setItem(STORE, JSON.stringify(settings)); } }
  function visible(el) { if (!el || !el.isConnected) return false; const style = getComputedStyle(el); if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth; }
  function enabled(el) { return !!(el && !el.disabled && el.getAttribute("aria-disabled") !== "true" && visible(el)); }
  function text(el) { if (!el) return ""; const aria = el.getAttribute?.("aria-label") || el.getAttribute?.("title"); const value = el.getAttribute?.("value"); return [...new Set([aria, value, el.textContent, el.innerText].filter(Boolean).map((item) => item.trim()).filter(Boolean))].join(" ").replace(/\s+/g, " ").trim(); }
  function click(el) { if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true })); el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true })); el.click(); }
  function toast(message) { document.getElementById(`${APP_ID}-toast`)?.remove(); const el = document.createElement("div"); el.id = `${APP_ID}-toast`; el.textContent = message; Object.assign(el.style, { position: "fixed", left: "50%", bottom: "92px", transform: "translateX(-50%)", zIndex: "2147483647", background: "rgba(17,24,39,.92)", color: "#fff", padding: "10px 14px", borderRadius: "8px", fontSize: "14px", fontFamily: "system-ui,sans-serif", boxShadow: "0 6px 18px rgba(0,0,0,.2)" }); document.documentElement.appendChild(el); delay(() => el.remove(), 1800); }

  function buttonPatterns() { return settings.english ? ZH.concat(EN) : ZH; }
  function buttonMatch(el) { const label = text(el); return !!label && buttonPatterns().some((pattern) => pattern.test(label)); }
  function score(el) { const label = text(el); let scoreValue = 0; if (/确认|confirm/i.test(label)) scoreValue += 5; if (/批准|approve/i.test(label)) scoreValue += 4; if (/允许|allow/i.test(label)) scoreValue += 3; if (/继续|continue/i.test(label)) scoreValue += 2; if (el.closest(DLG)) scoreValue += 6; return scoreValue; }
  function clearMark() { const el = document.querySelector('[data-safe-confirm-helper-highlight="true"]'); if (!el) return; el.style.outline = el.dataset.safeConfirmHelperOldOutline || ""; el.style.outlineOffset = el.dataset.safeConfirmHelperOldOutlineOffset || ""; el.removeAttribute("data-safe-confirm-helper-highlight"); }
  function mark() { if (!settings.highlight || !candidate) return; candidate.dataset.safeConfirmHelperOldOutline = candidate.style.outline; candidate.dataset.safeConfirmHelperOldOutlineOffset = candidate.style.outlineOffset; candidate.setAttribute("data-safe-confirm-helper-highlight", "true"); candidate.style.outline = "2px solid #22c55e"; candidate.style.outlineOffset = "3px"; }
  function setCandidate(button, autoClickable = false) { if (candidate === button && candidateAutoClickable === autoClickable) return; clearMark(); candidate = button; candidateAutoClickable = !!autoClickable; if (!button) clicked = new WeakSet(); mark(); }
  function findModalRoots() { return Array.from(document.querySelectorAll(DLG)).filter(visible).slice(-4); }
  function scanRoots(roots, autoClickable) { let best = null, bestScore = -1, total = 0, matches = 0; for (const root of roots) { const list = root.querySelectorAll(BTN); total += list.length; for (const button of list) { if (!enabled(button) || !buttonMatch(button)) continue; matches += 1; const value = score(button); if (value > bestScore) { best = button; bestScore = value; } } } scanInfo = { roots: roots.length, candidates: total, matches, autoClickable: !!autoClickable }; setCandidate(best, !!best && autoClickable); autoClick(); return best; }
  function scan() { if (!settings.enabled) { setCandidate(null, false); return null; } const modalRoots = findModalRoots(); if (modalRoots.length) return scanRoots(modalRoots, true); return scanRoots([document.body || document.documentElement], false); }
  function requestScan() { if (settings.autoConfirm && document.visibilityState === "hidden") { const now = Date.now(); if (now - lastHiddenScan < 250) return; lastHiddenScan = now; scan(); return; } if (scanTimer) return; scanTimer = delay(() => { scanTimer = 0; scan(); }, 120); }
  function autoClick() { if (!settings.enabled || !settings.autoConfirm || !candidate || !candidateAutoClickable || clicked.has(candidate) || !enabled(candidate) || !buttonMatch(candidate)) return false; const label = text(candidate); click(candidate); clicked.add(candidate); toast(`已自动确认：「${label}」`); requestScan(); return true; }
  function manualClick() { const button = candidate && enabled(candidate) && buttonMatch(candidate) ? candidate : scan(); if (!button) return toast("没有找到可见的确认按钮"); const label = text(button); if (confirm(`是否点击按钮：「${label}」？`)) { click(button); toast(`已点击：「${label}」`); requestScan(); } }

  function input(scope = document) { return [...(scope.querySelectorAll?.("#prompt-textarea,textarea,[contenteditable='true']") || []), ...document.querySelectorAll("#prompt-textarea,textarea,[contenteditable='true']")].filter(visible).find((el) => !el.closest(`#${APP_ID}-panel`)) || null; }
  function inputText(el) { return !el ? "" : ("value" in el ? String(el.value || "") : String(el.textContent || "")).trim(); }
  function setInput(el, value) { if (!el) return false; el.focus(); if ("value" in el) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set; setter ? setter.call(el, value) : el.value = value; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; } const selection = getSelection(); if (selection) { const range = document.createRange(); range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range); document.execCommand("insertText", false, value); } if (inputText(el) !== value) el.textContent = value; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })); return inputText(el) === value; }
  function sendButton(el) { const root = el?.closest?.("form") || document; for (const selector of ["button[data-testid='send-button']", "button[aria-label*='发送']", "button[aria-label*='Send']", "button[title*='发送']", "button[title*='Send']", "button[type='submit']"]) { const button = root.querySelector(selector); if (button && enabled(button)) return button; } return Array.from(root.querySelectorAll(BTN)).filter(enabled).find((button) => /发送|send/i.test(text(button))) || null; }
  function noteComposerFailure(reason) { runtime.composerFailureCount += 1; if (runtime.composerFailureCount >= 3) { runtime.pausedReason = reason; task.status = "paused_composer_failed"; toast(reason); } }
  function noteSendFailure(reason) { runtime.sendFailureCount += 1; if (runtime.sendFailureCount >= 3) { runtime.pausedReason = reason; task.status = "paused_send_failed"; toast(reason); } }
  function queuePrompt(prompt, sent, failed) { const el = input(); if (!el || !visible(el)) { noteComposerFailure("连续多次找不到输入框，自动继续已暂停"); return false; } if (inputText(el)) return false; if (!setInput(el, prompt)) { noteComposerFailure("连续多次无法写入输入框，自动继续已暂停"); return false; } runtime.composerFailureCount = 0; delay(() => trySend(el, 0, sent, failed), 120); return true; }
  function trySend(el, attempt, sent, failed) { const button = sendButton(el); if (button && enabled(button)) { click(button); sent?.(); return true; } if (attempt < 2) { delay(() => trySend(el, attempt + 1, sent, failed), 700); return false; } failed?.(); return false; }

  function lastAssistantEl() { const direct = [...document.querySelectorAll("[data-message-author-role='assistant']")].filter(visible); if (direct.length) return direct.at(-1); const messages = [...document.querySelectorAll("article,[data-testid*='conversation-turn']")].filter(visible); for (let i = messages.length - 1; i >= 0; i -= 1) { const role = messages[i].getAttribute("data-message-author-role"); if (role === "user") continue; if (role === "assistant" || !messages[i].querySelector("textarea,[contenteditable='true']")) return messages[i]; } return null; }
  function lastAssistantText() { return text(lastAssistantEl()); }
  function running() { const buttons = Array.from(document.querySelectorAll(BTN)).filter(visible); return buttons.some((button) => /停止|中止|stop|cancel/i.test(text(button))) || /正在思考|正在运行|正在生成|thinking|running|generating/i.test(lastAssistantText()); }
  function shouldSupervise(raw) { const value = norm(raw); const lower = value.toLowerCase(); if (!value) return false; if (/https?:\/\/|github\.com\/|vercel\.app|www\./i.test(value)) return true; const words = ["继续", "直到完成", "不要停", "全部完成", "完整", "优化", "审计", "实现", "修改", "重构", "开发计划", "部署", "构建", "运行", "验证", "检查", "seo", "cro", "ux", "github", "vercel", "sitemap", "robots", "代码", "项目", "仓库", "插件"]; const hasWord = words.some((word) => lower.includes(word)); const multi = /[1-9][.、)]|第一|第二|第三|步骤|阶段|要求|必须|不要|全部/.test(value); return ((cjk(value) >= 80 || value.length >= 120) && hasWord) || (hasWord && multi); }
  function pluginPrompt(raw) { const value = norm(raw); return value === norm(CONTINUE) || value === norm(AUDIT) || value.includes("现在做最终自检") || value.includes("继续原始任务"); }
  function resetTask(reason = "") { task = blankTask(); Object.assign(runtime, { continueCount: 0, sendFailureCount: 0, composerFailureCount: 0, lastContinueAt: 0, lastAssistantTextHash: "", pausedReason: "", sending: false, externalSignals: blankSignals() }); if (reason) task.stopReason = reason; }
  function prepare(el) { if (!settings.enabled || !settings.superviseLongTasks) return false; const raw = inputText(el); if (!raw || pluginPrompt(raw) || raw.includes("[SafeConfirm Supervision]")) return false; if (!shouldSupervise(raw)) { if (task.active) resetTask("manual_user_prompt"); return false; } if (!setInput(el, `${raw.trim()}\n\n${SUPERVISE}`)) return false; task = { active: true, status: "supervising", taskId: `${Date.now().toString(36)}-${hash(raw)}`, conversationKey: getConversationKey(), startedAt: Date.now(), loopCount: 0, auditCount: 0, lastFinal: null, lastGateReason: "", stopReason: "" }; Object.assign(runtime, { continueCount: 0, sendFailureCount: 0, composerFailureCount: 0, lastContinueAt: 0, lastAssistantTextHash: "", pausedReason: "", sending: false, externalSignals: blankSignals() }); toast("已进入长任务监督"); return true; }

  function parseFinal(raw) { const match = String(raw || "").match(/<SCH_FINAL>([\s\S]*?)<\/SCH_FINAL>/i); if (!match) return null; const body = match[1].trim(); const out = { raw: body }; for (const name of FIELDS) out[name] = field(body, name); return out; }
  function field(body, name) { const names = FIELDS.join("|"); const match = String(body || "").match(new RegExp(`^\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:${names})\\s*:|$)`, "im")); return match ? match[1].trim() : ""; }
  function empty(value) { return ["", "none", "no", "无", "没有", "空", "n/a", "na"].includes(norm(value).toLowerCase()); }
  function block(value) { return /阻塞|高风险|未验证|未测试|未运行|无法确认|需要.*确认|not verified|not tested|not run|cannot confirm|need.*confirmation/i.test(String(value || "")); }
  function weakRisk(value) { return /可能|大概|理论上|应该|如果|尚未|未确认|推测|估计|probably|maybe|should|if\b|likely|assume|assumption|theoretically|could be|might/i.test(String(value || "")); }
  function gate(finalBlock) { if (!finalBlock) return { canStop: false, reason: "missing_final" }; for (const key of FIELDS) if (!String(finalBlock[key] || "").trim()) return { canStop: false, reason: `missing_${key}` }; if (!/^done$/i.test(norm(finalBlock.status))) return { canStop: false, reason: "status_not_done" }; if (!/ready_to_stop/i.test(norm(finalBlock.verdict))) return { canStop: false, reason: "verdict_not_ready" }; if (!empty(finalBlock.unverified)) return { canStop: false, reason: "unverified_exists" }; if (!empty(finalBlock.risks) && block(finalBlock.risks)) return { canStop: false, reason: "blocking_risk_exists" }; if (!empty(finalBlock.risks) && weakRisk(finalBlock.risks)) return { canStop: false, reason: "risk_word_exists" }; if (block(finalBlock.raw)) return { canStop: false, reason: "blocking_keyword_in_final" }; if (weakRisk(finalBlock.raw)) return { canStop: false, reason: "weak_risk_keyword_in_final" }; return { canStop: true, reason: "valid_final" }; }

  function getSnapshot() { return { enabled: settings.enabled, autoContinue: settings.autoContinue, superviseLongTasks: settings.superviseLongTasks, taskActive: task.active, taskStatus: task.status, taskId: task.taskId, conversationKey: task.conversationKey, pausedReason: runtime.pausedReason, continueCount: runtime.continueCount, maxContinueCount: settings.maxContinueCount, lastContinueAt: runtime.lastContinueAt, cooldownMs: settings.continueCooldownMs, sending: runtime.sending, pageKey: getConversationKey() }; }
  function acceptSignal(signal) { if (!signal || typeof signal !== "object") return false; if (!settings.enabled || !settings.autoContinue || !settings.superviseLongTasks || !task.active || runtime.pausedReason) return false; if (signal.taskId !== task.taskId || signal.conversationKey !== task.conversationKey || task.conversationKey !== getConversationKey()) return false; if (Date.now() - Number(signal.createdAt || 0) > 60000) return false; if (!["risk_word", "stale_progress", "final_ui_seen"].includes(signal.type)) return false; const signals = runtime.externalSignals; if (signal.type === "risk_word") signals.riskWord = true; if (signal.type === "stale_progress") signals.staleProgress = true; if (signal.type === "final_ui_seen") signals.finalUiSeen = true; signals.lastSignalAt = Date.now(); signals.lastMessageHash = String(signal.messageHash || signals.lastMessageHash || ""); signals.reasons = Array.from(new Set([...(signals.reasons || []), String(signal.reason || signal.type)])).slice(-8); return true; }
  function consumeExternalSignals(lastHash) { const signals = runtime.externalSignals; if (!signals?.lastSignalAt) return null; const expired = Date.now() - signals.lastSignalAt > 60000; const mismatch = signals.lastMessageHash && signals.lastMessageHash !== lastHash; if (expired || mismatch) { runtime.externalSignals = blankSignals(); return null; } const result = { riskWord: signals.riskWord, staleProgress: signals.staleProgress, finalUiSeen: signals.finalUiSeen, reasons: [...signals.reasons] }; runtime.externalSignals = blankSignals(); return result; }
  function auditNeeded(raw, gateResult, signal) { return /任务已完成|已完成|完成了|done|completed|finished|ready_to_stop|未验证|未测试|未运行|无法确认|需要你确认|可能|大概|理论上|应该|如果|not verified|not tested|cannot confirm|need confirmation|probably|maybe|should|if\b/i.test(String(raw || "")) || ["unverified_exists", "blocking_risk_exists", "risk_word_exists", "blocking_keyword_in_final", "weak_risk_keyword_in_final"].includes(gateResult.reason) || !!signal?.riskWord || !!signal?.staleProgress || (task.loopCount > 0 && task.loopCount % settings.auditEvery === 0); }

  function maybeContinue() {
    if (!settings.enabled || !settings.autoContinue || !settings.superviseLongTasks || !task.active || runtime.pausedReason || runtime.sending) return false;
    if (task.conversationKey && task.conversationKey !== getConversationKey()) { resetTask("conversation_changed"); return false; }
    if (runtime.continueCount >= settings.maxContinueCount) { runtime.pausedReason = `已达到最大自动继续次数 ${settings.maxContinueCount}`; task.status = "paused_max_continue"; return false; }
    const last = lastAssistantText();
    if (!last || running()) return false;
    if (Date.now() - runtime.lastContinueAt < settings.continueCooldownMs) return false;
    const lastHash = hash(last);
    if (runtime.lastAssistantTextHash === lastHash) return false;
    const finalBlock = parseFinal(last);
    const gateResult = gate(finalBlock);
    task.lastFinal = finalBlock;
    task.lastGateReason = gateResult.reason;
    if (gateResult.canStop) { task.active = false; task.status = "stopped_valid_final"; task.stopReason = "合格 SCH_FINAL 已出现"; runtime.composerFailureCount = 0; runtime.sendFailureCount = 0; runtime.externalSignals = blankSignals(); toast("已达到自验证停止条件"); return false; }
    const editor = input();
    if (!editor || !visible(editor)) { noteComposerFailure("连续多次找不到输入框，自动继续已暂停"); return false; }
    if (inputText(editor)) return false;
    const signal = consumeExternalSignals(lastHash);
    const audit = auditNeeded(last, gateResult, signal);
    task.status = audit ? "auditing" : "continuing";
    if (audit) task.auditCount += 1;
    runtime.sending = true;
    const queued = queuePrompt(audit ? AUDIT : (settings.continuePrompt || CONTINUE), () => { runtime.continueCount += 1; task.loopCount += 1; runtime.sendFailureCount = 0; runtime.composerFailureCount = 0; runtime.lastContinueAt = Date.now(); runtime.lastAssistantTextHash = lastHash; runtime.sending = false; toast(`${audit ? "已触发最终自检" : "已自动发送继续"}（${runtime.continueCount}/${settings.maxContinueCount}）`); }, () => { runtime.sending = false; noteSendFailure("连续多次无法发送，自动继续已暂停"); });
    if (!queued) runtime.sending = false;
    return queued;
  }

  function scrollBottom() { if (Date.now() - lastUserScroll < settings.userScrollPauseMs) return; programmaticScrollUntil = Date.now() + 500; scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight); Array.from(document.querySelectorAll("main,[role='main'],[class*='scroll'],[data-testid*='conversation'],div")).filter((el) => visible(el) && el.scrollHeight - el.clientHeight > 80).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)).slice(0, 4).forEach((el) => { el.scrollTop = el.scrollHeight; }); }
  function assist() { if (!settings.enabled) return; if (settings.keepAtBottom) scrollBottom(); if (settings.autoContinue) maybeContinue(); }
  function requestAssist() { if (document.visibilityState === "hidden") { const now = Date.now(); if (now - lastHiddenAssist < 500) return; lastHiddenAssist = now; assist(); return; } if (assistTimer) return; assistTimer = delay(() => { assistTimer = 0; assist(); }, 350); }
  function own(node) { return node instanceof Element && (node.id === `${APP_ID}-toast` || node.closest?.(`#${APP_ID}-panel`) || node.classList?.contains("safe-confirm-final-toggle")); }
  function ownMut(mutation) { if (own(mutation.target)) return true; const nodes = [...mutation.addedNodes, ...mutation.removedNodes]; return nodes.length > 0 && nodes.every(own); }
  function candidateMayChange(el, deep = false) { return el instanceof Element && (el.matches(BTN) || el.matches(DLG) || el.closest(DLG) || ((deep || el.childElementCount <= 80) && el.querySelector(`${BTN},${DLG}`))); }
  function scanMut(mutation) { if (ownMut(mutation)) return false; if (mutation.type === "characterData") return !!mutation.target.parentElement?.closest(BTN); if (mutation.type === "attributes") return candidateMayChange(mutation.target); return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => candidateMayChange(node, true)); }
  function assistMut(mutation) { if (ownMut(mutation) || !settings.enabled || (!settings.keepAtBottom && !settings.autoContinue)) return false; const may = (node) => node instanceof Element && (node.matches("main,article,form,textarea,[contenteditable='true'],[data-message-author-role]") || node.closest("main,article,form,[data-message-author-role]") || (node.childElementCount <= 120 && node.querySelector("article,form,textarea,[contenteditable='true'],[data-message-author-role]"))); return mutation.type === "attributes" ? may(mutation.target) : (mutation.type === "characterData" ? [mutation.target.parentElement] : [...mutation.addedNodes, ...mutation.removedNodes]).some(may); }
  function loops() { clearTimer(scanLoop); clearTimer(assistLoop); if (settings.enabled && settings.autoConfirm) scanLoop = every(scan, 1000); if (settings.enabled && (settings.keepAtBottom || settings.autoContinue)) assistLoop = every(assist, 1500); }
  function state() { return { connected: true, enabled: settings.enabled, candidateText: candidate ? text(candidate) : "", scanInfo: { ...scanInfo, autoClickable: candidateAutoClickable }, automation: { ...runtime, maxContinueCount: settings.maxContinueCount }, task: { ...task, finalValid: task.lastGateReason === "valid_final", hasFinal: !!task.lastFinal }, settings: { ...settings } }; }
  function popup(msg, _sender, sendResponse) { if (msg?.source !== `${APP_ID}-popup`) return false; (async () => { if (msg.action === "confirm") manualClick(); else if (msg.action === "rescan") scan(); else if (msg.action === "reset-task") resetTask("manual_reset"); else if (msg.action === "set-setting" && Object.prototype.hasOwnProperty.call(DEF, msg.key)) { const value = msg.valueType === "number" ? Number(msg.value) : msg.valueType === "string" ? String(msg.value ?? "") : Boolean(msg.value); settings = cleanSettings({ ...settings, [msg.key]: value }); if ((msg.key === "enabled" || msg.key === "autoContinue") && !value) runtime.externalSignals = blankSignals(); if ((msg.key === "enabled" || msg.key === "autoContinue") && value) { runtime.pausedReason = ""; runtime.externalSignals = blankSignals(); } await saveSettings(); loops(); requestScan(); requestAssist(); } else if (msg.action === "get-state") scan(); sendResponse(state()); })().catch(() => sendResponse(state())); return true; }
  function installBridge() { bridge = { version: "2.2.0", getSnapshot, reportSignal: acceptSignal, clearSignals: () => { runtime.externalSignals = blankSignals(); } }; window.__safeConfirmHelperBridge = bridge; }
  function cleanup() { ac.abort(); observer?.disconnect(); [scanTimer, assistTimer, scanLoop, assistLoop].forEach(clearTimer); timers.forEach((id) => { clearTimeout(id); clearInterval(id); }); timers.clear(); clearMark(); document.getElementById(`${APP_ID}-toast`)?.remove(); chrome.runtime?.onMessage?.removeListener(popup); if (window.__safeConfirmHelperBridge === bridge) delete window.__safeConfirmHelperBridge; }

  window.__safeConfirmHelperCleanup = cleanup;
  installBridge();
  document.addEventListener("keydown", (event) => { if (event.altKey && event.shiftKey && event.key === "Enter") { event.preventDefault(); manualClick(); return; } if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && event.target instanceof Element && event.target.matches("#prompt-textarea,textarea,[contenteditable='true']")) prepare(event.target); }, { capture: true, signal: ac.signal });
  document.addEventListener("submit", (event) => { const editor = input(event.target instanceof Element ? event.target : document); if (editor) prepare(editor); }, { capture: true, signal: ac.signal });
  const pointer = (event) => { const button = event.target instanceof Element ? event.target.closest("button") : null; if (button && /发送|send/i.test(text(button))) { const editor = input(); if (editor) prepare(editor); } };
  document.addEventListener("pointerdown", pointer, { capture: true, signal: ac.signal });
  document.addEventListener("click", pointer, { capture: true, signal: ac.signal });
  document.addEventListener("visibilitychange", () => { lastHiddenScan = 0; lastHiddenAssist = 0; requestScan(); requestAssist(); }, { signal: ac.signal });
  document.addEventListener("scroll", () => { if (Date.now() > programmaticScrollUntil) lastUserScroll = Date.now(); }, { capture: true, passive: true, signal: ac.signal });
  chrome.runtime?.onMessage?.addListener(popup);
  (async () => { settings = await loadSettings(); observer = new MutationObserver((mutations) => { if (mutations.some(scanMut)) requestScan(); if (mutations.some(assistMut)) requestAssist(); }); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ["aria-disabled", "disabled", "hidden", "style", "class", "open"] }); loops(); requestScan(); requestAssist(); console.log("[Safe Confirm Helper] SCH_FINAL 长任务监督已启用。快捷键：Alt + Shift + Enter。"); })().catch((error) => console.error("[Safe Confirm Helper] 启动失败", error));
})();
