# Pro 与 AI token 计量

产品规则：全部 AI 功能仅限有效 Pro；每月最多 1,000,000 token，输入与输出均计入。重试和多轮修复产生的实际推理也计入，传输重连和重复交付不能重复扣费。套餐价格和支付开放状态使用 MU 返回的数据。

## 当前客户端

`account.cjs` 在每次 AI 传输之前刷新账户并调用 `ai-policy.cjs`，覆盖创作、修复、AI 安装分析。普通用户、过期会员、关闭功能、额度缺失、额度耗尽均拒绝。取消不受额度限制。`server.cjs` 在启动创作或拒绝反馈触发修复之前也检查额度。

账户响应必须增加 `aiUsage: { limitTokens: 1000000, usedTokens: 123, periodStart: ISO8601, periodEnd: ISO8601 }`。没有有效周期和非负整数用量时返回 `ai_quota_unconfigured`，不能按无限额度降级。客户端将上限限制在 100 万。`GET /api/account/ai-usage` 返回当前账户额度和本机历史用量摘要。

`studio-mu-client.cjs` 支持 NDJSON 的 `usage` 帧，以及 event/result/error 内的 `usage`。格式为该 delivery task 的累计 `{ inputTokens, outputTokens }`，也支持 OpenAI/Anthropic 对应的 snake_case 字段。多次模型调用由服务端先求和，再回传任务累计数；不能将不同模型调用的单次用量冒充任务累计用量。失败时应在 error 前回传已消耗 token。

本机 `ai-usage` 目录按账户和任务的 SHA-256 隔离，用原子写入记录累计输入/输出，重放不重复相加；不保存提示词、模型回复、邮箱或凭据。没有服务端用量时不虚构 token，界面说明未回传不等于零消耗。本机明细是辅助记录，不能作为跨设备付费账本。

## 上线前必须接通的 MU 云端规则

当前工作区没有正在运行的 MU AI 扣费服务源码/部署凭据。本地 `F:/mu` 的服务快照不包含 studio 推理路由。本次没有部署云端；仅发布客户端不能宣称扣费闭环已上线。

云端必须以已验证的账户 ID 作为 owner，并在每次模型调用前检查 Pro 与月额度，在数据库事务中预留本次最大 token，设置对应的模型输出上限。多个设备、并发任务共享一个账户周期账本，禁止以客户端提供的 owner、套餐、用量或当前时间作为扣费依据。按会员账期每月重置（数据库提供当前 periodStart/periodEnd），不得通过重新登录/重装重置。

每次模型调用用不可重复的 usage ID 记账，存储 provider 实际 input/output token；成功、失败、取消均结算实际消耗并释放剩余预留。delivery ID 绑定 owner，订阅重连只读取既有任务；取消/结果读取仍须允许额度耗尽的原任务执行。任务输出上述累计 usage 帧，并在 account/me 返回更新后的 aiUsage。应验证跨设备并发、账期切换、会员到期、流中断、取消、模型失败、幂等重放，以及实付订单回调后权益和额度生效。

支付页面只在 MU `plans.paymentsEnabled` 为 true 时允许创建订单，支付结果必须重新从服务端查询；本地显示不授予会员权限。
