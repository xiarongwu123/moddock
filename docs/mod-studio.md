# AI Mod 创作工作台

主导航“AI 创作”或游戏详情“AI 创作 · PRO”进入。沿用现有界面风格；用户通过对话描述需求、回答问题、修改、安装和启动，不需要填写工程参数或手写代码。

主界面围绕对话、创作进度和作品展示。Pi、Skill、Agent 等底层名称不出现在产品状态中；实际事件显示为“查阅制作资料”“检查游戏环境”等用户能理解的动作。进度默认只占一行，“查看过程”中集中收起真实处理记录、思考记录和制作方案，不生成假思考。作品卡片在对话末尾展示，输入框固定在下方，编译报告与文件详情可按需展开。

先从列表选择游戏，或在桌面端拖入游戏文件夹/原生启动文件，点击“启动引擎”检查所选游戏的创作环境。此操作不启动游戏进程，也不调用生成模型。生成完成后可选择“进游戏确认”（自动安装当前版本、启动并检查日志）或“满意，存进 Mod 库”（校验并保存到现有 Mod 库，不自动安装或启动）。保存记录持久化且支持重复调用；保存后可打开对应游戏的 Mod 列表。开关复用已安装 Mod 的启停操作；仅展示实际支持的控制，不为内容包虚构滑条或快捷键。

拖入游戏通过 sandbox preload 的 webUtils 读取用户拖入文件的位置，服务端验证原生文件与目录后保存本机游戏记录；已有启动器游戏保留原 ID。不会执行拖入文件，脚本和快捷方式被拒绝。选择新游戏仍需有效 Pro、library.manage 与 configuration.edit 权限。

## 真实模型服务

规划、生成和修复均由服务端 `@earendil-works/pi-coding-agent` 1.3.0 的原生 `createAgentSession` 管理。Pi 负责模型流、工具循环、Skill 资源与专项 Agent 会话。新客户端的 `agentStep/toolHistory` 自定义循环已移除；应用不再手写模型 HTTP 请求或解析模型伪造的工具决策 JSON。服务端仅为旧 BG3 客户端保留有界的检查握手和结果包装，实际创作仍调用同一个 Pi 会话，避免升级期间旧安装包中断。

Pi 注册受限的 `inspect_game`、`read`、`read_reference`、`search_api`、`read_runtime`、`run_agent`、`submit_result` 工具。提交前必须检查游戏并实际读取已选 Skill 和游戏专项参考。BG3 自由脚本还必须查询固定的 BG3SE/Osiris 接口，并通过引用校验；客户端继续负责真实 Lua 编译和构建，不执行模型 Lua。`read_runtime` 仅返回传入的宿主验证报告；未提供时明确报告没有本次运行证据。

`run_agent` 创建独立 Pi 专项复核会话，读取同一组已选技能；不允许递归委派，每阶段最多调用两次，主会话与专项会话合计：规划阶段最多 14 个模型回合，编写与修复阶段最多 36 个模型回合。会话、设置与凭据存储均隔离于个人 Pi 配置，不加载用户全局扩展、命令或任意 shell 工具。

生成脚本可声明开关、数值参数、动作和 F6–F12 快捷键。宿主生成服务端设置轮询与客户端按键入口；设置保存在本机用户目录，跨游戏启动保留，不按存档区分。动作使用唯一编号，游戏回执必须匹配当前编号；参数回执必须匹配当前修订。未收到回执时只显示等待。停止效果是否完全可逆取决于脚本逻辑；已写入游戏存档的效果需要游戏本身的恢复方式。

在对应游戏“我的 Mod”中点击“参数与快捷键”。安装前仍检查 Script Extender 与 Public 配置；此控制面板不改动游戏二进制或其他 Mod。内置 wasmoon 1.16.0 / Lua 5.4 编译器可检查新式 BG3 脚本，无需玩家安装开发工具。

客户端通过 MU `/api/v1/studio/plan`、`generate`、`repair` 使用当前登录态请求创作。MU 校验账号、有效 Pro 与功能权限后，转发私有 Pi 服务的 NDJSON 事件流并及时刷新。Pi 自带 provider 负责调用固定的 DeepSeek `deepseek-flash`，启用真实 thinking。没有直接调用模型 API 的应用侧回退路径；服务失败时保留想法与已有文件。

