const DEFAULT_CONTINUE_PROMPT = "继续执行最初的任务。不要总结，不要停下，直到最初任务全部完成。完成后请只回复：任务已完成";

const ids = {
  status: "page-status",
  taskState: "task-state",
  candidate: "candidate-text",
  scanInfo: "scan-info",
  confirm: "confirm-btn",
  rescan: "rescan-btn",
  autoConfirm: "auto-confirm-input",
  keepAtBottom: "keep-bottom-input",
  autoContinue: "auto-continue-input",
  enabled: "enabled-input",
  english: "english-input",
  highlight: "highlight-input",
  continuePrompt: "continue-prompt-input",
  promptState: "prompt-state",
  resetPrompt: "reset-prompt-btn"
};

const el = Object.fromEntries(
  Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)])
);

let activeTabId = null;
let connected = false;
let promptSaveTimer = 0;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setDisabled(disabled) {
  [
    el.confirm,
    el.rescan,
    el.autoConfirm,
    el.keepAtBottom,
    el.autoContinue,
    el.enabled,
    el.english,
    el.highlight,
    el.continuePrompt,
    el.resetPrompt
  ].forEach((node) => {
    node.disabled = disabled;
  });
}

async function send(action, payload = {}) {
  if (!activeTabId) throw new Error("没有当前标签页");
  return chrome.tabs.sendMessage(activeTabId, { source: "safe-confirm-helper-popup", action, ...payload });
}

function canInjectInto(tab) {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/.test(tab?.url || "");
}

async function connectOrInject(tab) {
  try {
    return await send("get-state");
  } catch {
    if (!canInjectInto(tab) || !chrome.scripting?.executeScript) throw new Error("当前页面未注入插件脚本");

    el.status.textContent = "正在注入页面脚本...";
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ["content.js"]
    });
    return send("get-state");
  }
}

function render(state) {
  connected = true;
  setDisabled(false);

  el.status.textContent = state.enabled ? "已连接当前页面" : "插件已暂停";
  el.taskState.textContent = state.taskComplete
    ? "任务已完成"
    : state.autoContinuePausedReason
      ? "自动继续已暂停"
      : state.settings.autoContinue
        ? `自动继续 ${state.continueCount || 0}/${state.maxContinueCount || 50}`
        : "手动继续";
  el.candidate.textContent = state.candidateText || "未发现候选";
  el.scanInfo.textContent = `范围 ${state.scanInfo.roots} · 按钮 ${state.scanInfo.candidates} · 匹配 ${state.scanInfo.matches}`;

  el.enabled.checked = Boolean(state.settings.enabled);
  el.autoConfirm.checked = Boolean(state.settings.autoConfirm);
  el.keepAtBottom.checked = Boolean(state.settings.keepAtBottom);
  el.autoContinue.checked = Boolean(state.settings.autoContinue);
  el.english.checked = Boolean(state.settings.english);
  el.highlight.checked = Boolean(state.settings.highlight);

  if (document.activeElement !== el.continuePrompt) {
    el.continuePrompt.value = state.settings.continuePrompt || DEFAULT_CONTINUE_PROMPT;
    el.promptState.textContent = "已同步";
  }
}

function renderDisconnected(message) {
  connected = false;
  setDisabled(true);
  el.status.textContent = message;
  el.taskState.textContent = "不可用";
  el.candidate.textContent = "-";
  el.scanInfo.textContent = "请打开匹配站点后刷新页面";
  el.promptState.textContent = "未连接";
}

async function refresh() {
  try {
    const tab = await getActiveTab();
    activeTabId = tab?.id || null;

    if (!activeTabId) {
      renderDisconnected("没有找到当前标签页");
      return;
    }

    const state = await connectOrInject(tab);
    render(state);
  } catch {
    renderDisconnected("当前页面不匹配或无法注入脚本");
  }
}

async function run(action, payload) {
  if (!connected) return null;

  try {
    const state = await send(action, payload);
    if (state) render(state);
    return state;
  } catch {
    renderDisconnected("连接已断开，请刷新页面");
    return null;
  }
}

function setBooleanSetting(key, checked) {
  run("set-setting", { key, value: checked });
}

function savePrompt(immediate = false) {
  window.clearTimeout(promptSaveTimer);

  const commit = async () => {
    el.promptState.textContent = "保存中...";
    const state = await run("set-setting", {
      key: "continuePrompt",
      value: el.continuePrompt.value,
      valueType: "string"
    });
    el.promptState.textContent = state ? "已保存" : "保存失败";
  };

  if (immediate) {
    commit();
    return;
  }

  el.promptState.textContent = "未保存";
  promptSaveTimer = window.setTimeout(commit, 600);
}

el.confirm.addEventListener("click", () => run("confirm"));
el.rescan.addEventListener("click", () => run("rescan"));

el.enabled.addEventListener("change", () => setBooleanSetting("enabled", el.enabled.checked));
el.autoConfirm.addEventListener("change", () => setBooleanSetting("autoConfirm", el.autoConfirm.checked));
el.keepAtBottom.addEventListener("change", () => setBooleanSetting("keepAtBottom", el.keepAtBottom.checked));
el.autoContinue.addEventListener("change", () => setBooleanSetting("autoContinue", el.autoContinue.checked));
el.english.addEventListener("change", () => setBooleanSetting("english", el.english.checked));
el.highlight.addEventListener("change", () => setBooleanSetting("highlight", el.highlight.checked));

el.continuePrompt.addEventListener("input", () => savePrompt(false));
el.continuePrompt.addEventListener("change", () => savePrompt(true));
el.resetPrompt.addEventListener("click", () => {
  el.continuePrompt.value = DEFAULT_CONTINUE_PROMPT;
  savePrompt(true);
});

refresh();
