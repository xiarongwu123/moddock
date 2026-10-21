# Mod 制作适配进度（2026-10-22）

本次在赛博朋克 CET 路线基础上新增八条游戏专用路线。完成的是代码生成、源文件校验、游戏格式打包和文件安装管理；没有部署生产服务、切换客户端或做真实游戏效果验收。

## 新增路线及范围

| 游戏 | 制作类型 | 可交付内容 | 安装与启用 |
|---|---|---|---|
| 异星工厂 | factorio-lua | Lua 5.2 `control.lua` 运行时脚本、宿主生成的 info.json、原生 `<id>_1.0.0/` ZIP；核对本机 base 版本证据 | Windows 默认 Factorio 数据目录的 mods；需在游戏中启用。自定义/便携目录无法唯一核对时阻止安装，可导出 |
| 饥荒联机版 | dst-lua | Lua 5.1 modmain.lua、modinfo.lua；区分 client/server 范围 | 安装目录 mods/<id>；在客户端或世界的 Mod 菜单启用。不会改专用服务器配置 |
| Noita | noita-lua | Lua 5.1 init.lua 回调、mod.xml；保持游戏沙箱 | 安装目录 mods/<id>；在游戏 Mod 菜单启用 |
| Garry's Mod | gmod-lua | 标准 Lua 5.1 子集的客户端 addon、autorun 与客户端文件发送入口；独立 data 日志 | garrysmod/addons/<id>；不包含服务器插件、GLua 扩展语法或模型/BSP |
| 僵尸毁灭工程 | zomboid-lua | 客户端 Kahlua/Lua 5.1；显式支持 41 和 42 目录；42 包含 common 和 42/mod.info | Windows 默认 Zomboid 用户目录的 mods/<id>；需核对目标系列并在游戏中启用，不处理 Java 插件、地图或专用服务器 |
| BeamNG.drive | beamng-lua | GE Lua 扩展、保留模块 return 值、正确的下划线/目录映射、modScript 加载入口；导出 ZIP 内直接是 lua/scripts | Windows 当前默认用户目录 mods/unpacked/<id>；不制作车辆/JBeam/关卡，不猜测自定义 UserPath 或旧版本目录 |
| 王国风云 3 | ck3-data | 决议、事件、scripted_effects/triggers、英文/简中本地化；Clausewitz 结构语法检查、BOM 本地化、两个 .mod 描述文件 | 系统真实 Documents 下的 CK3 用户目录/mod；保留其他 Mod 和播放集，用户在启动器加入播放集 |
| 潜渊症 | barotrauma-content | Item/Affliction XML、宿主生成 filelist.xml；拒绝 DTD/实体 | 安装目录 LocalMods/<id>；在游戏中启用，不包含 Lua/C# 插件、潜艇或新美术资产 |

所有路线使用作品唯一命名空间。文件事务复用现有备份、冲突检查、失败恢复、启用/禁用和卸载流程；新增用户目录安装模式只允许绑定游戏及当前作品目录，不能由模型指定任意绝对路径。

Lua 使用对应语言版本的静态解析，不执行模型代码。XML 和 Clausewitz 检查是结构校验，不能替代游戏的语义检查或运行。目标版本字段不是兼容承诺；已有可读本机版本证据与请求不匹配时阻止打包，没有证据时报告待验证。Steam buildId 不当作语义版本。

## 运行验收

- 原生 Lua 需要 ModdockVerification.expect/begin/check 的真实状态回读协议；宿主包装日志及错误捕获，不接受初始化日志代替功能验收。
- Factorio、GMod、PZ、BeamNG 已接入相应目录下的日志读取路径，并复用本次启动的日志基线和状态回读逻辑；仍需真实游戏验证这些路径和接口。
- DST、Noita、CK3、潜渊症本轮未接入可归属于当前作品的自动运行日志，明确返回需用户实测的状态。它们不被标为自动玩法验收通过。
- 用户确认当前版本能用后才能存入 Mod 库；修复出的新版本继续要求重新确认。

## 原清单仍待补齐的十一款

巫师 3、神界原罪 2、泰拉瑞亚/tModLoader、杀戮尖塔、武装突袭 3、DayZ、太空工程师、骑马与砍杀 2、无人深空、Minecraft、文明 7。

这些游戏的专用编译、游戏 SDK、资产格式、PBO/JAR/tmod/PAK 等制作和加载路线仍未接通，继续保留明确阻塞。都市：天际线 2 仍只有通用 Unity 路线；上古卷轴/辐射的 ESP/Papyrus 专用制作也未补齐。上述新增八条不意味着这些缺口已经完成。

## 依据

- [Factorio Mod 结构](https://lua-api.factorio.com/latest/auxiliary/mod-structure.html)及[脚本生命周期](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html)
- [Klei 模组论坛与样例](https://kleiforums.com/forums/forum/79-dont-starve-together-mods-and-tools/)
- [Noita 基础结构及示例](https://noita.wiki.gg/wiki/Modding:_Basics)
- [GMod Addon 结构](https://wiki.facepunch.com/gmod/Addon_Creation)及[file.Append](https://wiki.facepunch.com/gmod/file.Append)
- [PZ 版本化 Mod 目录](https://pzwiki.net/wiki/Mod_structure)
- [BeamNG 扩展与加载](https://documentation.beamng.com/modding/programming/extensions/)、[打包结构](https://documentation.beamng.com/modding/mod-support/mod_packing/)、[用户目录变更](https://beamng.com/game/news/announce/user-folder-migration-changes/)
- [CK3 Mod 结构](https://ck3.paradoxwikis.com/Mod_structure)及项目已有 CK3 技能参考资料
- [潜渊症开发者内容包文档](https://github.com/Regalis11/BaroModDoc/blob/main/docs/Intro/ContentPackages.md)
