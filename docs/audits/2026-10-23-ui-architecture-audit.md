# SillyTavern Desktop UI 架构与原生组件残留审计

审计日期：2026-10-23（北京时间）。对象：`E:\Github\sillytavern-desktop` 的完整当前工作树，产品版本字段为 0.5.0，外壳 HEAD 为 `b3331d29ce7d086335220dde05c947bdb4e73a1f`；上游检出 HEAD 与 manifest 固定的 SillyTavern 1.19.0 commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` 一致。关键扩展仍有未跟踪文件，因此本报告不能用外壳 HEAD 单独复原。

本次只读走查源码，并对真实 LocalWorkspace 类做无磁盘写入的内存故障注入；仅新增本报告，没有修改应用代码、配置、依赖、测试或用户资料，没有启动 Electron、默认后端或真实模型。下文“确认”指源码逻辑或本轮内存验证成立；实际屏幕占用、不同缩放下的最终尺寸及第三方扩展兼容性仍需独立运行验收。

用户列出的内容实际是四组，本报告另将“跨模式设计系统与交互基础设施”作为第五维度。仓库 AGENTS.md 和 DECISIONS.md 中仍有“沿用原生主题、不自创新主题”的旧约定；本次现代化目标以用户最新要求为准，但本报告不把建议视为已实施，也不改写历史决策。

## 1. 审计结论与优先级

当前 UI 是“黑金样式覆盖 + 原生 RP DOM 停靠 + Agent Shadow DOM 独立样式”的混合架构，已经完成部分现代化，尚未形成统一的组件、设置入口和状态管理。主要矛盾在于：颜色改了，原生布局和交互状态机大多保留；Shadow DOM 隔离了旧样式，也隔断了新组件需要的图标与共享组件样式。

优先级约定：P1 为数据一致性或关键功能可用性问题，应优先处理；P2 为布局、可访问性与现代化完整性问题；P3 为维护性改进。本轮没有足够依据判定 P0 故障。

| 编号 | 等级 | 结论 | 证据性质 |
| --- | --- | --- | --- |
| A01 | P2 | Agent 输入底栏分成两个独立换行容器；发送按钮已有右对齐，但不能带动上一行控件利用剩余空间 | 源码确认 |
| A02 | P1 | Shadow DOM 仅加载 agent.css，没有 FontAwesome 字形映射；空的删除图标节点无法仅凭 font-family 生成图标 | 源码确认 |
| A03 | P2 | 删除按钮只在 hover 时显现，缺少 focus-within、明确图标按钮名称和减少动效支持 | 源码确认 |
| A04 | P2 | 左侧讨论没有业务 contextmenu 监听，也没有对应 Electron IPC | 源码确认 |
| A05 | P1 | Agent 设置“抽屉”缺少定位和滚动规则，实际仍是主横向 Flex 内的普通子项 | 源码确认 |
| A06 | P2 | Shadow 内复用了 assistant-ui 组件，却没有加载这些组件在文档中的专用样式 | 源码确认 |
| S01 | P2 | “酒馆设置”仅切换原生工具栏可见性，没有现代 Settings Dialog | 源码确认 |
| S02 | P1 | 设置保存链路存在“await 完成不等于持久化成功”的语义，新的保存状态不能直接照搬 | 源码确认 |
| R01 | P2 | RP 九个设置页实际仍是原生抽屉内容，角色管理、滑块、折叠标题等仍暴露 | 源码确认 |
| R02 | P2 | RP 聊天只分配了 Grid 区域，消息与发送器内部仍由原生 CSS 主导 | 源码确认 |
| R03 | P2 | 右栏整体折叠没有释放原生停靠面板，唤回控件还是不可键盘访问的 div | 源码确认；残影表现待运行验证 |
| D01 | P1 | 解除系列关联会级联删除讨论，确认文案没有说明这一影响 | 源码确认 |
| D02 | P1 | 删除未完整检查编辑、保存队列和待保存建议；移除当前项目在删除成功之后才可能因未保存编辑而报错 | 源码确认 |
| D03 | P1 | 两个后端删除方法持久化失败后不回滚内存，可能在后续保存中把失败的删除落盘 | 源码确认 + 本轮内存验证 |
| D04 | P2 | 删除没有版本前置条件和删除标记；首次尚未落盘的讨论可能被迟到保存重新创建 | 源码确认 + 服务层内存验证 |
| X01 | P2 | 黑金 token 存在两份不同值；全局控件覆盖过宽，Shadow 组件覆盖又不完整 | 源码确认 |

需要纠正的两个前提：当前源码中未检出 `#range_div`，实际应查 `.range-block`、`.neo-range-slider` 和各 API 的 range input；RP 正常三栏下原生顶部开关已经被隐藏，不能把它们描述为始终裸露。残留主要是抽屉内容，以及点击“原生”或其他模式“酒馆设置”后的原生外观。

## 2. 关键文件与行号清单

以下均指本轮读取的当前文件行号，链接指向真实本地源码。长函数给出入口行，正文再列出具体区间。

