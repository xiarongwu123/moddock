# 7z / RAR 与 FOMOD 安装

下载管理的“一键安装”按文件头识别 ZIP、7z、RAR4 和 RAR5，包括后缀误标的下载。7z/RAR 使用内置 7-Zip 26.04 的完整解码器，无需安装外部软件。先列清单，复用文件数量、单文件/累计体积、膨胀倍数和安全路径检查，再逐个流式解包，验证实际大小、CRC 和 SHA-256。链接、特殊文件和加密条目不自动安装。

发现唯一的 `fomod/ModuleConfig.xml` 后展示选项卡片。作者名称和描述通过既有翻译服务转成中文，保留原文查看与重试；服务不可用时回退原文。选择只改变选项状态，不写游戏文件；点击“生成安装方案”后重新核对下载 SHA-256、配置摘要、选项规则、源文件、目标和冲突。预览确认后沿用现有事务安装器备份、部署、失败回滚、启停和卸载还原。

支持五种组规则、Required/Recommended/Optional/NotUsable/CouldBeUsable、标记依赖、条件可见步骤、动态选项类型、必装文件、条件文件、file/folder 映射、alwaysInstall/installIfUsable 与文件优先级。相同优先级写入不同内容的同一目标会明确报错。未选择的资源和安装器元数据不部署。

Skyrim、Fallout 等已识别的 Bethesda 游戏以 Data 为目标根，并检查游戏入口文件。其他游戏必须通过现有游戏/作者目录规则。插件部署后仍需由游戏或加载器启用并确认顺序；遇到依赖 Active/Inactive 插件但无法可靠读取其状态时停止。gameDependency / fommDependency 等版本比较声明目前明确拒绝，不忽略。脚本式 FOMOD、多个配置入口、加密包及需要外部部署器的包不支持。当前逐文件映射最多 2000 项。

组合自动安装遇到需要交互的 FOMOD 会暂停，并提示从下载列表选择选项；完成后可继续组合。启动前安装遇到 FOMOD 会打开选项界面，完成后再次启动游戏。

验证：`test/fomod.test.cjs` 与既有安装器测试合计 32 项通过，覆盖解析、安全、真实 7z/RAR、加载器前置保留、组合遇到交互时暂停，以及完整部署还原。`test/ui-fomod.cjs` 覆盖登录后的选项、中文翻译重试、翻译回退、预览、安装和还原；翻译接口以模拟响应校验，未验证在线服务实时可用性。RAR 测试样本来自 libarchive，保留其 COPYING。

当前源码快照缺少既有 React 组件及翻译/轮询模块，完整 `build-ui.cjs` 构建仍有原有缺口。本次沿用项目已有的 `update-studio-bundle.cjs` 方式，以 `scripts/update-fomod-bundle.cjs` 更新现成界面中的 FOMOD 入口，保留原有 React 组件。对应 `public/app.js` 和独立 `public/fomod-ui.js` 也已同步，恢复完整源码后可正常走全量构建。更新脚本针对发布界面做唯一锚点检查；重新运行前需恢复更新前的 auth.js，避免重复注入。

参考：[FOMOD 规范和教程](https://fomod-docs.readthedocs.io/en/latest/tutorial.html)、[7-Zip 官方下载](https://www.7-zip.org/download.html)。测试不代表已验证实际游戏内效果。
