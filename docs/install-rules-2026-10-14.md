# Nexus MOD 自动安装规则核对

核对日期：2026-10-14。规则登记在 `install-rules.cjs`，选择与拒绝条件在 `auto-install.cjs`。以下是目录部署规则的依据，不表示已经验证所有游戏版本或任意 MOD。

## 原实现的问题

原实现用已存在的顶层目录推断游戏根目录映射、用任意 `Content/Paks` 推断 `~mods`、用 DLL 后缀与加载器文件存在推断插件类型。这些条件不足以证明安装方法正确，已从默认自动安装移除。已保存的手动规则也不再作为自动识别失败的兜底；只能从高级设置主动执行。

## 已采用的规则

| 游戏 / 类型 | 默认行为 | 依据与限制 |
| --- | --- | --- |
| 星露谷 / SMAPI | 检查 manifest、入口、依赖和最低版本，部署到 `Mods/<UniqueID>` | [SMAPI 玩家指南](https://stardewvalleywiki.com/Modding:Player_Guide/Getting_Started)：每个 MOD 有独立子目录；Mac 内容根目录为 `Contents/MacOS`。不自动安装 SMAPI 或把 XNB 替换包当清单包。 |
| 赛博朋克 / legacy archive | `.archive` 部署到 `archive/pc/mod`，检查 RDAR 头及本机游戏入口 | [Red Modding 维护者指南](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-users/users-modding-cyberpunk-2077)。REDmod 的 `mods/<名称>/info.json`、ArchiveXL、redscript 等有不同前置和步骤，当前不混入此规则。 |
| 霍格沃茨 / 普通 PAK | `Phoenix/Content/Paks/~mods`；保留 PAK / IoStore 配套文件 | [Nexus 官方 Vortex 扩展](https://github.com/Nexus-Mods/game-hogwartslegacy)。`LogicMods`、Lua、影片替换使用其他安装器，不按普通 PAK 处理。 |
| 严阵以待 / 普通 PAK | `ReadyOrNot/Content/Paks`；作者明确要求时使用其 `~mods` 子目录 | [作者安装与故障排查指南](https://www.nexusmods.com/readyornot/articles/321)。不调用会同时清除存档的游戏清理入口。 |
| 黑神话 / 普通 PAK | `b1/Content/Paks/~mods`；文件说明明确要求 `Mods` 时使用该目录 | [作者说明](https://www.nexusmods.com/blackmythwukong/mods/1407?tab=posts)、[另一作者的 Mods 路径说明](https://www.nexusmods.com/blackmythwukong/articles/64)。`-fileopenlog`、Signature Bypass、UE4SS 等条件因 MOD 而异，不能对所有 PAK 统一加参数或猜测已满足。 |
| 剑星 / 普通 PAK | `SB/Content/Paks/~mods`；文件说明明确要求 Paks 根目录时使用该路径 | [作者安装说明](https://www.nexusmods.com/stellarblade/mods/232)、[文件级 Paks 根目录说明](https://www.nexusmods.com/stellarblade/mods/2789?tab=files)。CNS 等结构化资源和前置需要额外处理。 |
| 铁拳 8 / 普通 PAK | 默认 `Polaris/Content/Paks/~mods`，优先采用所选文件说明中的已登记目录 | [扩展作者规则](https://www.nexusmods.com/site/mods/1833)、[明确要求 mods 而非 ~mods 的作者说明](https://www.nexusmods.com/tekken8/mods/319)、[Paks 根目录说明](https://www.nexusmods.com/tekken8/mods/39)。多套可选文件、外部 Moveset 工具、蓝图不混装。 |
| BepInEx 5 | 规范 `BepInEx/plugins` 与 `BepInEx/patchers` 包分别映射；裸 DLL 只有明确作者目录说明时才判断 | [插件规范](https://docs.bepinex.dev/master/articles/dev_guide/plugin_tutorial/2_plugin_start.html)、[预加载补丁规范](https://docs.bepinex.dev/master/articles/dev_guide/preloader_patchers.html)。存在 BepInEx 不代表所有 DLL 都是插件；当前没有跨 Mono / IL2CPP / BepInEx 6 的兼容认证。 |
| MelonLoader | 按明确包内目录区分 `Mods` 和 `Plugins`，检查已安装加载器目录及默认代理文件 | [加载器维护者 README](https://github.com/LavaGang/MelonLoader#readme)。不把任意 Mods 文件夹或代理 DLL 当成 MelonLoader。 |

## 每个 Nexus 文件的检查

安装时重新读取当前 MOD 的描述、所选文件的描述和 Nexus 前置列表，核对文件仍属于该游戏和 MOD。文件说明优先于包内 README 和全局描述；仅允许选择规则登记的路径，不从任意文字生成可写路径。互相冲突的目录说明停止自动安装。

包内 README 是不可信数据：仅用于匹配已登记的安装目录，不执行脚本、不执行自然语言指令、不访问其中的任意链接。前置清单无法确认已安装时停止；SMAPI 同时读取已有清单。安装记录保存规则编号、核对日期、资料链接与实际目标目录，可从“安装依据”查看。

## 尚未完成自动适配的类型

Skyrim SE / Fallout 4 的 Data 路径可从 [Nexus Skyrim 扩展](https://github.com/Nexus-Mods/vortex-games/blob/master/game-skyrimse/index.js) 与 [Fallout 4 扩展](https://github.com/Nexus-Mods/vortex-games/blob/master/game-fallout4/index.js) 确认，但插件启用、排序、资源配置和脚本扩展仍需额外事务支持。因此默认自动安装不把“复制到 Data”报告为完整安装；高级手动部署仍保留。

RAR / 7z、FOMOD、REDmod、ArchiveXL / redscript 等混合框架包、UE4SS Lua / 蓝图、ReShade、外部部署工具和无法确认的游戏均需专用适配。下载可以保留，无法完成自动安装时会显示具体原因。

## 验证边界

自动测试使用临时游戏目录验证目标路径、作者目录覆盖、前置拒绝、配套文件、保存规则依据，以及既有原文件备份与恢复。浏览器验证按钮和实际文件变化。这些检查不替代 Windows 实机、真实 MOD 包和实际游戏加载验证。
