# Minecraft Java 非 Lua 制作适配

新增 `minecraft-datapack` 与 `minecraft-resourcepack`，接通真实源文件编写、验证、修复、原生 ZIP 打包和版本检查。不是 Forge/Fabric Java 插件，也不支持基岩版。没有增加新的 Lua 模板。

## 已实现

- 数据包：mcfunction 命令文件，以及 recipe、advancement、loot_table、predicate JSON。强制作品命名空间和实际 load.mcfunction，宿主生成 load/tick 标签与 pack.mcmeta。生成 ZIP 根目录就是 pack.mcmeta 与 data，可放入明确选择的世界的 datapacks 中。
- 资源包：语言、模型、blockstates、items JSON，以及 16×16 方块/物品纹理。模型提供调色板和像素行，宿主编码真正的 PNG，导出包含 assets 和 pack.mcmeta。
- 资源包自动安装到已核对实例的 resourcepacks/<作品ID>，沿用构建绑定、备份、校验、禁用、启用和卸载。需要在游戏中选择资源包；不会修改 options.txt。
- 资源包界面按钮仅执行安装，随后提示从用户自己的启动器进入游戏启用，不猜测 Java 启动参数或把文件部署当作游戏内启用。
- 数据包目前只导出。尚无世界选择界面，因此不会自动决定或写入存档，也不会把它显示成“开发方案或源码”。这项安装能力仍未完成。
- 本机选择器可识别自定义目录中的 Java 实例，不要求目录下有游戏 EXE。版本清单与对应 JAR 需要存在，快照只提供 id/mainClass 和摘要，不发送启动器账号、令牌或参数。
- 制作与私有服务允许类型、Pi 文件编写工具、导出 API、UI 文案及客户端/服务打包清单已同步。

## 版本边界

目前明确核对以下版本，未知版本不会猜测 pack_format：

| Java 版本 | 数据包格式 | 资源包格式 | 官方依据 |
|---|---|---|---|
| 1.21 | 48 | 34 | [1.21](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21) |
| 1.21.4 | 61 | 46 | [1.21.4](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-4) |
| 1.21.6 | 80 | 63 | [1.21.6](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-6) |

1.21 的目录按官方说明使用 function、recipe 等单数形式。格式号相同不代表不同版本所有命令、模型或游戏注册项相同；AI 仍需按具体目标版本查证。当前检查包括 JSON/路径、命令括号与引号、入口、像素及包结构，不是 Minecraft 的完整命令或资源语义编译器。Forge/Fabric 及其他自定义启动实例需要额外适配，不从第三方 mainClass 推断兼容。

## 验证与未完成项

隔离测试覆盖版本格式、真实 PNG、原生 ZIP、Pi 实际源文件提交、私有服务类型、REST 构建/导出、资源包安装与恢复，以及存档和 options.txt 保持原样。它们不证明真实 Minecraft 游戏效果，仍需在对应版本中确认。

尚未部署生产服务、替换用户当前客户端，未声称达到千款游戏适配。后续需要目标世界选择、最新版本格式与语义检查、Forge/Fabric 构建，以及其他主流游戏的非 Lua 工具链。
