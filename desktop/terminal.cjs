// The terminal panel's shells: the ones installed on this PC, each run in a pseudo-terminal (node-pty) in the app's
// main process. The panel (terminal.html) draws them; a shell outlives the panel being hidden and the view reloading,
// with the end of its output kept to show again. A shell cannot outlive the app, so the tabs are kept in a file
// (their split panes, each one's shell, folder, name and the end of its output) and started again, fresh, in the
// folder each was last in, the next time the app opens the panel.
// Desktop app only — the page in a browser never reaches a shell.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFileSync, execFile } = require('node:child_process')
const crypto = require('node:crypto')

const WIN = process.platform === 'win32'
// The environment the app was started with, taken before the server sets its PORT and MONITOR_HOME: a dev server
// started in the terminal must not take the monitor's port, nor a monitor started there its data folder
const ENV = { ...process.env }
for (const k of Object.keys(ENV)) if (k === 'PORT' || /^(MONITOR_|ELECTRON_)/i.test(k)) delete ENV[k]

// node-pty is unpacked beside app.asar (its helper programs and its worker must be real files), so it is loaded from there
let pty = null
const ptyModule = () => pty || (pty = require(path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'node_modules', 'node-pty')))

const exists = (f) => { try { return !!f && fs.statSync(f).isFile() } catch { return false } }
function which(name) {
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (d && exists(path.join(d, name))) return path.join(d, name)
  return null
}

/* ── the folder a shell is in: each says it at every prompt, as in Windows Terminal and VS Code ── */
// PowerShell: the prompt it has (the profile's, oh-my-posh…) wrapped to first write OSC 9;9 with the folder; sent
// encoded, so no quoting can break it
// and, before the first prompt reads it, the pane's own history file instead of the one every PowerShell shares
const PS_HOOK = Buffer.from(
  "if ($env:CREW_HISTFILE -and (Get-Module PSReadLine)) { Set-PSReadLineOption -HistorySavePath $env:CREW_HISTFILE }; " +
  "$global:__crewPrompt = $function:prompt; function global:prompt { $l = $executionContext.SessionState.Path.CurrentLocation; " +
  "if ($l.Provider.Name -eq 'FileSystem') { [Console]::Write([char]27 + ']9;9;\"' + $l.ProviderPath + '\"' + [char]7) }; & $global:__crewPrompt }",
  'utf16le').toString('base64')
// Command Prompt: the same in its PROMPT ($e is Esc, $P the folder); Git Bash: OSC 7 with its /c/... folder
const CMD_PROMPT = '$e]9;9;$P$e\\' + (process.env.PROMPT || '$P$G')
// (history -a: each command written down at once, so a shell ended with the app keeps what was typed in it)
const BASH_HOOK = 'history -a; printf "\\033]7;file://localhost%s\\007" "$PWD"'

