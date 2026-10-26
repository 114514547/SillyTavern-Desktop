# 当前实现架构

2026-10-25 后续启动链路：固定源码适配门槛现为五个文件（新增 `src/util.js`），managed 无 Git 的固定发行后端使用固定版本元数据。`prepare-frontend.cjs` 在构建期生成与 backend 索引对应的前端 receipt/产物，分发至 `resources/frontend`；运行期用户 receipt 未命中时验证随包全部依赖及输出，命中则首次也无需加载 Webpack。只有已编译出结果才给予默认 30 秒有界收尾宽限，增加 CPU 和输出字节数等脱敏指标。原生回退和 existing 路径保留。正式 126.6 秒失败及 Electron 弹窗边界见[后续报告](verification/2026-10-25-startup-followup.md)；下段四文件和仅运行期 receipt 为较早实现。

2026-10-25 启动链路更新：runner 接入 `startup-runtime.cjs`，仅对四个 SHA-256 完全匹配的固定上游文件增加内存适配；`frontend-cache.cjs` 根据编译输入/上下文/缺失依赖/输出生成并校验记录。managed 的前端与 Node 编译缓存位于 `dataRoot/_cache/desktop-startup/`，未知或失效时保留原生启动。启动 trace schema 2 从主进程 JS 入口计时，等待后台期间周期落盘，并通过核验 origin/frame 的 preload IPC 记录写作与 Agent 初始化完成。详见 [审核、验证与限制](verification/2026-10-25-startup.md)。

2026-10-25 UI 重构：`style.css` 作为唯一文档样式入口，依次加载设计变量、页面布局和原生兼容；Agent 的基础/现代样式合并为 `agent.css` 并继承文档主题变量。`theme.mjs` 提供 schema 1 的主题导入导出、配色/排版/材质配置；`ui-preferences.mjs` 将 UI 配置保存在当前酒馆用户的 `extension_settings.desktop_ui_v1`，只读迁移旧 localStorage。`native-surfaces.mjs` 保留原设置节点与绑定，增加分区跳转/查找并将抽屉请求导向设置中心。RP 右侧仅保留常用参数，复杂功能进入宽面板，旧浮动停靠队列和测量观察器已移除。主题兼容旧 CSS 为显式选择，原 CSS 内容和旧主题配置不删除。详见 [实施与验收](UI_REBUILD.md)。

2026-10-23 UI 更新：新增共享 `design-system.css`、文档 `modern-ui.css`、Shadow `modern-agent.css`、固定 SVG `icons.mjs` 和命令罗盘 `modern-shell.mjs`。`settings-dialog.mjs` 管理原生 dialog、常用字段写入及原生复杂页面临时挂载，与 RP 停靠协调；原生 chat/form 的直接父级继续保留。具体实现与验证范围见 [本轮记录](verification/2026-10-23-modern-ui.md)。下文三栏宽度和旧视觉描述属于较早基线。

审查日期：2026-10-21，交接完成于 2026-10-22。本文件描述当前工作树；不是重构方案。旧 `TECHNICAL_DECISIONS.md` 按时间追加，早期“没有 preload”“Agent 单栏”“模式切换参数”等表述已被后续实现替代，参见 `DECISIONS.md`。

## 目录与版本

2026-10-22 更新：工作区迁移已完成，下面的目录职责和运行时架构不变；原 `.codex\visualizations` 根保留为回退副本。Documents 入口已重新指向 E 盘新根。

实际项目根目录：`E:\Github\sillytavern-desktop`。这是独立 Git 仓库，不是 `E:\Github\Daily-system\Bases` 的子项目。新会话当前目录 `C:\Users\wang\Documents\ChatGPT\软件定制化项目` 起初只有空 Git 仓库，本次只加入指向实际源码的说明，不复制另一份代码。

| 位置 | 职责与维护方式 |
| --- | --- |
| `desktop/main.cjs`、`preload.cjs`、`workspace-preload.cjs`、`update-preload.cjs` | Electron 主进程、启动页、工作区与更新桥 |
| `desktop/services/` | 数据安全、后端生命周期、管理配置、备份、更新与本地文档 |
| `desktop/extensions/desktop-writing/` | RP 导航、小说、Agent、独立预设、生成与布局的真实源码 |
| `desktop/ui/` | 本地启动页与更新界面 |
| `vendor/manifest.json` | 固定上游地址、commit、Node 版本与空补丁列表 |
| `vendor/upstream/` | 官方原始程序的独立 Git 检出，生产依赖也在此；忽略提交，不直接开发 |
| `build/backend/` | 不含上游 `.git` 的打包暂存，不能当作工作源码 |
| `build/backend.zip`、`backend-files.json`、`runtime/` | 离线部署资源、逐文件索引与独立 Node |
| `tests/`、`scripts/` | 单元/集成测试、隐藏界面检查、构建与发布工具 |
| `dist/0.5.0/`、`dist/win-unpacked/` | 历史产物；不是自动同步的源码版 |
| `test-results/` | 本机测试证据及隔离数据，全部被忽略，不能整目录发布 |