| 文件定位 | 关键行 | 职责与审查结果 |
| --- | --- | --- |
| [agent-ui.mjs](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/agent-ui.mjs:30) | 30–42、43–108、187–190、221–269 | Shadow 创建、表单、删除操作、保存队列、切项目、生成任务 |
| [agent-layout.mjs](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/agent-layout.mjs:44) | 44–57、69–115 | 输入控件拆分、项目与讨论行、删除图标和控件禁用 |
| [agent.css](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/agent.css:591) | 1–30、261–284、432–477、591–697、709–803 | 独立 token、图标声明、按钮显隐、底栏、文档与设置布局 |
| [assistant-ui.mjs](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/assistant-ui.mjs:34) | 7–13、34–66 | 复用的预设、参数、思考和用量组件 |
| [index.js](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/index.js:101) | 18、101–117、346、366–372、413 | 上下文获取、模式切换、原生设置按钮、RP 原生接口适配 |
| [roleplay-ui.mjs](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/roleplay-ui.mjs:2) | 2–7、40–84、91–157、158–183、201–223 | 九入口、原生面板停靠、布局状态、角色列表与原生操作 |
| [style.css](E:/Github/sillytavern-desktop/desktop/extensions/desktop-writing/style.css:164) | 1–56、164–233、236–273、276–299、490–543 | 黑金覆盖、原生栏显隐、RP 布局、共享组件和沉浸模式 |
| [workspace-preload.cjs](E:/Github/sillytavern-desktop/desktop/workspace-preload.cjs:4) | 4–5 | 受限 workspace IPC 白名单 |
| [main.cjs](E:/Github/sillytavern-desktop/desktop/main.cjs:105) | 62–80、105–131、179 起 | 窗口隔离、IPC 来源检查、应用菜单 |
| [local-workspace.cjs](E:/Github/sillytavern-desktop/desktop/services/local-workspace.cjs:327) | 94–121、251–307、327–363 | 串行持久化、讨论版本、建议/保存/备份、讨论与项目删除 |
| [files.cjs](E:/Github/sillytavern-desktop/desktop/services/files.cjs:29) | 29–44 | 临时文件 rename 写入与脱敏错误 |
| [writing-extension.cjs](E:/Github/sillytavern-desktop/desktop/services/writing-extension.cjs:4) | 4、8–39 | 扩展文件白名单和启动时同步 |
| [原生 index.html](E:/Github/sillytavern-desktop/vendor/upstream/public/index.html:66) | 24–26、66 起、8201–8205 | FontAwesome、九个静态抽屉、jQuery 加载 |
| [原生 script.js](E:/Github/sillytavern-desktop/vendor/upstream/public/script.js:10953) | 470、7914 起、8051–8114、10953–10989 | 原生设置读取/保存、抽屉开关状态机 |
| [openai.js](E:/Github/sillytavern-desktop/vendor/upstream/public/scripts/openai.js:520) | 86–88、315–407、520、6030–6097、6824–6838、6993–6995、7082–7089 | ESM 状态、模型、代理、token 参数、连接与密钥提交 |
| [st-context.js](E:/Github/sillytavern-desktop/vendor/upstream/public/scripts/st-context.js:227) | 115 起、227–229 | 对扩展开放原生设置引用 |
| [secrets.js](E:/Github/sillytavern-desktop/vendor/upstream/public/scripts/secrets.js:349) | 349–425 | 密钥写入、删除和状态刷新 |
| [world-info.js](E:/Github/sillytavern-desktop/vendor/upstream/public/scripts/world-info.js:795) | 65–86、795–852、2036–2058、4151–4189 | 世界书绑定/扫描设置、内容缓存与保存 |
| [power-user.js](E:/Github/sillytavern-desktop/vendor/upstream/public/scripts/power-user.js:3514) | 1227–1440、2484 起、3514–3518 | 主题配置、视觉应用和主题文件保存 |
| [原生 style.css](E:/Github/sillytavern-desktop/vendor/upstream/public/style.css:5555) | 894–927、1185–1193、4238–4305、5555–5598 | 原生发送器、消息、滑块、抽屉最小宽度与动画 |
| [settings endpoint](E:/Github/sillytavern-desktop/vendor/upstream/src/endpoints/settings.js:206) | 206–225 | 原生用户 settings 文件读写及错误响应 |
| [secrets endpoint](E:/Github/sillytavern-desktop/vendor/upstream/src/endpoints/secrets.js:511) | 119、511–536 | 用户 secrets 文件及服务端密钥操作 |
| [local-workspace.test.cjs](E:/Github/sillytavern-desktop/tests/local-workspace.test.cjs:142) | 142–152 | 现有删除 happy path，未覆盖本报告发现的故障分支 |
| [smoke-agent-layout.cjs](E:/Github/sillytavern-desktop/scripts/smoke-agent-layout.cjs:13) | 13–23 | 三栏几何、编辑与生成验证；没有图标、右键和删除保护验收 |
| [smoke-roleplay-native.cjs](E:/Github/sillytavern-desktop/scripts/smoke-roleplay-native.cjs:73) | 73–115 | 正常动画、完整面板、原生父级、窄屏与回退的现有验证路径 |

## 3. 本地工作区：Shadow DOM 与输入框

### 3.1 输入底栏为什么失衡

`agent-ui.mjs:37` 先构造 refs、textarea 和 `#agent-input-actions`。随后 `agent-layout.mjs:44–49` 将“预设与参考”移入 actions，并在 actions 前插入单独的 `#agent-controls`，后者装模型、预设和思考模式；`agent-layout.mjs:53` 又把 metrics 作为表单最后一个子节点。

`agent.css:591–603` 将表单设为纵向 Flex。因此 controls 和 actions 是上下两行的兄弟容器；两者在 `631–638`、`657–663` 分别独立 `flex-wrap:wrap`。它们没有共享一条弹性主轴，controls 内也没有占满剩余宽度的弹性区域，天然从左向右按内容宽度排列。模型名或预设名较长时，固有尺寸还会促使这一行提前换行。

必须保留的事实是：`agent.css:672–673` 已给发送按钮设置 `margin-left:auto`，所以“完全没有右对齐”不是准确诊断。这个 auto margin 只能消费发送按钮所在那条 Flex 行的剩余空间，无法利用上一行 controls 的右侧空白；当 actions 自己换行时，它同样只能作用于最后所在的行。两侧文档栏打开后，中心列明显小于视口，按视口写的 1050/800px 断点也无法准确反映输入区的可用宽度。

建议保留 refs、textarea、metrics 作为纵向区域，只把两组底栏包进一个新的 footer：左组模型/预设/思考采用 `flex:1 1 0; min-width:0`，右组引用/权限/发送停止采用 `flex:0 0 auto; margin-inline-start:auto`，footer 为 `display:flex; align-items:center; gap:8px; flex-wrap:nowrap`。必须同时约束模型按钮和 select 的最大宽度、允许文本省略，并将“发送/停止”封成同一个操作槽；否则单纯改成 nowrap 会把拥挤变成溢出。

