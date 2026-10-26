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
      if (separateDesktopBackend(row.CommandLine, installation)) {
        const args = [...row.CommandLine.matchAll(/"([^"\r\n]*)"|([^\s"]+)/g)].map(match => match[1] ?? match[2]);
        // Resolve no aliases through junctions/symlinks when proving separation.
        try {
          const targets = [path.dirname(args[2]), args[args.indexOf('--dataRoot') + 1], args[args.indexOf('--configPath') + 1], installation.root, installation.dataRoot, installation.configPath];
          const canonical=[];for(const target of targets)canonical.push((await fs.realpath(await noLinks(target))).toLowerCase());
          const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
          // realpath also prevents differing Windows short-name spellings from
          // disguising the same existing data directory as a separate profile.
          if(!overlaps(canonical[0],canonical[3])&&!overlaps(canonical[1],canonical[4])&&canonical[2]!==canonical[5])continue;
        } catch { /* Cannot prove isolation. */ }
      }
      throw fail('检测到已有 Node 后端服务。请先用原方式关闭旧酒馆后重试；本应用不会复用或终止其他进程。');
    }
  }
}
function separateDesktopBackend(command, installation) {
  // Only recognize our unambiguous supervisor command shape. Relative/global/unknown
  // native launches remain conservative. Repeated flags cannot prove separation.
  if (typeof command !== 'string' || !/^(?:"[^"\r\n]*"|[^\s"\r\n]+)(?:\s+(?:"[^"\r\n]*"|[^\s"\r\n]+))*$/.test(command)) return false;
  const args = [...command.matchAll(/"([^"\r\n]*)"|([^\s"]+)/g)].map(match => match[1] ?? match[2]);
  const normalize = value => path.win32.resolve(value).toLowerCase();
  const absolute = value => typeof value === 'string' && /^[a-z]:[\\/]/i.test(value);
  if (!absolute(args[0]) || !absolute(args[1]) || !/[\\/](?:supervisor|services)[\\/]runner\.cjs$/i.test(args[1]) || !absolute(args[2]) || !/[\\/]server\.js$/i.test(args[2])) return false;
  const flag = name => { const indices = args.flatMap((arg, index) => arg === name ? [index] : []); return indices.length === 1 && absolute(args[indices[0] + 1]) ? args[indices[0] + 1] : null; };
  const data = flag('--dataRoot'), config = flag('--configPath');
  if (!data || !config || args.includes('--global') || args.some(arg => arg.startsWith('--dataRoot=') || arg.startsWith('--configPath='))) return false;
  const expected = { '--configPath': config, '--dataRoot': data, '--browserLaunchEnabled': 'false', '--listen': 'false', '--listenAddressIPv4': '127.0.0.1', '--enableIPv4': 'true', '--enableIPv6': 'false', '--disableCsrf': 'false', '--ssl': 'false' };
  if (args.length !== 23) return false;
  const visited = new Set();
  for (let n = 3; n < args.length; n += 2) { const key = args[n]; if (visited.has(key) || (key === '--port' ? !/^\d{1,5}$/.test(args[n+1]) : expected[key] === undefined || expected[key] !== args[n+1])) return false; visited.add(key); }
  const overlaps = (a,b) => { a=normalize(a); b=normalize(b); return a===b || a.startsWith(b+'\\') || b.startsWith(a+'\\'); };
  return !overlaps(path.win32.dirname(args[2]), installation.root) && !overlaps(data, installation.dataRoot) && normalize(config) !== normalize(installation.configPath);
}
function argsFor(i, port) {
  return [path.join(i.root,'server.js'), ...(i.mode === 'global' ? ['--global'] : ['--configPath',i.configPath,'--dataRoot',i.dataRoot]),
    '--browserLaunchEnabled','false','--listen','false','--listenAddressIPv4','127.0.0.1','--enableIPv4','true','--enableIPv6','false',
    '--disableCsrf','false','--ssl','false','--port',String(port)];
}
module.exports = { inspect, discover, assertNoExternalServer, argsFor, separateDesktopBackend };