官方协议：https://api-docs.deepseek.com/quick_start 。deepseek-flash 后的括号是文档脚注，不属于模型名。

模型 API Key 只放在服务端的私有环境文件中。客户端安装包不含 studio-ai.cjs、模型凭据或私有服务令牌，不读取本机 studio-ai.bin 或 MODDOCK_DEEPSEEK_API_KEY；用户登录 MU 后即可使用有效 Pro 权限创作。MU 登录令牌仍由桌面宿主管理，不交给浏览器。模型端点、模型名及系统提示由服务端固定，客户端不能指定任意上游地址。部署说明见 [MU 创作服务](../platform/MU-STUDIO.md)。

每个 Pi 阶段有 300 秒超时、取消与结构校验；输入最多 192 KiB，最终结果最多 256 KiB，含心跳的事件流最多 2 MiB，持久化活动记录限制为 64 KiB。浏览器通过现有 1.2 秒会话轮询显示真实事件。模型只接收所选游戏的有限诊断、资料与对话，不接收安装目录、编译器路径或令牌。资料不能授权执行命令、安装加载器或扩大工具权限。

## 自动选择 Skill 与 Agent

`studio-skills.cjs` 根据游戏 App ID、名称和已识别引擎选择；服务端重新计算，不接受客户端指定任意 Skill 路径。未知游戏使用通用流程，未确定 Mono/IL2CPP 的 Unity 游戏先使用引擎诊断指南。

| 匹配 | 自动选择 |
|---|---|
| 所有游戏 | Universal Modder |
| Unity Mono / IL2CPP | MODDOCK BepInEx 专项适配 |
| Unreal / Creation Engine | Unreal / Bethesda 专项 |
| Minecraft / 文明 7 / 王国风云 3 | 各自的上游游戏专项 Skill |
| 星露谷物语 | SMAPI / Content Patcher 专项 |
| BG3、泰拉瑞亚、赛博朋克 2077、巫师 3、异星工厂等 19 款 | 游戏专项 Skill + 对应参考文档 |

上游 MIT 资料、提交与文件哈希见 `vendor/studio-skills/UPSTREAM.json`。BepInEx 适配为项目独立编写，上游参考链接保留，未复制无许可证的技能正文。Minecraft 专项需要的 MCP 尚未配置，Pi 会使用该技能自带的无 MCP 工作流，不把缺失的 MCP 标为可用。专项资料不会让尚未支持的游戏自动具备编译/安装能力。

服务端配置与验证：`npm run studio:setup-agent` 安装固定 Pi 运行时，`npm run studio:check-agent` 校验固定资料与路由。Agent 角色在 `agents/studio-creator.md` 和 `agents/studio-specialist.md`。这些配置无需玩家填写模型密钥。

规划提示词只提供当前游戏可用的制作类型及其结构，不混入其他游戏模板。方案类型、步骤或 JSON 不合法时，将校验原因交回真实模型，最多自动修正两次；生成阶段也单独校验产物类型，并对类型或 JSON 错误最多自动修正两次，均无模板回退。服务错误和取消不触发重试。对话保留每次规划的类型、校验原因和是否通过，不保存原始服务响应。用户让 AI 自行决定创意细节时，模型选择合理默认值。

启动迁移删除旧 local-template / aiUsed:false 产物、旧模拟方案和回复；用户原始想法保留，可以通过真实模型继续。

## 对话流程

1. 选择本机游戏，输入想法。
2. 读取本机引擎、加载器与依赖证据，匹配 universal-modder 指南和案例。
3. Pi 按游戏与引擎加载对应 Skill，选择可用制作路线，信息不足时在对话中提问。
4. 生成完整源码或内容，自动校验、编译并保存实际产物。
5. 编译错误最多自动修复两次，每次保留独立版本；缺依赖或工具时报告 blocked。
6. 说“安装”或“安装并启动游戏”，通过现有安装事务、备份与冲突检查部署。
7. 说“启动游戏并检查日志”，通过既有原生入口或 Steam/Epic 启动，观察本次日志。
8. 说“检查本次运行”再次读取加载证据。文件、编译、加载和游戏内玩法效果分别记录。

