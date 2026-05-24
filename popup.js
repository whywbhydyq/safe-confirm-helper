const FINAL_FORMAT = `<SCH_FINAL>
status: done
covered: ...
proof: ...
unverified: none
risks: none
verdict: ready_to_stop
</SCH_FINAL>`;
const DEFAULT_CONTINUE_PROMPT = `继续执行原始任务，从当前进度后的下一个具体步骤开始。优先处理未完成、未验证或有阻塞风险的部分；不要复述计划，不要阶段性总结，不要只说“任务已完成”。如果发现遗漏、未验证项或阻塞风险，先继续执行或修复。只有确认全部完成且无未验证项、无阻塞风险时，才只输出以下格式，不要添加其他文字：
${FINAL_FORMAT}`;
const CONTENT_SCRIPT_FILES = ["sch-session-scope.js", "content.js", "sch-final-enhancements.js"];
const ids = {
  status: "page-status",
  connectionPill: "connection-pill",
  taskState: "task-state",
  taskReason: "task-reason",
  continueCount: "continue-count",
  finalState: "final-state",
  candidate: "candidate-text",
  scanInfo: "scan-info",
  primaryAction: "primary-action-btn",
  confirm: "confirm-btn",
  rescan: "rescan-btn",
  resetTask: "reset-task-btn",
  autoConfirm: "auto-confirm-input",
  keepAtBottom: "keep-bottom-input",
  autoContinue: "auto-continue-input",
  supervise: "supervise-input",
  enabled: "enabled-input",
  english: "english-input",
  highlight: "highlight-input",
  maxContinue: "max-continue-input",
  cooldown: "cooldown-input",
  auditEvery: "audit-every-input",
  continuePrompt: "continue-prompt-input",
  promptState: "prompt-state",
  resetPrompt: "reset-prompt-btn"
};
const el = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)]));
let activeTabId = null;
let connected = false;
let promptTimer = 0;
let numberTimer = 0;
let primaryMode = "start";

