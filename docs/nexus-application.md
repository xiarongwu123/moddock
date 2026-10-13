# MODDOCK 的 Nexus 应用注册与配置

这里的 App ID 指 Nexus 审核后分配给应用的 **slug**。它与 Steam 游戏 App ID、Electron `appId`、用户 API Key 都不同。开发者为 MODDOCK 申请一次；用户点击连接后，仍需在 Nexus 登录/注册并确认授权，软件自动接收该用户的 Key。

## 申请步骤

1. 准备支持手动 Personal API Key 的测试版本，供 Nexus 检查接口使用方式。
2. 向 **support@nexusmods.com** 发送应用注册申请，附测试版本或下载链接。按反馈调整后提供应用名称、简短介绍和适合深色背景的高分辨率 Logo；建议附源代码供审核。
3. 审核通过后，Nexus 会分配用于 SSO 的 slug。按官方人工审核流程申请，审核时长以 Nexus 的回复为准。

流程依据：[Nexus 官方 API 使用与注册说明](https://help.nexusmods.com/article/114-api-acceptable-use-policy)。正式面向公众发布前应完成注册，Personal API Key 方式用于开发测试。应用注册不代表 Nexus 对软件的背书。

## 已提交的测试版本

2026-10-13 已通过 Gmail 向 `support@nexusmods.com` 提交初次申请，并在支持工单 **271229** 中补充公开测试包、英文测试步骤和游匣测试账号。账号密码仅发送给 Nexus 支持团队，未放入公开发布说明或安装包。

- [公开测试版 0.5.0-beta.20261013.1](https://github.com/xiarongwen/moddock-releases/releases/tag/v0.5.0-beta.20261013.1)：Windows x64 安装包、SHA-256 校验文件及英文测试指南。
- 已验证公开下载后的 SHA-256 与本地产物一致，包内不含本机登录数据或测试账号凭证。
- 打包前 113 项自动检查通过；从包内提取的服务代码已验证测试账号可登录并配置来源。Windows 实机安装、卸载和游戏部署尚待验证。
- 申请内容：审核应用用途和接口使用方式、注册 MODDOCK、分配 SSO slug，并确认接入配置或材料还需哪些调整。发送邮件不等于应用已获批，`nexus-app.json` 仍保持为空。

可使用 `node scripts/stage-review-build.cjs output/nexus-review-<build-id> <prerelease-version>` 固定构建快照，再把生成的 `app` 目录作为 electron-builder 的 `--projectDir`。公开构建不包含私有仓库历史、测试账号、用户数据或 API Key。

## 后续邮件参考模板

这是后续申请时可复用的模板，需填写实际资料；已提交记录见上方。

```text
To: support@nexusmods.com
Subject: Application registration and SSO slug request - MODDOCK

Hello Nexus Mods team,

I would like to register MODDOCK (Chinese name: 游匣), a desktop application
for browsing community mods and managing local game installations.

MODDOCK uses the Nexus Mods APIs for user-initiated browsing, mod details,
file metadata and permitted downloads. It identifies itself with the
Application-Name and Application-Version headers. The application preserves
Nexus download permissions, including the NXM flow for non-Premium users.

User API keys are encrypted locally using the operating system's credential
protection through Electron safeStorage. They are not uploaded to our account
service. We would like to use your SSO service so users can authorize MODDOCK
without manually copying an API key.

Testing build supporting a Personal API Key: [download link]
Source code for review: [repository or source archive link]
Application name: MODDOCK
Short description: Desktop mod discovery, downloads and local game mod management.
Logo suitable for a dark background: [attachment or link]
Maintainer contact: [name and email]

Please review the application and let us know if changes are required before
an SSO application slug can be issued.

Thank you,
[name]
```

测试包需包含正常的游匣登录流程；如审核需要游匣测试账号，由维护者单独准备。不要把个人 Nexus API Key 或真实用户凭证放入安装包、邮件草稿或源码。

## 获批后接入

将项目根目录 `nexus-app.json` 的 `application` 替换为 Nexus 实际分配的 slug，再按 README 的 Windows 打包步骤发布。它是公开应用标识，可以随客户端分发。两个 Windows 打包入口都已包含该配置。

```json
{
  "application": "REPLACE_WITH_APPROVED_SLUG"
}
```

本地开发也可以通过环境变量覆盖，无需编辑配置文件：

```sh
MODDOCK_NEXUS_APP_ID='实际获批的slug' npm start
```

PowerShell：

```powershell
$env:MODDOCK_NEXUS_APP_ID = '实际获批的slug'
npm start
```

不要把示例占位文本或其他应用的 slug 当作 MODDOCK 的标识。当前仓库默认留空；未配置或不在桌面环境时，一键连接按钮禁用并显示原因。

## 实现与验收

连接遵循 [Nexus 官方 SSO protocol 2 示例](https://github.com/Nexus-Mods/sso-integration-demo/blob/master/demo.html)：本机服务连接 `wss://sso.nexusmods.com`，发送随机请求 ID 和协议版本；默认浏览器打开官方 SSO 页，收到 Key 后使用官方用户验证接口校验并加密保存。重连 token 与 NXM 临时授权只存内存。

首次在桌面版连接后，应关闭整个应用并重新打开，登录相同游匣账号，确认显示“已连接 · 本机加密保存”；再断开连接并重启，确认不恢复。还应验证取消、浏览器拒绝授权、断网、Nexus 撤销 Key 和 MU 切换账号。获批前的自动测试使用模拟 SSO 和测试加密适配器，不等于真实账号联调通过。

加密使用 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。Windows 使用 DPAPI、macOS 使用 Keychain；拒绝 Linux 的 `basic_text` 后端。更换操作系统用户或复制数据到另一台机器时可能无法解密，需要重新连接。网页预览不具备桌面系统加密能力，仅保留本次运行的授权。
