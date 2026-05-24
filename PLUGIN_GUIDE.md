# Safe Confirm Helper 插件使用说明

## 1. 插件定位

Safe Confirm Helper 是一个运行在 ChatGPT 网页端的长任务监督插件。

它不负责替用户验证所有业务结果，也不接管 GitHub、Vercel、本地文件、测试环境或外部后台。它负责监督 ChatGPT 的停机行为：长任务没有完成、没有验证、存在阻塞或只是阶段性进展时，不能用“任务已完成”“done”“finished”之类的普通话术结束。

一句话：

```text
用户正常下任务，插件负责防止 AI 假完成和早停。
```

## 2. 使用流程

当前版本采用手动开启监督，不自动猜测任务类型。

```text
1. 打开 ChatGPT 页面。
2. 点击浏览器扩展图标。
3. 点击“开启持续监督”。
4. 回到 ChatGPT，正常输入真实任务。
5. 发送任务。
6. 插件自动把 SafeConfirm Supervision 协议追加到任务末尾。
7. AI 开始执行。
8. 插件根据最后一条 assistant 回复决定继续、解阻、审计或停止。
9. 出现合格 <SCH_FINAL> 后，插件停止自动继续。
```

点击“开启持续监督”只会进入待命状态，不会立刻发送最终自检，也不会审计页面旧回复。

## 3. 状态说明

```text
普通模式
插件没有接管长任务。可以继续使用安全确认和保持底部等辅助功能。

监督已开启
对应内部 armed 状态。插件正在等待你发送下一条真实任务。

正在监督当前对话
真实任务已经发出，监督协议已经注入。插件会观察最新 assistant 回复。

正在解决阻塞
AI 明确说未完成、未验证、失败、权限不足、被拦截或不能继续，插件会要求它换路径推进。

最终自检未通过
AI 输出过 Final，但字段不完整、unverified 非空、risks 非空或 verdict 不合格。

最终自检通过
检测到合格 <SCH_FINAL>，插件停止自动继续。

已暂停
可能是达到最大继续次数、找不到输入框、发送失败、用户手动暂停，或确实需要用户外部操作。
```

## 4. 合格 SCH_FINAL

插件只接受下面这种结构化终止块：

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

必须满足：

```text
status 是 done。
covered 有内容。
proof 有内容。
unverified 是 none / 无 / 没有等空值。
risks 是 none / 无 / 没有等空值。
verdict 包含 ready_to_stop。
```

不会触发停止的内容：

```text
任务已完成
已完成
done
completed
finished
ready_to_stop 普通文本
不完整 Final
缺字段 Final
unverified 非空
risks 非空
AI 明确说没有验证、没有测试、失败、阻塞、权限不足或不能输出 SCH_FINAL
```

## 5. 插件如何决策

核心决策只在 `content.js` 中完成。

```text
maybeContinue()
  -> parseFinal()
  -> gate()
  -> classifyNextAction()
  -> promptForAction()
```

优先级：

```text
1. 合格 <SCH_FINAL>：停止。
2. 明确未完成、未验证、失败、阻塞：发送解阻继续提示。
3. 连续需要用户外部操作：暂停。
4. 疑似完成、不合格 Final、审计间隔到达：发送最终自检提示。
5. 其他情况：发送继续提示。
```

重要原则：阻塞和未完成优先级高于审计。AI 说“不能输出 SCH_FINAL”时，插件不应该反复要求最终自检，而应该要求它继续、换路径或说明用户需要做什么。

## 6. 单控制器架构

当前版本只有一个自动决策中心：`content.js`。

```text
manifest.json
加载 sch-session-scope.js 和 content.js。

popup.js
只负责弹窗状态、设置、启动监督、暂停/恢复。不会直接写 ChatGPT 输入框。

sch-session-scope.js
只负责把任务 session 绑定到当前标签页，避免多个 ChatGPT 标签页互相污染。

content.js
唯一任务状态机。只有它能判断继续、解阻、审计和停止。
```

已经删除：

```text
popup-prompt-boundaries.js
sch-final-enhancements.js
```

删除原因：这些旧脚本会形成第二控制器，可能维护另一套 prompt、直接改输入框或把低进展信号变成自动动作。当前版本不再允许这种旁路。

