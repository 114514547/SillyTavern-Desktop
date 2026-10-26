# SillyTavern Desktop 新会话交接

2026-10-25 后续复核：已取得正式 schema 2 的 126.6 秒失败记录，最大区间为核心导入 70.4 秒、Webpack 构造 33.3 秒，实际编译约 1.2 秒。修复首次尚未生成 receipt 就超时的缺口，新增构建期随包前端产物、首次启动验证复用、固定 managed 发行版本信息及有界编译收尾。100 文件语法、120 单元和首次命中的 27 项 Node/headless Edge UI 检查通过。隔离 Electron 测试触发了用户所见的 0x80000003 弹窗，测试 PID 已退出，根因未明，禁止继续自动启动 Electron。正式启动收益待正常重启验收；详见[后续修复与事故记录](verification/2026-10-25-startup-followup.md)。以下 114 秒样本和旧缓存说明保留为历史。

2026-10-25 启动性能更新：用户授权无人值守审核与修复。新增固定源码指纹约束的启动计时及 managed 前端/Node 缓存，缓存失效自动回到原生编译，不改写上游磁盘代码。隔离后端同 profile 对照中位数 3048 → 1987 ms；这不代表正式 114 秒启动已被复现或验收。正式实例未重启、资料未改动，完整依据与生效方式见 [启动审核与修复](verification/2026-10-25-startup.md)。

2026-10-25 最新：用户授权彻底重构 UI，当前源码实现及验证见 [UI_REBUILD.md](UI_REBUILD.md)。`style.css` 已改为统一导入入口，新增 `native-ui.css`、`native-surfaces.mjs`、`theme.mjs`、`ui-preferences.mjs`，Agent 使用合并后的 `agent.css`，`modern-agent.css` 已退役。原生业务/资料与未提交成果保留；不能重新追加旧全局按钮补丁、旧抽屉停靠或原型假数据。新资源经分发白名单和备份原子安装，需完全重启源码版，不能只刷新页面或覆盖正式安装。

2026-10-23 更新：用户已授权并完成以 `sillytavern_ui_demo.html` 为视觉基准的源码 UI 改造；最新状态、截图、测试和完整重启方式见 [验证记录](verification/2026-10-23-modern-ui.md)。新的共享样式、SVG、命令罗盘和设置模块已纳入扩展分发白名单，不能只拷贝旧 index.js/style.css。仍需保留全部未提交工作树；没有打包或覆盖正式安装。

最新迁移更新（2026-10-22）：实际开发根已切换至 `E:\Github\sillytavern-desktop`。完整当前工作树及 Git 历史、依赖、离线运行资源已复制并核验，用户资料留在原位置，旧源码保留回退。详见 [迁移验证](verification/2026-10-22-workspace-migration.md)。下文“未迁移”等描述是较早交接记录，当前路径与状态以此更新为准。

待后续任务：将 RP 右侧设置内容与九入口合为整体收起/展开、调整各栏宽度，以及简化小说专注视图，目前仍为用户讨论方案，本轮没有实现。

最新更新（2026-10-22）：用户随后授权的 RP 三栏局部修复已写入当前工作源码，完整隐藏原生 UI 回归通过；见 [修复与验证](verification/2026-10-22-roleplay-ui.md)。以下“只整理”“缺陷未修复”等描述保留交接阶段历史，当前事实以此更新及 PROJECT_STATUS 为准。本次未启动 Electron、未打包、未迁移，仍需用户重启源码版人工验收。

交接完成日：2026-10-22（北京时间）。审查和测试于 10 月 21 日执行，文档收尾于 22 日执行。当前任务只整理、不新增功能、不修 Bug、不迁移。

## 先定位正确工作树

实际项目根：

```text
E:\Github\sillytavern-desktop
```

这是独立 Git 仓库，分支 main，HEAD `b3331d29ce7d086335220dde05c947bdb4e73a1f`。**重要功能在未提交工作树中，不能只 clone GitHub 或切回 HEAD 接手。** 审查起点有 21 个已跟踪文件修改，以及 desktop/scripts/tests 下 42 个未跟踪新文件；专属扩展和 Agent 均在其中。本次只补文档及忽略规则，没有提交、暂存、重置或发布。

`C:\Users\wang\Documents\ChatGPT\软件定制化项目` 是新会话整理入口，起初只有空 Git 仓库；现有 README 和 AGENTS 指向上述源码，并不包含第二套程序。`E:\Github\Daily-system\Bases` 只是旧会话曾用的 cwd，不是本项目代码根。不要在这两个位置重新搭建酒馆。

