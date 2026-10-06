// The terminal panel's shells: the ones installed on this PC, each run in a pseudo-terminal (node-pty) in the app's
// main process. The panel (terminal.html) draws them; a shell outlives the panel being hidden and the view reloading,
// with the end of its output kept to show again. A shell cannot outlive the app, so the tabs are kept in a file
// (shell, folder, name, the end of the output) and started again, fresh, the next time the app opens the panel.
// Desktop app only — the page in a browser never reaches a shell.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

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

// the shells found here, the first one the default; looked for once
let found = null
function shells() {
  if (found) return found
  const list = []
  const add = (id, name, file, args = []) => { if (exists(file) && !list.some((s) => s.file.toLowerCase() === file.toLowerCase())) list.push({ id, name, file, args }) }
  if (WIN) {
    const sys = process.env.SystemRoot || 'C:\\Windows'
    const progs = [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)
    add('pwsh', 'PowerShell 7', which('pwsh.exe') || progs.map((p) => path.join(p, 'PowerShell', '7', 'pwsh.exe')).find(exists), ['-NoLogo'])
    add('powershell', 'Windows PowerShell', path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo'])
    add('cmd', 'Command Prompt', process.env.ComSpec || path.join(sys, 'System32', 'cmd.exe'))
    // Git for Windows' bash, not System32\bash.exe (that one is WSL's)
    const git = which('git.exe')
    const bash = [...progs.map((p) => path.join(p, 'Git', 'bin', 'bash.exe')), git && path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')].find(exists)
    add('gitbash', 'Git Bash', bash, ['--login', '-i'])
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

const terms = new Map()   // id → { p, id, shell, name, cwd, buf }
const KEEP = 200 * 1024   // the end of each one's output, for a panel drawn again
let nextId = 1
let send = () => {}       // set by the app: (event, ...args) to the panel
// output goes to the panel in small batches, not chunk by chunk
const pending = new Map()
function flush() {
  for (const [id, d] of pending) send('data', id, d)
  pending.clear()
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
  const tabs = [...terms.values()].map(({ shell, title, cwd, buf }) => ({ shell, title, cwd, buf: buf.slice(-SAVED) }))
  try { fs.mkdirSync(path.dirname(keepFile), { recursive: true }); fs.writeFileSync(keepFile, JSON.stringify(tabs)) } catch {}
}
// output only says the file is due: written every few seconds, so an app killed (an update installing) loses little
const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(save, 4000) }
// The tabs of the last run, handed out once (the first time the panel asks, with nothing running): the panel draws
// each one's old output and starts its shell again under it (open with inherit). Nothing to hand out after a shell
// has been started.
function saved() {
  if (restored) return []
  restored = true
  let tabs = []
  try { tabs = JSON.parse(fs.readFileSync(keepFile, 'utf8')) } catch {}
  return Array.isArray(tabs) ? tabs.slice(0, 12).filter((x) => x && typeof x === 'object') : []
}

// inherit: the shell starts where the panel's cursor is, under the old output drawn there, instead of on a cleared
// screen (Windows' console asks the panel where its cursor is; elsewhere a shell never clears it)
function open({ shell, cwd, cols, rows, title, inherit } = {}) {
  const all = shells()
  const sh = all.find((s) => s.id === shell) || all[0]
  if (!sh) throw new Error('No shell found')
  let dir = os.homedir()
  try { if (cwd && fs.statSync(cwd).isDirectory()) dir = cwd } catch {}
  const p = ptyModule().spawn(sh.file, sh.args, {
    name: 'xterm-256color', cols: Math.max(2, cols | 0 || 80), rows: Math.max(1, rows | 0 || 24), cwd: dir,
    env: { ...ENV, TERM_PROGRAM: 'ELOP-Crew', COLORTERM: 'truecolor' },
    ...(WIN && inherit ? { conptyInheritCursor: true } : {}),
  })
  const id = nextId++
  const t = { p, id, shell: sh.id, name: sh.name, title: String(title || '').trim().slice(0, 40), cwd: dir, buf: '' }
  terms.set(id, t)
  p.onData((d) => {
    t.buf += d.replace(/\x1b\[6n/g, '')
    if (t.buf.length > KEEP) { const cut = t.buf.indexOf('\n', t.buf.length - KEEP); t.buf = t.buf.slice(cut < 0 ? t.buf.length - KEEP : cut + 1) }
    if (!pending.size) setTimeout(flush, 8)
    pending.set(id, (pending.get(id) || '') + d)
    saveSoon()
  })
  p.onExit(({ exitCode }) => { flush(); terms.delete(id); send('exit', id, exitCode); if (!stopping) save() })
  restored = true   // a shell started before any was restored: the old ones are not brought back over it
  save()
  return { id, shell: t.shell, name: t.name, title: t.title, cwd: t.cwd }
}
const list = () => [...terms.values()].map(({ id, shell, name, title, cwd, buf }) => ({ id, shell, name, title, cwd, buf }))
function rename(id, title) { const t = terms.get(id); if (t) { t.title = String(title || '').trim().slice(0, 40); save() } }
function write(id, data) { const t = terms.get(id); if (t && typeof data === 'string') t.p.write(data) }
function resize(id, cols, rows) { const t = terms.get(id); if (t && cols > 1 && rows > 0) { try { t.p.resize(cols | 0, rows | 0) } catch {} } }
function close(id) { const t = terms.get(id); if (t) { try { t.p.kill() } catch {} } }
// the app quitting: the tabs are written down as they are, then the shells end
function closeAll() { if (stopping) return; save(); stopping = true; for (const t of terms.values()) { try { t.p.kill() } catch {} } terms.clear() }

module.exports = {
  shells, open, list, write, resize, rename, close, closeAll, saved, count: () => terms.size,
  onSend: (fn) => { send = fn }, keepIn: (file) => { keepFile = file },
}
