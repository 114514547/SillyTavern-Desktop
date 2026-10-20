# 验证记录

## 0.2.0 更新系统

本轮 23 项自动化测试通过、无失败或跳过，其中新增 10 项更新测试，覆盖签名无效、跨仓库/渠道/架构、酒馆基线变化、NSIS 元数据篡改、截断下载、安装前再次校验、备份失败阻止交接、待安装日志、正式版本比较和错误脱敏。原有数据与进程生命周期测试保持通过。

真实 electron-updater/NsisUpdater 的本地 HTTP 下载测试已通过：客户端验证签名，标准下载器读取元数据并下载合成 EXE，完成 SHA-512 校验，中文窗口显示可安装状态，然后真实创建校验备份和 pending.json 后交接。为避免修改系统，测试拦截安装调用，没有执行合成 EXE。证据：`test-results/updates-engine.json`、`update-available.png`、`update-downloaded.png`。

0.2.0 本地 Windows NSIS 构建成功；本地安装器 312,340,124 字节，SHA-256 为 `1e47c3cdc76fe5931ccae2f0fa9600c15d402f07b22f6d9680bd18cc53435a5b`。打包 ASAR 的主进程源码与当前源码逐字节一致，固定公钥已包含在包内。新增 electron-updater 后外壳生产依赖审计仍为 0 项漏洞。

新打包 EXE 再次通过真实窗口回归：原版 APP_READY、首次用户设置持久化、无 Node/Git/npm 的 PATH、沙箱及上下文隔离、单窗口、第二进程退出、关闭清理、重启和通过启动页使用合成原安装。没有覆盖用户安装在 `D:\sillyTavern desktop` 的程序或其数据。

GitHub Actions 在新的 Windows runner 上完成源码检出、依赖准备、静态检查、23 项测试、真实 NSIS 测试、真实后端集成测试、打包、清单签名和发布，最终 conclusion 为 success。运行地址：https://github.com/114514547/SillyTavern-Desktop/actions/runs/39344432196 ，发布提交为 `f39c19ab1c23f6f0a3157ccd57dc38d18aa9b419`。

正式版本：https://github.com/114514547/SillyTavern-Desktop/releases/tag/v0.2.0 。五个资产已公开：安装器、blockmap、latest.yml、签名清单 desktop-update.json、完整对应源码 ZIP。CI 安装器为 312,224,383 字节，构建环境和时间不同，不能使用本地安装器的哈希核验 CI 资产；应核对该发布自己的签名清单。

发布后实际启动本地打包应用，通过中文更新窗口连接线上 GitHub Release；内置公钥接受 CI 生成的签名清单，正确显示“当前已是最新稳定版”。没有下载或安装到用户目录。证据：`test-results/published-update.json`、`published-update.png`。可用 `node scripts/check-published-update.cjs` 复验。

本轮未在用户真实安装中执行 0.1.0→0.2.0 的静默覆盖安装，也没有声称验证了安装器完成后的系统重启行为。真实测试下载器的安装交接被拦截；用户需手动覆盖安装一次 0.2.0 才能获得后续应用内更新入口。下方 0.1.0 安装器大小及哈希仅对应旧版。

## 0.1.0 历史验证

日期：2026-10-20，Windows x64。仅使用独立测试目录和合成数据，没有启动或迁移用户旧安装。

静态语法检查：23 个 JavaScript 文件通过。自动化测试：13 通过、0 失败、0 跳过，最新一轮约 6.8 秒。覆盖自定义路径、全局语义、配置不改写、多用户/密钥/扩展备份、逐文件 SHA-256、恢复拒绝覆盖、损坏备份拒绝、复制中断保留源、数据排他锁、路径越界、YAML 脱敏、junction 拒绝、中文/空格路径、8000 端口占用、服务归属、秘密日志过滤、优雅退出、主进程崩溃后的子进程清理、缺失可执行文件不挂起、缺失导入的脱敏错误、绑定冲突后的换端口和重新加锁。

依赖审计：固定上游生产依赖 56 项（4 critical、22 high、29 moderate、1 low）；桌面外壳生产依赖 0 项。完整机器可读输出：`test-results/upstream-audit.json`、`test-results/desktop-audit.json`。未更改上游锁文件以掩盖审计结果。