现有源码目录已独立，但嵌在旧会话的 visualizations 路径，不适合作为可随意清理的预览产物。本次保留它以免快捷方式失效；将来复制到新目录的方案见 [MIGRATION_PLAN.md](MIGRATION_PLAN.md)，尚未执行。保留整个旧目录，不能按“临时生图/HTML 文件”删除它。

## 当前总体情况与最近工作

这是 Windows x64 Electron 封装，保留固定 SillyTavern 1.19.0 原生前端，后端由独立 Node 进程监管；通过命名空间扩展加入小说和本地 Agent，不改上游核心。技术栈和数据流程见 [ARCHITECTURE.md](ARCHITECTURE.md)。先读根 AGENTS，然后读本文件、[PROJECT_STATUS.md](PROJECT_STATUS.md)、[DECISIONS.md](DECISIONS.md)。旧 TECHNICAL_DECISIONS/TEST_RESULTS 是历史流水账，不是同一版本的完整验收结论。

最近完成的应用工作包括 Agent 项目/讨论/文档三栏、模块化独立预设、可选 RP 继承、有效参数和 usage 展示、顶部栏精简，以及 RP 左角色会话/中原生聊天/右原生设置三栏。小说继续三栏、对话创作、章节与候选显式采用；Agent 不绑定小说即可讨论本地资料。用户已认可设计方向，但 RP 三栏实现仍有实际缺陷。

三个版本必须分清：工作树 package.json 是 0.5.0（包含后来新增 UI），dist/0.5.0 是较早打包快照，`D:\sillyTavern desktop` 正式安装产品是 0.4.0。正式目录 `version` 文件的 44.9.0 是 Electron 版本。旧 source.zip、旧 ASAR 与 Git HEAD 均不能替代完整工作树。

## 关键代码与证据

| 文件/目录（相对根） | 用途 |
| --- | --- |
| `desktop/main.cjs` | 启动、窗口、IPC 来源校验、配置选择、更新 |
| `desktop/services/{lifecycle,guardian,runner}.cjs` | 后端数据锁、进程监管、回环/CSRF 就绪 |
| `desktop/services/{managed,installation,backup}.cjs` | 固定上游实例、原安装检查、备份恢复 |
| `desktop/services/local-workspace.cjs`、`desktop/workspace-preload.cjs` | 文件授权边界、版本、建议、确认保存、恢复 |
| `desktop/services/writing-extension.cjs` | 内置扩展分发白名单；新增文件必须同步 |
| `desktop/extensions/desktop-writing/roleplay-ui.mjs`、`style.css` | 当前 RP 三栏与右栏停靠；首先排查的位置 |
| 同目录 `agent-ui.mjs`、`agent-layout.mjs`、`agent.css` | Agent 三栏、编辑与讨论 |
| 同目录 `agent-loop.mjs`、`agent-transport.mjs` | 有预算的工具调用、去重、历史裁剪和 SSE |
| 同目录 `assistant-*.mjs`、`agent-settings.mjs` | 各用途预设、模块、继承和思考 |
| 同目录 `index.js`、`model.mjs`、`store.mjs`、`discussion.mjs`、`layout.mjs`、`generation.mjs` | 小说、存储、联动、请求取消与布局 |
| `vendor/manifest.json`、`electron-builder.yml` | 固定基线、构建/安装边界 |
| `scripts/create-development-shortcuts.ps1` | 基于仓库实际路径生成源码入口，不会移动数据 |
| `tests/`、`test-results/handoff-unit.log`、`handoff-backend.log` | 当前基线验证；原始日志不入 Git |
| `docs/verification/2026-10-21-handoff.json` | 精简交接证据、源码保留检查和验证范围 |

旧设计 HTML、预设结构分析、录屏抽帧在源码父目录：`tavern-roleplay-three-pane.html`、`tavern-local-agent.html`、`preset-analysis-2026-10-21/分析与改造依据.md`、`recording-review-221132/`。它们是参考材料，不是运行 UI；未经隐私审查不要整目录上传。录屏原件为用户桌面 QQ20261021-221132.mp4，约 22 秒，已审查过，没必要重新反复全程抽帧。

## 最近测试与未验证范围

10 月 21 日实际完成：73 个 JS 文件语法检查，88 项单元测试（0 失败/跳过），1 项隔离真实酒馆后端集成（约 123 秒）。集成覆盖启动、CSRF、合成角色/世界书/预设、模拟 API、聊天保存与重启、校验备份和新副本恢复，证明该后端流程可运行。没有使用正式用户数据、真实 API 或 Electron。22 日仅检查文档、文件存在性、工作树和元数据，未重复整套测试。