包版本 0.5.0；Electron 44.9.0；electron-builder 26.15.3；electron-updater 6.8.9；开发和随包独立 Node 均为 24.15.0 x64。外壳另外依赖 YAML、yauzl；测试使用 playwright-core。SillyTavern 固定为 1.19.0、commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`。本次核对 `vendor/upstream` HEAD 相同、工作树干净。`D:\sillyTavern desktop` 中产品仍为 **0.4.0**，其 `version` 文件写的是 Electron 44.9.0，不是产品版本。

## 进程与启动

```text
源码快捷方式 / npm run dev / 已安装 EXE
  └─ Electron main.cjs：单实例、启动页、数据路径、更新与窄 IPC
       └─ 独立 Node guardian.cjs：持有数据锁，监管自身子进程
            └─ 独立 Node runner.cjs → 目标 SillyTavern server.js
                 └─ 127.0.0.1 随机端口 HTTP + CSRF
       └─ BrowserWindow 加载上述地址 → 原生 UI + 专属写作扩展
```

主进程设置默认数据根和 `<home>/shell` Electron userData，获取单实例锁，先显示启动页，再校验官方 Node 的哈希。读取 `settings.json` 中上次配置，初始化 Managed、Lifecycle、工作区及更新处理；如果存在上次配置就继续使用。

Lifecycle 先核对外部 Node 服务及数据锁，安装专属扩展，再选择本机端口、启动 detached guardian。runner 在独立 Node 中导入目标 `server.js`，不在 Electron 主进程里运行后端。启动参数显式传 configPath/dataRoot、禁用外部监听和自动浏览器、仅 IPv4 `127.0.0.1`、保留 CSRF。通过 `/csrf-token` 和监听 PID/地址归属检查后才加载页面。识别端口冲突后最多重试三次；未知归属不冒险附着。

正常退出先处理前端待保存内容，再由 guardian 通知 runner 发出 JS SIGTERM，交给上游退出处理；guardian 超时只终止持有句柄的自身子进程，不按进程名杀系统 Node。外壳失联时 IPC 断开也触发清理。后台原始 stdout/stderr 不保存，只提取固定诊断/阶段代码。`startup-latest.json` 记录不含内容的阶段计时；`frontend-loaded` 不等于扩展全部可交互。

## 配置与数据归属

默认桌面 home 是 `%LOCALAPPDATA%\SillyTavernDesktop`，`--desktop-home=<绝对路径>` 可隔离。安装目录、源码目录均不是默认用户数据根；源码和安装版不带参数时共用数据。

| home 内路径 | 内容 |
| --- | --- |
| `settings.json` | 当前/上次配置指针、窗口等外壳设置；含本机路径，不入 Git |
| `profiles/<id>/profile.json`、`config.yaml`、`data/` | 独立配置的描述、酒馆配置和用户数据 |
| `backend/versions/1.19.0-06bde939/<id>/` | 每个独立配置自己的可写上游后端，含专属/社区扩展 |
| `shell/` | Chromium 配置、缓存与 localStorage 等 |
| `agent/<SHA256(dataRoot.toLowerCase())>/` | 按酒馆数据根隔离的文档讨论状态、建议与备份 |
| `backups/`、`extension-backups/` | 完整数据备份、专属扩展代码备份 |

运行模式有 fresh 独立创建、existing 使用原安装、copy 校验备份后恢复到新独立配置。existing 不改写外壳配置逻辑中的原 YAML，但上游启动可能自行补齐配置；它也会安装专属扩展，因此不是对原安装完全只读。检测到旧 `public/characters` 时，existing 拒绝启动以免上游自动移动旧数据。copy 只允许新副本做这类迁移，并拒绝混合角色目录的自动合并。

全局原生酒馆路径由 env-paths 决定，Windows 为 `%LOCALAPPDATA%\SillyTavern\Data\config.yaml` 和 `data`，不是 `%APPDATA%`。当前实际选择的是 managed 配置；独立于本工程的其他历史浏览器版安装没有在本次审查中确认，不能把 vendor 或 D 盘外壳混称为那份旧数据。

小说通过原生已认证 `/api/files/upload` 与 `/user/files/` 保存当前酒馆用户的 `user/files/desktop-writing-workspace-v1.json`、`desktop-writing-recovery-v1.json`（磁盘相对当前用户目录，见上游 `src/constants.js` 的 files 映射）。schema 1，版本校验、串行队列、Web Locks 和上一确认副本保护保存。每章最多 20 个快照，导入作品包新建而不覆盖。是否存在本机已保存作品以 `LOCAL_PATHS.local.md` 的检查为准，本次不创建或恢复用户作品。

Agent 的 `state-v1.json` 保存已连接根、讨论、预设等；`proposals/`、`backups/` 保存待确认建议与原始版本。外部授权文件夹仍留在原位置，不作为程序目录，也不随更新整库复制。实际本机配置 ID/路径见不入 Git 的 `LOCAL_PATHS.local.md`。

## 三个功能模式

RP 由 `roleplay-ui.mjs` 包装原生导航和会话元数据，保留原生 `#chat`、`#form_sheld`、面板父级与消息链。右栏以临时 CSS 定位和 pin 状态接管九个原生面板，默认 250px、可拖宽/收起；原生回退入口保留。已出现动画期间旧面板浮回中央、原生多列不适配窄栏等缺陷，见状态文档。RP 布局使用 localStorage；后端随机端口改变时同源存储是否仍能恢复未做真实重启证明，不把同页持久化测试等同于跨端口恢复。