## 7. 保持底部

长任务监督需要观察最新 assistant 回复，所以监督开启后会临时强制保持底部。

规则：

```text
普通模式：用户可自行开关保持底部。
监督期间：保持底部临时强制开启。
用户点击“保持底部”“开启持续监督”“恢复自动继续”：立即滚到底部。
用户手动往上滚动阅读：自动滚动暂停一段时间，避免抢视图。
```

当前 `popup-scroll-now.js` 只做即时滚动，不参与任务判断，不写输入框。后续可以把它合并成给 `content.js` 发消息，由 `content.js` 统一滚动。

## 8. 自动确认

插件可以辅助点击 ChatGPT 页面里的确认类按钮。

可识别：

```text
确认 / 允许 / 继续 / 批准
Confirm / Allow / Continue / Approve / Accept
```

边界：

```text
只点击可见、可用、匹配的确认按钮。
不绕过确认流程。
不点击不匹配的普通按钮。
不替用户确认外部网站或账号后台操作。
```

## 9. 多标签页边界

A 标签页开启监督，不应污染 B 标签页。

当前通过 `sch-session-scope.js` 把任务 session 改成 tab-local key。全局设置仍共享，例如总开关、自动继续、保持底部默认偏好等；具体任务状态隔离到当前标签页。

这能避免：

```text
一个 ChatGPT 页面开启监督，另一个页面也进入同一任务。
一个页面的 paused 状态影响另一个页面。
一个页面的任务完成误停止另一个页面。
```

## 10. 插件不会做什么

Safe Confirm Helper 不会：

```text
替用户验证 proof 一定真实。
自动跑本地测试。
自动提交 GitHub。
自动部署 Vercel。
自动登录外部后台。
自动读取本地 IDE 文件。
要求用户写断言、YAML、JSON 或业务测试规则。
成为通用浏览器自动化机器人。
```

它的边界是：监督 AI 的过程，不替代真实业务验收。

## 11. 常见问题

### 为什么点击开启后没有马上发送提示？

这是正确行为。点击按钮只进入 `armed` 待命状态。插件会等待你发送真实任务，然后把监督协议追加到这条任务后面。

### 为什么 AI 说“完成了”插件还继续？

因为普通完成话术不是停止条件。只有合格 `<SCH_FINAL>` 才是停止条件。

### 为什么 AI 输出了 Final 还没有停止？

通常是因为：

```text
Final 缺字段。
unverified 不是 none。
risks 不是 none。
verdict 不含 ready_to_stop。
AI 在 Final 中承认未验证、未测试、阻塞或失败。
```

### 为什么某些阻塞时插件不要求最终自检？

这是故意设计。阻塞未解决时做最终自检没有意义。插件会优先让 AI 继续换路径、交付 patch、脚本、命令或说明用户外部操作。

### 普通聊天会被干扰吗？

只有点击“开启持续监督”并发送下一条真实任务后，插件才接管长任务。你可以用“重置当前任务”退出当前监督。

## 12. 安装与更新

安装：

```text
1. 打开 chrome://extensions/
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择 safe-confirm-helper 目录。
5. 打开或刷新 ChatGPT 页面。
```

更新：

```bash
git pull origin main
```

然后在 Chrome 扩展管理页重新加载扩展，并刷新所有已打开的 ChatGPT 页面。

## 13. 维护注意事项

后续改代码时必须遵守：

```text
不要恢复 sch-final-enhancements.js。
不要恢复 popup-prompt-boundaries.js。
不要让 popup 直接写 ChatGPT 输入框。
不要新增第二套 UNBLOCK / AUDIT / CONTINUE 文案来源。
不要裸匹配 done / completed / finished 作为完成意图。
不要让 stale_progress 触发自动 unblock。
不要对整个 Final raw 做 weakRisk。
不要删除 armed 状态。
不要删除 sch-session-scope.js，除非有更安全的 tab-scoped session 替代方案。
不要把插件说成万能业务验证器。
```

推荐保留的判断边界：

```text
blockedOrIncomplete > finalBlock/audit
valid SCH_FINAL > stop
externalBlock 连续出现 > pause
periodicAuditDue 只做审计，不直接停止
```
