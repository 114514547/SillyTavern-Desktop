'use strict';
const { fs, path, exists, noLinks, fail, exec } = require('./files.cjs');
const yaml = require('yaml');
const REQUIRED_FLAGS = ['configPath', 'dataRoot', 'browserLaunchEnabled', 'listen', 'enableIPv4', 'enableIPv6', 'disableCsrf', 'ssl', 'port'];
async function inspect(root, options = {}) {
  root = await noLinks(root);
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); } catch { throw fail('该文件夹没有有效的 package.json。'); }
  if (pkg.name !== 'sillytavern' || !/^1\.(\d+)\./.test(pkg.version)) throw fail('请选择原版 SillyTavern 安装目录。');
  for (const file of ['server.js', 'src/command-line.js', 'public/index.html', 'default/config.yaml']) {
    if (!(await exists(path.join(root, file)))) throw fail('SillyTavern 安装不完整，缺少后端或前端资源。');
  }
  const parser = await fs.readFile(path.join(root, 'src/command-line.js'), 'utf8');
  if (!REQUIRED_FLAGS.every(flag => new RegExp(`\\.option\\(['\"]${flag}['\"]`).test(parser))) throw fail('此版本缺少必要的安全启动参数，请继续使用原启动方式或选择独立副本。');
  if (!(await exists(path.join(root, 'node_modules/express/package.json')))) throw fail('该安装缺少 Node 运行依赖。桌面版不会自动修改旧安装，请先用原安装方式补齐依赖。');
  if (!['standalone', 'global'].includes(options.mode || 'standalone')) throw fail('启动方式无效。');
  const globalMode = options.mode === 'global';
  // env-paths on Windows uses LOCALAPPDATA, not APPDATA. Match actual upstream.
  const globalBase = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData/Local'), 'SillyTavern', 'Data');
  const configPath = await noLinks(globalMode ? path.join(globalBase, 'config.yaml') : path.resolve(root, options.configPath || 'config.yaml'));
  let config = {};
  if (await exists(configPath)) {
    try { config = yaml.parse(await fs.readFile(configPath, 'utf8'), { maxAliasCount: 50 }); } catch { throw fail('config.yaml 无法解析。请先修复配置，桌面版未改写原文件。'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw fail('config.yaml 必须是有效的 YAML 配置对象。');
  }
  const dataRoot = await noLinks(globalMode ? path.join(globalBase, 'data') : path.resolve(root, options.dataRoot || config.dataRoot || './data'));
  const launcherText = (await Promise.all(['Start.bat','start.sh','package.json'].map(f => fs.readFile(path.join(root, f), 'utf8').catch(() => '')))).join('\n');
  return { root, version: pkg.version, mode: globalMode ? 'global' : 'standalone', configPath, dataRoot,
    remoteWasEnabled: config.listen === true, pluginEnabled: config.enableServerPlugins === true,
    port: Number(config.port) || 8000,
    hints: { globalLauncher: /(?:node[^\r\n]*server(?:-global)?\.js[^\r\n]*--global|node[^\r\n]*server-global\.js)/.test(launcherText) },
    config };
}
async function discover() {
  const home = require('node:os').homedir();
  const bases = [home, path.join(home,'Desktop'), path.join(home,'Documents'), 'D:/', 'E:/', 'D:/AI', 'D:/code', 'E:/03_Projects'];
  const candidates = new Set();
  for (const base of bases) {
    for (const entry of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && /silly|tavern|酒馆/i.test(entry.name)) candidates.add(path.join(base, entry.name));
    }
  }
  const found = [];
  for (const root of candidates) { try { const i = await inspect(root); found.push({ root, version: i.version, globalLauncher: i.hints.globalLauncher }); } catch { /* Invalid candidates are never modified. */ } }
  return found;
}
async function assertNoExternalServer(installation) {
  if (process.platform !== 'win32') return;
  let rows;
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command', "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction Stop | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    rows = JSON.parse(stdout || '[]');
  } catch { throw fail('无法读取正在运行的 Node 服务。为避免同时写数据，请关闭旧酒馆后重试，或使用全新独立配置。'); }
  for (const row of (Array.isArray(rows) ? rows : [rows])) {
    if (row.ProcessId === process.pid) continue;
    if (!row.CommandLine) throw fail('存在无法确认归属的 Node 进程，无法安全启动旧安装。请关闭旧酒馆，或改用全新独立配置。');
    const cmd = row.CommandLine.toLowerCase();
    if (/server(?:-global)?\.js/.test(cmd) || cmd.includes(installation.dataRoot.toLowerCase())) {
      throw fail('检测到已有 Node 后端服务。请先用原方式关闭旧酒馆后重试；本应用不会复用或终止其他进程。');
    }
  }
}
function argsFor(i, port) {
  return [path.join(i.root,'server.js'), ...(i.mode === 'global' ? ['--global'] : ['--configPath',i.configPath,'--dataRoot',i.dataRoot]),
    '--browserLaunchEnabled','false','--listen','false','--listenAddressIPv4','127.0.0.1','--enableIPv4','true','--enableIPv6','false',
    '--disableCsrf','false','--ssl','false','--port',String(port)];
}
module.exports = { inspect, discover, assertNoExternalServer, argsFor };