// the shells found here, the first one the default; looked for once
let found = null
function shells() {
  if (found) return found
  const list = []
  const add = (id, name, file, args = [], env = {}) => { if (exists(file) && !list.some((s) => s.file.toLowerCase() === file.toLowerCase())) list.push({ id, name, file, args, env }) }
  if (WIN) {
    const sys = process.env.SystemRoot || 'C:\\Windows'
    const progs = [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)
    const ps = ['-NoLogo', '-NoExit', '-EncodedCommand', PS_HOOK]
    add('pwsh', 'PowerShell 7', which('pwsh.exe') || progs.map((p) => path.join(p, 'PowerShell', '7', 'pwsh.exe')).find(exists), ps)
    add('powershell', 'Windows PowerShell', path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ps)
    add('cmd', 'Command Prompt', process.env.ComSpec || path.join(sys, 'System32', 'cmd.exe'), [], { PROMPT: CMD_PROMPT })
    // Git for Windows' bash, not System32\bash.exe (that one is WSL's)
    const git = which('git.exe')
    const bash = [...progs.map((p) => path.join(p, 'Git', 'bin', 'bash.exe')), git && path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')].find(exists)
    add('gitbash', 'Git Bash', bash, ['--login', '-i'], { PROMPT_COMMAND: BASH_HOOK + (process.env.PROMPT_COMMAND ? '; ' + process.env.PROMPT_COMMAND : '') })
    // wsl.exe is there even with no Linux installed: offered only when it lists one
    const wsl = path.join(sys, 'System32', 'wsl.exe')
    if (exists(wsl)) {
      try { if (execFileSync(wsl, ['-l', '-q'], { timeout: 4000, windowsHide: true }).toString('utf16le').replace(/\0/g, '').trim()) add('wsl', 'WSL', wsl) } catch {}
    }
  } else {
    // the login shell first, then the others in /etc/shells; started as login shells, as a terminal app does
    let lines = []
    try { lines = fs.readFileSync('/etc/shells', 'utf8').split('\n').map((x) => x.trim()).filter((x) => x.startsWith('/')) } catch {}
    for (const f of [process.env.SHELL, ...lines]) {
      const base = f && path.basename(f)
      if (base && !list.some((s) => s.id === base)) add(base, base, f, ['-l'])
    }
    if (!list.length) add('sh', 'sh', '/bin/sh')
  }
  return (found = list)
}

// the folder in what a shell printed: OSC 9;9 "C:\..." or OSC 7 file://host/path (Git Bash's /c/... made C:\...)
const SAYS_DIR = /\x1b\]9;9;"?([^"\x07\x1b]+)"?(?:\x07|\x1b\\)|\x1b\]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g
function dirIn(d) {
  let found = null
  for (const m of d.matchAll(SAYS_DIR)) {
    if (m[1]) found = m[1]
    else { let p = m[2]; try { p = decodeURIComponent(p) } catch {} found = WIN ? (/^\/([a-z])(\/|$)/i.test(p) ? p.replace(/^\/([a-z])/i, (_, l) => l.toUpperCase() + ':').replace(/\//g, '\\') : null) : p }
  }
  return found
}
// on a Mac or Linux the shell's own folder can be asked of the system (zsh says nothing by itself)
function probeDirs() {
  if (WIN) return Promise.resolve()
  return Promise.all([...terms.values()].map((t) => new Promise((done) => {
    const pid = t.p.pid
    if (process.platform === 'linux') { try { t.dir = fs.readlinkSync('/proc/' + pid + '/cwd') } catch {} done(); return }
    execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 }, (err, out) => {
      const line = !err && String(out).split('\n').find((l) => l.startsWith('n/'))
      if (line) t.dir = line.slice(1)
      done()
    })
  })))
}

const terms = new Map()   // id → { p, id, hid, shell, name, title, cwd (started in), dir (in now), buf }

/* ── each pane's own command history (↑), kept across restarts: PowerShell and Git Bash; cmd keeps none ── */
let histDir = null
// A pane's history starts as the last of the history every shell of its kind shares (PowerShell's PSReadLine file,
// ~/.bash_history), so ↑ in a new pane brings back recent commands as before; from then on it is the pane's own
const SHARED_HISTORY = {
  ps: path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
  bash: path.join(os.homedir(), '.bash_history'),
}
function seedHistory(file, shell) {
  if (fs.existsSync(file)) return
  try {
    const all = fs.readFileSync(shell === 'gitbash' ? SHARED_HISTORY.bash : SHARED_HISTORY.ps, 'utf8').split(/\r?\n/)
    // the last thousand lines, not starting in the middle of a command PowerShell wrote over several (each line but
    // its last ends with a backtick)
    let start = Math.max(0, all.length - 1000)
    while (start > 0 && start < all.length && all[start - 1].endsWith('`')) start++
    fs.writeFileSync(file, all.slice(start).join('\n').replace(/\n*$/, '\n'))
  } catch {}
}
const histFile = (hid, shell) => histDir && /^[a-f0-9]{8,32}$/.test(hid) && (shell === 'gitbash' ? path.join(histDir, hid + '.bash') : /^(pwsh|powershell)$/.test(shell) ? path.join(histDir, hid + '.txt') : null)
const KEEP = 200 * 1024   // the end of each one's output, for a panel drawn again
let nextId = 1
let send = () => {}       // set by the app: (event, ...args) to the panel
// output goes to the panel in small batches, not chunk by chunk
const pending = new Map()
function flush() {
  for (const [id, d] of pending) send('data', id, d)
  pending.clear()
}

/* ── the tabs as the panel shows them: each a group of split panes ── */
let layout = []           // [{ ids, dir: 'row' | 'column', sizes, pinned }]
function setLayout(groups) {
  if (!Array.isArray(groups)) return
  layout = groups.filter((g) => g && Array.isArray(g.ids)).map((g) => ({
    ids: g.ids.filter((id) => terms.has(id)), dir: g.dir === 'column' ? 'column' : 'row',
    sizes: Array.isArray(g.sizes) ? g.sizes.map(Number).filter((n) => n > 0) : [], pinned: !!g.pinned,
  })).filter((g) => g.ids.length)
  save()
}
// the layout with every shell in it (one the panel has not placed yet, on a tab of its own)
function groupsNow() {
  const placed = new Set(layout.flatMap((g) => g.ids))
  return [...layout.map((g) => ({ ...g, ids: g.ids.filter((id) => terms.has(id)) })).filter((g) => g.ids.length),
    ...[...terms.keys()].filter((id) => !placed.has(id)).map((id) => ({ ids: [id], dir: 'row', sizes: [], pinned: false }))]
}

/* ── kept across restarts ── */
let keepFile = null       // set by the app, in its settings folder
let stopping = false      // the app quitting: its shells' ends are not tabs closed
let restored = false
const SAVED = 64 * 1024   // the end of each one's output kept in the file
let saveTimer = null
function save() {
  clearTimeout(saveTimer); saveTimer = null
  if (!keepFile) return
  const tabs = groupsNow().map((g) => ({
    dir: g.dir, sizes: g.sizes, pinned: g.pinned,
    panes: g.ids.map((id) => terms.get(id)).map(({ hid, shell, title, cwd, dir, buf }) => ({ hid, shell, title, cwd: dir || cwd, buf: buf.slice(-SAVED) })),
  }))
  try { fs.mkdirSync(path.dirname(keepFile), { recursive: true }); fs.writeFileSync(keepFile, JSON.stringify({ v: 2, tabs })) } catch {}
}
// output only says the file is due: written every few seconds, so an app killed (an update installing) loses little
const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(() => probeDirs().then(save), 4000) }
// The tabs of the last run, handed out once (the first time the panel asks, with nothing running): the panel draws
// each pane's old output and starts its shell again under it (open with inherit). Nothing to hand out after a shell
// has been started. A file from before the split panes held one shell per tab.
function saved() {
  if (restored) return []
  restored = true
  let kept = null
  try { kept = JSON.parse(fs.readFileSync(keepFile, 'utf8')) } catch {}
  const tabs = Array.isArray(kept) ? kept.map((x) => ({ pinned: !!x?.pinned, dir: 'row', panes: [x] })) : Array.isArray(kept?.tabs) ? kept.tabs : []
  return tabs.filter((g) => g && Array.isArray(g.panes) && g.panes.length).slice(0, 12)
    .map((g) => ({ ...g, panes: g.panes.filter((p) => p && typeof p === 'object').slice(0, 4) }))
}

