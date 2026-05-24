# Safe Confirm Helper

Safe Confirm Helper 是一个面向 ChatGPT 网页端的轻量长任务监督插件。

它不试图替 AI 验证所有业务结果，也不把浏览器插件变成复杂的测试器、Agent 平台或仓库自动化系统。它只解决一个明确问题：当用户让 ChatGPT 执行长任务时，AI 经常在任务未完成、未验证、存在阻塞或只有阶段性进展时提前说“任务已完成”。

Safe Confirm Helper 的目标是让 AI 不能用普通完成话术停机。只有输出合格的 `<SCH_FINAL>` 终止块，插件才停止自动继续。

## 当前架构

当前版本采用单控制器架构：

```text
popup.js 只负责 UI、设置、启动和恢复。
sch-session-scope.js 只负责单标签页 session 隔离。
content.js 是唯一的任务状态机和自动决策中心。
```

核心决策路径只有一条：

```text
content.js -> maybeContinue() -> classifyNextAction() -> promptForAction()
```

已经移除的旧模块：

```text
popup-prompt-boundaries.js
sch-final-enhancements.js
```

原因：它们形成了第二控制器和第三份 prompt 来源，可能绕过主状态机直接改输入框、上报低进展信号或维护另一套 UNBLOCK 文案。当前版本不再加载这些脚本，也不保留它们的文件。

## 真实需求边界

本插件必须保持简单、低干扰、少设置。用户不需要写 assertions、JSON、YAML、测试规则或业务验证器。

推荐使用流程：

```text
1. 打开 ChatGPT 页面。
2. 点击插件里的“开启持续监督”。
3. 回到 ChatGPT，正常输入真实任务。
4. 插件把监督协议追加到这条真实任务后面。
5. 后续由插件监督 AI 继续、解阻、审计，直到合格终止。
```

插件不接管 GitHub、Vercel、IDE、本地文件、外部后台或真实业务验收。它只能监督 ChatGPT 页面里的对话行为。

边界划分：

```text
AI：负责执行任务、调用工具、验证结果、说明证据。
插件：负责监督 AI 不能早停、不能跳过自检、不能用普通完成话术结束。
用户：负责外部权限、账号后台、密钥、域名、付款、人工验收等浏览器插件无法代替的事项。
```

## 核心机制

当前版本不自动猜测哪条消息是长任务。必须由用户手动点击“开启持续监督”。

状态流：

```text
idle
未开启监督。

armed
用户点击“开启持续监督”，插件进入待命。此时不审计旧回复，不自动继续。

supervising
用户发送真实任务后，插件追加 SafeConfirm Supervision 协议，开始监督。

continuing
没有合格 Final，插件要求 AI 从当前进度继续。

unblocking
AI 明确说未完成、未验证、失败、被拦截或存在阻塞，插件要求 AI 把阻塞转成下一步行动。

auditing
AI 疑似完成、出现 Final、或到达审计间隔，插件要求做停机前自检。

paused_blocked
AI 连续说明必须用户外部操作才能继续，插件暂停并等待用户。

stopped_valid_final
检测到合格 <SCH_FINAL>，插件停止自动继续。
```

点击“开启持续监督”不会立刻发送提示，也不会审计页面历史回复。它只进入 `armed`，等待下一条真实任务。

## 合格停止条件

插件只接受严格的 XML-like 终止块：

```text
<SCH_FINAL>
status: done
covered: ...
proof: ...
unverified: none
risks: none
verdict: ready_to_stop
</SCH_FINAL>
```

必须同时满足：

```text
status 必须是 done。
covered 必须说明覆盖了哪些原始需求。
proof 必须说明完成证据。
unverified 必须是 none / 无 / 没有等空值。
risks 必须是 none / 无 / 没有等空值。
verdict 必须包含 ready_to_stop。
```

这些内容不能让插件停止：

```text
任务已完成
已完成
done
completed
finished
普通文本 ready_to_stop
裸 SCH_FINAL 字样
不完整 Final 块
缺字段 Final 块
unverified 非空
risks 非空
AI 明确说任务未完成、未验证、未测试、失败、被拦截或不能输出 SCH_FINAL
```

## 继续、解阻、审计优先级

主状态机的优先级应保持如下：

```text
1. 合格 <SCH_FINAL> -> stop。
2. 明确未完成、未验证、失败、权限不足、阻塞 -> unblock。
3. 连续需要用户外部操作 -> pause。
4. 疑似完成、不合格 Final、审计间隔到达 -> audit。
5. 其他情况 -> continue。
```

重要原则：`blocked / incomplete` 的优先级必须高于 `audit`。AI 说“我还不能输出 SCH_FINAL”时，插件应该推动继续或换路径，而不是反复要求最终自检。

