# 2026-10-25 启动超时复核与首次启动修复

用户报告正常源码版启动等待两分钟后失败，并在后续隔离 Electron 测试时看到 `electron.exe` 的 `unknown software exception (0x80000003)` 弹窗。这两件事分别记录：启动超时已有细分记录和源码修复；原生 Electron 异常尚未确诊，不能宣称已经修复。本报告接续[上一轮启动审核](2026-10-25-startup.md)，以下证据优先于旧报告的正式 114 秒样本。

本轮未运行正式后台、读写正式聊天或小说、调用真实模型、覆盖安装、升级依赖或关闭系统防护。后续验收只使用 Node 和 headless Edge；不再启动 Electron 自动化。

## 正式失败的时间分布

正式 trace 日期为 `2026-10-25T06:49:00.883Z`，schema 2，从主进程 JS 入口到失败共 126589 ms。只读副本保存在本机 `test-results/startup-context-20261025/formal-failed.json`。

| 阶段 | 时间或区间 | 含义 |
| --- | ---: | --- |
| 启动页加载完成 | 累计 1059 ms | Electron 显示启动页较快；用户等待主要发生在之后 |
| 后台派生 | 累计 3602 ms | 路径、重复进程、扩展准备不是分钟级主因 |
| runner 到 Node 入口输出 | 3738 → 12476 ms | 入口依赖等耗时约 8.7 秒 |
| 核心模块导入 | 12525 → 82935 ms | 70410 ms，为最大区间 |
| 导入内的 Webpack 版本查询 | 59806 → 82898 ms | 23092 ms，包含在上一行内，不能再次相加 |
| 本地数据、迁移、备份、统计等 | 约 0.3 秒 | 本次记录不支持“资料过多导致两分钟”的结论；插件阶段 0 ms |
| Webpack 编译器构造 | 83217 → 116472 ms | 33255 ms，构造本身很慢 |
| Webpack 执行到结果阶段 | 116472 → 117679 ms | 约 1207 ms，实际编译并非主要耗时 |
| 截止及清理 | 最终累计 126589 ms | 未出现 close 完成与 receipt 保存，启动失败 |

现有架构先启动完整酒馆 Node 后台，等待其导入、数据初始化和运行期 Webpack 完成，然后才导航到酒馆页面。因此，“同为 Electron”不足以保证类似 VS Code 或 Obsidian 的启动速度；关键在于页面之前串联了哪些工作。日志确认了慢区间，但没有确认为什么正式进程上下文会将这些工作放大到几十秒。不能凭推测归咎于显卡、代理、杀毒或 UI 样式。

## 上轮缓存的缺口与本次修复

上轮只在一次完整运行期编译成功后生成 receipt，后续才能跳过 Webpack。正式启动在编译收尾、保存 receipt 之前被总截止时间终止，因此第一次无法留下可复用记录，下次仍走原生慢路径。单纯提高总超时或展示更早的启动页不能消除这条链路。

本轮将前端产物准备移到构建期：`scripts/prepare-frontend.cjs` 从干净暂存后端生成依赖 receipt，并验证 1254 个编译输入的大小与 SHA-256 都匹配 `build/backend-files.json`，输出也必须匹配现有离线后端包中的产物。资源写入 `build/frontend/{manifest.json,lib.js,lib.js.LICENSE.txt}`，通过 electron-builder 分发到 `resources/frontend`。没有改写上游源文件。

managed 启动先检查用户运行期 receipt；没有时再校验随包 receipt 与实际安装的全部输入、上下文、缺失依赖和输出。验证通过直接提供相同的 `/lib.js`，第一次也能跳过 Webpack 导入、配置、构造、执行和关闭，无须先成功完成一次慢编译。当前 lib.js SHA-256 为 `2d5fb1eedcbefe7062421e8ca54b90a23312f64df8d480c16538714c5157e0bf`，大小 1947206 字节。未知版本、文件变化、损坏或链接等情况仍走原生路径。

