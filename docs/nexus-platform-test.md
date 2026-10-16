# MU 统一 Nexus 下载

## 2026-10-15 收款版本恢复下载

当前账号服务保留 `20261014-payments-e94ad754` 的原始 `Mu.Server.dll`、内嵌收款码、会员套餐与数据库 v5，通过 `platform/mu-nexus-gateway` 的 .NET 启动扩展接回 Nexus 路由。新发布为 `20261015-nexus-payments-db626ed7`，原收款主程序与其余原文件均保持逐字节一致，仅增加网关程序集、依赖清单项和启动扩展配置。网关沿用原服务的登录鉴权、功能权限、异常处理、限流和任务归属。

隔离验证通过 33 项收款与下载接口断言、12 项后台收款浏览器断言和 10 项客户端平台下载测试。正式切换前已备份账号及邮件数据库、配置、compose 和密钥；维护期间对比全部 23 张账号库表，所有既有行完全一致，数据库保持 v5，历史邮件、配置和密钥均保留。备份位于 `/home/xrw/amd-dlss-mu-account/backups/nexus-recovery-cutover-20261015T025610Z/`。公网 Nexus 匿名状态请求恢复为 401，收款套餐及 `paymentsEnabled` 校验通过。构建、兼容性边界和部署步骤见 `platform/mu-nexus-gateway/README.md`。

当前已登录 Electron 客户端重新下载 `counterstrike2 / mod 33 / file 39` 成功，任务 `082e189c-83c7-4b1a-9400-4852cc2094a8` 最终显示“已下载”。文件为 `Rainbow Crosshair.zip`，447 字节，ZIP CRC 通过，包含 1,105 字节的 `rainbow_crosshair.cfg`；后台缓存、客户端记录和客户端实际文件的 SHA-256 均为 `94cf46c3a69587891734c11ae1418a630df7d0af4c6106890813e9ada994be30`。该记录验证真实公网下载链路，不代表 Windows 安装或 CS2 游戏内执行验收。

新版游匣客户端的所有 MU 账号默认通过 MU HTTPS 服务下载 Nexus 文件，不使用测试账号白名单，也不要求终端用户登录 Nexus、填 Key 或接收 NXM。客户端仍需正常 MU 登录，并具备当前 `library.manage` 权限。

## 文件流转

客户端后端使用当前 MU 登录态请求 `/api/v1/nexus/jobs`。MU 服务从已验证的账号声明生成任务 owner，向私有 worker 发起指定 `domain/modId/fileId` 的请求。worker 先请求官方 API；免费账号需要文件授权时，进入对应文件的官方管理器下载页面，选择 Slow download、等待站点倒计时并接收 NXM。来源文件在 worker 下载完成，MU 再流式传给客户端，客户端比对大小及 SHA-256。

Nexus Key、Cookie、NXM 临时授权及源站签名链接均不交给客户端。worker 内部令牌只在服务器配置中保存，MU 对外接口不接受用户提供的 owner、内部地址或任意 URL。跨账号读取、取消与文件请求返回 404；撤销登录和关闭下载权限会在 MU 入口立即生效。

## 已部署服务

2026-10-14，MU 发布版本 `20261014-nexus-f1eff735` 已切换到现有 `https://mu-api.claude-api.cn`，数据库保持 schema 4。部署保留既有 MU 配置、数据库和数据保护密钥，仅加入 Nexus worker 的地址及内部令牌。

worker 目录为 `/home/xrw/moddock-nexus`。`moddock-nexus.service` 由 xrw 用户的 systemd 管理，已启用，用户 Linger 已开启。worker 仅监听 Docker 私网网关 `172.25.0.1:8095`，使用随机 Bearer 内部令牌，拒绝浏览器 Origin 请求。公开访问只能经过 MU 的账号鉴权接口。任务最多每账号 3 个、全局 20 个，来源下载串行；缓存上限 6 GB，预留 512 MB 磁盘空间，并在准备新文件时清理超过 24 小时或空间不足的非活跃缓存。

`platform/install-runtime.sh` 下载官方 Electron Linux 运行时并核对 SHA-256，解包 Ubuntu 的 Xvfb 依赖。`platform/run-server.sh` 使用 Xvfb、私有 Xauthority 和非特权 namespace sandbox；维护窗口保持 `sandbox: true`。服务器不关闭 Electron 的 renderer sandbox。