“默认单行”应以中心列容器查询为条件。在窄中心列优先缩短模型名称、把高级控制收进“更多”，保留发送和停止；空间不足时有明确的第二行布局。不能为了单行把关键按钮压成不可点击，也不能只依赖窗口断点。验收使用长模型名、长预设名、两侧展开、缩放 125%/150% 和停止状态，检查按钮矩形、横向溢出与可点击面积。

### 3.2 FontAwesome 缺失的确定原因

`agent-ui.mjs:32–33` 的 ShadowRoot 只引入 agent.css。`agent-layout.mjs:85、102` 创建的删除图标是空 `<i class="fa-solid fa-xmark">` / `<i class="fa-solid fa-trash-can">`，没有文本或 SVG 内容。agent.css 的 `28–30` 只指定字体族和字重，既没有 `.fa-trash-can::before` / `.fa-xmark::before` 的 content 映射，也没有引入完整图标 CSS。

原生页面在 `index.html:24–26` 加载的 fontawesome.min.css、solid.min.css 属于文档样式树，不会把这些 class/pseudo-element 规则穿透到 Shadow DOM。原生映射分别是 `\f2ed` 和 `\f00d`，字体声明位于 solid.min.css；即使某个 Chromium 版本能复用文档字体资源，也不能替代缺失的字形 content。因此仅“继承 FontAwesome 字体”无法修复空图标，字体下载是否成功也不是这里最先应查的原因。

核心删除、收起、新建、引用图标建议统一改为代码内固定 SVG，使用 `currentColor`，提供固定 viewBox、尺寸和描边，不从模型文本或外部 HTML 注入。这样可消除字形映射、字体资源和字体加载时序三个依赖，是关键按钮确定性渲染最稳妥的方式。若继续使用 FontAwesome，则必须在 Shadow 内提供完整所需规则，明确本地资源 URL，并对目标 Electron 版本实测字体作用域和加载失败回退；只复制 `font-family` 或只引入 solid.min.css 均不完整。

### 3.3 删除按钮与交互反馈

`agent.css:261–284` 已有颜色、背景和透明度过渡，不能说完全没有动效。但是初始 `opacity:0` 的按钮仍占位、可被点到，也可能获得键盘焦点；显现只依赖父行 hover，没有 `:focus-within` 和按钮 `:focus-visible`。按钮又只有 title，图标 aria-hidden，没有明确的 aria-label。由此形成“键盘焦点落在不可见操作上”和“鼠标靠近才知道能删除”的交互盲区。

建议默认给予可识别的低对比操作入口，hover/focus-within 提高可见性，focus-visible 提供清晰焦点圈；图标按钮设置中文 aria-label，并根据可用尺寸提供合理命中区域。微动效限定到 opacity、color、background-color 和 transform，例如悬停上移 1px、按下缩放 0.94，持续约 120–160ms；在 `prefers-reduced-motion:reduce` 下取消 transform/动画。不要继续使用 `transition:all` 去覆盖未知布局属性。

### 3.4 讨论列表没有右键菜单的原因及 Electron 接口

`agent-layout.mjs:69–109` 只生成项目、讨论及删除按钮；`agent-ui.mjs:43–92` 只有 click 委托。desktop 源码未检出 contextmenu 业务绑定，workspace-preload.cjs 也没有上下文菜单方法。`main.cjs:107–110` 的 appMenu 弹出的是整套应用菜单，不能替代带讨论目标的业务菜单。因此缺少右键功能是未实现事件与桥接能力，并非 Shadow DOM 自动吞掉了右键。

在 ShadowRoot 内监听 contextmenu，使用 closest 或 composedPath 找出行的稳定 threadId/rootId，命中业务行后再 preventDefault。处理 Shift+F10 和 ContextMenu 键，用当前行矩形作为键盘菜单锚点；普通文档编辑区继续保留适合文本编辑的菜单行为。如果从 webContents 的 context-menu 事件处理，不能假定 document.elementFromPoint 就能直接识别 Shadow 内讨论节点。

建议新增一个窄 IPC，例如 workspace:contextMenu，只接受枚举 kind、合法目标 ID 和有限坐标，不接受 renderer 提供的任意菜单模板、执行脚本或文件绝对路径。主进程沿用现有当前窗口/mainFrame/准确 origin 校验，从服务端当前 state 验证目标，使用 `Menu.buildFromTemplate(...).popup({window,...})` 构造“重命名、复制名称、删除讨论”或“新建讨论、解除关联”等固定选项。busy/dirty 只能用于菜单可用性提示，真正执行时必须重新校验。

菜单返回选择的 commandId 与原目标 ID，renderer 调用与行内按钮相同的业务命令；主进程服务保留最终数据一致性防线。菜单等待期间切模式、切项目或导航时，应取消或忽略过期结果。系统菜单色彩受操作系统控制，不能保证像网页面板一样精确黑金；若精确品牌皮肤优先，则使用同一命令层加网页菜单，但应明确这是另一种表现层选择。

### 3.5 额外确认：设置面板不是实际浮层

`#agent-drawer` 在 `agent-ui.mjs:36` 是 #agent-main 的普通子项。agent.css:759–770 虽然设置 inset、translateX、width、max-height 和 z-index，却没有 position；整个 agent.css 也没有其他规则为它补充 absolute/fixed。于是 inset 不产生预期定位作用，它仍参与主横向 Flex 布局，transform 只移动绘制位置，原占位仍保留，打开设置会竞争主栏空间。它还缺少自身 overflow:auto。

`agent-layout.mjs:54–55` 仅补 role=dialog 与 Escape，没有模态背景、焦点约束、焦点还原或 aria-modal。更进一步，assistant-ui.mjs:34 起生成的 dw-assistant-settings、dw-preset-module、dw-assistant-preview 等样式主要定义在文档 style.css:490–491，Shadow 内无法命中。当前 agent.css 的通用控件样式只能提供局部外观，不能代替这些组件的排版、宽度和预览滚动规则。

