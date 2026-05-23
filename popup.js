const DEFAULT_CONTINUE_PROMPT = "继续原始任务。优先处理未完成、未验证或有风险的部分。不要总结；不要只说“任务已完成”。若确认全部完成，输出 SCH_FINAL，否则继续执行。";
const CONTENT_SCRIPT_FILES = ["content.js", "sch-final-enhancements.js"];
const ids = { status: "page-status", taskState: "task-state", taskReason: "task-reason", continueCount: "continue-count", finalState: "final-state", candidate: "candidate-text", scanInfo: "scan-info", confirm: "confirm-btn", rescan: "rescan-btn", resetTask: "reset-task-btn", autoConfirm: "auto-confirm-input", keepAtBottom: "keep-bottom-input", autoContinue: "auto-continue-input", supervise: "supervise-input", enabled: "enabled-input", english: "english-input", highlight: "highlight-input", maxContinue: "max-continue-input", cooldown: "cooldown-input", auditEvery: "audit-every-input", continuePrompt: "continue-prompt-input", promptState: "prompt-state", resetPrompt: "reset-prompt-btn" };
const el = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)]));
let activeTabId = null;
let connected = false;
let promptTimer = 0;
let numberTimer = 0;

async function tab() { const [active] = await chrome.tabs.query({ active: true, currentWindow: true }); return active; }
function ok(t) { return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/.test(t?.url || ""); }
async function send(action, payload = {}) { if (!activeTabId) throw new Error("没有当前标签页"); return chrome.tabs.sendMessage(activeTabId, { source: "safe-confirm-helper-popup", action, ...payload }); }
async function connect(t) {
  try { return await send("get-state"); }
  catch {
    if (!ok(t) || !chrome.scripting?.executeScript) throw new Error("当前页面未注入插件脚本");
    el.status.textContent = "正在注入页面脚本...";
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: CONTENT_SCRIPT_FILES });
    return send("get-state");
  }
}
function disabled(value) { [el.confirm, el.rescan, el.resetTask, el.autoConfirm, el.keepAtBottom, el.autoContinue, el.supervise, el.enabled, el.english, el.highlight, el.maxContinue, el.cooldown, el.auditEvery, el.continuePrompt, el.resetPrompt].forEach((node) => { if (node) node.disabled = value; }); }
function taskLabel(s) { if (!s.settings.superviseLongTasks) return "监督已关闭"; if (s.task.status === "stopped_valid_final") return "已停止：合格 Final"; if (!s.task.active) return "普通模式"; if (s.task.status === "auditing") return "审计中"; if (s.task.status === "continuing") return "继续中"; if (s.task.status?.startsWith("paused")) return "已暂停"; return "监督中"; }
function reason(s) { if (s.automation.pausedReason) return s.automation.pausedReason; if (s.task.stopReason) return s.task.stopReason; if (s.task.lastGateReason) return `最后门控：${s.task.lastGateReason}`; return s.task.active ? "等待合格 SCH_FINAL" : "普通短对话不介入"; }
function render(s) {
  connected = true;
  disabled(false);
  el.status.textContent = s.settings.enabled ? "已连接当前页面" : "插件已暂停";
  el.taskState.textContent = taskLabel(s);
  el.taskReason.textContent = reason(s);
  el.continueCount.textContent = `${s.automation.continueCount || 0} / ${s.settings.maxContinueCount || 50}`;
  el.finalState.textContent = s.task.finalValid ? "合格" : s.task.hasFinal ? "不合格" : "未检测";
  el.candidate.textContent = s.candidateText || "未发现候选";
  const autoText = s.scanInfo.autoClickable === false ? " · 仅高亮" : s.scanInfo.autoClickable === true ? " · 可自动点" : "";
  el.scanInfo.textContent = `范围 ${s.scanInfo.roots} · 按钮 ${s.scanInfo.candidates} · 匹配 ${s.scanInfo.matches}${autoText}`;
  el.enabled.checked = !!s.settings.enabled;
  el.supervise.checked = !!s.settings.superviseLongTasks;
  el.autoConfirm.checked = !!s.settings.autoConfirm;
  el.keepAtBottom.checked = !!s.settings.keepAtBottom;
  el.autoContinue.checked = !!s.settings.autoContinue;
  el.english.checked = !!s.settings.english;
  el.highlight.checked = !!s.settings.highlight;
  el.maxContinue.value = s.settings.maxContinueCount || 50;
  el.cooldown.value = s.settings.continueCooldownMs || 10000;
  el.auditEvery.value = s.settings.auditEvery || 3;
  if (document.activeElement !== el.continuePrompt) { el.continuePrompt.value = s.settings.continuePrompt || DEFAULT_CONTINUE_PROMPT; el.promptState.textContent = "已同步"; }
}
function disconnected(message) { connected = false; disabled(true); el.status.textContent = message; el.taskState.textContent = "不可用"; el.taskReason.textContent = "请打开 ChatGPT 页面后刷新"; el.continueCount.textContent = "-"; el.finalState.textContent = "-"; el.candidate.textContent = "-"; el.scanInfo.textContent = "请打开匹配站点后刷新页面"; el.promptState.textContent = "未连接"; }
async function refresh() { try { const t = await tab(); activeTabId = t?.id || null; if (!activeTabId) return disconnected("没有找到当前标签页"); render(await connect(t)); } catch { disconnected("当前页面不匹配或无法注入脚本"); } }
async function run(action, payload) { if (!connected) return null; try { const s = await send(action, payload); if (s) render(s); return s; } catch { disconnected("连接已断开，请刷新页面"); return null; } }
function bool(key, value) { run("set-setting", { key, value }); }
function num(key, value) { clearTimeout(numberTimer); numberTimer = setTimeout(() => run("set-setting", { key, value, valueType: "number" }), 350); }
function savePrompt(now = false) { clearTimeout(promptTimer); const commit = async () => { el.promptState.textContent = "保存中..."; const s = await run("set-setting", { key: "continuePrompt", value: el.continuePrompt.value, valueType: "string" }); el.promptState.textContent = s ? "已保存" : "保存失败"; }; if (now) return commit(); el.promptState.textContent = "未保存"; promptTimer = setTimeout(commit, 600); }
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