### Docker 到 worker 的网络

2026-10-14 修复了 MU 容器连接 worker 的 30 秒超时：宿主机 UFW 默认丢弃入站请求，原配置没有放行 Docker 网桥到 `172.25.0.1:8095`。`platform/allow-worker-network.sh` 从当前 MU Docker 网络读取网桥、网段和网关，添加只匹配该网桥、私网来源、网关及 worker TCP 端口的持久化 UFW 规则。变更前将规则备份到 `/etc/ufw/moddock-nexus-backups/`；重复运行会检查现有内核规则与持久化文件，不重复添加。

worker 的 systemd 单元在 `ExecStartPre` 执行该脚本，启动时重新确认规则。检查、预览和回滚只针对这条规则：

```sh
bash /home/xrw/moddock-nexus/app/platform/allow-worker-network.sh --check
bash /home/xrw/moddock-nexus/app/platform/allow-worker-network.sh --dry-run
bash /home/xrw/moddock-nexus/app/platform/allow-worker-network.sh --remove
```

持久回滚时还需恢复 `/home/xrw/moddock-nexus/data/moddock-nexus.service.before-network-fix-20261014` 中的 systemd 单元并执行用户级 `daemon-reload`，否则下次 worker 启动会重新添加规则。

修改后，从 MU 容器使用既有内部凭证请求 worker 状态得到 HTTP 200；worker 完成新的真实 `Mod Fixer.zip` 下载，809 字节，SHA-256 为 `b7239bd02e77d1a876ed01ad085f77ca04c6626599553e379dec4f9595716fba`。首次文件授权等待较久，随后文件传输与校验完成。修复在服务端生效，现有 Windows 客户端可直接重新下载。

### 文件大小精度

公网任务接通后，`mecchachameleon / mod 2 / file 10` 暴露出另一处校验错误：Nexus 返回 `sizeInBytes: null`、`size: 185`，实际文件为 189,903 字节。原逻辑把近似 KiB 换算结果 189,440 当成精确字节数，误拒绝了已经传输完整的文件。

`sources.cjs` 现在明确标记 `sizeExact`；`downloads.cjs` 只对精确的来源大小执行逐字节比较，继续严格检查 HTTP 响应长度、已有来源校验值和平台 SHA-256。worker 更新并重启后，同一真实文件重新下载、传输和 ZIP CRC 校验通过，SHA-256 为 `9b1095b25d301f1726deee8e2bcdbc68a6907016fa3c9edd8aba49510d4cb063`。132 项客户端测试通过，包含近似大小成功、精确大小不符拒绝和传输不足拒绝。平台返回的是后台实际字节数，现有平台模式 Windows 客户端不需要重打安装包。

源文件更新前的备份在 `/home/xrw/moddock-nexus/data/network-fix-stage-20261014/before/`。仅回滚这处校验修复时，恢复其中的 `sources.cjs` 和 `downloads.cjs` 并重启 worker；网络放行规则可继续保留。

### 授权页面的线程额度和失败退出

Windows 已完成 `readyornot / mod 476 / file 13899` 的公网文件传输（15,840 字节）。随后 `file 22121` 的授权页面崩溃：worker 日志出现 `pthread_create: Resource temporarily unavailable` 和 `Zygote could not fork`，服务 cgroup 的 `pids.events` 记录 6 次触及 `TasksMax=256`，内存 OOM 计数为 0。

systemd 服务的 `TasksMax` 提高到 512，保留原有 768 MB 内存上限和 renderer sandbox。`NexusAuthorizer` 在 renderer 退出、页面加载失败或授权接收失败时关闭该窗口并继续下一条任务；平台同步将该任务标记为失败，使客户端停止轮询并释放准备容量。136 项测试通过，新增回归覆盖崩溃后队列继续、旧授权拒绝、页面加载失败退出和客户端失败轮询结束。

此次更新前的授权模块、平台模块和 systemd 单元备份在 `/home/xrw/moddock-nexus/data/network-fix-stage-20261014/renderer/before/`。回滚时恢复对应文件和用户级单元，执行 `daemon-reload` 后重启 worker。