应把 Agent 预设面板接到统一 Dialog 基础组件，或至少作为脱离主 Flex 的有界浮层，补齐滚动和焦点生命周期；共享 assistant 样式需作为独立样式资源同时进入文档与 Shadow，不能把整份含 body/#sheld 规则的 style.css 原样导进 Shadow。

## 4. 顶部九抽屉与统一 Settings Dialog

### 4.1 当前挂载与开关链路

九抽屉不是点击时临时创建的 DOM。它们静态写在上游 index.html 的 #top-settings-holder 下，每个 .drawer 内含 .drawer-toggle 和 .drawer-content，原生模块再向内部控件绑定事件和加载数据。

| 页签 | 原生 holder → 内容节点 | 上游 index.html 行 |
| --- | --- | --- |
| 生成参数 | ai-config-button → left-nav-panel | 68、72 |
| 连接与模型 | sys-settings-button → rm_api_block | 2282、2286 |
| 高级提示格式 | advanced-formatting-button → AdvancedFormatting | 4091、4095 |
| 世界书 | WI-SP-button → WorldInfo | 4671、4675 |
| 界面与主题 | user-settings-button → user-settings-block | 4878、4882 |
| 背景 | backgrounds-button → Backgrounds | 5653、5657 |
| 扩展与正则 | extensions-settings-button → rm_extensions_block | 5750、5754 |
| 用户身份 | persona-management-button → PersonaManagement | 5833、5837 |
| 角色卡管理 | rightNavHolder → right-nav-panel | 6001、6006 |

index.js:346、413 的“酒馆设置”只切换 body.dw-native-tools-open 及 aria-expanded；style.css:165–167 因而撤销对顶部原生栏的隐藏。这一步本身不是调用某个抽屉。随后点击原生 toggle，或 Agent 的模型按钮在 agent-ui.mjs:224 点击 API-status-top，才进入原生抽屉行为。

原生 script.js:10953–10989 通过 toggle 的 parent().find('.drawer-content') 查找面板，切换 openDrawer/closedDrawer 和图标状态；打开新页先关闭未 pinned 的旧页，必要时等待动画，角色页还触发收藏与滚动逻辑。RP 在 index.js:367 直接复用此函数。任何现代化替代都必须保留这些必要副作用，不能仅用 display:block 假装打开成功。

### 4.2 设置数据到底存在哪里

window.jQuery 是原生 DOM 控件的事件/值访问入口，不是业务设置数据库。oai_settings 是 openai.js:520 的模块对象，经 86–88 导出；当前上下文以 `SillyTavern.getContext().chatCompletionSettings` 引用它（st-context.js:227）。不能假设存在 window.oai_settings，也不应复制一个同名对象作为新真源。

| 数据 | 当前读写机制 | 新 Dialog 应保留的行为 |
| --- | --- | --- |
| API Key | secrets.js 的 writeSecret/secret_state，经 /api/secrets/write、/read；用户 secrets.json 在后端管理。连接处理见 openai.js:6082–6097 | 显示已配置状态与显式替换/删除；不能把空占位或掩码当真实密钥再提交 |
| 反向代理 | #openai_reverse_proxy 的 input 更新 oai_settings.reverse_proxy；见 6030–6033、7319 | 保留代理提示、供应商支持范围、连接验证和保存 |
| 代理口令 | #openai_proxy_access_key 的 input 更新 oai_settings.proxy_password；见 6993–6995 | 与 API Key 分开处理；当前它随普通 oai_settings 保存，不属于 secrets API 隔离字段 |
| 模型与自定义地址 | 各供应商独立字段，如 openai_model、deepseek_model、custom_model/custom_url；模型选择还会更新容量与功能支持 | 按 main_api 和 chat_completion_source 适配，不能统一写 openai_model |
| 上下文/输出 | OpenAI 路径 openai_max_context/openai_max_tokens，input 处理见 6824–6838；其他 API 有各自设置 | 同步 range/counter、供应商限制及相关预算副作用；不要误写到 Agent 独立参数 |
| 世界书绑定与扫描设置 | selected_world_info、world_info 和 get/updateWorldInfoSettings；全局选择写入 globalSelect，随 settings 保存 | 保留全局/角色/聊天/身份多种绑定，不能用一个开关替代全部绑定 |
| 世界书条目内容 | loadWorldInfo 缓存读取 /api/worldinfo/get；saveWorldInfo 更新缓存并提交 /api/worldinfo/edit | 区分“绑定设置”和“书内条目”，保留缓存失效与 WORLDINFO_UPDATED |
| 主题 | power_user.theme、颜色与布局字段；#themes change 调 applyTheme 后保存。主题预设文件另走 /api/themes/save | 同时应用视觉值和保存选择，只改字符串不会完整换肤 |

普通设置由 script.js:8051–8114 组装完整 payload，包括 main_api、oai_settings、power_user、world_info_settings、extension_settings 等，POST /api/settings/save；后端 settings.js:206–225 读写当前用户根的 settings 文件。API Key 与普通设置分开，而代理口令目前在普通设置中，因此调试日志、导出和报告都不应转储完整 settings 对象。

密钥还有一个易错语义：secrets.js:351–354 中，调用 writeSecret(key, '') 默认转为删除。因此现代面板“未修改密钥”的状态必须独立表示，不能把空输入框当作写入空值。写入失败可能返回 null，必须检查结果。

### 4.3 保存成功反馈是单独的架构问题

原生 saveSettings 在 script.js:8111–8114 内捕获错误并弹 toast，没有把失败向调用方抛出；settings endpoint 的 catch 又在 212–214 使用 response.send(err)，没有显式错误状态。因此“await saveSettings 返回”或“HTTP 200”都不充分证明保存成功。世界书 _save 在 world-info.js:4155–4160 也没有检查 response.ok 就发出更新事件。

新 Dialog 不能简单在 await 之后显示绿色“已保存”。兼容适配层应明确区分本地值已应用、正在持久化、已确认持久化和失败；关键普通设置可在显式提交后读取服务端对应字段做有限校验，密钥检查写入 ID/状态，世界书内容需要可靠响应确认。若未来允许修复上游保存语义，可提供更直接的结果，但不能在本次报告中假定它已经存在。完整对象不得输出到诊断日志。

