# 技术决策（2026-10-20）

上游固定为官方 release 分支 SillyTavern 1.19.0，提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`。保存上游锁文件及 SHA-256，不跟踪 staging。桌面外壳 0.1.0 使用 Electron 44.9.0、electron-builder 26.15.3、Node 24.15.0 x64。上游源码没有补丁。

已阅读上游 `src/electron/index.js`。原入口在 Electron 主进程内导入全局服务，仅提供基础窗口。采用独立封装，保留原版前端，把服务放入独立官方 Node 进程，以便进程归属校验、安全退出、离线打包和数据路径管理。

直接读取 `src/command-line.js`，确认支持 `--configPath`、`--dataRoot`、`--global`、`--browserLaunchEnabled`、`--listen`、`--enableIPv4`、`--enableIPv6`、`--disableCsrf`、`--ssl`、`--port`。启动只传参数数组，不编辑用户原 config.yaml；明确覆盖 `--disableCsrf false`、`--ssl false`、IPv4 回环和禁用自动浏览器。后端自身可能给 config.yaml 补齐默认值，这是上游行为，启动页已说明。

当前上游的 `env-paths('SillyTavern', {suffix:''}).data` 在 Windows 上是 `%LOCALAPPDATA%\SillyTavern\Data`，因此全局配置为其中的 `config.yaml`、数据为 `data`。任务书提到 `%APPDATA%\SillyTavern`，但不能依其文字覆盖实际源码。自定义旧位置通过独立模式的自定义绝对路径使用；不因为发现目录就切换全局模式。

旧版 `public/characters` 会使上游执行文件移动。直接模式拒绝触发；复制模式只在完整校验备份之后允许新副本执行上游迁移。若同时存在旧版和新版角色目录则拒绝自动合并。

安装资源位于 extraResources，后端压缩包、逐文件哈希及官方 Node 文件哈希在展开前后校验。每个独立配置拥有自己的后端版本目录，避免多个配置共享可写插件。配置和数据与后端分离，全部位于用户目录。

守护进程使用独立 Windows 进程组和父子 IPC。外壳崩溃使 IPC 断开，守护进程通知 runner 发出 JS SIGTERM，调用上游退出处理；9 秒超时只清理自己持有的子进程句柄。runner 与守护进程都不提供 HTTP 管理接口。原始后端 stdout/stderr 直接丢弃，只识别固定错误代码，因此聊天内容、插件打印、密钥不会进入桌面诊断日志。

目标数据目录使用排他目录锁，所有者从外壳交给守护进程。存活锁拒绝第二写入者；无法证明死亡的锁保留。Windows 通过进程命令行检查现有 Node 后端，无法确定则拒绝启动旧安装。HTTP 就绪必须同时通过 CSRF token、子进程存活、Get-NetTCPConnection 的监听 PID 和回环地址校验；不会附着到任意 localhost 服务。临时空闲端口有绑定竞争，所以启动识别冲突后最多重试三次。

启动页和酒馆使用不同的 BrowserWindow。只有本地启动页加载受限 preload，IPC 校验 webContents、顶层 frame 和精确 URL；酒馆页没有 preload。开启沙箱、上下文隔离和同源安全，禁用 Node 集成。未知导航阻止，外部链接仅限用户确认的 HTTPS。V1 禁止摄像头、麦克风等网页权限；文字、上传和原版文件导入不依赖这些权限。

0.2.0 已增加 GitHub Releases 桌面发布源和用户确认的 NSIS 更新流程。采用稳定 electron-updater 6.8.9，保留现有 electron-builder 26.15.3，不为获取 v27 的新功能切换未发布的主版本。v26 更新器的哈希只保护下载文件，因此额外实现小型 Ed25519 签名清单，固定客户端信任公钥，再验证版本、渠道、架构、仓库、酒馆基线以及元数据/安装包 SHA-512。默认关闭 autoDownload 和 autoInstallOnAppQuit，避免绕过备份。

更新窗口独立于原版页面，仅提供 state/check/download/cancel/install 五个受限 IPC。下载和检查不停止服务；明确确认安装后停止后端、备份全部已保存配置及设置快照、再次验证安装包，才调用标准 quitAndInstall。当前酒馆后端版本与已展开实例不变。后端跨版本迁移及自动二进制回退仍未实现，不用配置指针回退冒充程序降级。

发布私钥只在本地受限目录和 GitHub Actions 加密 secret 中。仓库与所有交付归档只包含公钥。版本标签触发 CI 构建及测试，先上传草稿全部资产后才公开。原版官方版本查询仍保留为只读辅助入口，不作为本项目的软件更新源。

参考：

- https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127
- https://docs.sillytavern.app/administration/config-yaml/
- https://www.electronjs.org/docs/latest/tutorial/security/
- https://www.electron.build/nsis/
