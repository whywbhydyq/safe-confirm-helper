(() => {
  const APP_ID = "safe-confirm-helper";
  const STORAGE_KEY = `${APP_ID}:settings`;
  const BUTTON_SELECTOR = "button, [role='button'], input[type='button'], input[type='submit']";
  const SCAN_DEBOUNCE_MS = 120;
  const HIDDEN_SCAN_MIN_GAP_MS = 250;
  const AUTO_SCAN_INTERVAL_MS = 1000;
  const ASSIST_DEBOUNCE_MS = 350;
  const HIDDEN_ASSIST_MIN_GAP_MS = 500;
  const ASSIST_WATCHDOG_INTERVAL_MS = 1500;
  const CONTINUE_COOLDOWN_MS = 10000;
  const USER_SCROLL_PAUSE_MS = 12000;
  const SEND_RETRY_DELAY_MS = 700;
  const MAX_CONTINUE_COUNT = 50;
  const MAX_SEND_RETRIES = 2;
  const MAX_CONSECUTIVE_SEND_FAILURES = 3;
  const COMPLETION_PHRASE = "任务已完成";
  const DEFAULT_CONTINUE_PROMPT = `继续执行最初的任务。不要总结，不要停下，直到最初任务全部完成。完成后请只回复：${COMPLETION_PHRASE}`;
  const DIALOG_SELECTOR = [
    "dialog[open]",
    "[role='dialog']",
    "[role='alertdialog']",
    "[aria-modal='true']",
    "[data-radix-dialog-content]",
    "[data-headlessui-state]",
    ".modal",
    ".popover"
  ].join(",");

  const TEXT_PATTERNS = {
    zh: [/^确认$/, /^允许$/, /^继续$/, /^批准$/, /确认/, /允许/, /批准/, /继续/],
    en: [
      /^Confirm$/i,
      /^Approve$/i,
      /^Allow$/i,
      /^Continue$/i,
      /^Accept$/i,
      /\bConfirm\b/i,
      /\bApprove\b/i,
      /\bAllow\b/i,
      /\bContinue\b/i,
      /\bAccept\b/i
    ]
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    english: true,
    highlight: true,
    autoConfirm: true,
    keepAtBottom: true,
    autoContinue: true,
    continuePrompt: DEFAULT_CONTINUE_PROMPT
  };
  const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

  const previousCleanup = window.__safeConfirmHelperCleanup;
  if (typeof previousCleanup === "function") previousCleanup();

  const abortController = new AbortController();
  const timers = new Set();
  let observer = null;
  let scanTimerId = 0;
  let assistantTimerId = 0;
  let cachedButton = null;
  let lastScanAt = 0;
  let lastHiddenScanAt = 0;
  let lastHiddenAssistantAt = 0;
  let lastContinueAt = 0;
  let lastContinueAssistantText = "";
  let continueCount = 0;
  let sendFailureCount = 0;
  let lastUserScrollAt = 0;
  let programmaticScrollUntil = 0;
  let autoContinuePausedReason = "";
  let autoScanIntervalId = 0;
  let assistWatchdogIntervalId = 0;
  let autoClickedButtons = new WeakSet();
  let lastScanInfo = {
    roots: 0,
    candidates: 0,
    matches: 0
  };
  let settings = loadSettings();
  let activePatterns = getPatternsForEnglish(settings.english);

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const saved = parsed && typeof parsed === "object" ? parsed : {};
      const next = {};
      for (const key of SETTING_KEYS) {
        next[key] = saved[key] ?? DEFAULT_SETTINGS[key];
      }
      return next;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function setManagedTimeout(callback, delay) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      callback();
    }, delay);
    timers.add(id);
    return id;
  }

  function clearManagedTimeout(id) {
    if (!id) return;

    window.clearTimeout(id);
    window.clearInterval(id);
    timers.delete(id);
  }

  function setManagedInterval(callback, delay) {
    const id = window.setInterval(callback, delay);
    timers.add(id);
    return id;
  }

  function getPatternsForEnglish(english) {
    return english
      ? [...TEXT_PATTERNS.zh, ...TEXT_PATTERNS.en]
      : TEXT_PATTERNS.zh;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.pointerEvents === "none"
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  }

  function isEnabledButton(el) {
    return (
      el &&
      !el.disabled &&
      el.getAttribute("aria-disabled") !== "true" &&
      isVisible(el)
    );
  }

  function getElementText(el) {
    if (!el) return "";
    const value = el.getAttribute("value");
    const label = el.getAttribute("aria-label") || el.getAttribute("title");
    const textParts = [label, value, el.textContent, el.innerText]
      .filter(Boolean)
      .map((text) => text.trim())
      .filter(Boolean);

    return [...new Set(textParts)]
      .join(" ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function matchesConfirmText(el) {
    const text = getElementText(el);
    return Boolean(text) && activePatterns.some((pattern) => pattern.test(text));
  }

  function scoreButton(el) {
    const rect = el.getBoundingClientRect();
    const text = getElementText(el);
    let score = 0;

    if (/确认|confirm/i.test(text)) score += 5;
    if (/批准|approve/i.test(text)) score += 4;
    if (/允许|allow/i.test(text)) score += 3;
    if (/继续|continue/i.test(text)) score += 2;
    if (el.closest(DIALOG_SELECTOR)) score += 6;
    if (rect.bottom > window.innerHeight * 0.45) score += 1;

    return score;
  }

  function getScanRoots() {
    const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR))
      .filter(isVisible)
      .slice(-4);

    return dialogs.length ? dialogs : [document.body || document.documentElement];
  }

  function scanForButton() {
    if (!settings.enabled) {
      setCachedButton(null);
      return null;
    }

    const roots = getScanRoots();
    let best = null;
    let bestScore = -1;
    let candidateCount = 0;
    let matchCount = 0;

    for (const root of roots) {
      const candidates = root.querySelectorAll(BUTTON_SELECTOR);
      candidateCount += candidates.length;

      for (const candidate of candidates) {
        if (!isEnabledButton(candidate) || !matchesConfirmText(candidate)) continue;

        matchCount += 1;
        const score = scoreButton(candidate);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
    }

    lastScanInfo = {
      roots: roots.length,
      candidates: candidateCount,
      matches: matchCount
    };
    setCachedButton(best);
    lastScanAt = Date.now();
    tryAutoClick();
    return best;
  }

  function getCurrentButton() {
    if (cachedButton && isEnabledButton(cachedButton) && matchesConfirmText(cachedButton)) {
      return cachedButton;
    }

    return scanForButton();
  }

  function setCachedButton(button) {
    if (cachedButton === button) {
      updatePanelState();
      return;
    }

    clearHighlight();
    cachedButton = button;
    if (!button) autoClickedButtons = new WeakSet();
    applyHighlight();
    updatePanelState();
  }

  function requestScan() {
    if (settings.autoConfirm && document.visibilityState === "hidden") {
      const now = Date.now();
      if (now - lastHiddenScanAt < HIDDEN_SCAN_MIN_GAP_MS) return;

      lastHiddenScanAt = now;
      scanForButton();
      return;
    }

    if (scanTimerId) return;

    scanTimerId = setManagedTimeout(() => {
      scanTimerId = 0;
      scanForButton();
    }, SCAN_DEBOUNCE_MS);
  }

  function clickConfirmButton() {
    const button = getCurrentButton();

    if (!button) {
      showToast("没有找到可见的确认按钮");
      return;
    }

    const text = getElementText(button);
    const ok = window.confirm(`是否点击按钮：「${text}」？`);

    if (!ok) return;

    clickElement(button);
    showToast(`已点击：「${text}」`);
    requestScan();
  }

  function clickButtonWithoutPrompt(button, reason) {
    if (!button || !isEnabledButton(button) || !matchesConfirmText(button)) return false;

    const text = getElementText(button);
    clickElement(button);
    showToast(`${reason}：「${text}」`);
    requestScan();
    return true;
  }

  function clickElement(el) {
    if (typeof PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    }
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    if (typeof PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    }
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click();
  }

  function updateAutoScanLoop() {
    clearManagedTimeout(autoScanIntervalId);
    autoScanIntervalId = 0;

    if (!settings.enabled || !settings.autoConfirm) return;

    autoScanIntervalId = setManagedInterval(scanForButton, AUTO_SCAN_INTERVAL_MS);
  }

  function tryAutoClick() {
    if (!settings.autoConfirm || !cachedButton || autoClickedButtons.has(cachedButton)) return false;

    const didClick = clickButtonWithoutPrompt(cachedButton, "已自动确认");
    if (didClick) autoClickedButtons.add(cachedButton);
    return didClick;
  }

  function updateAssistWatchdogLoop() {
    clearManagedTimeout(assistWatchdogIntervalId);
    assistWatchdogIntervalId = 0;

    if (!settings.enabled || (!settings.keepAtBottom && !settings.autoContinue)) return;

    assistWatchdogIntervalId = setManagedInterval(runAssistantAutomation, ASSIST_WATCHDOG_INTERVAL_MS);
  }

  function requestAssistantAutomation() {
    if (document.visibilityState === "hidden") {
      const now = Date.now();
      if (now - lastHiddenAssistantAt < HIDDEN_ASSIST_MIN_GAP_MS) return;

      lastHiddenAssistantAt = now;
      runAssistantAutomation();
      return;
    }

    if (assistantTimerId) return;

    assistantTimerId = setManagedTimeout(() => {
      assistantTimerId = 0;
      runAssistantAutomation();
    }, ASSIST_DEBOUNCE_MS);
  }

  function runAssistantAutomation() {
    if (!settings.enabled) return;

    if (settings.keepAtBottom) scrollConversationToBottom();
    if (settings.autoContinue) maybeSendContinuePrompt();
    updatePanelState();
  }

  function scrollConversationToBottom() {
    if (Date.now() - lastUserScrollAt < USER_SCROLL_PAUSE_MS) return;

    programmaticScrollUntil = Date.now() + 500;
    const targets = getScrollableTargets();
    for (const target of targets) {
      if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
        window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
      } else {
        target.scrollTop = target.scrollHeight;
      }
    }
  }

  function getScrollableTargets() {
    const targets = new Set([document.scrollingElement, document.documentElement, document.body].filter(Boolean));
    const elements = Array.from(document.querySelectorAll("main, [role='main'], [class*='scroll'], [data-testid*='conversation'], div"));

    elements
      .filter((el) => {
        if (!(el instanceof Element) || !isVisible(el)) return false;
        const style = window.getComputedStyle(el);
        const canScroll = /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
        return canScroll && el.scrollHeight - el.clientHeight > 80;
      })
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 4)
      .forEach((el) => targets.add(el));

    return [...targets];
  }

  function maybeSendContinuePrompt() {
    if (autoContinuePausedReason) return false;
    if (continueCount >= MAX_CONTINUE_COUNT) {
      pauseAutoContinue(`已达到最大自动继续次数 ${MAX_CONTINUE_COUNT}`);
      return false;
    }

    const lastAssistantText = getLastAssistantText();
    if (!lastAssistantText) return false;
    if (lastAssistantText.includes(COMPLETION_PHRASE)) {
      autoContinuePausedReason = "";
      return false;
    }
    if (isAssistantRunning()) return false;
    if (Date.now() - lastContinueAt < CONTINUE_COOLDOWN_MS) return false;
    if (lastContinueAssistantText && lastContinueAssistantText === lastAssistantText) return false;

    const input = findComposerInput();
    if (!input || !isVisible(input) || getComposerText(input)) return false;

    if (!setComposerText(input, getContinuePrompt())) return false;

    lastContinueAt = Date.now();
    lastContinueAssistantText = lastAssistantText;
    setManagedTimeout(() => trySendContinue(input, 0), 120);
    return true;
  }

  function trySendContinue(input, attempt) {
    const sendButton = findSendButton(input);
    if (sendButton && isEnabledButton(sendButton)) {
      clickElement(sendButton);
      continueCount += 1;
      sendFailureCount = 0;
      showToast(`已自动发送继续执行（${continueCount}/${MAX_CONTINUE_COUNT}）`);
      return true;
    }

    sendFailureCount += 1;
    if (sendFailureCount >= MAX_CONSECUTIVE_SEND_FAILURES) {
      pauseAutoContinue("连续多次无法发送，自动继续已暂停");
      return false;
    }

    if (attempt < MAX_SEND_RETRIES) {
      setManagedTimeout(() => trySendContinue(input, attempt + 1), SEND_RETRY_DELAY_MS);
      return false;
    }

    showToast("继续提示已填入，但发送按钮不可用");
    return false;
  }

  function pauseAutoContinue(reason) {
    autoContinuePausedReason = reason;
    settings = { ...settings, autoContinue: false };
    saveSettings();
    updateAssistWatchdogLoop();
    showToast(reason);
  }

  function getContinuePrompt() {
    const prompt = String(settings.continuePrompt || "").trim();
    return prompt || DEFAULT_CONTINUE_PROMPT;
  }

  function getLastAssistantText() {
    const assistantMessages = [...document.querySelectorAll("[data-message-author-role='assistant']")]
      .filter(isVisible);
    if (assistantMessages.length) {
      return getElementText(assistantMessages.at(-1));
    }

    const messages = [...document.querySelectorAll("article, [data-testid*='conversation-turn']")]
      .filter(isVisible);

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const role = message.getAttribute("data-message-author-role");
      const text = getElementText(message);
      if (!text) continue;
      if (role === "user") continue;
      if (role === "assistant" || !message.querySelector("textarea, [contenteditable='true']")) return text;
    }

    return "";
  }

  function isAssistantRunning() {
    const buttons = Array.from(document.querySelectorAll(BUTTON_SELECTOR)).filter(isVisible);
    if (buttons.some((button) => /停止|中止|stop|cancel/i.test(getElementText(button)))) return true;

    const lastText = getLastAssistantText();
    return /正在思考|正在运行|正在生成|thinking|running|generating/i.test(lastText);
  }

  function findComposerInput() {
    const candidates = [
      ...document.querySelectorAll("#prompt-textarea, textarea, [contenteditable='true']")
    ].filter(isVisible);

    return candidates.find((el) => !el.closest(`#${APP_ID}-panel`)) || null;
  }

  function getComposerText(input) {
    if ("value" in input) return String(input.value || "").trim();
    return (input.textContent || "").trim();
  }

  function setComposerText(input, text) {
    input.focus();

    if ("value" in input) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      if (setter) setter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);
    }

    if (getComposerText(input) !== text) input.textContent = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return getComposerText(input) === text;
  }

  function findSendButton(input) {
    const form = input.closest("form");
    const selectors = [
      "button[data-testid='send-button']",
      "button[aria-label*='发送']",
      "button[aria-label*='Send']",
      "button[title*='发送']",
      "button[title*='Send']"
    ];

    for (const selector of selectors) {
      const button = (form || document).querySelector(selector);
      if (button && isEnabledButton(button)) return button;
    }

    const submitButton = (form || document).querySelector("button[type='submit']");
    if (submitButton && isEnabledButton(submitButton)) return submitButton;

    const buttons = Array.from((form || document).querySelectorAll("button")).filter(isEnabledButton);
    return buttons.find((button) => /发送|send/i.test(getElementText(button))) || null;
  }

  function getPublicState() {
    return {
      enabled: settings.enabled,
      candidateText: cachedButton ? getElementText(cachedButton) : "",
      scanInfo: { ...lastScanInfo },
      taskComplete: getLastAssistantText().includes(COMPLETION_PHRASE),
      continueCount,
      maxContinueCount: MAX_CONTINUE_COUNT,
      autoContinuePausedReason,
      settings: { ...settings }
    };
  }

  function clearHighlight() {
    const highlighted = document.querySelector(`[data-${APP_ID}-highlight="true"]`);
    if (!highlighted) return;

    highlighted.style.outline = highlighted.dataset.safeConfirmHelperOldOutline || "";
    highlighted.style.outlineOffset = highlighted.dataset.safeConfirmHelperOldOutlineOffset || "";
    highlighted.removeAttribute(`data-${APP_ID}-highlight`);
    delete highlighted.dataset.safeConfirmHelperOldOutline;
    delete highlighted.dataset.safeConfirmHelperOldOutlineOffset;
  }

  function applyHighlight() {
    if (!settings.highlight || !cachedButton) return;

    cachedButton.dataset.safeConfirmHelperOldOutline = cachedButton.style.outline;
    cachedButton.dataset.safeConfirmHelperOldOutlineOffset = cachedButton.style.outlineOffset;
    cachedButton.setAttribute(`data-${APP_ID}-highlight`, "true");
    cachedButton.style.outline = "2px solid #22c55e";
    cachedButton.style.outlineOffset = "3px";
  }

  function showToast(message) {
    const old = document.getElementById(`${APP_ID}-toast`);
    if (old) old.remove();

    const toast = document.createElement("div");
    toast.id = `${APP_ID}-toast`;
    toast.textContent = message;

    Object.assign(toast.style, {
      position: "fixed",
      left: "50%",
      bottom: "92px",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      background: "rgba(17, 24, 39, 0.92)",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "8px",
      fontSize: "14px",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      boxShadow: "0 6px 18px rgba(0,0,0,.2)"
    });

    document.documentElement.appendChild(toast);
    setManagedTimeout(() => toast.remove(), 1800);
  }

  function handlePopupMessage(message, _sender, sendResponse) {
    if (message?.source !== `${APP_ID}-popup`) return false;

    if (message.action === "get-state") {
      scanForButton();
      sendResponse(getPublicState());
      return true;
    }

    if (message.action === "confirm") {
      clickConfirmButton();
      sendResponse(getPublicState());
      return true;
    }

    if (message.action === "rescan") {
      scanForButton();
      sendResponse(getPublicState());
      return true;
    }

    if (message.action === "set-setting") {
      if (!SETTING_KEYS.includes(message.key)) {
        sendResponse(getPublicState());
        return true;
      }

      const value = message.valueType === "number"
        ? Number(message.value)
        : message.valueType === "string"
          ? String(message.value ?? "")
          : Boolean(message.value);

      settings = { ...settings, [message.key]: value };
      if (message.key === "english") activePatterns = getPatternsForEnglish(settings.english);
      if (message.key === "autoContinue" && value) {
        autoContinuePausedReason = "";
        sendFailureCount = 0;
        continueCount = 0;
        lastContinueAssistantText = "";
      }
      saveSettings();
      updateAutoScanLoop();
      updateAssistWatchdogLoop();
      scanForButton();
      requestAssistantAutomation();
      sendResponse(getPublicState());
      return true;
    }

    sendResponse(getPublicState());
    return true;
  }

  function updatePanelState() {
    // Page floating controls were removed; state is shown in the extension popup.
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      const shouldScan = mutations.some(shouldScanMutation);
      const shouldAssist = mutations.some(shouldAssistMutation);

      if (shouldScan) requestScan();
      if (shouldAssist) requestAssistantAutomation();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["aria-disabled", "disabled", "hidden", "style", "class", "open"]
    });
  }

  function shouldAssistMutation(mutation) {
    if (isOwnMutation(mutation)) return false;
    if (!settings.enabled || (!settings.keepAtBottom && !settings.autoContinue)) return false;

    if (mutation.type === "attributes") {
      return elementMayAffectAssistant(mutation.target);
    }

    const changedNodes = mutation.type === "characterData"
      ? [mutation.target.parentElement]
      : [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.some(elementMayAffectAssistant);
  }

  function elementMayAffectAssistant(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches("main, article, form, textarea, [contenteditable='true'], [data-message-author-role]")) return true;
    if (node.closest("main, article, form, [data-message-author-role]")) return true;
    if (node.childElementCount > 120) return false;
    return Boolean(node.querySelector("article, form, textarea, [contenteditable='true'], [data-message-author-role]"));
  }

  function shouldScanMutation(mutation) {
    if (isOwnMutation(mutation)) return false;

    if (mutation.type === "characterData") {
      return Boolean(mutation.target.parentElement?.closest(BUTTON_SELECTOR));
    }

    if (mutation.type === "attributes") {
      return elementMayAffectCandidate(mutation.target);
    }

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.some(nodeMayAffectCandidate);
  }

  function nodeMayAffectCandidate(node) {
    if (!(node instanceof Element)) return false;
    return elementMayAffectCandidate(node, true);
  }

  function elementMayAffectCandidate(el, allowDeepQuery = false) {
    if (!(el instanceof Element)) return false;
    if (el.matches(BUTTON_SELECTOR) || el.matches(DIALOG_SELECTOR)) return true;
    if (el.closest(DIALOG_SELECTOR)) return true;

    if (!allowDeepQuery && el.childElementCount > 80) return false;
    return Boolean(el.querySelector(`${BUTTON_SELECTOR}, ${DIALOG_SELECTOR}`));
  }

  function isOwnElement(node) {
    if (!(node instanceof Element)) return false;

    return Boolean(
      node.id === `${APP_ID}-panel` ||
      node.id === `${APP_ID}-style` ||
      node.id === `${APP_ID}-toast` ||
      node.closest?.(`#${APP_ID}-panel`)
    );
  }

  function isOwnMutation(mutation) {
    if (isOwnElement(mutation.target)) return true;

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.length > 0 && changedNodes.every(isOwnElement);
  }

  function cleanup() {
    abortController.abort();
    if (observer) observer.disconnect();
    clearManagedTimeout(scanTimerId);
    clearManagedTimeout(assistantTimerId);
    clearManagedTimeout(autoScanIntervalId);
    clearManagedTimeout(assistWatchdogIntervalId);
    timers.forEach((id) => window.clearTimeout(id));
    timers.forEach((id) => window.clearInterval(id));
    timers.clear();
    clearHighlight();
    document.getElementById(`${APP_ID}-panel`)?.remove();
    document.getElementById(`${APP_ID}-style`)?.remove();
    document.getElementById(`${APP_ID}-toast`)?.remove();
    if (window.chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(handlePopupMessage);
    }
    cachedButton = null;
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const isShortcut = event.altKey && event.shiftKey && event.key === "Enter";

      if (!isShortcut) return;

      event.preventDefault();
      clickConfirmButton();
    },
    { signal: abortController.signal }
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      lastHiddenScanAt = 0;
      lastHiddenAssistantAt = 0;
      requestScan();
      requestAssistantAutomation();
    },
    { signal: abortController.signal }
  );

  document.addEventListener(
    "scroll",
    () => {
      if (Date.now() > programmaticScrollUntil) lastUserScrollAt = Date.now();
    },
    { capture: true, passive: true, signal: abortController.signal }
  );

  if (window.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handlePopupMessage);
  }

  window.__safeConfirmHelperCleanup = cleanup;

  startObserver();
  updateAutoScanLoop();
  updateAssistWatchdogLoop();
  requestScan();
  requestAssistantAutomation();

  console.log(
    "[Safe Confirm Helper] 已启用。快捷键：Alt + Shift + Enter。自动确认默认开启。"
  );
})();