小说的 `index.js`、`model.mjs`、`store.mjs`、`discussion.mjs`、`layout.mjs` 负责作品/章节/卷/大纲/聊天、正文与 RP 双向联动、候选采用和导出。`generation.mjs` 负责取消、预算、超时和输出阶段。正文与候选分开，讨论不自动改稿。

Agent 的 `agent-ui.mjs`、`agent-layout.mjs`、`agent.css` 负责三栏和独立净化 Markdown/Shadow DOM；`agent-loop.mjs` 是有预算的工具循环，`agent-transport.mjs` 处理兼容补全传输。`LocalWorkspace` 主进程服务负责文件权限、编码、搜索、版本与显式写入。字面搜索不是语义索引；单轮内去重不等于跨轮完整工具记忆。

`assistant-options.mjs`、`assistant-runtime.mjs`、`assistant-ui.mjs` 与 `agent-settings.mjs` 维护各用途独立预设、模块和参数。模型/连接仍来自原生当前选择，提示文本继承、参数继承、角色卡、世界书分别选择，默认独立上下文 32768、输出上限 4096。Agent 项目可设新讨论默认预设。RP 预设继承只提取启用普通文本和常用宏，跳过 marker，不复刻任意深度插入/插件执行链。

DeepSeek/OpenAI/自定义兼容来源使用相应 SSE；Claude/Google/Cohere 小说经上游转换使用非流式正文，其 Agent 工具协议未适配。接口明确返回 reasoning_content/reasoning 字符串才提供思考折叠，显示/保存分别选择、默认关闭。新模块不套社区正文正则；世界书自身激活机制仍属于原生链路。

## 安全边界与兼容性

BrowserWindow 禁用 Node 集成，启用 sandbox/contextIsolation/webSecurity；外部新窗口拒绝并走确认后的 HTTPS 外链。启动页、更新页与酒馆页各用不同的窄 preload。工作区 IPC 核验当前窗口、主 frame 和准确本机 origin，不接收页面绝对路径授权。

文件工具限制相对路径、敏感名称、隐藏目录、符号链接/硬链接、保护根和容量；支持 UTF-8/UTF-16 文本及 DOCX 只读提取。保存必须明确确认并核验读取版本，先备份原字节，新文件不能覆盖。没有通用 shell/删除工具。Shadow DOM 与 Markdown 净化只隔离常见视觉/渲染规则，第三方扩展仍与酒馆共享页面环境，不是插件安全沙箱。语音/媒体权限和依赖浏览器特殊 API 的插件不保证完整兼容。

## 开发、构建与更新

`npm run dev` 用本地 Electron 直接打开工作树；三个现有快捷方式等价。每次启动在数据锁内把源码专属扩展同步至目标后端，哈希检查、白名单校验、先备份后原子切换；新增文件不能遗漏分发清单。正常退出重开才保证同步，Ctrl+R 只刷新现有前端副本。

`npm ci` 安装外壳依赖；`npm run prepare:vendor` 按固定 commit 准备上游与生产依赖、官方 Node 哈希、前端预编译及 ZIP；资源缺失时需要网络。`npm run build:dir` / `build:win` 分别生成免安装目录/NSIS 安装器，默认输出 dist，而不会自动覆盖 D 盘安装。不要为文档工作运行打包。

发布工具、Actions 与 `resources/update-policy.json` 使用 `114514547/SillyTavern-Desktop`、stable 和 Ed25519 公钥。electron-updater 先验证签名清单/仓库/基线/架构/元数据/安装包，再由用户确认停后端、备份、校验和 NSIS 交接。默认不自动下载/安装。Windows Authenticode 签名未提供；清单签名不等于 EXE 证书签名。上游数据跨版本迁移和自动程序回退未实现。签名私钥只留本机受保护位置或 CI Secret，不读取/复制其内容。本次未联网检查 GitHub，也未发布。
