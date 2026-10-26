# E 盘工作区迁移验证（2026-10-22）

当前开发根：`E:\Github\sillytavern-desktop`。恢复副本：`C:\Users\wang\.codex\visualizations\2026\10\19\01a1557e-a693-71a3-a3f5-d7cb8a27e19b\sillytavern-desktop`。迁移采用复制、核验后切换入口，未删除或移动旧根；不是 clone/重新初始化，也没有用 HEAD、旧 EXE 或 source.zip 替换当前工作树。

复制基线为 main / `b3331d29ce7d086335220dde05c947bdb4e73a1f`，21 个已跟踪修改、51 个未跟踪文件。107 个完整工作树文件（包含本轮之前的 RP 修复）及 Git 历史、依赖、固定上游、离线后端/文件索引和独立 Node 已复制；共 50242 个文件、1543322587 字节，逐文件 SHA-256 一致，原工作树文件复制后再次核验。复制完成、文档更新前，新旧 Git 状态完全相同。此后仅本页及 AGENTS、README、HANDOFF、状态/架构/决策/迁移文档按新路径更新；应用代码未改变。

新根运行 74 文件语法检查、4 项 RP 单元测试及 6 项迁移隔离后端检查，均通过。后端检查使用新根下全新测试 home，校验复制的独立 Node、离线 ZIP 和文件索引，启动真实本机后端，验证 CSRF、完整原生前端，以及当前 RP/小说/Agent 扩展四个关键文件与源码字节一致，最后确认后端停止。未启动 Electron 或用户浏览器，未请求真实或收费模型 API；不把本次迁移验证冒称完整 Electron UI 验收。

默认 `%LOCALAPPDATA%\SillyTavernDesktop`、其中的配置/聊天/角色/插件/小说/Agent 状态、外部授权文档、D:\sillyTavern desktop 正式安装均未迁移，配置指针未修改。默认桌面 settings.json 与正式 EXE 的存在性、长度、修改时间迁移前后相同；这不是私人数据逐字节审计。未读取或输出密钥/故事正文。

旧 `dist/`（历史安装包）、`test-results/`（旧私有测试资料）、`.release/` 和签名文件、本机路径文档、旧构建临时辅助脚本与旧源码归档未复制，均保留原处。新根保留足够的依赖、build/backend 暂存、runtime、backend.zip/index 和 notices，可离线日常启动；未执行 npm ci、prepare:vendor 或打包。固定上游版本不变。

入口：桌面“SillyTavern 源码开发版.lnk”、新根“启动源码开发版.lnk”、新根 dist/“启动测试版.lnk”由新根既有脚本生成并回读目标/参数/工作目录；旧桌面链接在新根 dist/shortcut-backups 保留备份。打开前先正常退出其他酒馆，源码版与安装版默认仍共用数据。旧根自己的入口保留作回退，后续不要混用或在旧根开发。

详细复制清单在忽略的 `migration-20261022.local.json`；隔离后端结果在 `test-results/migration-backend.local.json`；快捷方式回读结果在 `test-results/migration-shortcuts.local.json`。C 盘 Documents 的交接 README/AGENTS 已指向新根，其 `.git` 保留。Codex 应用中“软件定制化项目”项目目录已核对为 E:\Github，后续命令在其 sillytavern-desktop 子目录执行。