async function tab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}
function ok(t) { return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/.test(t?.url || ""); }
async function send(action, payload = {}) {
  if (!activeTabId) throw new Error("没有当前标签页");
  return chrome.tabs.sendMessage(activeTabId, { source: "safe-confirm-helper-popup", action, ...payload });
}
async function connect(t) {
  try { return await send("get-state"); }
  catch {
    if (!ok(t) || !chrome.scripting?.executeScript) throw new Error("当前页面未注入插件脚本");
    el.status.textContent = "正在注入页面脚本...";
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: CONTENT_SCRIPT_FILES });
    return send("get-state");
  }
}
function disabled(value) {
  [el.primaryAction, el.confirm, el.rescan, el.resetTask, el.autoConfirm, el.keepAtBottom, el.autoContinue, el.supervise, el.enabled, el.english, el.highlight, el.maxContinue, el.cooldown, el.auditEvery, el.continuePrompt, el.resetPrompt].forEach((node) => { if (node) node.disabled = value; });
}
function setPill(text, cls = "") {
  el.connectionPill.textContent = text;
  el.connectionPill.className = `pill ${cls}`.trim();
}
function supervisedActive(s) {
  return !!(s?.settings?.enabled && s?.settings?.superviseLongTasks && s?.task?.active && s?.task?.status !== "stopped_valid_final");
}
function mapGateReason(reason) {
  const map = {
    missing_final: "AI 还没有完成最终自检",
    missing_status: "最终自检缺少状态字段",
    missing_covered: "最终自检缺少覆盖说明",
    missing_proof: "最终自检缺少完成证据",
    missing_unverified: "最终自检缺少未验证项说明",
    missing_risks: "最终自检缺少风险说明",
    missing_verdict: "最终自检缺少停止结论",
    status_not_done: "AI 尚未声明任务完成",
    verdict_not_ready: "AI 尚未确认可以停止",
    unverified_exists: "AI 仍声明有未验证项",
    blocking_risk_exists: "AI 仍声明有阻塞风险",
    risk_word_exists: "最终自检里仍有不确定表述",
    blocking_keyword_in_final: "最终自检里仍有阻塞风险词",
    weak_risk_keyword_in_final: "最终自检里仍有不确定表述",
    valid_final: "AI 已完成最终自检"
  };
  return map[reason] || reason || "等待页面状态";
}
function mapStopReason(reason) {
  const map = {
    manual_user_prompt: "检测到你输入了新问题，已退出旧任务",
    conversation_changed: "已切换会话，旧任务已停止",
    manual_reset: "当前任务已重置"
  };
  if (!reason) return "";
  if (reason.includes("合格 SCH_FINAL")) return "AI 已完成最终自检，插件已停止继续";
  return map[reason] || reason;
}
function mapPaused(reason, status) {
  if (status === "paused_max_continue" || /最大自动继续次数|安全上限/.test(reason || "")) return "已达到安全上限，已暂停";
  if (status === "paused_send_failed" || /无法发送|发送失败/.test(reason || "")) return "多次发送失败，已暂停";
  if (status === "paused_composer_failed" || /找不到输入框|写入输入框/.test(reason || "")) return "找不到输入框，已暂停";
  return reason || "已暂停";
}
function taskLabel(s) {
  if (!s.settings.enabled) return "插件已暂停";
  if (!s.settings.superviseLongTasks) return "监督已关闭";
  if (s.task.status === "stopped_valid_final") return "已完成";
  if (s.task.status === "unblocking") return "正在解决阻塞";
  if (s.task.status === "paused_blocked") return "需要用户处理";
  if (s.task.status?.startsWith("paused") || s.automation.pausedReason) return "已暂停";
  if (s.task.active && !s.task.promptInjected) return "监督已开启";
  if (s.task.active) return "正在监督当前对话";
  return "普通模式";
}
function reason(s) {
  if (!s.settings.enabled) return "点击按钮后会启用插件并只接管当前页面";
  if (!s.settings.autoContinue && s.task.active) return "自动继续已暂停；保持底部仍随监督模式强制开启";
  if (s.task.status === "unblocking") return "AI 声明存在未完成、未验证或阻塞项，插件正在推动它换方案继续";
  if (s.task.status === "paused_blocked") return "AI 声明需要用户外部操作才能继续，插件已暂停";
  if (s.automation.pausedReason || s.task.status?.startsWith("paused")) return mapPaused(s.automation.pausedReason, s.task.status);
  if (s.task.active && !s.task.promptInjected) return "等待你发送真实任务；发送时会自动追加监督协议，并保持底部开启";
  const stop = mapStopReason(s.task.stopReason);
  if (stop) return stop;
  if (s.task.lastGateReason) return mapGateReason(s.task.lastGateReason);
  return s.task.active ? "AI 还没有完成最终自检" : "点击“开启持续监督”后会监督本页，直到合格最终自检";
}
function finalLabel(s) {
  if (s.task.active && !s.task.promptInjected) return "等待任务开始";
  if (s.task.finalValid) return "最终自检通过";
  if (s.task.hasFinal) return "最终自检未通过";
  return "等待最终自检";
}
function updatePrimary(s) {
  el.primaryAction.className = "primary";
  if (!s.settings.enabled || !s.task.active || s.task.status === "stopped_valid_final") {
    primaryMode = "start";
    el.primaryAction.textContent = !s.settings.enabled ? "启用并开启持续监督" : s.task.status === "stopped_valid_final" ? "重新开启持续监督" : "开启持续监督";
    el.primaryAction.classList.add("enable");
    return;
  }
  if (!s.settings.autoContinue || s.automation.pausedReason || s.task.status?.startsWith("paused")) {
    primaryMode = "resume";
    el.primaryAction.textContent = "恢复自动继续";
    el.primaryAction.classList.add("resume");
    return;
  }
  primaryMode = "pause";
  el.primaryAction.textContent = "暂停自动继续";
}
async function enforceSupervisionBottom(s) {
  if (!supervisedActive(s) || s.settings.keepAtBottom) return;
  await run("set-setting", { key: "keepAtBottom", value: true });
}
function render(s) {
  connected = true;
  disabled(false);
  el.status.textContent = s.settings.enabled ? "已连接 ChatGPT" : "插件已暂停";
  setPill(s.settings.enabled ? "已连接" : "已暂停", s.settings.enabled ? "ok" : "paused");
  el.taskState.textContent = taskLabel(s);
  el.taskReason.textContent = reason(s);
  el.continueCount.textContent = `已自动继续 ${s.automation.continueCount || 0} 次`;
  el.finalState.textContent = finalLabel(s);
  const autoConfirmText = s.settings.autoConfirm ? "安全确认：已开启" : "安全确认：已关闭";
  el.candidate.textContent = autoConfirmText;
  const autoText = s.scanInfo.autoClickable === false ? "仅高亮，不自动点" : s.scanInfo.autoClickable === true ? "弹窗按钮可自动点" : "等待扫描";
  el.scanInfo.textContent = `${autoText} · 匹配 ${s.scanInfo.matches || 0} 个候选`;
  const forceBottom = supervisedActive(s);
  el.enabled.checked = !!s.settings.enabled;
  el.supervise.checked = !!s.settings.superviseLongTasks;
  el.autoConfirm.checked = !!s.settings.autoConfirm;
  el.keepAtBottom.checked = forceBottom || !!s.settings.keepAtBottom;
  el.keepAtBottom.disabled = forceBottom;
  el.autoContinue.checked = !!s.settings.autoContinue;
  el.english.checked = !!s.settings.english;
  el.highlight.checked = !!s.settings.highlight;
  el.maxContinue.value = s.settings.maxContinueCount || 50;
  el.cooldown.value = s.settings.continueCooldownMs || 10000;
  el.auditEvery.value = s.settings.auditEvery || 3;
  if (document.activeElement !== el.continuePrompt) {
    el.continuePrompt.value = s.settings.continuePrompt || DEFAULT_CONTINUE_PROMPT;
    el.promptState.textContent = "已同步";
  }
  updatePrimary(s);
  void enforceSupervisionBottom(s);
}
function disconnected(message) {
  connected = false;
  disabled(true);
  el.status.textContent = message;
  setPill("不可用", "bad");
  el.taskState.textContent = "不可用";
  el.taskReason.textContent = "请打开 ChatGPT 页面后刷新";
  el.continueCount.textContent = "-";
  el.finalState.textContent = "-";
  el.candidate.textContent = "安全确认：不可用";
  el.scanInfo.textContent = "请打开匹配站点后刷新页面";
  el.promptState.textContent = "未连接";
}
async function refresh() {
  try {
    const t = await tab();
    activeTabId = t?.id || null;
    if (!activeTabId) return disconnected("没有找到当前标签页");
    render(await connect(t));
  } catch {
    disconnected("当前页面不匹配或无法注入脚本");
  }
}
async function run(action, payload) {
  if (!connected) return null;
  try {
    const s = await send(action, payload);
    if (s) render(s);
    return s;
  } catch {
    disconnected("连接已断开，请刷新页面");
    return null;
  }
}
function bool(key, value) { return run("set-setting", { key, value }); }
function num(key, value) { clearTimeout(numberTimer); numberTimer = setTimeout(() => run("set-setting", { key, value, valueType: "number" }), 350); }
function savePrompt(now = false) {
  clearTimeout(promptTimer);
  const commit = async () => {
    el.promptState.textContent = "保存中...";
    const s = await run("set-setting", { key: "continuePrompt", value: el.continuePrompt.value, valueType: "string" });
    el.promptState.textContent = s ? "已保存" : "保存失败";
  };
  if (now) return commit();
  el.promptState.textContent = "未保存";
  promptTimer = setTimeout(commit, 600);
}
async function startCurrentConversation() {
  if (!connected) return false;
  el.primaryAction.disabled = true;
  el.primaryAction.textContent = "正在开启监督...";
  const s = await run("takeover-current");
  if (s?.task?.active) await bool("keepAtBottom", true);
  el.primaryAction.disabled = false;
  return !!s?.task?.active;
}
async function primaryAction() {
  if (!connected) return;
  if (primaryMode === "start") await startCurrentConversation();
  else if (primaryMode === "resume") {
    await bool("enabled", true);
    await bool("autoContinue", true);
    await bool("keepAtBottom", true);
  } else await bool("autoContinue", false);
}
el.primaryAction.addEventListener("click", primaryAction);
el.confirm.addEventListener("click", () => run("confirm"));
el.rescan.addEventListener("click", () => run("rescan"));
el.resetTask.addEventListener("click", () => run("reset-task"));
el.enabled.addEventListener("change", () => bool("enabled", el.enabled.checked));
el.supervise.addEventListener("change", () => bool("superviseLongTasks", el.supervise.checked));
el.autoConfirm.addEventListener("change", () => bool("autoConfirm", el.autoConfirm.checked));
el.keepAtBottom.addEventListener("change", () => bool("keepAtBottom", el.keepAtBottom.checked));
el.autoContinue.addEventListener("change", () => bool("autoContinue", el.autoContinue.checked));
el.english.addEventListener("change", () => bool("english", el.english.checked));
el.highlight.addEventListener("change", () => bool("highlight", el.highlight.checked));
el.maxContinue.addEventListener("input", () => num("maxContinueCount", el.maxContinue.value));
el.cooldown.addEventListener("input", () => num("continueCooldownMs", el.cooldown.value));
el.auditEvery.addEventListener("input", () => num("auditEvery", el.auditEvery.value));
el.continuePrompt.addEventListener("input", () => savePrompt(false));
el.continuePrompt.addEventListener("change", () => savePrompt(true));
el.resetPrompt.addEventListener("click", () => { el.continuePrompt.value = DEFAULT_CONTINUE_PROMPT; savePrompt(true); });
refresh();
