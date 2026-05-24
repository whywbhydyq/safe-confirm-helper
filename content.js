(() => {
  const APP_ID = "safe-confirm-helper";
  const STORE = `${APP_ID}:settings`;
  const SESSION_STORE = `${APP_ID}:session`;
  const BTN = "button,[role='button'],input[type='button'],input[type='submit']";
  const DLG = "dialog[open],[role='dialog'],[role='alertdialog'],[aria-modal='true'],[data-radix-dialog-content],[data-headlessui-state],.modal,.popover";
  const FINAL_FORMAT = `<SCH_FINAL>
status: done
covered: ...
proof: ...
unverified: none
risks: none
verdict: ready_to_stop
</SCH_FINAL>`;
  const CONTINUE = `继续执行原始任务，从当前进度后的下一个具体步骤开始。

执行规则：
- 优先处理未完成、未验证或有阻塞风险的部分，不要复述计划，不要阶段性总结，不要只说“任务已完成”。
- 继续推进不能破坏用户已经设定的工程约束，例如提交策略、部署次数、分支策略、权限边界、测试要求或不得频繁触发构建等。
- 如果继续推进和工程约束冲突，先保工程约束，再给出可执行替代路径。
- 单一路径失败时，优先换工具、换路径、生成 patch、脚本、命令、文件包或检查清单；但不能为了推进而制造碎片提交、误触发部署、污染仓库历史或虚构验证结果。
- 如果确实缺少用户权限、账号后台、外部配置、密钥、域名/DNS、付款/广告平台等用户侧操作，暂停并明确说明用户最短需要做什么，不要假装已经完成。

只有在当前工具和权限允许范围内已经形成可验证闭环，且确认无遗漏、无未验证项、无阻塞风险时，才只输出以下格式，不要添加其他文字：
${FINAL_FORMAT}`;
  const AUDIT = `先不要结束。现在只做停机前自检。

按顺序检查：
1. 原始需求是否全部覆盖？
2. 已完成声明分别有什么证据？证据必须来自实际执行结果、工具反馈、文件差异、测试输出、页面验证或明确的可执行替代交付物。
3. 哪些内容只是推测、假设、未运行、未测试或未验证？
4. 是否存在阻塞风险、权限缺口、外部系统依赖、工程约束冲突或可能造成副作用的继续路径？
5. 是否有为了继续推进而破坏用户约束的风险，例如碎片提交 main、重复触发部署、污染仓库历史、绕过测试或虚构验证？

如果有任何未完成、未验证、阻塞风险或工程约束冲突，不要输出 SCH_FINAL；请继续执行、修复、换路径，或交付 patch/脚本/命令/文件包/检查清单等可执行替代物。

只有确认原始需求已覆盖，证据闭环充分，且无未验证项、无阻塞风险、无工程约束冲突时，才只输出以下格式，不要添加其他文字：
${FINAL_FORMAT}`;
  const UNBLOCK = `当前任务尚未完成。不要做停机前自检，不要输出 SCH_FINAL。

请把刚才提到的未完成项、未验证项、工具失败或阻塞点转化为下一步行动：
- 能继续执行的，直接继续执行；
- 能换工具或换路径的，换方案继续；
- 能验证的，先验证，不要把推测当证据；
- 单一路径失败时，不要直接视为最终阻塞，优先尝试其他可用工具路径、patch、脚本、命令、文件包或检查清单；
- 换路径不得制造更大的工程副作用，不得碎片提交 main，不得误触发部署，不得污染仓库历史，不得虚构验证结果；
- 如果缺少用户外部权限、账号后台、密钥、域名/DNS、广告平台或其他用户侧操作，暂停并明确说明用户最短需要做什么；
- 能降级交付的，先完成可执行替代方案。

现在继续推进原始任务，但不能为了推进而破坏用户已经设定的工程约束。`;
  const PAUSE_BLOCKED = `当前任务需要用户外部操作才能继续。请列出阻塞项、需要用户完成的动作、完成后应从哪一步继续。不要输出 SCH_FINAL。`;
  const SUPERVISE = `[SafeConfirm Supervision]\n本轮是受监督的长任务。先执行用户的原始需求，不要一开始就做最终自检，也不要用一句“任务已完成”结束。\n\n执行过程中：\n- 优先推进实际任务；遇到未完成、未验证、工具失败或阻塞风险时继续处理或换路径。\n- 不要把阶段性总结、推测、计划、未运行结果或未验证结果当作完成。\n- 继续推进不能破坏用户已经设定的工程约束；当“继续推进”和“工程约束”冲突时，先保工程约束。\n- 换路径不得造成更大副作用，例如碎片提交 main、重复触发部署、污染仓库历史、绕过测试或虚构验证。\n- 缺少外部权限、账号后台、密钥、域名/DNS、广告平台或其他用户侧操作时，要暂停并说明用户最短需要做什么，不要假装已经完成。\n- 无法直接完成时，优先交付可执行替代物，例如 patch、脚本、命令、文件包、检查清单或回滚方案。\n\n准备停止前：必须自检原始需求覆盖情况、完成证据、未验证项、残余风险和工程约束冲突。\n只有确认当前工具和权限允许范围内已经形成可验证闭环，且无遗漏、无未验证项、无阻塞风险、无工程约束冲突时，才只输出以下格式，不要添加其他文字：\n${FINAL_FORMAT}`;
  const DEF = { enabled: true, autoConfirm: true, keepAtBottom: true, autoContinue: true, superviseLongTasks: true, english: true, highlight: true, continuePrompt: CONTINUE, maxContinueCount: 50, continueCooldownMs: 10000, auditEvery: 3, userScrollPauseMs: 12000 };
  const ZH = [/^确认$/, /^允许$/, /^继续$/, /^批准$/, /确认/, /允许/, /批准/, /继续/];
  const EN = [/^Confirm$/i, /^Approve$/i, /^Allow$/i, /^Continue$/i, /^Accept$/i, /\bConfirm\b/i, /\bApprove\b/i, /\bAllow\b/i, /\bContinue\b/i, /\bAccept\b/i];
  const FIELDS = ["status", "covered", "proof", "unverified", "risks", "verdict"];

  const old = window.__safeConfirmHelperCleanup;
  if (typeof old === "function") old();

  const ac = new AbortController();
  const timers = new Set();
  let settings = { ...DEF };
  let observer = null;
  let bridge = null;
  let candidate = null;
  let candidateAutoClickable = false;
  let clicked = new WeakSet();
  let scanTimer = 0;
  let assistTimer = 0;
  let scanLoop = 0;
  let assistLoop = 0;
  let lastHiddenScan = 0;
  let lastHiddenAssist = 0;
  let lastUserScroll = 0;
  let programmaticScrollUntil = 0;
  let scanInfo = { roots: 0, candidates: 0, matches: 0, autoClickable: false };

  const runtime = {
    continueCount: 0,
    sendFailureCount: 0,
    composerFailureCount: 0,
    lastContinueAt: 0,
    lastAssistantTextHash: "",
    observedAssistantHash: "",
    observedAssistantAt: 0,
    lastAction: "",
    lastPromptKind: "",
    unblockCount: 0,
    auditCount: 0,
    lastActionAt: 0,
    pausedReason: "",
    sending: false,
    externalSignals: blankSignals()
  };
  let task = blankTask();

  function blankTask() { return { active: false, status: "idle", taskId: "", conversationKey: "", startedAt: 0, loopCount: 0, auditCount: 0, promptInjected: false, lastFinal: null, lastGateReason: "", stopReason: "" }; }
  function blankSignals() { return { riskWord: false, staleProgress: false, finalUiSeen: false, reasons: [], lastSignalAt: 0, lastMessageHash: "" }; }
  function norm(value) { return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim(); }
  function hash(value) { let h = 2166136261; const s = String(value || ""); for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function delay(fn, ms) { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; }
  function every(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; }
  function clearTimer(id) { if (!id) return; clearTimeout(id); clearInterval(id); timers.delete(id); }
  function clamp(value, min, max, fallback) { const n = parseInt(value, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
  function getConversationKey() { return `${location.pathname}${location.search}`; }

  function legacyContinuePrompt(value) {
    const text = String(value || "");
    return (/输出\s*SCH_FINAL/.test(text) && !/<SCH_FINAL>/i.test(text)) || /不要总结；不要只说/.test(text) || /继续原始任务。优先处理未完成、未验证或有风险/.test(text) || /继续执行最初的任务/.test(text) || /完成最初的全部任务后请只回复/.test(text);
  }
  function cleanSettings(value) {
    const src = value && typeof value === "object" ? value : {};
    const next = {};
    Object.keys(DEF).forEach((key) => { next[key] = src[key] ?? DEF[key]; });
    next.maxContinueCount = clamp(next.maxContinueCount, 1, 200, 50);
    next.continueCooldownMs = clamp(next.continueCooldownMs, 1000, 120000, 10000);
    next.auditEvery = clamp(next.auditEvery, 1, 20, 3);
    next.userScrollPauseMs = clamp(next.userScrollPauseMs, 1000, 60000, 12000);
    const prompt = String(next.continuePrompt || CONTINUE).trim();
    next.continuePrompt = !prompt || legacyContinuePrompt(prompt) ? CONTINUE : prompt;
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
      const next = cleanSettings(result.settings);
      if (JSON.stringify(result.settings || {}) !== JSON.stringify(next)) await chrome.storage.local.set({ settings: next });
      return next;
    } catch {
      try { return cleanSettings(JSON.parse(localStorage.getItem(STORE) || "{}")); } catch { return cleanSettings({}); }
    }
  }
  async function saveSettings() { settings = cleanSettings(settings); try { await chrome.storage.local.set({ settings }); } catch { localStorage.setItem(STORE, JSON.stringify(settings)); } }

  function sessionRuntime() {
    return { continueCount: runtime.continueCount, sendFailureCount: runtime.sendFailureCount, composerFailureCount: runtime.composerFailureCount, lastContinueAt: runtime.lastContinueAt, lastAssistantTextHash: runtime.lastAssistantTextHash, observedAssistantHash: runtime.observedAssistantHash, observedAssistantAt: runtime.observedAssistantAt, lastAction: runtime.lastAction, lastPromptKind: runtime.lastPromptKind, unblockCount: runtime.unblockCount, auditCount: runtime.auditCount, lastActionAt: runtime.lastActionAt, pausedReason: runtime.pausedReason };
  }
  async function saveSession() { try { await chrome.storage.local.set({ [SESSION_STORE]: { conversationKey: getConversationKey(), task: { ...task }, runtime: sessionRuntime() } }); } catch {} }
  async function loadSession() {
    try {
      const result = await chrome.storage.local.get([SESSION_STORE]);
      const saved = result[SESSION_STORE];
      if (!saved?.task || saved.conversationKey !== getConversationKey()) return;
      task = { ...blankTask(), ...saved.task };
      Object.assign(runtime, sessionRuntime(), saved.runtime && typeof saved.runtime === "object" ? saved.runtime : {}, { sending: false, externalSignals: blankSignals() });
    } catch {}
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
  }
  function enabled(el) { return !!(el && !el.disabled && el.getAttribute("aria-disabled") !== "true" && visible(el)); }
  function text(el) { if (!el) return ""; return [...new Set([el.getAttribute?.("aria-label"), el.getAttribute?.("title"), el.getAttribute?.("value"), el.textContent, el.innerText].filter(Boolean).map((x) => x.trim()).filter(Boolean))].join(" ").replace(/\s+/g, " ").trim(); }
  function cleanAssistantText(el) { if (!el) return ""; const clone = el.cloneNode(true); clone.querySelectorAll?.(".safe-confirm-final-toggle").forEach((node) => node.remove()); return text(clone); }
  function click(el) { if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true })); el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true })); el.click(); }
  function toast(message) { document.getElementById(`${APP_ID}-toast`)?.remove(); const el = document.createElement("div"); el.id = `${APP_ID}-toast`; el.textContent = message; Object.assign(el.style, { position: "fixed", left: "50%", bottom: "92px", transform: "translateX(-50%)", zIndex: "2147483647", background: "rgba(17,24,39,.92)", color: "#fff", padding: "10px 14px", borderRadius: "8px", fontSize: "14px", fontFamily: "system-ui,sans-serif", boxShadow: "0 6px 18px rgba(0,0,0,.2)" }); document.documentElement.appendChild(el); delay(() => el.remove(), 1800); }

  function buttonPatterns() { return settings.english ? ZH.concat(EN) : ZH; }
  function buttonMatch(el) { const label = text(el); return !!label && buttonPatterns().some((pattern) => pattern.test(label)); }
  function score(el) { const label = text(el); let n = 0; if (/确认|confirm/i.test(label)) n += 5; if (/批准|approve/i.test(label)) n += 4; if (/允许|allow/i.test(label)) n += 3; if (/继续|continue/i.test(label)) n += 2; if (el.closest(DLG)) n += 6; return n; }
  function inlineApproval(el) {
    const label = text(el);
    if (!/^(确认|批准|允许|Confirm|Approve|Allow|Accept)$/i.test(label)) return false;
    let root = el.parentElement;
    for (let depth = 0; root && depth < 5; depth += 1, root = root.parentElement) {
      const buttons = Array.from(root.querySelectorAll(BTN)).filter(visible);
      if (buttons.length < 2 || buttons.length > 6) continue;
      const labels = buttons.map(text).join(" ");
      if (/拒绝|取消|deny|reject|decline|cancel/i.test(labels) && /确认|批准|允许|confirm|approve|allow|accept/i.test(labels)) return true;
    }
    return false;
  }
  function clearMark() { const el = document.querySelector('[data-safe-confirm-helper-highlight="true"]'); if (!el) return; el.style.outline = el.dataset.safeConfirmHelperOldOutline || ""; el.style.outlineOffset = el.dataset.safeConfirmHelperOldOutlineOffset || ""; el.removeAttribute("data-safe-confirm-helper-highlight"); }
  function mark() { if (!settings.highlight || !candidate) return; candidate.dataset.safeConfirmHelperOldOutline = candidate.style.outline; candidate.dataset.safeConfirmHelperOldOutlineOffset = candidate.style.outlineOffset; candidate.setAttribute("data-safe-confirm-helper-highlight", "true"); candidate.style.outline = "2px solid #22c55e"; candidate.style.outlineOffset = "3px"; }
  function setCandidate(button, autoClickable = false) { if (candidate === button && candidateAutoClickable === autoClickable) return; clearMark(); candidate = button; candidateAutoClickable = !!autoClickable; if (!button) clicked = new WeakSet(); mark(); }
  function scanRoots(roots, autoClickable) {
    let best = null, bestScore = -1, total = 0, matches = 0;
    for (const root of roots) for (const button of root.querySelectorAll(BTN)) { total += 1; if (!enabled(button) || !buttonMatch(button)) continue; matches += 1; const value = score(button); if (value > bestScore) { best = button; bestScore = value; } }
    scanInfo = { roots: roots.length, candidates: total, matches, autoClickable: !!(best && (autoClickable || inlineApproval(best))) };
    setCandidate(best, scanInfo.autoClickable);
    autoClick();
    return best;
  }
  function scan() { if (!settings.enabled) { setCandidate(null, false); return null; } const modalRoots = Array.from(document.querySelectorAll(DLG)).filter(visible).slice(-4); return scanRoots(modalRoots.length ? modalRoots : [document.body || document.documentElement], !!modalRoots.length); }
  function requestScan() { if (settings.autoConfirm && document.visibilityState === "hidden") { const now = Date.now(); if (now - lastHiddenScan < 250) return; lastHiddenScan = now; scan(); return; } if (scanTimer) return; scanTimer = delay(() => { scanTimer = 0; scan(); }, 120); }
  function autoClick() { if (!settings.enabled || !settings.autoConfirm || !candidate || !candidateAutoClickable || clicked.has(candidate) || !enabled(candidate) || !buttonMatch(candidate)) return false; const label = text(candidate); click(candidate); clicked.add(candidate); toast(`已自动确认：「${label}」`); requestScan(); return true; }
  function manualClick() { const button = candidate && enabled(candidate) && buttonMatch(candidate) ? candidate : scan(); if (!button) return toast("没有找到可见的确认按钮"); const label = text(button); if (confirm(`是否点击按钮：「${label}」？`)) { click(button); toast(`已点击：「${label}」`); requestScan(); } }

  function input(scope = document) { return [...(scope.querySelectorAll?.("#prompt-textarea,textarea,[contenteditable='true']") || []), ...document.querySelectorAll("#prompt-textarea,textarea,[contenteditable='true']")].filter(visible).find((el) => !el.closest(`#${APP_ID}-panel`)) || null; }
  function inputText(el) { return !el ? "" : ("value" in el ? String(el.value || "") : String(el.textContent || "")).trim(); }
  function setInput(el, value) {
    if (!el) return false;
    el.focus();
    if ("value" in el) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set; setter ? setter.call(el, value) : el.value = value; el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    const selection = getSelection();
    if (selection) { const range = document.createRange(); range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range); document.execCommand("insertText", false, value); }
    if (inputText(el) !== value) el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return inputText(el) === value;
  }
  function sendButton(el) { const root = el?.closest?.("form") || document; for (const selector of ["button[data-testid='send-button']", "button[data-testid='composer-send-button']", "button[aria-label*='发送']", "button[aria-label*='Send']", "button[title*='发送']", "button[title*='Send']", "button[type='submit']"]) { const button = root.querySelector(selector) || document.querySelector(selector); if (button && enabled(button)) return button; } return Array.from(document.querySelectorAll(BTN)).filter(enabled).find((button) => /发送|send/i.test(text(button))) || null; }
  function queuePrompt(prompt, sent, failed) { const el = input(); if (!el || !visible(el)) { noteComposerFailure("连续多次找不到输入框，自动继续已暂停"); return false; } const draft = inputText(el); if (draft && !pluginPrompt(draft)) return false; if (!draft && !setInput(el, prompt)) { noteComposerFailure("连续多次无法写入输入框，自动继续已暂停"); return false; } runtime.composerFailureCount = 0; delay(() => trySend(el, 0, sent, failed), 250); return true; }
  function noteComposerFailure(reason) { runtime.composerFailureCount += 1; if (runtime.composerFailureCount >= 3) { runtime.pausedReason = reason; task.status = "paused_composer_failed"; toast(reason); } void saveSession(); }
  function noteSendFailure(reason) { runtime.sendFailureCount += 1; if (runtime.sendFailureCount >= 3) { runtime.pausedReason = reason; task.status = "paused_send_failed"; toast(reason); } void saveSession(); }
  function pressEnter(el) { el.focus(); for (const type of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true })); }
  function trySend(el, attempt, sent, failed) { const button = sendButton(el); if (button && enabled(button)) { click(button); sent?.(); return true; } if (attempt < 6) { delay(() => trySend(el, attempt + 1, sent, failed), 900); return false; } const before = inputText(el); pressEnter(el); delay(() => { const after = inputText(el); if (after && norm(after) === norm(before)) failed?.(); else sent?.(); }, 800); return false; }

  function lastAssistantEl() { const direct = [...document.querySelectorAll("[data-message-author-role='assistant']")].filter(visible); return direct.at(-1) || null; }
  function lastAssistantText() { return cleanAssistantText(lastAssistantEl()); }
  function running() { const buttons = Array.from(document.querySelectorAll(BTN)).filter(visible); return buttons.some((button) => /停止|中止|stop|cancel/i.test(text(button))) || /正在思考|正在运行|正在生成|thinking|running|generating/i.test(lastAssistantText()); }
  function promptKind(raw) { const value = norm(raw); if (value === norm(UNBLOCK) || value.includes("当前任务尚未完成") || value.includes("转化为下一步行动")) return "unblock"; if (value === norm(AUDIT) || value.includes("现在只做停机前自检") || value.includes("停机前自检")) return "audit"; if (value === norm(PAUSE_BLOCKED) || value.includes("需要用户外部操作才能继续")) return "pause"; if (value === norm(CONTINUE) || value.includes("继续原始任务") || value.includes("继续执行原始任务") || value.includes("继续执行最初的任务")) return "continue"; return ""; }
  function pluginPrompt(raw) { return !!promptKind(raw); }

  function resetTask(reason = "") { task = blankTask(); Object.assign(runtime, { continueCount: 0, sendFailureCount: 0, composerFailureCount: 0, lastContinueAt: 0, lastAssistantTextHash: "", observedAssistantHash: "", observedAssistantAt: 0, lastAction: "", lastPromptKind: "", unblockCount: 0, auditCount: 0, lastActionAt: 0, pausedReason: "", sending: false, externalSignals: blankSignals() }); if (reason) task.stopReason = reason; void saveSession(); loops(); }
  function prepare(el) {
    if (!settings.enabled || !settings.superviseLongTasks || !task.active) return false;
    const raw = inputText(el);
    if (!raw || pluginPrompt(raw)) return false;
    if (raw.includes("[SafeConfirm Supervision]")) { if (!task.promptInjected) { task.promptInjected = true; task.status = "supervising"; void saveSession(); } return false; }
    if (task.promptInjected) return false;
    if (!setInput(el, `${raw.trim()}\n\n${SUPERVISE}`)) return false;
    task.promptInjected = true; task.status = "supervising"; task.lastGateReason = ""; void saveSession(); toast("已为本次任务追加监督协议"); return true;
  }

  function finalBody(raw) { const match = String(raw || "").match(/<\s*SCH_FINAL\s*>([\s\S]*?)<\/\s*SCH_FINAL\s*>/i); return match ? match[1].trim() : null; }
  function parseFinal(raw) { const body = finalBody(raw); if (!body) return null; const out = { raw: body }; for (const name of FIELDS) out[name] = field(body, name); if (!out.status && /^[^\p{L}\p{N}]*done\b/iu.test(norm(body))) out.status = "done"; return out; }
  function field(body, name) { const names = FIELDS.join("|"); const match = String(body || "").match(new RegExp(`(?:^|\\s|[·;])${name}\\s*:\\s*([\\s\\S]*?)(?=(?:\\s|[·;])(?:${names})\\s*:|$)`, "i")); return match ? match[1].trim().replace(/[·;]\s*$/, "").trim() : ""; }
  function empty(value) { return ["", "none", "no", "无", "没有", "空", "n/a", "na"].includes(norm(value).toLowerCase()); }
  function block(value) { return /阻塞|高风险|未验证|未测试|未运行|无法确认|需要.*确认|not verified|not tested|not run|cannot confirm|need.*confirmation/i.test(String(value || "")); }
  function weakRisk(value) { return /可能|大概|理论上|应该|如果|尚未|未确认|推测|估计|probably|maybe|should|if\b|likely|assume|assumption|theoretically|could be|might/i.test(String(value || "")); }
  function gate(finalBlock) { if (!finalBlock) return { canStop: false, reason: "missing_final" }; for (const key of FIELDS) if (!String(finalBlock[key] || "").trim()) return { canStop: false, reason: `missing_${key}` }; if (!/^done$/i.test(norm(finalBlock.status))) return { canStop: false, reason: "status_not_done" }; if (!/ready_to_stop/i.test(norm(finalBlock.verdict))) return { canStop: false, reason: "verdict_not_ready" }; if (!empty(finalBlock.unverified)) return { canStop: false, reason: "unverified_exists" }; if (!empty(finalBlock.risks) && block(finalBlock.risks)) return { canStop: false, reason: "blocking_risk_exists" }; if (!empty(finalBlock.risks) && weakRisk(finalBlock.risks)) return { canStop: false, reason: "risk_word_exists" }; if (block(finalBlock.raw)) return { canStop: false, reason: "blocking_keyword_in_final" }; if (weakRisk(finalBlock.raw)) return { canStop: false, reason: "weak_risk_keyword_in_final" }; return { canStop: true, reason: "valid_final" }; }

  function negatedReady(raw) { return /不应视为\s*ready_to_stop|不是\s*ready_to_stop|不能.*ready_to_stop|not\s+ready_to_stop|not.*ready to stop|should\s+not.*ready_to_stop|should\s+not.*ready to stop/i.test(String(raw || "")); }
  function blockedOrIncomplete(raw) { return /未完成|没有全部覆盖|未覆盖|未验证|未测试|未运行|无法验证|无法确认|不能输出\s*SCH_FINAL|不要输出\s*SCH_FINAL|不能结束|阻塞|失败|被拦截|权限不足|无法访问|不能\s*git\s*push|不能部署|not complete|incomplete|not verified|not tested|not run|cannot verify|cannot confirm|blocked|failed|permission denied|unable to access|cannot push|cannot deploy|do not output\s*SCH_FINAL/i.test(String(raw || "")) || negatedReady(raw); }
  function externalBlock(raw) { return /需要(你|用户|人工|手动).*(登录|提供|配置|绑定|授权|token|key|密钥|账号|域名|Search Console|AdSense)|必须(你|用户|人工|手动).*(登录|提供|配置|绑定|授权|token|key|密钥|账号|域名|Search Console|AdSense)|requires? user|need(s)? user|must be done by user|manual login|manual configuration|provide .*token|provide .*key/i.test(String(raw || "")); }
  function completionIntent(raw) { return /任务全部完成|已经完成全部|全部要求已完成|可以结束|任务已完成|已完成全部|done|completed|finished|ready_to_stop/i.test(String(raw || "")) && !blockedOrIncomplete(raw); }
  function periodicAuditDue() { return task.loopCount > 0 && task.loopCount % settings.auditEvery === 0 && runtime.lastAction !== "unblock" && runtime.lastAction !== "audit"; }
  function classifyNextAction(raw, finalBlock, gateResult, signal) { if (gateResult?.canStop) return "stop"; if (externalBlock(raw) && runtime.lastAction === "unblock" && runtime.unblockCount >= 1) return "pause"; if (blockedOrIncomplete(raw) || !!signal?.riskWord || !!signal?.staleProgress) return "unblock"; if (finalBlock || completionIntent(raw) || !!signal?.finalUiSeen || periodicAuditDue()) return "audit"; return "continue"; }
  function promptForAction(action) { if (action === "audit") return AUDIT; if (action === "unblock") return UNBLOCK; if (action === "pause") return PAUSE_BLOCKED; return settings.continuePrompt || CONTINUE; }
  function statusForAction(action) { if (action === "audit") return "auditing"; if (action === "unblock") return "unblocking"; if (action === "pause") return "paused_blocked"; return "continuing"; }
  function recordAction(action) { runtime.lastAction = action; runtime.lastPromptKind = action; runtime.lastActionAt = Date.now(); if (action === "unblock") runtime.unblockCount += 1; if (action === "audit") { runtime.auditCount += 1; task.auditCount += 1; } }

  function getSnapshot() { return { enabled: settings.enabled, autoContinue: settings.autoContinue, keepAtBottom: settings.keepAtBottom, superviseLongTasks: settings.superviseLongTasks, taskActive: task.active, promptInjected: task.promptInjected, taskStatus: task.status, taskId: task.taskId, conversationKey: task.conversationKey, pausedReason: runtime.pausedReason, continueCount: runtime.continueCount, maxContinueCount: settings.maxContinueCount, lastContinueAt: runtime.lastContinueAt, cooldownMs: settings.continueCooldownMs, sending: runtime.sending, pageKey: getConversationKey() }; }
  function acceptSignal(signal) { if (!signal || typeof signal !== "object") return false; if (!settings.enabled || !settings.autoContinue || !settings.superviseLongTasks || !task.active || !task.promptInjected || runtime.pausedReason) return false; if (signal.taskId !== task.taskId || signal.conversationKey !== task.conversationKey || task.conversationKey !== getConversationKey()) return false; if (Date.now() - Number(signal.createdAt || 0) > 60000) return false; if (!["risk_word", "stale_progress", "final_ui_seen"].includes(signal.type)) return false; const signals = runtime.externalSignals; if (signal.type === "risk_word") signals.riskWord = true; if (signal.type === "stale_progress") signals.staleProgress = true; if (signal.type === "final_ui_seen") signals.finalUiSeen = true; signals.lastSignalAt = Date.now(); signals.lastMessageHash = String(signal.messageHash || signals.lastMessageHash || ""); signals.reasons = Array.from(new Set([...(signals.reasons || []), String(signal.reason || signal.type)])).slice(-8); return true; }
  function consumeExternalSignals(lastHash) { const signals = runtime.externalSignals; if (!signals?.lastSignalAt) return null; const expired = Date.now() - signals.lastSignalAt > 60000; const mismatch = signals.lastMessageHash && signals.lastMessageHash !== lastHash; if (expired || mismatch) { runtime.externalSignals = blankSignals(); return null; } const result = { riskWord: signals.riskWord, staleProgress: signals.staleProgress, finalUiSeen: signals.finalUiSeen, reasons: [...signals.reasons] }; runtime.externalSignals = blankSignals(); return result; }
  function assistantStable(lastHash) { if (runtime.observedAssistantHash !== lastHash) { runtime.observedAssistantHash = lastHash; runtime.observedAssistantAt = Date.now(); void saveSession(); return false; } return Date.now() - runtime.observedAssistantAt >= 3500; }

  async function startCurrentSupervision() { if (runtime.sending) return { ok: false, reason: "正在发送中" }; settings = cleanSettings({ ...settings, enabled: true, superviseLongTasks: true, autoContinue: true }); await saveSettings(); task = { active: true, status: "armed", taskId: `${Date.now().toString(36)}-manual-${hash(getConversationKey())}`, conversationKey: getConversationKey(), startedAt: Date.now(), loopCount: 0, auditCount: 0, promptInjected: false, lastFinal: null, lastGateReason: "", stopReason: "" }; Object.assign(runtime, { continueCount: 0, sendFailureCount: 0, composerFailureCount: 0, lastContinueAt: 0, lastAssistantTextHash: "", observedAssistantHash: "", observedAssistantAt: 0, lastAction: "", lastPromptKind: "", unblockCount: 0, auditCount: 0, lastActionAt: 0, pausedReason: "", sending: false, externalSignals: blankSignals() }); await saveSession(); loops(); requestAssist(); toast("已开启持续监督"); return { ok: true }; }
  function maybeContinue() {
    if (!settings.enabled || !settings.autoContinue || !settings.superviseLongTasks || !task.active || !task.promptInjected || runtime.pausedReason || runtime.sending) return false;
    if (task.conversationKey && task.conversationKey !== getConversationKey()) { resetTask("conversation_changed"); return false; }
    if (runtime.continueCount >= settings.maxContinueCount) { runtime.pausedReason = `已达到最大自动继续次数 ${settings.maxContinueCount}`; task.status = "paused_max_continue"; void saveSession(); return false; }
    const last = lastAssistantText();
    if (!last || running()) return false;
    if (Date.now() - runtime.lastContinueAt < settings.continueCooldownMs) return false;
    const lastHash = hash(last);
    if (document.visibilityState !== "visible" || !assistantStable(lastHash)) return false;
    if (runtime.lastAssistantTextHash === lastHash) return false;
    const finalBlock = parseFinal(last);
    const gateResult = gate(finalBlock);
    task.lastFinal = finalBlock;
    task.lastGateReason = gateResult.reason;
    void saveSession();
    if (gateResult.canStop) { task.active = false; task.status = "stopped_valid_final"; task.stopReason = "合格 SCH_FINAL 已出现"; runtime.composerFailureCount = 0; runtime.sendFailureCount = 0; runtime.externalSignals = blankSignals(); void saveSession(); loops(); toast("已达到自验证停止条件"); return false; }
    const signal = consumeExternalSignals(lastHash);
    const action = classifyNextAction(last, finalBlock, gateResult, signal);
    if (action === "pause") { runtime.pausedReason = "需要用户外部操作才能继续"; task.status = "paused_blocked"; runtime.lastAction = "pause"; runtime.lastPromptKind = "pause"; runtime.lastActionAt = Date.now(); void saveSession(); toast("已暂停：需要用户外部操作"); return false; }
    const editor = input();
    if (!editor || !visible(editor)) { noteComposerFailure("连续多次找不到输入框，自动继续已暂停"); return false; }
    const prompt = promptForAction(action);
    const draft = inputText(editor);
    if (draft) { if (!pluginPrompt(draft)) return false; if (norm(draft) !== norm(prompt) && !setInput(editor, prompt)) return false; runtime.sending = true; void saveSession(); return trySend(editor, 0, () => sentAction(action, lastHash, true), () => { runtime.sending = false; noteSendFailure("连续多次无法发送，自动继续已暂停"); }); }
    task.status = statusForAction(action);
    runtime.sending = true;
    void saveSession();
    const queued = queuePrompt(prompt, () => sentAction(action, lastHash, false), () => { runtime.sending = false; noteSendFailure("连续多次无法发送，自动继续已暂停"); });
    if (!queued) { runtime.sending = false; void saveSession(); }
    return queued;
  }
  function sentAction(action, lastHash, queued) { runtime.continueCount += 1; task.loopCount += 1; recordAction(action); runtime.sendFailureCount = 0; runtime.composerFailureCount = 0; runtime.lastContinueAt = Date.now(); runtime.lastAssistantTextHash = lastHash; runtime.sending = false; void saveSession(); const label = action === "audit" ? "审计" : action === "unblock" ? "解阻" : "继续"; toast(queued ? `已发送已排队的${label}提示（${runtime.continueCount}/${settings.maxContinueCount}）` : `${action === "audit" ? "已触发最终自检" : action === "unblock" ? "已发送解阻提示" : "已自动发送继续"}（${runtime.continueCount}/${settings.maxContinueCount}）`); }

  function supervisionForcesBottom() { return !!(settings.enabled && settings.superviseLongTasks && task.active && task.status !== "stopped_valid_final"); }
  function shouldKeepBottom() { return !!(settings.enabled && (settings.keepAtBottom || supervisionForcesBottom())); }
  function scrollTargets() {
    const targets = new Set([document.scrollingElement, document.documentElement, document.body].filter(Boolean));
    Array.from(document.querySelectorAll("main,[role='main'],[data-testid*='conversation'],[class*='conversation'],[class*='thread'],[class*='scroll']"))
      .filter((el) => el instanceof Element && visible(el) && el.scrollHeight - el.clientHeight > 80)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 4)
      .forEach((el) => targets.add(el));
    return Array.from(targets);
  }
  function scrollBottom() { if (!shouldKeepBottom() || document.visibilityState === "hidden") return; if (Date.now() - lastUserScroll < settings.userScrollPauseMs) return; programmaticScrollUntil = Date.now() + 1500; for (const target of scrollTargets()) { if (target === document.scrollingElement || target === document.documentElement || target === document.body) scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight); else target.scrollTop = target.scrollHeight; } }
  function assist() { if (!settings.enabled) return; if (shouldKeepBottom()) scrollBottom(); if (settings.autoContinue) maybeContinue(); }
  function requestAssist() { if (document.visibilityState === "hidden") { const now = Date.now(); if (now - lastHiddenAssist < 500) return; lastHiddenAssist = now; assist(); return; } if (assistTimer) return; assistTimer = delay(() => { assistTimer = 0; assist(); }, 350); }

  function own(node) { return node instanceof Element && (node.id === `${APP_ID}-toast` || node.closest?.(`#${APP_ID}-panel`) || node.classList?.contains("safe-confirm-final-toggle")); }
  function ownMut(mutation) { if (own(mutation.target)) return true; const nodes = [...mutation.addedNodes, ...mutation.removedNodes]; return nodes.length > 0 && nodes.every(own); }
  function candidateMayChange(el, deep = false) { return el instanceof Element && (el.matches(BTN) || el.matches(DLG) || el.closest(DLG) || ((deep || el.childElementCount <= 80) && el.querySelector(`${BTN},${DLG}`))); }
  function scanMut(mutation) { if (ownMut(mutation)) return false; if (mutation.type === "characterData") return !!mutation.target.parentElement?.closest(BTN); if (mutation.type === "attributes") return candidateMayChange(mutation.target); return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => candidateMayChange(node, true)); }
  function assistMut(mutation) { if (ownMut(mutation) || !settings.enabled || (!settings.autoContinue && !settings.keepAtBottom && !supervisionForcesBottom())) return false; const may = (node) => node instanceof Element && (node.matches("main,article,form,textarea,[contenteditable='true'],[data-message-author-role]") || node.closest("main,article,form,[data-message-author-role]") || (node.childElementCount <= 120 && node.querySelector("article,form,textarea,[contenteditable='true'],[data-message-author-role]"))); return mutation.type === "attributes" ? may(mutation.target) : (mutation.type === "characterData" ? [mutation.target.parentElement] : [...mutation.addedNodes, ...mutation.removedNodes]).some(may); }
  function loops() { clearTimer(scanLoop); clearTimer(assistLoop); if (settings.enabled && settings.autoConfirm) scanLoop = every(scan, 1000); if (settings.enabled && (settings.autoContinue || settings.keepAtBottom || supervisionForcesBottom())) assistLoop = every(assist, 1500); }

  function state() { return { connected: true, enabled: settings.enabled, candidateText: candidate ? text(candidate) : "", scanInfo: { ...scanInfo, autoClickable: candidateAutoClickable }, automation: { ...runtime, maxContinueCount: settings.maxContinueCount }, task: { ...task, finalValid: task.lastGateReason === "valid_final", hasFinal: !!task.lastFinal }, settings: { ...settings } }; }
  function popup(msg, _sender, sendResponse) { if (msg?.source !== `${APP_ID}-popup`) return false; (async () => { if (msg.action === "confirm") manualClick(); else if (msg.action === "rescan") scan(); else if (msg.action === "reset-task") resetTask("manual_reset"); else if (msg.action === "takeover-current") await startCurrentSupervision(); else if (msg.action === "set-setting" && Object.prototype.hasOwnProperty.call(DEF, msg.key)) { const value = msg.valueType === "number" ? Number(msg.value) : msg.valueType === "string" ? String(msg.value ?? "") : Boolean(msg.value); settings = cleanSettings({ ...settings, [msg.key]: value }); if ((msg.key === "enabled" || msg.key === "autoContinue") && !value) runtime.externalSignals = blankSignals(); if ((msg.key === "enabled" || msg.key === "autoContinue") && value) { runtime.pausedReason = ""; runtime.externalSignals = blankSignals(); if (task.status?.startsWith("paused")) task.status = task.promptInjected ? "supervising" : "armed"; } await saveSettings(); await saveSession(); loops(); requestScan(); requestAssist(); } else if (msg.action === "get-state") scan(); sendResponse(state()); })().catch(() => sendResponse(state())); return true; }

  function installBridge() { bridge = { version: "2.3.0", getSnapshot, reportSignal: acceptSignal, clearSignals: () => { runtime.externalSignals = blankSignals(); } }; window.__safeConfirmHelperBridge = bridge; }
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

  (async () => { settings = await loadSettings(); await loadSession(); observer = new MutationObserver((mutations) => { if (mutations.some(scanMut)) requestScan(); if (mutations.some(assistMut)) requestAssist(); }); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ["aria-disabled", "disabled", "hidden", "style", "class", "open"] }); loops(); requestScan(); requestAssist(); console.log("[Safe Confirm Helper] 2.3.0 已启用。快捷键：Alt + Shift + Enter。"); })().catch((error) => console.error("[Safe Confirm Helper] 启动失败", error));
})();
