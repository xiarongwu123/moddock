# MU 用户系统功能层

MODDOCK 共用 MU 的账户服务及用户数据。已提供账号逻辑、本地接口、加密会话保存与前端状态模块；登录密码步骤已接入找回密码分步流程。登录后侧栏和头像区可进入用户中心，查看账号与会员信息、修改密码或退出登录；订单页面尚未实现。

## UI 调用入口

```js
import accountModule from './account/store.cjs';

const account = accountModule.createAccountStore();
const unsubscribe = account.subscribe(state => {
  // 将 state.account、state.busy、state.error 绑定到你的 UI。
});

await account.initialize();
await account.login({ email, password, remember: true });
account.setActive(true); // 进入业务页后启用 30 秒账号心跳。
const snapshot = await account.refresh();
await account.authorize('library.manage');

account.setActive(false); // 登录、注册、找回密码和账号中心不启动心跳。
unsubscribe();
account.dispose();
```

实例不会自动注册 DOM 事件或创建页面。初始化恢复已保存的会话；登录、注册成功后返回账号快照。当前登录页使用 `src/auth/client.cjs`。用户中心 `src/account/UserCenter.jsx` 在已有登录的基础上调用 `refresh()`，使用同一浏览器的 HttpOnly 会话读取最新账号。账号页不启动心跳，并暂停业务轮询；离开页面时销毁状态订阅和密码输入，返回业务页恢复轮询。

| 方法 | 参数或作用 |
| --- | --- |
| `config()` | 协议版本、协议地址、`rememberAvailable` |
| `initialize()` / `restore()` | 校验当前登录 / 从系统加密缓存恢复登录 |
| `login()` | `{ email, password, remember?: boolean }` |
| `register()` | `{ email, password, code, termsAccepted, remember?: boolean }` |
| `sendCode()` | 注册：`{ email, purpose: 'register', termsAccepted: true }`；找回密码：`{ email, purpose: 'reset' }` |
| `resetPassword()` | `{ email, code, newPassword }`；成功返回 `requiresLogin: true` |
| `changePassword()` | `{ currentPassword, newPassword }`；成功清除本机及服务端会话，必须重新登录 |
| `refresh()` | 获取最新账号、会员和功能权限 |
| `authorize()` | 功能标识；实时访问 MU 授权接口，拒绝时抛出含最新账号的错误 |
| `hasFeature()` | 根据当前快照判断页面或按钮展示，不作为执行操作的授权凭据 |
| `plans()` | `{ items, paymentsEnabled }`；金额为最小货币单位 |
| `orders()` / `order(id)` | 当前账号的订单列表 / 单个订单 |
| `createOrder(planId)` | 复用 MU 的下单接口；支付未开放时抛出 `payments_unavailable` |
| `logout()` | 调用 MU 注销并清除本地会话和对应加密缓存 |
| `getState()` / `subscribe()` | 状态快照 / 订阅；订阅立即通知一次，返回解除订阅函数 |
| `setActive(boolean)` | 控制业务页心跳，默认关闭；无登录会话时不会启动 |
| `dispose()` | 停止计时器并解除全部订阅 |

状态包含 `account`、`hasSession`、`online`、`busy`、`error`、`remember`、`storageWarning`、`isReconnecting` 和 `canKeepVerifiedView`。账号包含 `id`、`email`、`name`、`mode: 'mu'`、`membership: { tier, expiresAt }`、`features: [{ key, enabled, minimumTier, allowed, version }]` 和 `paymentsEnabled`。会员等级、有效期、功能开关及权限版本全部以服务器快照为准。

首次联网校验成功后，临时断网可保留账号视图最多两分钟；连续失败不会延长这段时间。它只控制视图连续性，业务操作仍必须实时取得服务器授权。401、账号停用、无效账号数据、退出和改密立即终止该状态。错误提供 `code`、`message`、`status`、`retryAfterSeconds`、`reason`；权限拒绝还提供 `account`。无密码或 MU 会话令牌进入状态快照。

## 本地接口与 MU 对应关系

本地 POST 需要 `X-Moddock-Token`，可从 `/api/auth/config` 获取。除认证入口外，本地接口均要求 HttpOnly 会话；不接受界面传入 MU 的访问或刷新令牌。

| 本地接口 | MU 接口 |
| --- | --- |
| `POST /api/auth/code` | `POST /api/v1/auth/code`，`purpose: register/reset` |
| `POST /api/auth/login` | `POST /api/v1/auth/login` |
| `POST /api/auth/register` | `POST /api/v1/auth/register` |
| `GET /api/auth/session` | `GET /api/v1/account/me`，返回 `{ profile, remember, storageWarning }` |
| `POST /api/auth/restore` | 使用本机加密刷新令牌调用 `POST /api/v1/auth/refresh` |
| `POST /api/auth/reset-password` | `POST /api/v1/auth/reset-password` |
| `POST /api/auth/logout` | `POST /api/v1/auth/logout` |
| `GET /api/account/me` | `GET /api/v1/account/me`，返回 `{ account }` |
| `POST /api/account/password` | `POST /api/v1/account/password` |
| `POST /api/account/authorize` | `POST /api/v1/account/authorize` |
| `GET /api/account/plans` | `GET /api/v1/plans` |
| `GET /api/account/orders` | `GET /api/v1/orders` |
| `GET /api/account/orders/:id` | `GET /api/v1/orders/:id` |
| `POST /api/account/orders` | `POST /api/v1/orders`，`{ planId }` |

密码长度为 8–128 字符，验证码为 6 位数字、有效期 10 分钟。重发间隔按服务器返回值处理。注册同意协议版本 `2026-09-26`；协议版本变更需同步适配器。

`account-policy.cjs` 将游戏扫描、查询、下载、安装管理和 NXM 接收绑定到 `library.manage`，设置和配置档案绑定到 `configuration.edit`，启动和运行验证绑定到 `game.launch`。每次操作会请求 MU 的 `account/authorize`，不会用本地缓存授予权限。高频状态读取缓存已验证会话最多 30 秒，不重复发送权限请求。已经开始的文件事务完成安全收尾。

## 保持登录与验证边界

桌面版通过 Electron `safeStorage` 加密，保存到应用数据目录下的 `account-session.bin`，只保存刷新令牌、服务地址和邮箱，不保存密码或访问令牌。文件原子写入，权限为 `0600`。系统加密不可用或 Linux 回退到 `basic_text` 时禁用持久化；网页预览不持久化账号令牌。UI 通过 `rememberAvailable` 决定是否展示保持登录选项，默认登录调用不保存会话。

恢复时必须在线轮换令牌，服务地址变化或损坏缓存不会自动登录。已经开始的刷新不随 UI 卸载取消，替换令牌保存完成后才返回。保存失败保留内存登录并返回 `storageWarning`，退出、密码修改和相同邮箱的密码重置清除本地缓存。

套餐与订单迁移只复用 MU 服务。当前 MU 支付实现返回 503 `payments_unavailable`，不生成虚假结算页面、订单成功或 Pro 权益。管理员管理用户、授予 Pro、配置套餐和功能的后台仍由共享 MU 服务提供，不属于普通用户账号模块。

自动测试使用隔离服务响应和加密适配器，覆盖改密、重置、权限、订单、缓存、恢复、令牌轮换、心跳及失联状态。浏览器回归覆盖找回密码、用户中心双入口、会员刷新与到期状态、业务轮询暂停与恢复、改密校验和错误输入保留、改密后重新登录及退出清理。真实邮件收取、真实账号和 Windows 系统凭据保护仍需设备验收。