## 当前关键边界

### 1. completionIntent 不能裸匹配英文单词

维护时不要把 `done`、`completed`、`finished` 这种裸英文单词作为完成意图。它们可能出现在代码、日志、commit message 或测试输出里。

应使用上下文短语：

```text
ready_to_stop
ready to stop
task completed
task is complete
all requirements completed
```

中文完成表达可以保留：

```text
任务全部完成
已经完成全部
全部要求已完成
可以结束
任务已完成
已完成全部
```

### 2. Final gate 不应扫描整个 raw 的弱风险词

`unverified` 必须为空，`risks` 必须为空或等价空值。`risks` 字段里的弱风险词应拒绝停止。

但不要对整个 Final raw 做弱风险扫描。`covered` 或 `proof` 中可能自然出现“如果 / should / likely / might”等词，不能因此误拒一个合格 Final。

推荐策略：

```text
status、verdict、unverified、risks 仍严格。
risks 字段继续查 weakRisk。
硬阻塞词可以查 proof + unverified + risks。
不要对 finalBlock.raw 全局 weakRisk。
```

### 3. stale_progress 不应触发自动 unblock

旧增强脚本曾根据文本相似度上报 `stale_progress`。这个判断容易误伤长任务中自然重复的文件名、约束和验证说明。

当前版本已删除外部增强脚本。后续维护也不应恢复 `stale_progress -> unblock`。

### 4. popup 不直接写 ChatGPT 输入框

popup 只能发送设置、启动监督、暂停/恢复、手动确认或轻量滚动请求。真正写输入框和发提示的逻辑只能在 `content.js` 主状态机里。

### 5. session 隔离不能删除

`sch-session-scope.js` 用于避免 A 标签页开启监督后污染 B 标签页。它只隔离任务 session，不隔离全局设置。除非有更好的 tab-scoped 存储方案，否则不要删除。

## 保持底部逻辑

普通模式下，保持底部由用户开关决定。

监督开启后，保持底部临时强制开启，因为插件必须持续观察最新 assistant 回复。

用户主动点击“保持底部”“开启持续监督”或“恢复自动继续”时，应立即滚到底部，不能等轮询。用户手动往上滚动阅读时，后台自动滚动应暂停一段时间，避免抢回视图。

当前 `popup-scroll-now.js` 是弹窗侧即时滚动辅助。它不参与任务判断，也不改输入框。后续可以改为给 `content.js` 发送 `scroll-bottom-now` 消息，由 `content.js` 统一执行滚动。

## 自动确认按钮

安全确认辅助能力保留，用于减少 ChatGPT 工具调用中的重复确认。

可识别：

```text
确认 / 允许 / 继续 / 批准
Confirm / Allow / Continue / Approve / Accept
```

自动点击只应发生在可见、可用、匹配的确认按钮上。插件不能绕过确认流程，也不能点击不匹配的普通页面按钮。

## 文件说明

```text
manifest.json
Chrome MV3 配置。当前只加载 sch-session-scope.js 和 content.js。

content.js
唯一任务状态机。负责任务状态、监督协议注入、SCH_FINAL 解析、停止门控、自动继续、解阻、审计、保持底部、安全确认和状态持久化。

sch-session-scope.js
单标签页 session 隔离。必须在 content.js 前加载。

popup.html / popup.css / popup.js
扩展弹窗 UI。负责显示状态、切换设置、启动监督、暂停/恢复。popup 不直接写 ChatGPT 输入框。

popup-scroll-now.js
弹窗侧即时滚动辅助。只做滚动，不做任务判断。
```

## 安装方式

1. 打开 Chrome 扩展管理页：

```text
chrome://extensions/
```

2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。
5. 打开或刷新 ChatGPT 页面。

更新代码后必须重新加载扩展，并刷新所有已打开的 ChatGPT 页面。旧页面不会自动运行新的 content script。

## 维护原则

```text
保持简单，不引入复杂验证器。
核心自动行为只能集中在 content.js。
不得恢复第二控制器脚本。
popup 不直接写 ChatGPT 输入框。
所有 Final 解析必须严格要求 <SCH_FINAL>...</SCH_FINAL>。
blocked / incomplete 优先级必须高于 invalid final / audit。
不要裸匹配 done / completed / finished。
不要让 stale_progress 触发自动 unblock。
不要对整个 Final raw 做 weakRisk。
监督状态必须单标签页隔离。
不要把插件能力描述成业务验证能力。
```

## 拉取更新

```bash
git pull origin main
```

然后重新加载扩展并刷新 ChatGPT 页面。