内存适配的固定上游指纹从四个增至五个，新增 `src/util.js`。仅 managed、无 `.git` 且固定为 1.19.0 的发行后端，使用固定发行版本信息，避免重复启动 Git/where 子进程；existing/Git 源目录保留原生版本发现。实际正式后端的五个源码指纹以及随包前端依赖验证均通过，只读验证耗时约 4016 ms。此结果证明新路径具备适配条件，不证明正式 Electron 已完成启动。

原生回退路径增加 `webpack-close-start/end` 和 receipt 写入阶段。默认启动截止仍为 120 秒；只有已收到编译结果阶段，才允许默认额外 30 秒收尾，宽限最多 60 秒，永不无限等待。启动状态会明确显示正在编译收尾。阶段记录增加累计 CPU user/system 时间和 stdout/stderr 字节数，只存固定指标，不存原始输出或用户内容。

## 验证及范围

- 100 个 JavaScript 文件语法检查通过，120 项单元测试通过，0 失败、0 跳过。新增随包产物首次命中、损坏/输入变化拒绝、版本适配及有界收尾测试。
- 新隔离 profile 的真实 Node 后端三次就绪耗时为 2796、2006、2031 ms。三次均为用户 receipt miss、随包产物命中、无 Webpack 构造，返回相同 lib.js。profile 解包另耗时 26122 ms，不计入这组三次后端启动数值；不是操作系统冷启动，也不是正式 Electron 总时长。
- 新隔离 profile + headless Edge 完整原生 UI 检查 27 项通过，页面错误为零，后端就绪 3034 ms，导航后扩展就绪 5165 ms。覆盖原生设置读写、世界书、DOM 归属、三模式布局、主题及删除保护；明确断言首次随包产物命中、没有运行编译器。
- 真实原生后端集成通过，耗时约 129 秒，包括 CSRF、合成角色/世界书/预设、模拟模型、聊天持久化、备份恢复及损坏/未知来源的原生回退。报告副本保存在 `test-results/startup-context-20261025/real-backend.json`。构建分发配置中的 supervisor 相对依赖闭包、随包前端三个资源、产物哈希与文档链接检查通过；没有实际打包。

本机证据：`test-results/startup-context-20261025/unit.log`、`bundled-ui/after-report.json`，以及 `test-results/startup-review-1792912717917/optimized-1792912752063.json`。`verification-summary.json` 汇总最终检查和源码哈希，测试目录不入 Git。

## Electron 弹窗事故与诊断边界

隔离桌面测试使用全新测试 home、后台模式和禁止错误对话框参数，仍触发 Windows 原生 `0x80000003` 弹窗。测试启动 PID 为 40384，约 40 秒后报告 `electron.launch: Process failed to launch`，没有取得 startup trace。后续精确查询确认该 PID 已退出，没有对应的残留 WerFault。没有按进程名结束其他应用。

已停止该测试方式，`scripts/profile-desktop-startup.cjs` 已移出可执行脚本入口，失败探针只留档在 `test-results/startup-context-20261025/failed-electron-probe.cjs`；原始报告位于 `test-results/desktop-startup-context-1792911619414/report.json`。没有可靠故障模块或堆栈，不能断言代理、GPU、插件、UI 或后台超时就是此异常原因，也不能把 Node/Edge 通过当作 Electron 异常已修复。

只读实际安装核心导入探针没有启动服务器，也没有读取正式配置。其核心导入 3724 ms、Webpack 构造 1525 ms、总计 5657 ms，仍未复现正式上下文的几十秒延迟。正式进程环境差异的具体根因保留为未确诊项；后续正常启动的 CPU/耗时指标可继续缩小范围。

## 生效与待验收

当前修改与构建资源位于源码工作树。正常退出后，通过原有源码开发入口重启可加载；Ctrl+R 不足以更新主进程和同步扩展。旧安装版没有被覆盖，也不包含本轮修复。下次正常源码版启动应出现 `frontend-bundled-hit` 或 `frontend-cache-hit`，并不再出现 Webpack 构造阶段。

本轮没有再次运行 Electron，也没有以正式资料启动。正式等待时长是否改善、原生崩溃是否仍出现，仍需下一次正常启动结果；不能宣布分钟级启动或原生异常已经彻底解决。