修复后同时提交上述两份真实文件，`file 22121` 下载 33,468 字节，SHA-256 为 `1dd64ee4fe8a9e67fd33b851230a5bb1c007e356903d9fd4d1244e7bc04f152e`；`file 13899` 下载 15,840 字节，SHA-256 为 `85a919a6c83a7706e6ec6f87caf2b942f6a263e95403e6d7d67906bf51744780`。两份均通过后台传输及 ZIP CRC 检查，观测期内线程额度拒绝和 OOM 计数为 0。

### 客户端来源验证窗口

0.5.1 Windows 安装包增加来源验证窗口。worker 遇到人机验证时，任务返回 `verificationRequired`；客户端自动弹出当前任务的验证画面，用户点击经本机 HTTP 服务、MU 登录态和私有 worker 转发回原来的授权页面。验证通过后，原下载任务自动继续。用户可以选择稍后验证，再从下载管理的“完成验证”重新打开。

接口仅允许任务所属账号查看或操作，并实时检查 `library.manage`。后台只捕获已识别的验证区域；独立 Cloudflare 验证页须没有导航和密码输入，普通 Nexus 页面不可完整传出。画面捕获后再次检查页面；点击须匹配 10 秒内的画面版本、坐标范围和当前授权任务，每个版本只接受一次操作。任务完成、取消、页面更新或退出登录后，旧操作无法继续影响浏览器。Nexus Cookie、Key、NXM、源码和签名下载地址仍留在服务器。窗口只转发用户的操作，不自动解答验证。

MU 网关新增 `/jobs/{id}/verification` 与 `/jobs/{id}/verification/click`，发布为 `20261014-nexus-verification-fdfa1ed4`，DLL SHA-256 为 `fdfa1ed47bcc55f580270924fe5ea0b5e008356dfc914f69e87c4e57f4f17d87`。激活前核对原发布、进行完整性检查的数据库备份，保留原发布回滚。worker 更新前文件备份在 `/home/xrw/moddock-nexus/data/verification-stage-20261014/before/`。

151 项客户端测试、19 项 Nexus 网关检查和 421 项原有 HTTP 检查通过。Playwright 使用明确标记的模拟画面验证自动弹窗、点击坐标转发、同一任务继续下载、稍后验证后重开，以及退出登录关闭弹窗且旧请求不再重开；真实 CAPTCHA 的人工通过及新版安装/升级仍需 Windows 实机确认。打包核对冻结源码、x64 可执行文件、ASAR 内容和包内 HTTP 登录，并确认服务端凭证与 worker 未被带入安装包。

安装包为 `output/windows/20261014-verification/Moddock-0.5.1-windows-x64-Setup.exe`，113,832,245 字节，SHA-256 为 `ff92e0ef6ed6ad251df7eaf1a5275a3f1d222133507a2b33af75b454037b9c65`。发布快照在该目录的 `snapshot-release/`，包内验证记录为 `package-verification.json`。

### 验证点击无响应修复

2026-10-14，MU 的点击接口已返回 HTTP 200，但旧 worker 的 `sendInputEvent` 在 Linux Electron 的跨来源 iframe 中没有触发控件。隔离的本机 HTTP 复现使用普通复选框，不含真实验证码；聚焦窗口后旧调用仍无事件，改用固定的 CDP `Input.dispatchMouseEvent` 三步鼠标输入后，iframe 收到 `isTrusted: true` 的点击。最终 `NexusVerification.click` 也通过该运行时复现。后台只接受既有画面版本与坐标，不接受客户端传入 CDP 命令。

0.5.3 客户端修复了刷新请求未完成时丢弃点击的问题。按下鼠标时锁定显示画面与坐标，旧刷新响应不能覆盖本次操作；画面预解码后更新，默认按原尺寸显示，并提供 150% 与适应窗口选项。worker 优先裁剪可见验证 iframe，并在转发输入前恢复窗口与网页焦点。模块更新前备份在 `/home/xrw/moddock-nexus/data/click-fix-stage-20261014/nexus-verification.before.cjs`。

165 项自动测试通过。Playwright 在明确标记的模拟画面上验证：截图接口故意延迟 2.5 秒，刷新期间仍能点击，150% 显示坐标映射到原图 `(300, 99)`，点击接口返回 200，同一个下载任务随后完成。该试验不代表真实 Windows CAPTCHA 已通过，仍需用户安装新版后人工确认。