真实后端集成测试：1 通过，约 117.4 秒。使用内置官方 Node、固定版后端和合成数据，验证 CSRF 缺失返回 403、原版首页、JSON 角色导入、世界书导入、预设保存、模拟 OpenAI 兼容 API 往返、聊天保存、重启持久化、完整校验备份及创建新副本。迁移前后逐项比较源文件清单一致，新副本能读回设置和聊天。证据：`test-results/real-backend.json`。

开发版与最终打包 EXE 均通过实际 Electron 窗口测试。首次创建空白独立配置，完成原版首次用户设置，等待原版 `APP_READY`，通过后端确认 UI 设置已保存。随后验证沙箱、上下文隔离、禁用 Node、没有向酒馆暴露启动页 IPC、仅一个窗口、第二进程退出、拒绝 file 协议弹窗、关闭后本地 HTTP 不再响应、重启沿用配置，并通过真实启动页 IPC 再次启动合成的“现有安装”。测试 PATH 只保留 Windows 系统工具，不含预装 Node/Git/npm。证据：`test-results/desktop-dev.json`、`test-results/desktop-packaged.json`。

已人工查看截图，确认最终不是初始化遮罩：`test-results/sillytavern.png`、`test-results/packaged-sillytavern.png`；中文启动页截图为 `launcher.png`、`packaged-launcher.png`。所有账号名称、角色和聊天均为测试合成数据。主窗口真实标题栏、任务栏和文件拖放没有通过整屏截图逐项验收。

Windows NSIS 构建成功：`dist/SillyTavern-Desktop-Setup-x64.exe`，312,013,385 字节，约 298 MiB。SHA-256：`83c723e1be4dc5ce9c4aefab0f4a18764f2d0b14addbe165189363cece71ec7c`。Authenticode 状态为 NotSigned；构建日志中的 signing 是自定义空签名函数的阶段名称，不代表已签名。

内置 Node 官方 ZIP SHA-256：`cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62`。EXE SHA-256：`3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5`，打包后的文件与原校验值一致。后端 bundle 包含 21,080 个文件，压缩前 369,849,908 字节，ZIP 145,525,962 字节；逐文件清单在 `build/backend-files.json`，安装后资源目录也有该清单。

## 验收边界

| 任务书要求 | 实际证据 / 仍未验证的部分 |
| --- | --- |
| 原安装继续使用 | 通过真实启动页启动合成安装；没有找到并启动用户真实旧安装 |
| 无 Node/Git/npm | 打包 EXE 在剥离这三者 PATH 的环境启动；未使用全新 Windows 用户或全新系统 |
| 中文、空格、非 C 盘 | 中文和空格真实通过；非 C 盘未运行验证 |
| 单实例与生命周期 | 窗口单实例、数据锁、优雅关闭、父进程崩溃、绑定冲突自动重试通过 |
| 导入及对话 | 后端 API 导入角色/世界书、模拟 API、预设及重启通过；没有使用真实付费 API，也没有人工拖放文件 |
| 离线 | 全部依赖内置、不执行首次在线 npm 安装；未断开整机网络，因此不宣称完整断网实测 |
| 迁移故障与恢复 | 合成数据哈希、拒绝覆盖、篡改检测、复制中断、真实后端新副本启动通过；磁盘物理写满和真实长路径极限未实测 |
| 更新 | 官方版本只读检查、数据备份和配置回退代码已实现；没有自动后端升级器，未做跨后端版本插件兼容测试 |
| 安装与卸载 | NSIS 成功生成、对应打包 EXE 已运行；未在真实用户目录执行安装/卸载向导，避免改动用户注册表和快捷方式 |
| 安全 | 浏览器权限与 IPC 检查、CSRF 403、回环与监听 PID 验证、合成敏感输出过滤通过；不是完整渗透测试 |

服务检查采用保守策略：发现 Node 后端或无法确认归属时拒绝启动，不附着、不终止无关进程。非标准启动器、重命名运行时和同时运行多个不受协调的其他酒馆的情况仍需专项测试。

构建曾遇到 Git Schannel 凭据错误和 GitHub 直连超时，分别使用命令局部 OpenSSL 后端和用户已启用的本机代理解决。没有修改全局 Git 信任、系统代理或 npm 全局配置。