### 4.4 推荐的统一面板结构

建议形成一套 SettingsController、SettingsAdapter 和 DialogHost。Controller 负责当前 tab、打开来源、焦点、busy、待提交值和关闭策略；Adapter 按“连接、参数、提示格式、世界书、主题背景、扩展、身份角色”组织原生字段及命令；Host 负责居中大面板、左侧分类、内容滚动、底部状态。九个原生功能保留可寻址 tab，主题与背景等是否在导航上分组只影响展现，不合并其数据。

常用字段优先使用新控件，通过原生 input/change 或导出的领域函数驱动原状态。例如自定义模型通过 jQuery 的 val(...).trigger('input')，主题通过 #themes 的 change，预设通过当前 getPresetManager().selectPreset，世界书通过原生导出函数。只设置 .value 不触发事件不会保存；直接批量 Object.assign(oai_settings) 又可能漏掉模型切换的 UI、容量和事件副作用。对原生状态的订阅可复用 RoleplayUI 已使用的 SETTINGS_UPDATED、模型/来源、预设与世界书事件，但新的 Adapter 必须防止自己写入引起回声循环。

普通设置若采用“立即应用”，关闭按钮就应明确是关闭，不能把取消伪装为能回滚已自动保存的内容。若采用“应用/取消”，必须保存字段级草稿，在点击应用前不触发原生 input/change；密钥写入和连接测试仍是独立显式动作。两种提交语义不要混用。RP 参数、小说参数、Agent 参数需标明作用范围，切模式或打开面板不能自动覆盖其他模式的参数。

对于九页中的复杂原生内容，应采用“保留原节点、逐页现代化”的兼容路径，不能 cloneNode/innerHTML 复制一套。复制会产生重复 ID、丢失直接事件绑定，并使全局 jQuery 读到错误副本。也不建议使用 iframe，它会引入另一页面上下文和另一套原生状态。

真正使用原生 dialog.showModal 或现有 Popup 时，还要解决 top layer：留在 body 原位置的 fixed 原生抽屉，无论 z-index 多高，都不能自然出现在模态 dialog 之上，也可能被 inert。可验证的桥接方案是，在兼容页激活期间把整个 #top-settings-holder 子树临时挂入 DialogHost，保留“面板 → drawer → top-settings-holder”的内部父子链和节点身份，关闭时按标记恢复原位置。这样不会把 .drawer-content 从它的 drawer 单独拔走，但 holder 的外部祖先确实变化，仍必须逐项核查依赖。

这一方案需要一个面板所有权控制器，协调 RP 右栏和中央 Dialog，只允许一个 presenter 持有原生面板。打开 Dialog 前结束 RP dock，保存/恢复 pin、class、内联样式与滚动状态，并继续调用原生开关完成必要钩子；在 modal 内按 tab 显示选中的原生 holder，再针对其内容进行现代化排版。Select2 默认挂到 body 的下拉、拖动面板、第三方 body 浮层和后续原生 Popup 都是必须验证的兼容点，不能以“事件还在”判定全部安全。

如果不移动 holder，则应采用文档层统一 overlay、定位和焦点管理，并明确它不是 showModal top layer 方案。不能同时声称“所有原节点原地不动”和“直接塞进原生模态层”而不解释这一约束。建议先完成常用字段代理和原生兼容页原型验证，再逐页替换复杂视觉，不重做 RP 引擎或另存一份 settings 真源。

## 5. Roleplay Mode 老旧元素与三栏统一

### 5.1 已隐藏的内容与仍在暴露的内容

style.css:195–198 已隐藏正常三栏下的 #top-bar、九个 .drawer-toggle 和未停靠的一级 .drawer-content。roleplay-ui.mjs:64–65、215 的“原生”是有意保留的回退，点击后恢复原工具栏和浮动面板。因此应把“正常使用不再需要老工具栏”和“保留诊断回退”分别验收。

| 残留节点/组件 | 暴露方式与证据 | 具体缺口 |
| --- | --- | --- |
| #left-nav-panel、.range-block、.neo-range-slider、各 API range | 默认参数页通过 dw-rp-docked 打开；原生 index.html:257–290、原生 style.css:4238–4305 | 仍是原生滑块轨道、滑块头、数值布局；全局 input 换色不能完成现代化 |
| #right-nav-panel、#right-nav-panelheader、原生角色编辑/管理控件 | “角色管理”调用 character 原生页；index.html:6006 起 | 左侧已另有角色导航，但管理页仍是一整套旧右抽屉内容及拖动抓手 |
| #AdvancedFormatting、#WorldInfo、#user-settings-block、#PersonaManagement | 九入口停靠原节点 | 原生折叠标题、密集工具条、字段布局与插件内容仍在，现有 CSS 主要处理宽度 |
| #Backgrounds、#rm_extensions_block | 背景/扩展页停靠 | 背景已经有专门窄栏适配，扩展自带 UI 仍不受统一组件约束 |
| #chat .mes、.mes_block、.mes_text、消息按钮与 swipe | roleplay-ui 保留原生消息节点；style.css:190 只分配 chat 区域 | 消息密度、气泡、头像、工具条与编辑态仍继承原生样式 |
| #form_sheld、#send_form、#nonQRFormItems、#leftSendForm/#rightSendForm | 原生发送表单保留；style.css:191 只分配 composer 区域 | 输入、停止、附件、快捷回复和扩展插槽没有整体新布局 |
| 原生 Popup、内联抽屉、Select2 和扩展浮层 | 会话管理、角色管理、世界书/预设等操作继续打开 | 不在九个一级抽屉的覆盖范围内，需列入组件清单单独适配 |

当前没有 #range_div，后续 CSS 不应针对这个不存在的 ID 写“修复”。同时，不能用全局 `#right-nav-panel{display:none!important}` 消灭残留，因为角色管理仍依赖它；应该限制默认入口并现代化其内容或提供等价代理。