0.5.3 安装包为 `output/windows/20261014-click-fix/Moddock-0.5.3-windows-x64-Setup.exe`，113,835,763 字节，SHA-256 为 `f76f7b79320f85b5c993a82c4dd3c7114cead1094992611b7f8ee98edd5b0d36`。最新安装规则也已冻结在该目录的 `snapshot-release/`。包内 x64 运行时、74 个冻结文件、HTTP 登录及必要运行模块均通过检查，服务端 worker 和凭证未进入 ASAR。

### worker 内存终止导致服务不可用

北京时间 2026-10-14 16:10 和 16:16，systemd 记录 worker 被 OOM killer 终止；MU 到 worker 的请求因此出现 `Connection refused` 和 HTTP 503。每次均由 systemd 自动重启恢复，原来的 Docker 网桥规则仍生效。

`platform/nexus-browser-policy.cjs` 仅限制授权浏览器的 `subFrame` 请求：保留 Nexus 子域、已识别的验证站点及空白继承框架，拒绝无关的第三方框架；主页面、脚本、样式、图片、API 和文件传输不受该规则影响。服务配置增加 `MemoryHigh=1G`，将 `MemoryMax` 从 768 MB 提高到 1280 MB。更新前 worker 与单元备份在 `/home/xrw/moddock-nexus/data/oom-fix-stage-20261014/`；回滚时恢复 `nexus-worker.before.cjs` 与 `moddock-nexus.before.service`，执行用户级 `daemon-reload` 后重启。

部署后从 MU 容器请求 worker 状态返回 HTTP 200。真实 `Mod Fixer.zip` 再次下载完成，809 字节，SHA-256 为 `b7239bd02e77d1a876ed01ad085f77ca04c6626599553e379dec4f9595716fba`。私有诊断确认拦截了 `assets.bounceexchange.com`、`cdn.intergient.com` 和 `consentcdn.cookiebot.com` 子框架；下载完成后 cgroup 内存约 116 MB，`NRestarts=0`，内存 high、max、OOM 和 OOM kill 计数均为 0。该观察不覆盖长期负载。

## 维护方凭证和会话

### 浏览器与下载接口进程隔离

2026-10-14 将原来的单个 Electron worker 拆成两个 systemd 用户服务：

- `moddock-nexus.service` 运行 `platform/nexus-worker.cjs`，负责私有 HTTP 接口、任务记录、Nexus API Key、来源链接和分块文件传输。复用现有 Electron 的 Node 24.21.0 运行模式，不启动 Chromium；内存 soft/hard 限制为 192/384 MB，线程上限 64。
- `moddock-nexus-browser.service` 运行 `platform/nexus-browser.cjs`，只负责既有持久 Cookie 分区、授权页面和验证画面/输入。保留 renderer sandbox 与第三方子框架限制，内存 soft/hard 限制为 1024/1280 MB，线程上限 512，退出后 systemd 等待 2 秒自动重启。

两个服务使用不同的 cgroup；API 对浏览器只有 `Wants` 启动依赖，没有 `Requires`、`BindsTo` 或共同的内存额度。浏览器 OOM 或退出不会关闭 API 监听端口。`data/browser.sock` 位于既有 0700 私有目录，socket 权限 0600，不开放新的网络端口。IPC 只包含限定的任务授权、画面、点击和维护方法，单条消息上限 2 MB，最多 32 个未完成请求；有请求超时、事件心跳和自动重连。

授权结果经私有 IPC 交给 API，API 再检查任务是否仍有效，以及 NXM 的来源、MOD 与文件是否匹配。浏览器断开时，正在等待网页授权的任务标记为 `BROWSER_UNAVAILABLE`，客户端显示“来源授权浏览器正在恢复，请重新下载”；已授权的传输和完成文件读取由 API 独立继续。重连不复活失败任务，旧画面版本不能影响新任务。API 先恢复 HTTP 服务，浏览器启动或恢复不会阻塞状态及缓存接口。

