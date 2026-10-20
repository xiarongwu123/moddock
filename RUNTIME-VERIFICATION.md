# 游匣 AI 线上生成与真实游戏验收

日期：2026-10-19。本机 Ready or Not Steam build 25784851，UE5.3，UE4SS v3.0.1 Beta。现有线上 Agent 服务，实际保存、构建、托管安装及游戏进程；没有用回归测试替身冒充线上实测。

## 结果

| 场景 | 实测结果 | 边界 |
| --- | --- | --- |
| 线上生成 | 真实 plan/generate、保存及构建完成 | 首个产物在游戏中有接口错误 |
| 没效果发现 | 真实热键触发后读到 90，期望 110；宿主判定失败 | 属性写成功和加载日志均未被算作生效 |
| 没效果自动修复 | 旧 Skill 两次修复仍失败并停止；最终 Skill 重测同一失败代码，自动线上修复一次，新运行回读 110/90 通过 | 测试复用已实测无效果的线上产物，场景和热键由测试者操作；未发送人工接口修复提示 |
| 补充接口证据的修订 | 线上生成 PlayerController:FOV 版本，警局内跨帧 GetFOVAngle 回读 110，恢复 90 | 人工补充了候选接口，不算前两次自动修复成功 |
| 异常退出恢复 | 主动终止已验证进程，宿主捕获退出码 -1，自动线上修复、构建、替换；新运行再次回读 110/90，behavior_verified | 受控异常退出，未复现自然原生访问冲突，不能证明自然闪退根因已修复 |
| 最终包回归 | 源码与 app.asar 各 61 项通过；719 个基准文件对照通过 | 回归包含受控 AI/游戏状态替身，独立于以上实机证据 |

## 最终恢复成功的证据

- 基线产物：`0b508185-6147-4f97-8b3c-3b012cf7b4f0`；运行 `b1addacd-b299-405e-9ebe-f3863b6397eb`，110/90 已验证后主动终止 PID 15612。
- 真实线上自动修复产物：`fc250bb6-75d0-4014-ba4f-4e575b00ebd5`；生产管理事务替换原产物，安装 ID `abcdb220-e2b9-4913-a5f8-4130c87b63a9`。
- 新运行：`526ba535-afe7-4753-924b-4faad3d25677`；Shipping PID 33364。
- 12:20:30：F6，延迟回读 actual=110，expected=110，tolerance=0.5。
- 12:20:49：再次 F6，延迟回读 actual=90，expected=90，tolerance=0.25。
- 宿主显示 `behavior_verified`；随后正常退出，`exited=true`，没有增加修复次数。
- 机器证据：`crash-auto-repair-new-run-verified.json`、`crash-auto-repair-new-run-110-90.log`、`final-runtime-after-normal-exit.json`。

自动重启仍受到 Steam 平台启动选项影响。本轮确认启动后曾未出现游戏进程，从 Steam 库再次启动并确认 DX12 后，新进程由同一运行观察器接管；未把请求启动算成已启动。热键及进入场景由测试操作完成，产品没有实现自动游玩任意游戏的机器人。

游戏画面捕获间歇性返回 `FrameArrived timed out: timed out waiting on channel`。观察到警局真实画面；效果验收使用实际有效 FOV 的跨帧回读，没有完整的前后像素对比证据。

## 已补齐的底层链路

验收合同与 AST 检查、宿主注入及真实数值比较、首轮空记录兼容、Steam 非子进程句柄与异常退出码跟踪、当前版本/运行/日志基线关联、无效果和异常退出触发真实线上 repair、保留原验收项、两次预算及持久化、构建通过后等待游戏关闭、管理事务替换与哈希同步、新运行重新验收。

最终 Skill 还包含本机失败接口和有效接口证据，要求其他版本重新探测及回读。配额/网络失败后的继续操作保留原运行修复任务，页面后台轮询也已修复。

最终包：`F:/youxia/release/20261019-runtime-repair/windows-final/`。默认 `启动客户端.cmd` 指向此包。异常退出分支使用先前热修主机；最终 Skill 无效果分支已在最终包（窗口 8651548，端口 61297）完成真实线上及实机验收，详见下节。最终包的后台页面轮询也实际同步显示了失败、修复与游戏状态回读通过。

app.asar SHA-256：`4e77b1f1df77eb0a3f7fbd28ea8f883df71c9f221b8cea2527897b96a6db4846`。

安装包 SHA-256：`09b82d228808c0c07fcddcecaeaee8cfad4ba0c83683854bea312e8eae4191c6`。

## 收尾

测试游戏已正常退出，临时 FOV 已恢复到 90。测试作品通过游匣管理界面停用，源码、产物和证据保留；原有四项托管 Mod 状态及资源版本一致，见 `original-mods-preserved.json`。未直接修改已安装脚本以绕过管理校验。

这轮证明了特定 UE4SS 功能的真实效果验收、无效果后的线上自动修复闭环，以及受控异常退出后的自动修复编排闭环。未证明所有 Mod 都能自动修好、所有加载器都有可靠效果探针，或最初第三人称作品已通过本轮验收。

## 最终 Skill 独立无效果修复验收：通过

用户登录最终包后，复用原线上产物 `44cb1655-bc16-43b7-8bc4-0f95b03fda83` 的完整原始代码，通过生产保存与构建模块创建独立版本 `3d552d4b-4ba4-49c4-b4b9-f814c55df4a2`，对话 `7aa987fa-19ab-4652-b7f6-4c3c2744fd35`。代码哈希完全一致，见 `final-skill-case.json`；未直接改安装目录，未模拟游戏读数或 AI 返回。对话只描述 110/原值两项要求，没有候选修复接口提示。Skill 自身已包含上一轮实测沉淀的接口知识，这不是对完全未知游戏的泛化能力证明。

13:49:39 在警局按 F6；13:49:40 真实 GetFOVAngle 仍为 90，预期 110。运行 `306810dd-9c1a-48c1-a695-6bb318d435b7` 被宿主判定 `behavior_failed`，自动携带证据调用现有线上 AI repair。正常退出旧游戏后，宿主自动构建并通过安装事务替换，产物 `a0c5bc6d-8ff8-4a9c-ba91-0747800c5992`，安装 ID `1cb517f5-11ab-48e0-b4b0-5ec7cb5ec0af`，新运行 `695222c2-6a83-46ed-9468-110d1350a23e`，PID 35472。只使用了一次自动修复。

新游戏警局中，13:54:44 按 F6，13:54:45 延迟回读 actual=110、expected=110；13:55:32 再按 F6，13:55:33 延迟回读 actual=90、expected=90。宿主标记 `behavior_verified`，页面同步显示声明的功能验收已通过游戏状态回读。随后正常退出，宿主状态 `completed`，`exited=true`，未再次调用修复。截图捕获在切换后仍出现超时，因此没有把它记为完整像素对比通过。

证据：`final-skill-real-no-effect.log`、`final-skill-no-effect-detected.json`、`final-skill-online-auto-repaired.lua`、`final-skill-repaired-built-replaced.json`、`final-skill-new-run-110-90.log`、`final-skill-auto-repair-verified.json`、`final-skill-after-normal-exit.json`。

本轮测试作品也已通过游匣管理界面停用；两个 QA FOV 作品均停用，原有 Mod 状态和资源 ID 一致。最终包继续保持已登录，未为整理报告再次重启。
