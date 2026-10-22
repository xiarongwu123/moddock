# 2026-10-22 主流游戏基础适配交付包

对应代码提交：`f28835de46c681ddac2c4dc19716a0a65af89063`。

- `service.tar.gz`：MU 创作后端部署包，解压后按 platform 锁文件安装生产依赖，沿用服务器现有环境配置。未包含服务器密码或私钥。
- `client.zip`：解压为 `client/app`，配套客户端源码、运行依赖与已构建 UI 快照，版本 `0.6.16-mainstream.20261022`；不是 Windows 安装程序。
- `source-overlay.zip` 与 `source-overlay-manifest.json`：基于 `66215e54c1a31bece951ee23eac158db59c9d9a2` 的增量源码；不用于覆盖旧客户端安装目录。
- `commits.bundle`：本批 Git 提交离线包，需要上述基线提交。
- `verification.zip` 与 `verification.json`：自动测试和隔离浏览器验证材料。
- `交付说明.md`：功能范围、适配限制与验收边界。
- `SHA256SUMS.txt`：压缩包及清单的 SHA256 校验值。

自动测试 520 项通过。真实 AI、真实游戏内效果及生产部署未验收；全部主流游戏与 1000 款目标尚未完成。提交部署包不会自动部署服务器或更新已安装客户端。