### 5.2 当前三栏架构的价值与不足

roleplay-ui.mjs:74–79 将原生面板留在父节点，通过 ResizeObserver 测量右栏，再用 style.css:200 的 fixed 坐标覆盖到右栏占位。它保留原生事件和节点身份，属于有价值的兼容层。closeNative:92–104 已针对离场动画短暂禁用 transition、提交关闭布局再恢复样式；style.css:204–233 也已经为复杂页面做容器查询和背景专用适配。本报告不把此前的“旧页漂到中央”和默认窄栏竖排重复定性为当前已复现故障。

不过，现在的 #dw-rp-settings 主要是标题与尺寸占位，真正内容依旧在外部 #top-settings-holder。显示结果依赖 rightOpen、rightEntire、legacy、dockTicket、原生 open/pinned class、body class 以及测量变量共同一致。仅继续累加 CSS 会扩大状态组合，难以保证模态设置、右栏和原生回退互不冲突；应先统一 presenter 所有权，再逐页做视觉替换。

右栏宽度默认 250px，左栏 220px/窄窗 190px，轨道固定 66px。style.css:173 计算右栏上限时，没有同时扣除 66px 轨道和 sheld 的 16px 外边距，因此式中的“360px 中心区”不是最终保证的 360px。右栏达到公式上限时，中心区可能比这个预算少约 82px。应围绕中心列最小可用宽度统一分配所有固定区域，并在空间不足时明确进入 overlay 模式，不能把公式里的数字当作已达到的可读性保证。

左侧 renderLibrary:177–187 不是原生角色卡 DOM，而是新生成的文字按钮，当前没有头像、最近消息、时间或明确的层级操作。可在现有实体数据上增加紧凑头像行、选中条、二级会话、更多操作入口与空态；保持 selectCharacterById、openCharacterChat、openGroupChat 等原生命令。搜索和分页继续复用已有逻辑，暂不需要引入整套前端框架。

中栏建议只为 body.dw-rp-mode 下原生消息节点增加可控的排版层：统一正文宽度、字体/行高、角色与用户的容器外观、头像和元信息，工具条在 hover/focus-within 显现。保留 mesid、原生消息层级、编辑 textarea、swipe、附件、reasoning 与扩展按钮；不要重新序列化消息 HTML。小说 discussion 与 Agent message 可以共享视觉 token 和样式约定，不应强制共享业务消息渲染器，否则会破坏各自净化与插件边界。

右栏建议只保留本轮常用参数，采用“标签/说明 + 数值输入 + 可选滑块”的响应式字段行，其余进入统一设置。现有原生 slider/counter 要么保留 ID 并换肤，要么由代理控件可靠触发原生事件；不能只隐藏 slider 后留下一个没有同步机制的数字框。原生可拖抓手和 pin 控件在被现代 presenter 持有时可隐藏，但应恢复原生回退状态。

### 5.3 整体折叠与键盘盲区

roleplay-ui.mjs:137–140 的 toggleEntireRight 只改 rightEntire 并 applyRight，没有像 right-close:214 那样调用 releaseDock(true)。style.css:186–188 只隐藏网格中的 right/rail，外部的 dw-rp-docked.openDrawer 未被相同条件显式隐藏。随后 measure 对隐藏占位测得零矩形，依靠零宽高间接处理外部面板；原生 panel 自身还可能保留 padding，键盘可访问性也没有通过 inert/hidden 明确关闭。可确认的是状态关闭不完整，实际是否显示边角或残影需运行确认。

唤回条在 roleplay-ui.mjs:66 创建为只有 onclick 的 div，没有 tabIndex、button 语义和键盘处理；style.css:499 的默认命中宽度只有 12px。应改为可键盘操作的按钮，带 aria-controls/expanded，与标题栏同一收起命令联动；折叠时明确释放或隐藏真正的面板及其焦点，而非只隐藏占位栏。

## 6. 删除与数据安全机制

### 6.1 IPC 通道和已存在的保护

实际调用为：行内删除/移除按钮 → agent-ui.mjs 的 bridge → window.localWorkspace.deleteThread/removeProject → ipcRenderer.invoke('workspace:deleteThread'/'workspace:removeProject') → main.cjs:113–130 的白名单分发 → LocalWorkspace 同名方法。

通道本身已经贯通。主进程核验当前窗口 webContents、mainFrame 和 active.url 的准确本机 origin，并按所选 dataRoot 哈希隔离服务实例。不是任意 iframe 都能调用，也没有通用“删除任意路径”的 IPC。LocalWorkspace.serial 把服务写入串行化，persist 使用临时 JSON 加 rename。删除方法只修改工作区状态，没有删除外部本地目录/文档的文件操作，这部分保护应保留。

前端也不是完全没有 job 拦截：删除当前正在生成的讨论在 agent-ui.mjs:61 被拒绝；移除当前 job 所属项目在 79 被拒绝，所有按钮点击在 applying 时又会被 45 拦截。但这些是 renderer 层条件，服务方法和 IPC 本身没有生成任务/编辑状态概念。不能据此宣称后端能独立拒绝所有正在使用中的对象。

### 6.2 解除关联的真实破坏范围大于文案

removeProject:355–361 不仅移除 roots 项，还过滤该 rootId 的所有 threads，并可能改变 currentRoot。项目的名称、确认摘要和默认预设也随 root 对象从状态消失。前端确认文案 agent-ui.mjs:77 只强调“不删除本地文件夹中的任何文件”，没有说明讨论、草稿和项目内设置会一同删除。

这不是“外部文件被删除”，而是“本地讨论资料被级联移除”。建议把“断开文件夹授权”与“删除项目及其讨论”拆成明确命令。断开应保留项目和讨论但标记离线；如确实删除，确认面板显示讨论数、草稿/待处理建议数量和恢复策略。可以采用有限回收站/软删除，不能只改个更醒目的叉号。

