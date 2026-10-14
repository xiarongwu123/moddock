# MU 统一 Nexus 下载

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

## 维护方凭证和会话

`platform/nexus-worker.cjs` 是后台入口，不随客户端打包。Linux 服务模式使用 `platform/secret-store.cjs` 加密 Nexus Key，私有根目录权限 0700，主密钥和密文权限 0600。网页登录 Cookie 保存在专用 Electron 持久分区。

本次初始化由 `platform/export-session.cjs` 仅导出维护方已经登录的 Nexus 会话，迁移到服务器后删除两端临时原始导入文件。服务重启后从服务器本地密文和持久会话恢复，不再依赖维护方 Mac 上的 worker。

来源登录失效、验证码或未知页面由维护方恢复，客户端只显示等待或服务暂不可用。后台不会生成文件授权，也不会自动处理验证码。私有维护状态与截图入口受内部令牌保护，MU 网关不转发这些入口。调试输出避免记录登录信息、完整 NXM 和下载签名链接。

本机开发仍可使用 `MODDOCK_NEXUS_PLATFORM_CONFIG=/absolute/private/client.json` 覆盖默认网关；此文件不能加入安装包或仓库。正式客户端无需这个环境变量，也不保存 worker 内部令牌。

## 验证记录

- 客户端构建与 128 项自动测试通过；默认 MU 客户端测试覆盖两个账号，无个人 Nexus 配置。退出登录时先提交后台取消，再释放 MU 会话。
- MU 网关 13 项专用 HTTP 断言通过，覆盖账号声明生成 owner、两个账号下载、跨账号拒绝、精确二进制传输、参数拒绝、关闭功能权限及撤销登录。
- MU 既有 HTTP 测试 421 项、管理与备份测试 136 项通过，核心测试通过。
- Linux worker 用迁移后的真实免费账号会话自动下载 `Mod Fixer.zip`，809 字节，SHA-256 为 `b7239bd02e77d1a876ed01ad085f77ca04c6626599553e379dec4f9595716fba`；ZIP CRC 检查通过。重启后会话与加密 Key 恢复成功。
- 本机分离进程试验另已下载 `ImprovedUI Null File.zip`，879 字节，后台与客户端大小、SHA-256 和 ZIP CRC 均通过。
- 公网 MU 健康检查 200，匿名 Nexus 请求 401。完整公网客户端点击下载的验证记录将在完成后补充。

上述验证不覆盖真实 Windows 安装、游戏加载或大文件负载。旧版安装包需要更新客户端才能默认走此服务。平台代下载的外部许可仍沿用此前约定，应用注册申请本身不代表该用途获批。