历史 0.5.0 有 6 组隐藏打包回归；最新 RP 的 16 项 Edge 隔离检查使用简化控件且关闭动画，漏掉了录屏缺陷。不能对用户声称当前 Electron、真实账户、所有社区扩展、在线更新、覆盖安装或冷启动已验收。

0.5.0 安装包只读哈希复核与旧报告一致，312405111 字节，SHA-256 `7711e4c3d14282035e70543aae45cf523ce0fca32c3604ff5295fbaeb4de4e5d`。本次未打包，不意味着当前工作树与旧包一致。

## 未解决问题与下一步

目前没有因依赖缺失而必须重搭项目的证据。主要阻碍是 RP 三栏未达到可用程度，以及真实 Electron 曾发生原生异常，故自动测试不能反复启动打扰用户。

后续获准继续应用优化时，建议依次处理：

1. 在正常动画、完整原生面板下复现切换过程：旧格式/背景/扩展/世界书在聊天中央短暂展开，检查 releaseDock/closeNative 与上游 display 过渡顺序。此机制只是初步线索，尚未证明根因。保持原生 DOM 和“原生”回退。
2. 逐页适配默认窄栏：高级格式、界面、身份等改为可用的响应布局，消除背景页横向溢出；不要用单纯增宽掩盖问题。再做与修改规模相称的交互验证。
3. 核验 RP localStorage 在随机端口重启后的恢复；当前同页测试不证明跨 origin 持久化。Electron win32 异常和偶发冷启动慢分别调查，不猜测与 UI 同因。
4. Agent 的跨轮工具记忆、字面检索质量、上下文覆盖和缓存策略单独设计，以真实 usage 和覆盖范围为准，不承诺 DSH/Reasonix 的收益。不要在修 RP 时顺带重构 Agent。

本次交接没有授权立即做这些开发，也没有授权复制迁移源码根；先按用户下一条任务行动。迁移方案已可审查，不必重新问泛泛的“要不要继续”。

## 如何运行与接手

新 Codex 会话应直接选择上面的实际源码文件夹作为项目，先读 AGENTS 和 docs/HANDOFF。若先打开“软件定制化项目”，按其 README 切换至真实源码根；不要在空 Git 仓库运行 npm 或重新初始化应用。保持当前工作树，先看 git status，再按用户指定范围修改。

人工日常试用：先正常退出已运行的酒馆，然后双击桌面 `SillyTavern 源码开发版.lnk` 或仓库根 `启动源码开发版.lnk`。`dist/启动测试版.lnk` 同样指向工作树，不再代表旧打包版。也可在根执行 `npm run dev`。完整重启会同步专属扩展，Ctrl+R 不代替同步。默认与 D 盘安装共用桌面数据根，不能同时开两个版本写数据。

自动验证一律使用隔离数据、模拟接口、隐藏且不聚焦；不要直接启动默认用户实例“看看能不能跑”。当前依赖和离线启动资源已存在，不需要先 npm ci 或重新构建；若缺失，再按 README 的构建路径补齐。发布签名私钥、真实配置和文档原文不能复制到交接包。

本机精确配置 ID、用户数据位置和本次存在性检查见被忽略的 [LOCAL_PATHS.local.md](LOCAL_PATHS.local.md)。外部小说目录不读取、不迁移、不上传。只有用户明确同意迁移方案后，才复制并验证新入口；保留旧目录用于恢复。

## 本次新增和修改清单

根目录新增 `AGENTS.md`；docs 新增 `ARCHITECTURE.md`、`PROJECT_STATUS.md`、`DECISIONS.md`、`HANDOFF.md`、`MIGRATION_PLAN.md`、`verification/2026-10-21-handoff.json` 以及不入 Git 的 `LOCAL_PATHS.local.md`。修改根 `README.zh-CN.md` 增加交接与缺陷入口，修改 `.gitignore` 排除本机路径 Markdown。没有修改应用 JS/CSS、测试实现、依赖、构建或发布代码。

新入口目录 `C:\Users\wang\Documents\ChatGPT\软件定制化项目` 新增 `README.md`、`AGENTS.md`，其现有 .git 保持原样。没有在该目录新建另一份 sillytavern-desktop 副本。

源码父目录新增本机审查辅助 `handoff-snapshot.cjs`、`handoff-finalize.cjs`、`handoff-before.local.json`、`handoff-after.local.json`、`handoff-after-output.local.log`；不属于发行源码。测试目录产生 `handoff-unit.log`、`handoff-backend.log` 及隔离合成数据，并更新既有 `real-backend.json`。这些被忽略的本机证据不是要上传的用户数据备份。