此外 proposals/ 和 backups/ 文件未在 removeProject 中删除，原字节备份仍存在；但它们关联旧 rootId，而 pending、apply、history 路径需要有效 root。重新连接同一文件夹时 connect:116–118 会创建新 ID，因此不能承诺“重新连接即可恢复全部建议和历史”。需要保留稳定项目身份或提供显式恢复关联。

### 6.3 未保存状态的前置拦截不完整

现有安全函数并不缺：prepareToLeave:110–116 会检查 editorDirty、等待 applyDone、取消并等待 job，再 flush；selectRoot:187–190 也在切换前检查 job/editorDirty 并 flush。但删除处理没有完整复用它们。

| 状态 | deleteThread 当前行为 | removeProject 当前行为 |
| --- | --- | --- |
| 正在生成 | 仅阻止删当前 job 所在讨论；其他讨论可删 | 仅阻止移除当前 job 所在项目 |
| 正在 apply | 正常按钮路径被 applying 全局入口挡住 | 同左 |
| 文档 editorDirty | 没有前置检查；render 可能重建编辑 DOM，尽管 editText 仍保留于 viewer | 删除已提交、前端 arrays 已过滤后，调用 selectRoot 才因 editorDirty 抛错 |
| 讨论未保存/保存失败 | 未先 flush 或等待 this.queue，也未暂停 700ms timer | 同样未先排空保存队列 |
| notesDraft 未保存 | 没有独立检查 | root 被移除时没有确认这份草稿 |
| pending 修改建议 | 不提示其关联影响 | 不提示旧 rootId 下建议/历史失去正常访问路径 |

最明确的错序是移除当前项目：80 行先成功调用服务删除，81–82 行删除前端项目和讨论，84 行才 selectRoot；selectRoot 在 188 行看到 editorDirty 就拒绝。结果是用户收到“请先保存或放弃”的错误，但项目实际上已经被删除，renderer 的 currentRoot/thread/viewer 还可能指向已不存在的对象。这是可由明确分支顺序确认的问题，无需读取真实用户数据。

建议所有入口统一执行删除命令：先检查编辑、摘要草稿、apply 和相关 job，处理保存队列，再显示含影响范围的确认；用户确认后重新核对目标与版本；服务成功后获取一致的最新 state 并整体更新当前选择。不要先局部改 arrays 再调用一个可能拒绝的 selectRoot。自动保存计数也应绑定 threadId，而不是让全局 serial/saved 在切换后误代表另一讨论。

### 6.4 持久化失败没有内存回滚：本轮已验证

saveThread:335–337 采用 candidate 副本，并在 persist 失败时恢复旧 this.data；deleteThread:345–346 和 removeProject:356–361 却直接修改 this.data 后 await persist，没有 catch 回滚。

本轮对真实 LocalWorkspace 方法注入只抛错的 persist，覆盖 load 以避免任何磁盘访问，使用合成 ID 和记录，得到：

| 操作 | 持久化结果 | 操作后的服务内存 |
| --- | --- | --- |
| deleteThread | 注入失败，调用确实抛错 | threads 从 1 变为 0，未恢复 |
| removeProject | 注入失败，调用确实抛错 | roots、threads 均变为 0，currentRoot 变为 null |

因此磁盘旧状态虽然在这次失败时可能仍保留，服务内存已经执行删除，下一次无关 persist 有可能把这次“失败的删除”写下去。原子 JSON 写入只保护磁盘替换过程，不提供业务事务或内存回滚。建议与 saveThread 一致：在副本上修改并验证，持久化成功后确认提交；或者失败立即恢复旧引用。还需覆盖重复删除、容量/权限失败及 UI 状态重载。

### 6.5 删除与迟到保存的竞态边界

deleteThread/removeProject 只要求非空字符串，没有 expectedRevision，也没有删除标记。service 串行队列保证执行先后，不能使一个迟到的逻辑命令自动失效。saveThread 对已存在的讨论有 revision 检查；一个已保存讨论被删除后，旧的非空 revision 保存通常会冲突，不能笼统声称所有删除都会被自动保存复活。

但从未落盘的讨论 revision 为 null。如果删除先到服务（此时删除是无记录的成功 no-op），随后首次 saveThread 带 revision:null 到达，服务会把它当新讨论创建。本轮用实际服务方法和无磁盘 persist 验证了这一顺序，最终 threads 为 1；真实 UI 是否命中该时序仍需专门竞态验收。

建议暂停目标的 debounce、排空/取消已有保存任务，为命令附 expectedRevision/项目版本，并记录 tombstone 或等价的对象生命周期版本，阻止迟到保存创建已经确认删除的 ID。若只允许前端控制生成任务，必须把这条边界写清楚；如要求主进程也严格拒绝 busy 对象，可增加按会话和对象 ID 的操作租约，导航/崩溃时释放，不能仅信任调用参数里一个 busy:false。

## 7. 第五维度：统一设计系统与基础交互

style.css:1–20 已定义黑金 token 并映射部分 SmartTheme 值，因此“RP 完全没有现代配色”不成立。但 agent.css:9–22 在 :host 内重新定义同名 token，例如 base 是 #0e0e11，文档根是 #121214；panel 分别 #141418 与 #1a1a1e。Shadow 内外的按钮、字体和密度也独立实现，形成两套相近但不一致的设计系统。主题切换还可能受原生内联变量、Custom CSS 和未映射 token 影响，需要决定“应用黑金皮肤”与“原生主题预设”的优先级。

style.css:28–56 用 body 模式前缀批量覆盖所有 .menu_button 和几乎全部 input/select/textarea，并大量使用 !important。这虽然快速统一颜色，但连 range、color、file、扩展自带输入等控件也可能被纳入同一外观规则；对插件和原生复杂控件有较宽影响面。与之相反，共享组件放进 Shadow 后又没有相应样式。这种“大范围强覆盖 + 局部漏覆盖”的结构，比单个颜色不匹配更值得治理。

建议建立无 body 依赖的 token 与组件样式资源，文档和 Shadow 显式加载同一套；限定应用-owned 控件和经登记的原生适配区域，原生 slider、Select2、checkbox、color picker 分别适配。统一按钮、图标、输入、字段行、菜单、Dialog、空态、状态条和 focus/reduced-motion 约定，同时保留模式各自的业务 DOM 与安全边界。

