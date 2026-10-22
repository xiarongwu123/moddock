# 2026-10-22 主流游戏基础适配交付包

对应代码提交：`f28835de46c681ddac2c4dc19716a0a65af89063`。

## 2026-10-22 Linux 换行修订

`service.tar.gz` 已重新打包：`platform/run-studio-server.sh` 使用 LF，服务清单所有路径使用 `/`。Git 的平台脚本换行规则和打包过程均已修复，Windows 上构建也会生成相同的 Linux 换行格式。

新服务器包 SHA256：`88c20ce8d3bb9876dc6dc29e0f22e19af20f932e676dc72d9f6328199eabc317`。之前部署命令中的 `06d5328e...` 是旧包校验值，不能再用于新包。

`client.zip` 和 `verification.json` 保留本批原始 0.6.16 快照及历史验证结果；它们不是本次 0.6.17 Windows 安装包。本次 Windows 安装包在本机 `F:\youxia\release\20261022-mainstream-lf\windows`，服务换行修订记录见 `line-ending-fix.json`。

- `service.tar.gz`：MU 创作后端部署包，解压后按 platform 锁文件安装生产依赖，沿用服务器现有环境配置。未包含服务器密码或私钥。
- `client.zip`：解压为 `client/app`，配套客户端源码、运行依赖与已构建 UI 快照，版本 `0.6.16-mainstream.20261022`；不是 Windows 安装程序。
- `source-overlay.zip` 与 `source-overlay-manifest.json`：基于 `66215e54c1a31bece951ee23eac158db59c9d9a2` 的增量源码；不用于覆盖旧客户端安装目录。
- `commits.bundle`：本批 Git 提交离线包，需要上述基线提交。
- `verification.zip` 与 `verification.json`：自动测试和隔离浏览器验证材料。
- `交付说明.md`：功能范围、适配限制与验收边界。
- `SHA256SUMS.txt`：压缩包及清单的 SHA256 校验值。

自动测试 520 项通过。真实 AI、真实游戏内效果及生产部署未验收；全部主流游戏与 1000 款目标尚未完成。提交部署包不会自动部署服务器或更新已安装客户端。