// inherit: the shell starts where the panel's cursor is, under the old output drawn there, instead of on a cleared
// screen (Windows' console asks the panel where its cursor is; elsewhere a shell never clears it)
// prior: a restarted pane's output from before, kept above a line with the time it came back (no words: printed once,
// it would stay in the language of that moment), so it lasts through the next restart and a panel drawn again too
function open({ shell, cwd, cols, rows, title, inherit, hid, prior } = {}) {
  const all = shells()
  const sh = all.find((s) => s.id === shell) || all[0]
  if (!sh) throw new Error('No shell found')
  let dir = os.homedir()
  try { if (cwd && fs.statSync(cwd).isDirectory()) dir = cwd } catch {}
  // a pane started again keeps its history; a new one starts its own
  if (typeof hid !== 'string' || !/^[a-f0-9]{8,32}$/.test(hid)) hid = crypto.randomBytes(8).toString('hex')
  const hist = histFile(hid, sh.id)
  if (hist) { try { fs.mkdirSync(histDir, { recursive: true }) } catch {} seedHistory(hist, sh.id) }
  const histEnv = !hist ? {} : sh.id === 'gitbash' ? { HISTFILE: hist.replace(/\\/g, '/') } : { CREW_HISTFILE: hist }
  const p = ptyModule().spawn(sh.file, sh.args, {
    name: 'xterm-256color', cols: Math.max(2, cols | 0 || 80), rows: Math.max(1, rows | 0 || 24), cwd: dir,
    env: { ...ENV, ...sh.env, ...histEnv, TERM_PROGRAM: 'ELOP-Crew', COLORTERM: 'truecolor' },
    ...(WIN && inherit ? { conptyInheritCursor: true } : {}),
  })
  const id = nextId++
  const t = { p, id, hid, lastAt: Date.now(), shell: sh.id, name: sh.name, title: String(title || '').trim().slice(0, 40), cwd: dir, dir: '', buf: '' }
  if (typeof prior === 'string' && prior) {
    const now = new Date(), hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    t.buf = prior.slice(-SAVED) + '\x1b[0m\r\n\x1b[2m── ↻ ' + hm + ' ──\x1b[0m\r\n'
  }
  terms.set(id, t)
  p.onData((d) => {
    t.buf += d.replace(/\x1b\[6n/g, '')
    t.lastAt = Date.now()
    if (t.buf.length > KEEP) { const cut = t.buf.indexOf('\n', t.buf.length - KEEP); t.buf = t.buf.slice(cut < 0 ? t.buf.length - KEEP : cut + 1) }
    if (!pending.size) setTimeout(flush, 8)
    pending.set(id, (pending.get(id) || '') + d)
    const now = d.includes('\x1b]') && dirIn(d)
    if (now && now !== t.dir) { t.dir = now; send('cwd', id, now) }
    saveSoon()
  })
  p.onExit(({ exitCode }) => {
    flush(); terms.delete(id); send('exit', id, exitCode)
    if (stopping) return
    save()
    if (hist) setTimeout(() => fs.rm(hist, { force: true }, () => {}), 1500)   // closed for good: its history goes too
  })
  restored = true   // a shell started before any was restored: the old ones are not brought back over it
  return { id, shell: t.shell, name: t.name, title: t.title, cwd: t.cwd, buf: t.buf }
}
const list = () => [...terms.values()].map(({ id, shell, name, title, cwd, dir, buf }) => ({ id, shell, name, title, cwd: dir || cwd, buf }))
// For the monitor's assistant: the tabs and their panes, each shell with its name, folder and when it last printed
function info() {
  return groupsNow().map((g, i) => ({
    tab: i + 1, pinned: g.pinned, panes: g.ids.map((id) => terms.get(id)).map((t) => ({ id: t.id, shell: t.name, title: t.title, folder: t.dir || t.cwd, lastAt: t.lastAt })),
  }))
}
// the last lines a shell printed, from what was kept (the panel's own screen is better: the app asks it first);
// escape sequences dropped, a line redrawn in place kept as last drawn
function tail(id, n = 60) {
  const t = terms.get(id)
  if (!t) return null
  const text = t.buf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b[()][0-9A-Za-z]|\x1b[=>]/g, '')
  const lines = text.split('\n').map((l) => l.split('\r').filter(Boolean).pop() || '').map((l) => l.trimEnd())
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines.slice(-n)
}
// the panel's output cleared: not drawn again from what was kept either
function clearBuf(id) { const t = terms.get(id); if (t) { t.buf = ''; save() } }
function rename(id, title) { const t = terms.get(id); if (t) { t.title = String(title || '').trim().slice(0, 40); save() } }
function write(id, data) { const t = terms.get(id); if (t && typeof data === 'string') t.p.write(data) }
function resize(id, cols, rows) { const t = terms.get(id); if (t && cols > 1 && rows > 0) { try { t.p.resize(cols | 0, rows | 0) } catch {} } }
function close(id) { const t = terms.get(id); if (t) { try { t.p.kill() } catch {} } }
// the app quitting: the tabs are written down as they are, then the shells end
function closeAll() { if (stopping) return; save(); stopping = true; for (const t of terms.values()) { try { t.p.kill() } catch {} } terms.clear() }

module.exports = {
  shells, open, list, write, resize, rename, clearBuf, close, closeAll, saved, setLayout, layout: groupsNow, info, tail, has: (id) => terms.has(id), count: () => terms.size,
  onSend: (fn) => { send = fn }, keepIn: (file) => { keepFile = file; histDir = path.join(path.dirname(file), 'terminal-history') },
}