现有 settings、Agent drawer、原生 confirm 和 Popup 也不统一。Agent 删除使用同步 window.confirm，而小说等流程已经调用原生 Popup；建议由统一确认组件展示影响范围和恢复方式，避免阻塞主交互，同时沿用同一删除命令。不要为一次 UI 重构开放 Node 集成、remote、任意 eval 或文件路径 IPC。

沉浸模式同样有两份状态：body.dw-zen-mode 与 RoleplayUI.zen。index.js:407、473 会操作 body class，RoleplayUI 自己另存 sidebar/rightEntire，setActive 没有统一恢复这套状态。应由模式控制器管理进入/退出和焦点，不宜让多个模式共用一个全局 class 却各自缓存状态。该项是有代码依据的状态漂移风险，跨模式实际表现尚未验证。

## 8. 一次完整工程改造的建议清单

“一次解决”应指同一套设计与状态模型覆盖完整链路，按依赖顺序交付；不建议用一次大范围替换或一份巨型 !important 样式表完成。以下都只在 desktop 源码层实施，不以修改 vendor/upstream、build/backend 或正式安装副本代替开发。

| 顺序 | 工作包 | 具体交付 | 复杂度与维护影响 |
| --- | --- | --- | --- |
| 1 | 删除命令与事务 | 统一 UI 命令、影响清单、编辑/job/保存队列检查、expectedRevision、删除生命周期、失败回滚；分离断开授权与级联删除 | 中；优先消除数据风险，减少多入口重复逻辑 |
| 2 | 共享视觉基础 | 单一 token、固定 SVG 图标、通用按钮/字段/焦点/动效样式，同时支持文档和 Shadow | 中；降低后续维护成本，避免新增框架 |
| 3 | Agent 布局修复 | 一条自适应 footer、长名称与中心列断点、设置真正浮层与滚动、共享组件样式、可访问删除入口 | 中；保留现有生成/文件权限模型 |
| 4 | 菜单基础设施 | 行内/键盘/Electron 菜单共用命令；窄 IPC、稳定 ID、过期结果取消 | 中；增加少量主进程代码，不能扩大任意执行能力 |
| 5 | 设置领域适配层 | 按供应商映射连接/模型/参数；密钥独立状态；世界书、主题与预设复用原生领域接口；可靠保存反馈 | 高；复杂性主要来自原生副作用，需显式维护字段映射 |
| 6 | 统一 Settings Dialog | 九功能可寻址导航、常用字段现代代理、复杂页原节点兼容 Host、焦点/滚动/提交语义 | 高；需先验证 modal top layer、Select2 和扩展浮层 |
| 7 | RP presenter 与三栏 | 单一面板所有权、完整折叠/恢复、中心区宽度预算、角色行、消息和发送器视觉适配、常用参数栏 | 中高；保持原节点和原生 API，避免再建聊天引擎 |
| 8 | 分发与文档收尾 | 新资源进入 writing-extension.cjs 白名单；更新架构与有效设计决策，保留原生回退和明确适用边界 | 低；避免“源码有文件、实际启动未同步”的假修复 |

这些改造不会自动解决供应商模型兼容、长期记忆、插件任意脚本行为或 Electron 原生异常；它们不属于本次 UI 走查已证明的根因。性能方面优先避免每次输入都重建整页、无边界 MutationObserver 和重复 ResizeObserver 写读循环；无需仅为换肤引入 React/Vue 或重新打包一套酒馆前端。

## 9. 必须补齐的验收门槛

现有 tests/local-workspace.test.cjs:142–152 只覆盖成功删除讨论、移除空项目及目录仍存在，没有断言带多讨论项目的级联影响、持久化失败回滚、过期 revision、迟到保存、pending/history 访问恢复。smoke-agent-layout.cjs 检查三栏位置和编辑/生成，但没有测删除图标内容、footer 分行、右键和设置浮层几何。现有 RP 完整原生回归已覆盖正常动画、父级保留等，不应退回只用占位 DOM 的测试。

后续实施的验收应按真实失效方式组织：

1. Agent 图标在不依赖文档 FontAwesome 规则时仍有可见图形和可访问名称；Tab、Shift+F10、Escape 可完成列表操作；删除入口在焦点进入行时可见。
2. 两侧展开、长模型名/预设名、不同窗口宽度和缩放下，footer 无横向溢出，发送/停止始终可操作；Agent 设置不挤占主三栏，有界滚动、焦点还原和明确关闭行为。
3. 九个设置页均可从统一入口进入；原生 ID 唯一、节点身份与内部父链保留；切页和关闭不损失未保存输入；Select2、密钥管理、原生子 Popup、拖动/pin 与扩展浮层可用。
4. 合成设置按“修改 → 原生值同步 → 服务端持久化确认 → 重载恢复”验证。密钥空占位不触发删除；连接错误、保存 HTTP 错误与 HTTP 200 错误体不显示成功；不调用真实收费模型。
5. RP 在完整原生内容、正常动画下连续切九页、整体折叠/唤回、原生回退、切换模式；检查真正原生面板而非仅占位栏的 visible/focus/scroll 状态，覆盖背景缩放和消息编辑/swipe/附件。
6. 删除分别覆盖当前/其他讨论、当前/其他项目、job、apply、editorDirty、notesDraft、保存失败、pending 建议；确认取消零副作用，解除关联文案与实际行为一致，外部文档内容保持不变。
7. 使用真实服务方法对持久化失败、重复命令、过期 revision 和删除后迟到保存做确定性测试，断言失败后的服务内存和持久状态一致，不能只断言 Promise 抛错。

运行验收继续使用项目隔离目录、本机模拟 API、隐藏且不聚焦的窗口；文档走查没有必要为此重启默认 Electron。最终验收报告应分别说明静态检查、隔离运行和用户正式配置人工验收，不能用旧安装包或旧测试通过替代当前源码的 UI 接受结论。

