# 八款原生游戏 Mod 路线交付与部署

本次只交付代码及快照，不激活服务器或客户端。修改位于 `F:\youxia\moddock`；新的交付目录为 `F:\youxia\release\20261022-native-game-mods`。它包含前一批 CET 代码，不需要先叠加旧 CET 补丁。

## 同步范围

客户端增加 `studio-game-mods.cjs`、专用配方、语法与内容校验、原生导出 ZIP、安装器的 game-mod 模式及对应日志目录。私有服务同步支持八个新类型、Lua/内容源码工作区和校验。旧私有服务会拒绝新类型，因此应先验收并更新后端，再更新客户端。

MU 网关路由、登录与 Pro 权限、月 token 计量及支付数据库不因这批类型新增而迁移。沿用现有服务器配置和任务目录；快照不包含生产凭据。不要以代码快照覆盖数据库、service.env 或正在进行的任务数据。

## 重新生成快照

使用 Node >=22.19.0；本机系统 PATH 的 Node 20 不满足测试和计量模块要求。

```powershell
& F:\youxia\.tools\node-v22.23.3-win-x64\node.exe scripts/stage-review-build.cjs <新的客户端目录> 0.6.13-nativegames.20261022
& F:\youxia\.tools\node-v22.23.3-win-x64\node.exe platform/stage-studio-service.cjs <新的服务目录>
```

`client/app` 是已构建 UI 的客户端源码快照，不是 Windows 安装程序；可按既有 Electron 流程打包。`service`/`service.tar.gz` 是私有服务快照。Linux 上按锁文件安装服务依赖：

```sh
npm ci --prefix platform --omit=dev --ignore-scripts
```

之后沿用 `platform/MU-STUDIO.md` 的候选服务验收、保留旧版本和切换流程。确认哈希清单、ready 状态、Pro 权限及额度仍有效，再激活候选服务。此次没有为你执行服务器操作。

## 游戏验收

1. 对八款游戏分别确认可用制作类型，不再因为只有文档配方而直接报制作适配缺失。
2. 提供准确版本、范围和需求；验证 AI 实际写入源码/内容并运行 validate_project，不返回开发方案冒充 Mod。
3. 检查原生导出 ZIP 的顶层目录。Factorio 是 `<id>_1.0.0`，BeamNG 直接是 lua/scripts，CK3 包含作品文件夹及同级 .mod。
4. 使用测试游戏/隔离用户目录安装，验证文件位置、冲突、运行中拒绝写入、禁用/启用、卸载和存档保留。程序自动定位用户目录，不开放模型指定任意目标路径。
5. 必须在相应游戏/启动器中启用 Mod。文件已部署不代表游戏菜单里已启用，更不代表玩法有效。
6. 对有日志路线检查本次启动后的唯一作品标记和实际状态回读；其余路线走明确的用户实测反馈。
7. 当前版本经用户确认可用后才允许存入 Mod 库；后续修复版本重新确认。

范围和剩余十一款缺口详见 `docs/studio-capability-audit-2026-10-22.md`。本轮自动测试使用隔离游戏、HTTP、Pi 和 Lua VM fixture，不等于生产模型或原生游戏验收。
