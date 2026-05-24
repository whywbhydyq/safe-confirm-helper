# Safe Confirm Helper

Safe Confirm Helper 是一个运行在 ChatGPT 网页端的长任务监督插件。

它的目标不是替用户验证所有业务结果，也不是接管 GitHub、Vercel、本地文件或外部测试环境。它真正做的是：当用户让 ChatGPT 执行较长、较复杂的任务时，插件强制 AI 在停止前进行自检，并且只有输出合格的 `<SCH_FINAL>` 终止块后，插件才停止自动继续。

一句话概括：用户正常给 ChatGPT 下任务，插件负责防止 AI 只说“任务完成”就提前停下。

## 核心流程

当前版本采用按钮开启监督，不再依赖插件自动猜测“这是不是长任务”。

```text
1. 安装并加载插件
2. 打开 ChatGPT 页面
3. 点击插件弹窗里的“开启持续监督”
4. 回到 ChatGPT 输入真实任务
5. 插件在发送任务时追加监督协议
6. ChatGPT 执行任务
7. 如果没有合格 SCH_FINAL，插件自动继续、解阻或审计
8. 如果出现合格 SCH_FINAL，插件停止自动继续
```

点击“开启持续监督”只会让插件进入待命状态，不会立刻发送最终自检。真正监督从你发送真实任务后开始。

## 停止协议

合格的最终块必须是完整 XML-like block：

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

插件不会因为这些内容停止：

- “任务已完成”
- “已完成”
- “done”
- “finished”
- 裸 `SCH_FINAL` 字样
- 不完整 Final 块
- `unverified` 非空
- `risks` 中存在风险或不确定表述
- `verdict` 不是 `ready_to_stop`

## 弹窗 UI 行为

弹窗分为状态卡、主操作区、页面确认状态和设置区。

设置区默认展开，不需要每次点击“高级设置”才能修改参数。

### 主按钮

主按钮根据当前状态自动切换：

```text
普通模式 -> 开启持续监督
监督中 -> 暂停自动继续
已暂停 -> 恢复自动继续
已完成 -> 重新开启持续监督
```

### 保持底部开关

保持底部的规则已经调整：

```text
未开启持续监督时：可以自由开启或关闭保持底部。
开启持续监督后：保持底部必须一直开启，并在弹窗中锁定。
监督停止或重置后：恢复为普通设置，可再次手动开关。
```

这样设计的原因是：长任务监督时插件需要持续观察最新 assistant 回复，否则可能错过稳定回复、Final 块或继续时机；普通聊天时用户仍然可以按自己的阅读习惯关闭保持底部。

### 自动继续开关

自动继续控制“是否自动发送继续、审计或解阻提示”。

它不再决定保持底部能不能手动开启。也就是说，普通模式下即使自动继续关闭，保持底部也可以作为独立显示偏好使用。

### 设置区

设置区包含：

- 插件总开关
- 长任务监督
- 自动继续
- 安全确认
- 保持底部
- 确认按钮识别
- 自动继续参数
- 继续提示词

其中“保持底部”在监督中会被锁定为开启，并显示监督中锁定状态。

## 任务状态模型

```text
idle
未开启监督。

armed
用户已经点击“开启持续监督”，插件正在等待用户发送真实任务。

supervising / continuing / auditing
真实任务已经发送，监督协议已经注入，插件正在监督 AI 输出。

unblocking
AI 声明存在未完成、未验证、失败或阻塞项，插件正在推动它换方案继续。

paused_blocked
AI 连续声明必须用户外部操作才能继续，插件暂停等待用户处理。

stopped_valid_final
已经检测到合格 SCH_FINAL，插件停止自动继续。
```

最关键的是 `armed` 状态：它只表示待命，不会自动继续、不会审计，也不会根据页面旧回复判断任务状态。

## 插件会自动做什么

### 追加监督协议

用户点击“开启持续监督”后，下一次发送真实任务时，插件会把监督协议追加到任务末尾。它不会在按钮点击瞬间单独发送协议。

### 自动继续