`npm test` 169 项通过，新增独立子进程回归覆盖跨 socket 验证与授权、浏览器 SIGKILL 后 API/缓存继续、正在下载的文件继续、重新连接后的新任务，以及无浏览器时 API 启动。服务器部署后在无活动授权任务时执行一次真实 SIGKILL：浏览器服务主 PID 从 `1401233` 变为 `1402624`；API PID 保持 `1401491`，重启计数为 0。13 次状态采样全部 HTTP 200，其中 11 次观测浏览器尚未恢复；此期间读取 809 字节缓存文件并验证 SHA-256 成功。API cgroup 内存约 21 MB，浏览器约 93 MB。该故障试验验证浏览器进程退出的隔离，不代表已覆盖主机整体内存耗尽或长期高负载。

浏览器恢复后，新建真实 `baldursgate3 / mod 141 / file 9433` 任务 `7a3c8745-76d1-424b-8c48-7990b7fda50a`。首次 80 秒观察结束时在等待来源人机验证，未操作真实验证码；后续任务自行完成。`Mod Fixer.zip` 为 809 字节，SHA-256 为 `b7239bd02e77d1a876ed01ad085f77ca04c6626599553e379dec4f9595716fba`，私有接口再次读取文件并核对字节数和 SHA-256 通过。因为任务已完成，后续验证画面探针按预期无法取得待验证画面；没有将该探针计为真实验证码点击验收。最终没有留下活动测试授权任务，API PID 仍为 `1401491`。

切换前文件与单元备份在 `/home/xrw/moddock-nexus/data/process-split-stage-20261014/before/`，`/home/xrw/moddock-nexus/data/process-split-stage-20261014/rollback-process-split.sh` 可停止两个服务、恢复原 worker/API/启动脚本与单元，再启动原来的单进程服务；保留现有凭证、Cookie、下载记录、缓存和 Docker 网桥规则。MU 地址、内部令牌和客户端接口保持兼容，此次仅更新后台，现有 Windows 客户端无需重新打包。

`platform/nexus-worker.cjs` 与浏览器入口均不随客户端打包。Linux 服务模式使用 `platform/secret-store.cjs` 加密 Nexus Key，私有根目录权限 0700，主密钥和密文权限 0600。API 持有 Key，网页登录 Cookie 保存在浏览器的专用 Electron 持久分区。

本次初始化由 `platform/export-session.cjs` 仅导出维护方已经登录的 Nexus 会话，迁移到服务器后删除两端临时原始导入文件。服务重启后从服务器本地密文和持久会话恢复，不再依赖维护方 Mac 上的 worker。

来源登录失效或未知页面由维护方恢复；验证码由任务所属客户端用户手动完成，后台仅转发用户操作。后台不会生成文件授权，也不会自动解答验证码。私有维护状态与截图入口受内部令牌保护，MU 网关不转发这些入口。调试输出避免记录登录信息、完整 NXM 和下载签名链接。

本机开发仍可使用 `MODDOCK_NEXUS_PLATFORM_CONFIG=/absolute/private/client.json` 覆盖默认网关；此文件不能加入安装包或仓库。正式客户端无需这个环境变量，也不保存 worker 内部令牌。

## 验证记录

- 客户端构建与 128 项自动测试通过；默认 MU 客户端测试覆盖两个账号，无个人 Nexus 配置。退出登录时先提交后台取消，再释放 MU 会话。
- MU 网关 13 项专用 HTTP 断言通过，覆盖账号声明生成 owner、两个账号下载、跨账号拒绝、精确二进制传输、参数拒绝、关闭功能权限及撤销登录。
- MU 既有 HTTP 测试 421 项、管理与备份测试 136 项通过，核心测试通过。
- Linux worker 用迁移后的真实免费账号会话自动下载 `Mod Fixer.zip`，809 字节，SHA-256 为 `b7239bd02e77d1a876ed01ad085f77ca04c6626599553e379dec4f9595716fba`；ZIP CRC 检查通过。重启后会话与加密 Key 恢复成功。
- 本机分离进程试验另已下载 `ImprovedUI Null File.zip`，879 字节，后台与客户端大小、SHA-256 和 ZIP CRC 均通过。
- 公网 MU 健康检查 200，匿名 Nexus 请求 401。完整公网客户端点击下载的验证记录将在完成后补充。

上述验证不覆盖真实 Windows 安装、游戏加载或大文件负载。旧版安装包需要更新客户端才能默认走此服务。平台代下载的外部许可仍沿用此前约定，应用注册申请本身不代表该用途获批。
