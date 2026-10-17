# MU AI creation service

The desktop uses its existing MU session for POST `/api/v1/studio/plan`,
`/generate` and `/repair`. The MU gateway derives the owner from authenticated
claims, reads current Pro membership and feature policies, and forwards only
these fixed routes to the private service. Standard, expired, disabled and
revoked accounts cannot invoke the model. User prompts and provider responses
are not written to server logs.

`studio-mu-client.cjs` sends bounded game context without local installation or
compiler paths. Login token refresh is serialized; long AI requests run outside
the session queue so polling, cancellation and sign-out stay responsive.
Client packages exclude the direct model adapter and never read model keys.

All three routes use native Pi `createAgentSession` sessions. Pi owns provider
streaming, thinking, tool execution and specialist delegation. The application
does not call a model HTTP endpoint or implement a second agent loop.
Legacy BG3 `agentStep`/`toolHistory` requests have a bounded inspection handshake
and result-envelope adapter; actual authoring invokes the same Pi provider.
New clients cannot combine those legacy fields with `harness: "pi-agent"`.
The server selects
skills from game identity and engine evidence. Each Pi session has only bounded
reference/inspection/submission tools and isolated Lua project write/read/compile tools; no default shell, arbitrary filesystem write, global
extensions, personal credentials or context discovery is enabled.

`run_agent` creates a second native Pi session for the selected game specialist.
Delegation is limited to depth one, two calls, 14 combined turns for planning and 36 for implementation/repair.
Sessions and provider credentials use in-memory stores. The creator and reviewer
roles are in `agents/`; skill origins and hashes are pinned in
`vendor/studio-skills/UPSTREAM.json`. The Minecraft skill uses its documented
MCP-unavailable fallback until a separately verified MCP is configured.

This change requires the private Pi service, streaming MU gateway and updated
desktop renderer together. Keep the schema-5 account/payment application and
database intact. `stage-studio-service.cjs` includes the runtime lockfile,
selected skill files and Agent roles. No model key or transport token enters
a desktop build. Existing clients requesting JSON still receive JSON.
New desktop requests include `harness: "pi-agent"`; an older service rejects
that field before invoking its legacy model adapter. Interactive clients also
require the Pi event stream rather than silently accepting a legacy JSON result.

The private Node service in `studio-service.cjs` runs on the MU Docker bridge,
requires a separate server-only token and a claims-derived account header,
and calls the fixed DeepSeek provider. Each account can have one active request;
the service allows four global requests and 120 requests per account per hour.
Requests have a 192 KiB input limit, a 256 KiB final result limit and a 300-second
deadline. NDJSON streams are limited to 2 MiB, include ten-second heartbeats and
respect disconnect cancellation and output backpressure. MU forwards and flushes
the stream without buffering it into a JSON document. The desktop consumes
incremental UTF-8 frames, records bounded/redacted activity and exposes it through
the existing conversation polling. A stream without a final result is rejected.
Provider error bodies and credentials are never returned to clients.

Install the private runtime on the target OS with Node >=22.19:

```sh
npm ci --prefix platform --omit=dev --ignore-scripts
```

For a developer checkout, `npm run studio:setup-agent` installs and verifies the
runtime. `npm run studio:check-agent` verifies hashes and game/engine routing
without calling a model. Do not copy macOS native dependencies onto Linux;
install from the included lockfile on the deployment host. The Pi package is
server-side only and is not required in the desktop installer.

The server environment file `/home/xrw/moddock-studio/service.env` must be
readable only by its owner and supply `MODDOCK_DEEPSEEK_API_KEY`,
`MODDOCK_STUDIO_TOKEN`, `MODDOCK_STUDIO_HOST` and `MODDOCK_STUDIO_PORT`.
The MU account service receives only `Studio__BackendUrl` and
`Studio__BackendToken`; it does not receive the model key.

The gateway is built against the deployed schema-5 payment binary. Extend the
existing `Mu.NexusGateway` hosting startup assembly to preserve its original
authentication, payment application, database and Nexus routes. Stage with
`mu-nexus-gateway/stage-studio-release.cjs`; it preserves every previous file
except that assembly. Do not replace production with the older local MU source.

`verify-studio-runtime.py DATABASE ORIGIN` accepts only a guarded isolated
rehearsal database. It creates synthetic identities there, logs in through MU,
checks authentication and live feature restrictions, and sends real planning
and generation calls through the candidate gateway. It also checks the existing
payment plans, catalog, Nexus, presets, wishes and compatibility routes.
Production activation must follow successful isolated and browser checks,
with locked backup, maintenance, database/configuration verification and rollback
to the previous schema-5 release while preserving current database writes.
# 可恢复创作传输

现有 plan/generate/repair 路由接受可选的 delivery 对象：version=1、UUID id、递增 after 游标以及 subscribe/cancel 操作。它由桌面客户端生成，不交给模型。账号仍由网关验证，服务端只信任网关提供的 owner。

第一次提交持久化任务身份与输入摘要后才启动运行时；同一 owner/id 的重复订阅只重放日志。相同编号配不同输入会拒绝，过期任务保留身份记录，防止重试意外生成新的产物。旧客户端继续使用原有协议。

运行脚本将 MODDOCK_STUDIO_TASKS 设置为服务根目录下的 tasks/。任务目录包含私有 request.json、task.json、frames.jsonl 和 project/ 检查点。日志在 tasks/logs/creation-YYYY-MM-DD.jsonl，文件权限为 0600。不要把该目录放进公开下载包或 Git。

每个订阅最多持续 25 秒，使用心跳并明确轮换；断开订阅不会取消运行时，cancel 操作才会。任务本身仍有执行期限。完成与失败事件带有连续序号，客户端按游标去重。

diagnostic 包含 traceId、stage、category、code、上游状态码和已脱敏原因；私有日志另保留调用栈。查错时先按 traceId 关联任务与阶段，再判断网络、模型、工具或编译失败，不要只依据用户界面的通用提示。
