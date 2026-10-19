# SillyTavern Desktop 0.2.0

Windows 10/11 x64 的原版酒馆桌面封装。聊天页面直接使用 SillyTavern 1.19.0，不替换原版角色、世界书、预设、正则、扩展或模型供应商。

## 安装与使用

运行 `dist/SillyTavern-Desktop-Setup-x64.exe`，安装到当前用户的程序目录或其他可写目录。此个人构建没有代码签名，Windows 可能显示未知发布者。双击桌面或开始菜单的 SillyTavern Desktop；关闭窗口即停止它创建的后端并退出。

启动页推荐“选择现有 SillyTavern 文件夹”，选择包含 `server.js`、`package.json`、`public`、`src` 的原安装目录。先关闭原来启动的酒馆。在“原来的启动方式与自定义路径”中如实选择独立/全局模式；自定义配置或数据路径时点击“重新识别路径”。直接模式不迁移数据，不修改网络配置，启动仅覆盖为本机回环、保留 CSRF、禁止自动打开浏览器。上游服务自身启动时可能为原 config.yaml 补齐缺失设置。

没有旧安装可选择“创建全新空白配置”。希望保留旧数据但独立使用，可先选择源安装、查看备份清单，再点击“先备份并校验，再创建独立副本”。不需要预装 Node、Git、npm；首次使用会从安装资源展开后端，耗时取决于磁盘和安全软件。离线可以启动及查看本地数据，模型推理由用户自己配置的 API 决定。

再次打开应用会回到上一次成功启动的安装。同一应用第二次启动只激活已有窗口。菜单可重新加载、打开数据目录、停止后端并返回设置、创建校验备份、回到上一次可用配置、打开软件更新和查看许可证。不会后台常驻托盘。

## 软件更新

0.1.0 用户需要手动覆盖安装一次 0.2.0，之后可从启动页“软件更新”或“帮助 → 软件更新”检查我们发布的正式版本。源码仓库与发布页为 [114514547/SillyTavern-Desktop](https://github.com/114514547/SillyTavern-Desktop)。普通代码推送不会触发客户端更新，只有完成测试并发布 Release 才会。

检查 → 阅读改动 → 手动确认下载 → 下载及签名校验 → 保存编辑内容 → 备份并更新。默认不自动下载，不在普通关闭软件时偷偷安装。安装前会停止本应用创建的后端，对所有已保存的独立配置及当前/上一次配置做完整备份；失败则停止更新。只更新桌面程序，不替换已有酒馆后端、插件或个人数据。自定义 `--desktop-home` 的用户更新后应使用原启动方式重新打开，以保留该参数。

更新清单使用本项目 Ed25519 发布密钥签名，客户端内置公钥；NSIS 元数据和安装包 SHA-512 都必须匹配签名清单，安装前再次检查。它与 Windows Authenticode 签名不同，本安装器仍为未签名个人构建。更新实现与维护说明见 [UPDATE.md](UPDATE.md)。

## 数据目录

桌面独立数据默认在 `%LOCALAPPDATA%\SillyTavernDesktop`：

| 目录 | 用途 |
| --- | --- |
| `backend/versions/<版本-提交>/<配置ID>` | 可写后端与独立插件 |
| `profiles/<配置ID>/config.yaml` | 独立配置 |
| `profiles/<配置ID>/data` | 所有用户、聊天、角色、密钥等 |
| `backups/<时间-ID>` | 带 SHA-256 清单的完整私密备份 |
| `settings.json` | 当前和上一次成功配置、窗口位置 |
| `shell` | Electron 窗口及浏览器会话数据 |

开发/测试或自定位置可以传入 `--desktop-home="D:\我的酒馆 桌面"`，每个位置仍通过目标数据锁防止并发写入。不要把该目录放在源安装内。

当前上游全局模式的实际数据位于 `%LOCALAPPDATA%\SillyTavern\Data\data`，配置位于其上层 `config.yaml`。如果旧版全局路径不同，请用独立模式明确选择其 configPath 和 dataRoot；不会根据 APPDATA 里是否有文件擅自切换。

## 恢复和故障

启动失败时仍保留中文启动页，可重试、复制诊断状态和打开数据目录。桌面日志只保留固定状态，不收集原始后端输出、聊天正文或 API 密钥。缺依赖、非法 YAML、不可写目录、现有后端和监听归属异常都会停止启动，不会杀掉其他软件的 Node 服务。

若提示目标目录正被使用，先切换到原窗口或关闭原酒馆。对于不完整的 `.sillytavern-desktop.lock`，先确认应用与对应后端均已退出，再保留并移走锁目录；不要对仍运行的服务移锁。正常崩溃由独立守护进程关闭后端，重启时可回收已确认死亡的有效锁。

检测到旧 `public/characters` 时，直接模式会拒绝触发上游的移动迁移。可选择校验备份后创建副本；若同时有新版数据目录则需要先人工整理，避免同名覆盖。符号链接、目录联接、特殊文件、路径越界和备份空间不足都会停止迁移。新副本失败不会切换当前安装，失败中间目录保留用于检查。

备份恢复与注意事项见 [MIGRATION.md](MIGRATION.md)。删除应用不会清除用户数据或旧安装；确需清理时先把完整备份另存，手动处理 `%LOCALAPPDATA%\SillyTavernDesktop`。不要把含私人数据的目录提交到 Git 或发送给别人。

## 从源码复现

构建机需要 Windows x64、Node 24+、Git 和网络；最终安装机器不需要这些工具。

```powershell
npm ci
npm run prepare:vendor
npm run dev
npm run check
npm test
npm run test:integration
npm run test:desktop
npm run test:updates
npm run build:win
# 已打包 EXE 的实际窗口测试
node scripts/smoke-desktop.cjs "dist/win-unpacked/SillyTavern Desktop.exe"
npm run source:zip
```

`prepare:vendor` 固定上游提交、安装锁定的生产依赖、下载并按官方 SHASUMS256 核验 Node、预编译前端、生成逐文件哈希与源码/许可归档。已完成的 bundle 会校验复用。若之前构建中断，请先检查 `build/backend`；将它保留到其他名称后再重新准备，不要清理任何用户数据目录。完整产物是安装器和 `win-unpacked` 多文件目录，后者并非单文件便携 EXE；V1 未额外提供便携 ZIP。

## 已知限制与许可证

详细实测范围见 [TEST_RESULTS.md](TEST_RESULTS.md)。上游固定锁文件在本次 npm 审计中报告 56 项漏洞（4 critical、22 high、29 moderate、1 low），外壳生产依赖为 0 项。保留上游版本，没有擅自执行 `npm audit fix --force`。这不是经过完整安全审计的公开稳定发布；第三方插件和所有上游依赖风险仍需要后续处理。

麦克风、摄像头等网页权限在 V1 禁用；原版文字、图片/文件选择导入照常。自定义插件兼容性、旧版复杂全局安装、干净 Windows 用户和全新系统尚需单独验收。支持签名校验的桌面外壳更新，不自动升级酒馆本体。失败可返回上一配置或从备份创建新副本；桌面二进制回退使用保留的旧安装器。

本封装及 SillyTavern 采用 AGPL-3.0。保留原作者版权。应用 resources 中包括 `SillyTavern-source.zip`（固定提交的对应源码）、`THIRD-PARTY-NOTICES.txt` 和 Node 许可证；桌面外壳源码及锁文件随交付源码归档提供。重新分发修改版时需同时提供对应源码、构建脚本和修改说明，并履行 AGPL 对通过网络使用修改版的源码提供要求。见 `resources/LICENSE.txt`。
