# Pro 与 AI token 计量

全部 AI 功能仅限有效 Pro。每账户每月 1,000,000 token，输入、缓存命中输入、输出及思考输出均按提供方真实 usage 计入。多轮修改及真正模型重试是新的调用；本机明细不作为账户账单。

账期采用 **UTC 自然月**，每月 1 日 00:00 UTC（北京时间 08:00）切换。有效 Pro 首次读取或使用时建立当期记录；登录、重装、设备切换及续费不重置当前期。跨期调用及迟到结算均归属预留时的原账期。

## 实际服务

账户服务：/home/xrw/amd-dlss-mu-account，Docker Compose 发布。私有 Pi 服务：/home/xrw/moddock-studio，用户 systemd 服务 moddock-studio 发布。两端通过 current -> releases/... 切换。

生产支付服务为 schema 5。旧 MU 源码不能替换线上 Mu.Server.dll。本次只替换网关扩展 Mu.NexusGateway.dll，并向当前私有 Studio 发布覆盖计量文件。发布脚本校验基线哈希，保留其余创作源码、依赖、账号与支付配置。

网关 Client 鉴权从登录 claims 获取 owner，覆盖客户端请求头。私有账户回查需要内网来源和服务器 transport token，调用现有 AccountService.SnapshotAsync。每次 Pi provider 请求（含专项 Agent、后续轮次、修复）均先回查有效 Pro 和功能权限，再预留额度。

AiAccounts.Serialize 为 account/me、登录、刷新、授权等账号响应统一添加 aiUsage。故障时为 null，禁止新创作。正常对象包含 limitTokens、usedTokens、periodStart、periodEnd，另返回 reservedTokens、reconciliationRequired。客户端剩余额度扣除活动预留；待对账时禁止新推理。

取消和已有 delivery 订阅不受额度限制；云端仍检查登录及任务归属，任何新的模型调用均重新检查权益。

## 数据库与计量

platform/ai-ledger.sql 是现有账户 SQLite 数据库中的增量迁移，不改变支付 schema 版本，不删除原表：

- ModdockAiPeriods：主键 (owner,start)，固定上限、实际已用及预留。
- ModdockAiCalls：计量 UUID 主键、owner、delivery、原期、预算、实际输入/输出、提供方 ID、状态、到期时间、对账凭证摘要。提供方 ID 有唯一索引。

预留和结算使用 BEGIN IMMEDIATE。预留检查 limit-used-reserved，并限制 provider max_tokens。输入预算为实际 Pi wire payload 字节数加模板余量，仅用于保守预留，绝不作为账单。

结算只读取 provider 原始 prompt_tokens 与 completion_tokens，不将缓存输入重复相加。提供方 ID 在首帧落库，真实 usage 到达立即结算，后续结果失败不会丢失已收到的账单。provider 隐式 HTTP 重试关闭；Pi 发起的每次真正重试有独立计量 ID。

订阅断开只轮换连接。delivery UUID 全局绑定 owner，重复订阅不重新推理。旧 owner-hash 任务目录启动时迁移，保留 frames/checkpoint/result。每次模型结算后持久化任务累计 usage 帧，握手先于重放帧，失败/取消终帧之前保留已结算用量。

## 取消、崩溃与对账

正常取消停止后续工具/推理，当前 provider 流最多继续收尾 300 秒以取得真实终帧用量，再结算并释放未用预留。收到 usage 后模型失败仍结算。

进程崩溃、断流或提供方未返回 usage 时，不虚构零消耗：到期预留转为 unresolved，释放预留并阻止该账号新推理，直到取得提供方凭证对账；该限制跨账期保持。恢复在额度读取或下一次预留时执行。

未知用量不能凭估算自动扣除或自动解除。运维取得提供方账单/支持回复后，在私有主机使用 reconcile-ai-usage.cjs：

~~~sh
ELECTRON_RUN_AS_NODE=1 /home/xrw/moddock-nexus/runtime/electron/electron \
  /home/xrw/moddock-studio/current/platform/reconcile-ai-usage.cjs \
  /home/xrw/amd-dlss-mu-account/data/accounts.sqlite /private/provider-evidence.json
