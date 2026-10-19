# 更新与发布维护

桌面版本、Electron 和内置运行时由本项目测试后统一发布。酒馆固定为 vendor/manifest.json 中的版本和提交，不直接跟随上游升级；签名清单若改变酒馆基线，0.2.x 更新器会拒绝自动安装，需要专门的数据迁移设计。

## 使用者

0.1.0 尚无更新器，需手动运行一次 0.2.0 安装包。之后在“帮助 → 软件更新”检查并下载。下载不会停止酒馆；只有明确确认“备份并更新”才停止后端、创建本地完整校验备份并调用 NSIS。普通退出不会触发安装，关闭更新窗口也不等于确认安装。

安装器仍是完整安装器，下载器可以尝试差分下载，缺少旧安装器缓存时会退回完整下载；不保证每次只下载少量变更。遇到断网、未发布版本、签名不符、哈希不符或备份失败时保留当前版本，重新检查后可重试。

更新不会改写已展开的酒馆后端和个人数据。更新前备份当前及全部已保存独立配置，快照保存在数据根的 backups 与 updates 目录。配置回退通过启动设置或备份新副本完成；桌面程序回退使用旧版安装器。旧安装包保留在本地 dist/previous/0.1.0，未自动执行系统降级。

自定义 --desktop-home 用户更新完成后用原快捷方式/启动参数打开；默认目录用户由更新器请求自动重启。测试没有覆盖系统安装器的真实覆盖安装行为，不能把本地下载测试视作真实升级成功。

## 维护者发布

仓库为 `114514547/SillyTavern-Desktop`。普通 main 提交只更新源码；只有 `v<package.json版本>` 标签或手动工作流会构建发布。

```powershell
npm ci
npm run prepare:vendor
npm run check
npm test
npm run test:updates
npm run test:integration
npm run build:win
npm run release:sign
npm run source:zip
```

正式资产包括 `SillyTavern-Desktop-Setup-x64.exe`、其 `.blockmap`、`latest.yml`、`desktop-update.json` 和对应源码 ZIP。先创建草稿，上传全部资产，再转为正式发布，避免客户端看到半个版本。不要覆盖同版本已有发布文件，修复后增加版本号。

electron-updater 6.8.9 负责标准 NSIS 元数据、下载、缓存和安装交接。我们额外验证 Ed25519 签名的 desktop-update.json，再核对下载器提供的元数据，下载完成及备份后各检查一次完整安装包 SHA-512。签名中的仓库、渠道、架构、正式版本和后端基线都必须匹配。客户端不需要 GitHub token；公开源不存放聊天、API 配置或私人备份。

签名私钥只在维护者本地 `.release/update-private.pem` 和 GitHub Actions 的加密 secret `ST_UPDATE_SIGNING_KEY` 内。公钥固定在 resources/update-policy.json。首次建项目时 `npm run update:key` 生成，后续构建绝不可重新生成；丢失私钥应从安全备份恢复，不能悄悄更换公钥，否则旧客户端无法认证新版本。不要打印、提交、打包或上传私钥。fork 项目应明确更换仓库和信任配置，而非冒充原发布者。

本地维护脚本 `scripts/github-release.cjs` 通过 Git Credential Manager 的已有 GitHub 凭据访问官方 API，凭据只在进程内使用，不写文件。create 创建仓库，secret 使用 GitHub 公钥加密写入发布 secret，publish 从本地构建创建草稿并逐个上传后发布。CI 直接使用 GitHub 提供的短期 GITHUB_TOKEN，不需要维护者个人 token。

目前没有自动二进制降级或热替换。安装前检查和备份可以防止损坏包执行及数据覆盖；安装器启动后的 Windows 权限、系统锁定或磁盘问题仍可能要求手动重开软件/使用旧安装包。新版本健康启动后记录更新完成，不自动删除备份。