如果 AI 停止后没有合格 `<SCH_FINAL>`，插件会发送继续提示，要求 AI 从当前进度后的下一个具体步骤继续。

### 解阻继续

如果 AI 明确说任务未完成、未验证、工具失败、权限不足、无法部署或不能输出 `SCH_FINAL`，插件不应该继续要求它反复做停机前自检，而是进入 `unblocking`，要求 AI 把阻塞项转成下一步行动。

### 自动审计

当 AI 明确表达完成、输出 Final 块、页面检测到 Final，或达到审计间隔时，插件会触发最终自检。审计不是替用户验证业务正确性，而是强制 AI 说明覆盖项、证据、未验证项和风险。

### 自动确认按钮

插件保留安全确认辅助能力，可识别 ChatGPT 页面上的确认类按钮，例如：

```text
确认 / 允许 / 继续 / 批准
Confirm / Allow / Continue / Approve / Accept
```

自动点击只应发生在可见、安全、匹配的确认按钮上。

## 插件不会做什么

Safe Confirm Helper 不是万能验证器。它不会：

- 验证 AI 的 proof 是否 100% 真实。
- 自动跑本地测试。
- 自动访问 GitHub、Vercel 或生产环境。
- 自动修改仓库、提交代码或部署。
- 要求用户写 JSON、YAML、assertions。
- 替代 IDE Agent 或完整自动化平台。

插件边界是：AI 负责执行任务和自检；插件负责强制 AI 不能跳过自检流程。

## 安装方式

1. 打开 Chrome 扩展管理页：

```text
chrome://extensions/
```

2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。
5. 打开或刷新 ChatGPT 页面。

## 使用方式

推荐流程：

1. 打开 ChatGPT。
2. 点击浏览器扩展图标，打开 Safe Confirm Helper 弹窗。
3. 点击“开启持续监督”。
4. 回到 ChatGPT 输入框，输入真实任务。
5. 正常发送。
6. 插件会自动追加监督协议。
7. 等待 ChatGPT 执行。
8. 插件会持续继续、解阻或审计，直到出现合格 `<SCH_FINAL>`。

弹窗状态说明：

- “监督已开启”：已经点击按钮，正在等待你发送任务。
- “正在监督当前对话”：任务已经发出，插件正在监督。
- “正在解决阻塞”：AI 承认未完成、未验证或阻塞，插件要求它继续推进。
- “最终自检未通过”：AI 输出过 Final，但字段或风险条件不合格。
- “最终自检通过”：检测到合格 Final，插件停止继续。
- “已暂停”：达到最大继续次数、发送失败、找不到输入框或用户手动暂停。

## 维护说明

主要文件：

```text
manifest.json
Chrome 扩展配置，声明权限、图标、popup 和 content scripts。

content.js
核心页面脚本。负责任务状态、监督协议注入、SCH_FINAL 解析、停止门控、自动继续、自动确认、状态持久化。

popup.html / popup.css / popup.js
插件弹窗界面。负责显示连接状态、任务状态、继续次数、Final 状态和设置项。

sch-final-enhancements.js
页面增强脚本。负责折叠 Final 块、识别页面风险信号，并把信号传给 content.js。

sch-session-scope.js
标签页 session 隔离脚本。用于避免一个 ChatGPT 标签页开启监督后影响另一个标签页。
```

## 当前已知待手动接入项

`sch-session-scope.js` 已在仓库中，但需要在 `manifest.json` 中加载后才会真正生效。

请将：

```json
"js": ["content.js", "sch-final-enhancements.js"]
```

改为：

```json
"js": ["sch-session-scope.js", "content.js", "sch-final-enhancements.js"]
```

顺序很重要，`sch-session-scope.js` 必须在 `content.js` 前加载。

可选地，也把 `popup.js` 的动态注入列表改为：

```js
const CONTENT_SCRIPT_FILES = ["sch-session-scope.js", "content.js", "sch-final-enhancements.js"];
```

详细手动补丁清单见 `MANUAL_PATCH.md`。
