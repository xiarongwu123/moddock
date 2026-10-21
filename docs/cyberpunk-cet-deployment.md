# CET 创作适配部署

## 改动范围

新增 `cyberpunk-cet-lua` 制作类型。客户端和私有 Pi 服务必须一起更新；旧后端会拒绝新类型。MU 网关路由、会员校验、月 token 额度与支付数据库不需要因这个类型做迁移。沿用现有后端环境配置，不要将密钥或账号数据放入发布包。

## 客户端

从当前源码构建；`scripts/stage-review-build.cjs` 和 `scripts/package-windows.py` 已包含新模块。快照命令：

```powershell
node scripts/stage-review-build.cjs <新目录> 0.6.12-cet.20261021
```

运行环境要求 Node >=22.19.0；系统 PATH 中的 Node 20 不能运行使用 `node:sqlite` 的完整测试。此工作区可使用 `F:\youxia\.tools\node-v22.23.3-win-x64\node.exe`。

## 私有服务

```powershell
node platform/stage-studio-service.cjs <新的服务快照目录>
```

上传快照到新的 release 目录后，依照现有 `platform/MU-STUDIO.md` 流程安装依赖、启动隔离候选服务、验收后切换当前服务。快照包含锁文件、固定资料、语法解析器和哈希清单，不包含凭据。

```sh
npm ci --prefix platform --omit=dev --ignore-scripts
```

本次关键服务文件为 `studio-cyberpunk.cjs`、`studio-ai.cjs`、`studio-authoring.cjs`、`studio-game-api.cjs`、`platform/studio-pi.mjs`、`platform/studio-service.cjs` 和 `vendor/luaparse`。推荐部署完整快照，保持资料和依赖一致。

服务启动仍沿用现有 `MODDOCK_DEEPSEEK_API_KEY`、`MODDOCK_STUDIO_TOKEN`、绑定地址、计量数据库、账号服务与任务目录配置。不要覆盖生产配置、支付数据库或当前任务目录。先保留旧 release 以便回退。

## 验收

1. 候选服务 `/status` 返回 ready；普通/过期账号仍不能调用 AI。
2. 赛博朋克工作区出现 `cyberpunk-cet-lua`；制作请求进入规划与源码生成，不再因只有文档配方而被拦截。
3. 生成真实脚本并通过 Lua 5.1 语法与功能验收协议检查；包内入口为 `mod/init.lua`。
4. CET 缺失时仍可制作和导出；安装明确阻止。CET 位于 `bin/x64/plugins/cyber_engine_tweaks.asi` 且匹配本机游戏版本后，才测试安装。
5. 安装目标为 `bin/x64/plugins/cyber_engine_tweaks/mods/<UniqueID>/init.lua`，只管理本 Mod 文件；测试禁用、启用和卸载。
6. 启动并触发功能；检查本次启动后 `<UniqueID>/<UniqueID>.log` 的初始化标记和实际状态回读。旧日志、初始化成功或文件校验通过不能证明玩法生效。
7. 让用户确认当前版本能用后再存入 Mod 库；修复后的新版本需重新确认。

本次代码测试使用隔离 HTTP/Pi 及游戏接口 fixture，未调用生产模型、部署服务器或在真实游戏内验证。

## 依据

- [CET Mod 目录与 init.lua](https://wiki.redmodding.org/scripting-cyberpunk/cyber-engine-tweaks/first-steps/mod-structure)
- [CET 专属 Mod 日志](https://wiki.redmodding.org/scripting-cyberpunk/cyber-engine-tweaks/cet-functions/misc/debug-functions)
- [CET LuaJIT/Lua 5.1 变更](https://wiki.redmodding.org/cyber-engine-tweaks/patch-notes)