其他固定动作：“重新编译”“查看验证报告”“检查制作环境”“预览产物”“导出”“导出编译包”。这些动作不消耗模型请求。下载与预览仅在当前页面触发，历史对话不会重放。

对话按账号和游戏隔离，每游戏最多 40 个对话、50 个项目，每对话最多 50 条消息、单次输入 2000 字。任务最长 900 秒，单次后端请求仍受原有超时限制；停止、退出登录或关闭服务会取消后续阶段。中断记录可继续。

## 多游戏工具链

| 路线 | 制作、编译、安装 |
| --- | --- |
| Unreal / UE4SS | 模型生成 Lua，真实 Lua 5.4 luac -p 语法检查；安装到唯一 UE4SS.dll 旁的 Mods/项目目录 |
| RE Engine / REFramework | 模型生成 Lua，真实语法检查；安装到检测到的唯一 reframework/autorun |
| Unity Mono / BepInEx 5 | 模型生成 C# 初始化方法，宿主生成加载入口；固定 Roslyn 编译，引用本机游戏 DLL；验证 PE/CLR 后安装实际编译 DLL 到 BepInEx/plugins/项目目录 |
| 博德之门 3 / Script Extender | 模型生成真实服务端 Lua；Lua 5.4 语法检查，宿主生成 LSX / SE 配置并打包 LSPK v18；回读元数据与全部文件后导出实际 .pak，安装至用户 Mods，并以事务合并 Public 加载顺序 |
| 星露谷 Content Patcher 对话 | 12 位原版角色星期对话；验证 JSON、SMAPI 与 Content Patcher，再安装到 Mods |
| 星露谷 Content Patcher 贴图 | 模型设计 16 × 16 像素，由宿主编码 PNG；验证 CRC/尺寸后替换生锈的剑外观 |
| 自定义源码工程 | 任意游戏；安全相对路径、最多 12 个文件与 64 KB 文本；没有专用构建适配时仅导出并报告 blocked |
| 开发方案 | 任意游戏；导出资料与方案，不作为可安装 Mod |

Unity IL2CPP 使用下述原生工具链。原生 C++ 和 PAK/IoStore 资源制作仍需对应适配。语法或编译成功不能证明实际玩法已生效；保护条件或格式不兼容时报告具体阻塞。

博德之门 3 的 `bg3-lua` 与 `bg3-follower` 已接通制作、PAK 打包、安装、入库、开关与卸载。安装使用 Windows `%LOCALAPPDATA%/Larian Studios/Baldur's Gate 3`（macOS 对应 Documents/Larian Studios）；只修改该用户目录的 `Mods/本项目.pak` 和 `PlayerProfiles/Public/modsettings.lsx` 中本模块的记录。不会写到游戏 Data，也不会创建空加载配置。需先运行游戏创建 Public 配置，并装有 Norbyte Script Extender 的 `bin/DWrite.dll`。宿主可用 installers.bg3DataPath 注入受控验收目录，此路径不来自模型。默认“导出 ZIP”交付实际编译 Mod 包，不交付源码工程。

加载顺序通过 XML DOM 合并，保留主战役、其他模块和未知字段。包文件与加载顺序共用安装日志和回滚事务；停用、卸载、原生恢复与档案切换只处理自己的 UUID，检测到冲突或外部改动时停止。生成包的源文件不直接安装。Script Extender 在 SessionLoaded 后写入本产物唯一日志，位于用户目录 `Script Extender/Moddock/产物UUID.log`；仅本次新日志可确认初始化，不能据此确认人物玩法、外观或完整剧情。

人物初期范围是复用当前玩家模板的自定义跟随者。AI 通过 `bg3-follower` 生成姓名和问候台词，宿主提供已测试的生成、命名、跟随与 PersistentVars 读档去重逻辑；首次创建通过游戏原生消息框显示问候。部分初始化失败会重试同一个角色，错误日志不会被成功标记覆盖。此配方不执行模型代码；有 Lua 工具时进行实际语法编译检查，无外部编译器时仍可按固定配方与经过安全转义的创作字段打包。自由脚本 `bg3-lua` 始终要求真实 Lua 编译检查。

全新头模、服装网格、配音、职业重做、起源选择、招募对话树、好感度和完整同伴剧情尚未适配，不应声称已经生成。需要新外观时，先明确其资源依赖。文件卸载不会改写旧存档或移除已经保存在存档中的角色对象。仅有开发方案或源码的其他游戏仍会在对话中明确提示；文档不会作为可安装 Mod 交付。