~~~

凭证 JSON 为 {source,providerId,callId,owner,task,usage:{inputTokens,outputTokens}}。身份须匹配 unresolved 调用，输入/输出为非负安全整数；凭证 SHA-256 写入账本。此命令无 HTTP 入口，须由有数据库权限的运维核对来源，禁止采用客户端报数。

## 配置、部署与回滚

Node >=22.19；生产现有 Electron Node runtime 为 24.21。service.env（0600）增加：

~~~text
MODDOCK_AI_DATABASE=/home/xrw/amd-dlss-mu-account/data/accounts.sqlite
MODDOCK_AI_ACCOUNT_URL=http://127.0.0.1:8089/internal/moddock/ai-account
~~~

复用已有 transport token、模型密钥、支付配置，不向客户端添加 API Key。启动执行幂等迁移；数据库路径错误、用户表缺失、额度不可用均关闭推理。

platform/deploy-ai-quota.py 支持 prepare/activate/rollback/stop-candidate。prepare 校验补丁，复制当前发布和隔离数据库，启动 8096/18098 候选；activate 要求真实模型计量报告通过，锁定发布与备份，确认无活动任务，停止写入，备份账户/邮件库，切换两端链接并检查健康。

已部署发布：20261020-ai-quota-f1315529。
补丁 SHA-256：f1315529b354f7ff99513ed3711ffcc7f2dc23a8a875f1cad7d22cf20b307511。
状态：/home/xrw/moddock-studio/deployment-20261020-ai-quota-f1315529.json。
切换前备份：/home/xrw/moddock-studio/backups/activate-quota-20261020T092631Z。

回滚保留当前数据库写入及计量表，不恢复旧数据库。为避免回到不支持额度保护的旧版本，回滚统一**暂停 AI 服务**；账户/支付恢复上个版本，确认目标支持计量或发布修复后再恢复推理。本次未执行生产回滚演练：

~~~sh
python3 /home/xrw/moddock-studio/incoming/quota-20261020/deploy-ai-quota.py \
  rollback f1315529b354f7ff99513ed3711ffcc7f2dc23a8a875f1cad7d22cf20b307511
~~~

## 验证记录（2026-10-20）

- npm run test:ai：29 项通过。覆盖 Pro/过期/无额度、并发连接预留、100 万边界、缓存输入、取消与失败结算、SIGKILL 杀进程后的身份保留/预留恢复、未知用量对账、跨期、重连/重启、跨账户隔离。
- 网关按线上支付程序集编译：0 warning、0 error。
- UI 构建、会员页浏览器验收通过。补齐分支缺少的构建源文件与依赖声明；服务端模型适配器从桌面打包排除。
- 真实隔离 MU 客户端联调通过：耗尽时显示已用 1,000,000、剩余 0，发起新创作返回 ai_credits_exhausted；恢复为实际账单后显示已用 13,998、剩余 986,002。另一设备本机明细为 0，不影响账户总额。截图在 output/playwright/ai-quota-real/。
- 最终补丁的隔离 MU + 真实 Pi/provider：18 项通过；3 次模型调用输入 13,005、输出 993，共 13,998 token。账本、流帧、account/me、refresh、authorize 一致。额度耗尽后禁止新推理，仍可读取/取消原任务。报告在隔离目录 quota-verification.json。
- 生产两端已切换且健康，鉴权边界、数据库完整性、已有 Pro 的额度读取通过；支付程序集未变。报告：/home/xrw/moddock-studio/ai-quota-production-check-20261020.json。没有创建生产测试会员或调用生产模型。

全套历史测试曾在下载/安装测试清理竞态后挂起，不能宣称全套通过；本次关联 29 项独立通过。未生成新 Windows 安装包，未做物理 Windows 或真实游戏验收。支付继续使用 MU 真实配置和订单核验，没有模拟付款或授予生产会员。
