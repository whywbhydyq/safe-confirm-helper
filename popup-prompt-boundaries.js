(() => {
  const FINAL_FORMAT = `<SCH_FINAL>
status: done
covered: ...
proof: ...
unverified: none
risks: none
verdict: ready_to_stop
</SCH_FINAL>`;
  const BOUNDED_PROMPT = `继续执行原始任务，从当前进度后的下一个具体步骤开始。

执行规则：
- 优先处理未完成、未验证或有阻塞风险的部分，不要复述计划，不要阶段性总结，不要只说“任务已完成”。
- 继续推进不能破坏用户已经设定的工程约束，例如提交策略、部署次数、分支策略、权限边界、测试要求或不得频繁触发构建等。
- 如果继续推进和工程约束冲突，先保工程约束，再给出可执行替代路径。
- 单一路径失败时，优先换工具、换路径、生成 patch、脚本、命令、文件包或检查清单；但不能为了推进而制造碎片提交、误触发部署、污染仓库历史或虚构验证结果。
- 如果确实缺少用户权限、账号后台、外部配置、密钥、域名/DNS、付款/广告平台等用户侧操作，暂停并明确说明用户最短需要做什么，不要假装已经完成。

只有在当前工具和权限允许范围内已经形成可验证闭环，且确认无遗漏、无未验证项、无阻塞风险时，才只输出以下格式，不要添加其他文字：
${FINAL_FORMAT}`;

  const looksLegacy = (value) => {
    const text = String(value || "");
    return !text.includes("工程约束") && (/继续执行原始任务/.test(text) || /不要复述计划/.test(text) || /任务已完成/.test(text));
  };

  async function savePrompt(value) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { source: "safe-confirm-helper-popup", action: "set-setting", key: "continuePrompt", value, valueType: "string" });
    } catch {}
  }

  function install() {
    const textarea = document.getElementById("continue-prompt-input");
    const reset = document.getElementById("reset-prompt-btn");
    const state = document.getElementById("prompt-state");
    if (!textarea) return;

    setTimeout(() => {
      if (!textarea.value || looksLegacy(textarea.value)) {
        textarea.value = BOUNDED_PROMPT;
        if (state) state.textContent = "已升级默认提示词";
        void savePrompt(BOUNDED_PROMPT);
      }
    }, 500);

    reset?.addEventListener("click", () => {
      setTimeout(() => {
        textarea.value = BOUNDED_PROMPT;
        if (state) state.textContent = "已恢复新版默认";
        void savePrompt(BOUNDED_PROMPT);
      }, 60);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