格式依据：[Norbyte LSLib](https://github.com/Norbyte/lslib) 的 PackageFormat/PackageWriter/PackageReader；脚本依据：[Norbyte BG3SE API](https://github.com/Norbyte/bg3se/blob/main/Docs/API.md) 与导出的 Osiris 函数签名。宿主内置有界的 LSPK v18 非 solid 写入与校验，不执行模型提供的打包脚本。需要运行独立 LSLib 读取检查后再声明格式验收；真实 Windows / 游戏内效果仍需实机验收。

宿主不执行生成的 Lua、DLL、MSBuild 目标或任意工程命令。BepInEx 草稿入口为 Moddock.Generated.ModContent.Initialize；宿主加载入口在初始化成功后写入当前产物唯一标记。Lua 同样在初始化完成后写入唯一标记。

`npm run studio:setup-tools` 从官方来源下载并校验 Lua 5.4.8 与 .NET 8 SDK，存入忽略的 .moddock-tools，不修改 PATH。支持 --lua-only / --dotnet-only。可通过 MODDOCK_TOOLCHAIN_DIR、MODDOCK_LUAC、MODDOCK_DOTNET 或 studio.tools 配置宿主工具。发布包不默认附带约 600 MB SDK，缺工具时报告具体原因。

## 安装、启动与日志

安装只接受当前账号、游戏、通过构建校验且完整性匹配的产物。C# 使用经过 SHA-256 校验的编译包，源码不会作为 DLL 安装。相同版本重复安装校验现状；新版本只替换同一对话自己的旧版本，失败时恢复旧包。其他托管 Mod 保留现有启停状态，外部修改和冲突由现有安装器阻止，不自动覆盖。

安装与启动前重新检查账号、Pro 与 library.manage / game.launch 权限。游戏路径或托管文件变化时停止启动。不会由模型决定任意目标目录、可执行文件或参数。

启动前记录日志基线，验证只读取本次追加或本次重建的日志：

- UE4SS：唯一 UE4SS.dll 旁的 UE4SS.log。
- BepInEx：BepInEx/LogOutput.log。
- REFramework：游戏根目录的 re2_framework_log.txt。
- SMAPI：现有启动管理器的日志与本次加载列表，核对当前产物名称、版本及运行编号。

UE4SS / REFramework / BepInEx 只有本次日志出现产物唯一初始化标记才返回 loader_loaded；同时出现错误返回 loader_with_errors。无新日志、平台只接收了启动请求或未出现加载证据时返回 unconfirmed，用户可稍后再次检查。只读取普通文件，不跟随日志路径链接，单日志限 8 MB。加载成功仍需在游戏内确认玩法效果。

## 产物与接口

数据位于 creations/<owner hash>/<artifact id>。保存源码 ZIP、记录、独立构建目录 builds/<build id> 与 deployment.json。构建报告含输入/输出 SHA-256、编译器、实际步骤与运行证据，保留最近 5 次构建。

产物预览提供概览、制作文件与验证报告。直接校验 ZIP 的 SHA-256、条目及 CRC 后展示只读文件，不执行代码或伪造游戏画面。

所有 /api/studio/* 操作要求登录、同源、X-Moddock-Token 和有效 Pro 权限。常用 POST：

| 接口 | 参数与用途 |
| --- | --- |
| conversations/send | gameId,message,id?,artifactId? 或 gameId,id,resume:true；HTTP 202；仅真实 AI 模式 |
| conversations/read / list | 持久化消息、实际阶段与历史 |
| workspace / diagnose | 本机诊断、适配器和参考资料 |
| games/add | 桌面文件选择器或拖入路径；保存本机游戏，不启动 |
| library | gameId,id；把通过验证的当前 Mod 存入 Mod 库，不安装或启动 |
| controls | gameId,id；读取当前账号、已安装版本的参数及回执 |
| controls/update | gameId,id,operation；保存带修订校验的参数或发送允许的动作 |
| controls/action-status | gameId,id,nonce；仅核对当前动作的游戏回执 |
| read / list | 当前账号的产物、构建及安装状态 |
| preview | 校验并读取 ZIP 文件 |
| prepare | 现有安装方案预览，C# 使用编译 ZIP |
| export | id,buildId?；源码或编译包 |
| cancel | 取消当前账号任务 |

## universal-modder 来源

https://github.com/rehan-remade/universal-modder ，固定提交 23902ef42e8ea9b077bfbbf6911eb8ea0348e55a。来源记录在 vendor/universal-modder/UPSTREAM.json，保留 MIT/OFL 声明，见 THIRD-PARTY-NOTICES.md。

Python 桥只调用原版 um.scan；文件索引限制为所选游戏、12000 项、6 层，不跟随链接。需 Python 3.10+，未安装时使用明确标注的本地兼容诊断。指南与最多三篇案例用于模型参考，不代表当前游戏已通过实机验收。未向模型开放上游任意命令执行入口。

## 验证入口

### 按引擎开放创作（0.6.5）

Unity、Unreal、Godot、RPG Maker、Ren'Py、GameMaker 按文件特征进入创作，不再要求先有某款游戏的专项配方。专项资料补充引擎路线。默认仍交付实际 Mod；需要额外工具或游戏接口时保留实际源码和具体阻塞，状态保持 blocked，不返回完成的开发方案。

| 引擎 | 当前可构建路线 | 仍会阻塞的情况 |
| --- | --- | --- |
| Unity | Mono 的 BepInEx 5；IL2CPP 自动准备 BepInEx 6、Cpp2IL 与 Il2CppInterop，使用真实游戏接口和 .NET 6 引用编译、安装 DLL | 加密或定制元数据、缺少实际玩法接口、上游暂未支持的 Unity 版本 |
| Unreal | UE4SS Lua；唯一 Win64 Shipping 入口可准备官方默认运行时 | 当前构建的反射接口、加载兼容或 cooked/IoStore 工具缺失 |
| Godot 3 / 4 | 恢复代码与设置、匹配版本原生解析、GDScript 字节码编译、autoload 注入、重建 PCK / 内嵌资源、增量安装与还原 | 加密或定制容器、未提供的引擎工具版本、缺少玩法接口 |
| RPG Maker | MV/MZ JavaScript；XP/VX/VX Ace 读取真实 RGSS 脚本、Ruby 编译、Main 前注入、重建数据库与 RGSSAD/RGSS2A/RGSS3A | 2000/2003 的 LCF、定制数据库格式或缺少实际脚本接口 |
| Ren'Py | Python 初始化脚本、唯一 .rpy 入口及派生 .rpyc 生命周期 | 游戏变量、脚本解包或对应 Python/Ren'Py API 缺少证据 |
| GameMaker VM | UndertaleModTool 反编译实际 GML 入口、联合编译、data.win 回读、增量安装与还原 | YYC 原生构建、上游尚未支持的数据版本或缺少实际入口 |

本机快照只收录所选游戏范围内的有限资源，跳过存档、用户数据和链接；大文件只提取带摘要的接口片段，不能当作完整修改目标。Pi 原生工具提供 list_game_files / read_game_file / search_api，实际工程由 write_project_file 写入，再经 validate_project 校验。没有直接模型 API 调用旁路。

engine-mod 工程用 mod.json 声明加载方式，再提交实际代码或绑定原文件 SHA-256 的资源替换。桌面独立构建 deploy/ 包；安装和执行前复核原文件版本，通过原有事务备份、替换和还原。Ren'Py 缓存在停用、卸载、档案切换及还原时一并处理，防止只删除源码后脚本仍生效。同一对话更新版本时，资源预条件绑定上一版本还原后的原始文件，插件清单去掉上一版本条目。

新增验证覆盖六类识别与选路、完整/片段证据、原文件过期、真实 JS/Python 静态语法、插件注册与玩法模拟、Ren'Py 缓存、版本替换和打包依赖。真实模型通过 Pi 生成过 MV/MZ 插件和 Ren'Py 脚本；这些结果不构成六类引擎所有游戏的运行验收。

新增四条原生路线通过真实 Pi 读资料、读取本机接口、写工程和提交代码，再由桌面原生工具构建。Godot 使用同版本官方原生解析器 check-only 和 GDRE 字节码编译；Godot 3.6.1、4.4.1、4.5.2 的导出式样例包含二进制项目设置和 .gdc，覆盖 PCK v1/v2/v3，实际运行确认数值修改。GameMaker 使用完整 CLI 反编译及重编译，不执行模型 C# 或命令。RGSS 的 Marshal 仅支持受限数据类型，Ruby 编译器不执行源码；XP/VX 要求保守 Ruby 1.8 写法，CRuby 3.3 语法通过不能代替目标 RGSS 兼容验证。IL2CPP 使用 Cpp2IL 公开真实测试二进制生成互操作程序集，DLL 按 BepInEx 的 .NET 6 运行时引用编译，不将游戏程序集导出。

原生容器 Mod 导出 MODDOCK-NATIVE.json 和 Fossil 增量，不复制整份原游戏资源。安装前绑定原资源大小、SHA-256、载荷和结果摘要，先在暂存目录重建，再复用原安装事务备份及还原。单个原资源上限 1 GiB，单个增量上限 24 MiB，编译 ZIP 上限 32 MiB。版本更新时从旧版本的原始备份构建增量基线。工具首次自动下载到宿主缓存，按固定摘要或官方校验清单核对；前端展示真实准备、提取、编译、修复及打包过程，不向玩家暴露底层运行时品牌。真实 Windows / 具体游戏效果仍按用户安排稍后验收。

默认创作交付必须是实际 Mod。只有用户明确要求方案或源码时，才接受 project-plan / custom-project。没有制作适配时保留想法并报告具体阻塞，不把文档当作制作成功。构建失败或缺条件时，对话以 failed / blocked 结束，可继续修复。

Lua 创作使用隔离工程工具 write_project_file / read_project_file / list_project_files / validate_project。模型必须写入 main.lua、读取真实 Lua 5.4 编译反馈并修复；提交时宿主读取该文件并校对摘要，修改后必须重编译。服务端不执行生成的游戏代码。桌面独立校验和打包实际加载文件，未安装加载器不妨碍脚本编译与导出。

严阵以待（1144200）选择 ready-or-not 专项技能，search_api 使用固定 MIT SDK 的 1000 余条类和函数签名，记录来源行号和 SHA-256。Windows 自动环境适配识别唯一 Shipping 可执行文件，准备已校验的 UE4SS 实验版、默认设置、UEHelpers 和 SDK 后端；不套用悟空配置、不安装示例 Mod。静态 SDK、编译和安装文件校验不代表当前游戏版本的伤害调用路径或玩法效果已经验证。

`npm test` 覆盖提供方协议、凭据存储、迁移、真实 Lua/C# 编译、编译包完整性、安装事务、版本替换、权限和日志新旧隔离。

`node test/studio-preview.cjs` 提供临时游戏与账号环境；默认不连接模型，禁止生成模拟产物。--live-ai 仅为后端开发保留，不是发布客户端的配置方式。--compiled-fixture 为 Unity 测试目录编译合成引用，仅供真实编译链路验证。`test/studio-mu.test.cjs` 覆盖默认 MU 接入、刷新、取消、会话并发、私有服务鉴权与错误脱敏。真实 MU 和模型验证由隔离 schema-5 实例运行 verify-studio-runtime.py；测试环境和自动化不能代替真实 Windows 游戏验收。
# 连接恢复与诊断

创作请求使用账号隔离的任务编号和递增进度编号。客户端连接断开只解除订阅，服务端继续运行同一个创作任务；重新连接时补收尚未确认的事件，不重新规划或再次生成代码。模型服务短暂断连时，由原有运行时在同一会话内有限重试，已经完成的工具操作继续保留。用户点击停止仍会明确取消任务。

服务端逐次保存工程文件、进度事件和最终结果。思考文本按短时间窗口合并后发送，避免逐字事件的开销耗尽通道上限；内容本身不因合并丢失。订阅会定期轮换，减少长连接故障对创作的影响。

异常时展开“查看错误详情”可查看失败阶段、错误码、上游状态码和请求编号，并导出诊断 JSON。服务端与本机日志通过同一个任务编号关联，记录实际模型和工具错误；日志会遮盖凭据与签名参数。

任务事件与结果保留 24 小时供断线重取。服务进程重启会保留已经完成的结果；尚未完成的会话会记录中断并保留已写代码，不会偷偷开始一次重复生成。该场景与网络重连分开处理。
