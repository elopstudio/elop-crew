// The browsers the agents drive to look at what they build — headless Chrome, Edge, Playwright's Chromium — shown in
// the monitor's browser panel: which agent has which, the pages open in each, and a live picture of one page.
//
// A browser can be watched when it listens on a DevTools port (--remote-debugging-port): the monitor asks it for its
// pages and, for the page picked, has it send its screen as it changes (the DevTools screencast). One started with
// only a pipe (Playwright's default) cannot be reached from outside; for those the monitor can run a shared browser
// of its own, which the agents are told to connect to instead of launching one. Only ports of browsers the agents
// started, and the shared one, are ever contacted, and only on 127.0.0.1. Nothing seen is kept.

import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const WIN = process.platform === 'win32'
const SHARED_PORTS = [9333, 9334, 9335, 9336, 9337]

// a page's DevTools answers, from 127.0.0.1 only
async function getJson(port, what, ms = 1500) {
  const c = new AbortController()
  const timer = setTimeout(() => c.abort(), ms)
  try { const r = await fetch('http://127.0.0.1:' + port + '/json/' + what, { signal: c.signal }); return r.ok ? await r.json() : null } catch { return null } finally { clearTimeout(timer) }
}

// where Chrome or Edge is on this PC, for the shared browser
function browserExe() {
  const env = process.env
  const list = WIN ? [
    path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
  return list.find((p) => { try { return fs.statSync(p).isFile() } catch { return false } }) || ''
}

export function createBrowsers({ processes, roots, mask, clip, dataDir }) {
  const allowed = new Set()   // ports the panel may reach: the agents' browsers seen in the last listing, and the shared one
  let shared = null           // { proc, port, startedAt }

  // a browser's DevTools port: on its command line, or (when it picked one itself, port 0) in its profile folder
  function portOf(b) {
    if (b.port) return b.port
    if (b.port === 0 && b.dataDir) {
      try { return Number(fs.readFileSync(path.join(b.dataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]) || null } catch {}
    }
    return null
  }
  const pagesOf = async (port) => ((await getJson(port, 'list')) || []).filter((t) => t && t.type === 'page')
    .map((t) => ({ id: String(t.id), title: mask(clip(t.title || '', 120)), url: mask(clip(t.url || '', 300)) }))

  // for the panel: each agent with its browsers and their pages; the shared browser apart
  async function list() {
    const found = await processes.browsers(await roots())
    const next = new Set()
    const sessions = []
    for (const { info, list: bs } of found) {
      const browsers = []
      for (const b of bs) {
        const port = portOf(b)
        if (port && shared && port === shared.port) continue   // listed as the shared one
        const pages = port ? await pagesOf(port) : []
        if (port) next.add(port)
        browsers.push({ pid: b.pid, name: b.name, headless: b.headless, start: b.start, mem: b.mem, how: port ? 'port' : b.pipe ? 'pipe' : 'none', port: port || null, pages })
      }
      sessions.push({ ...info, browsers })
    }
    if (shared && sharedAlive()) next.add(shared.port)
    allowed.clear()
    for (const p of next) allowed.add(p)
    return { sessions, shared: shared && sharedAlive() ? { port: shared.port, startedAt: shared.startedAt, pages: await pagesOf(shared.port) } : null, canShare: !!browserExe() }
  }

  /* ── A live picture of one page (Server-Sent Events, one JPEG per change) ── */

  async function stream(req, res, port, id) {
    port = Number(port)
    if (!allowed.has(port)) await list()
    if (!allowed.has(port)) { res.writeHead(404).end(); return }
    const target = ((await getJson(port, 'list')) || []).find((t) => String(t.id) === String(id) && t.type === 'page')
    if (!target?.webSocketDebuggerUrl || !/^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target.webSocketDebuggerUrl)) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    const send = (event, data) => { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n') } catch {} }
    let ws, seq = 0, closed = false
    const call = (method, params = {}) => { try { ws.send(JSON.stringify({ id: ++seq, method, params })); return seq } catch { return 0 } }
    const shotId = new Set()
    const end = () => {
      if (closed) return
      closed = true
      clearInterval(ping)
      try { call('Page.stopScreencast') } catch {}
      try { ws?.close() } catch {}
      try { res.end() } catch {}
    }
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 15000)
    req.on('close', end)
    try { ws = new WebSocket(target.webSocketDebuggerUrl) } catch { send('gone', {}); end(); return }
    ws.onopen = () => {
      call('Page.enable')
      // the page as it is now, then each change; at most about 1280 wide, plenty for a side panel
      shotId.add(call('Page.captureScreenshot', { format: 'jpeg', quality: 60 }))
      call('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 })
      send('info', { url: mask(clip(target.url || '', 300)), title: mask(clip(target.title || '', 120)) })
    }
    ws.onmessage = (ev) => {
      let m
      try { m = JSON.parse(String(ev.data)) } catch { return }
      if (m.method === 'Page.screencastFrame') {
        call('Page.screencastFrameAck', { sessionId: m.params.sessionId })
        const md = m.params.metadata || {}
        send('frame', { d: m.params.data, w: md.deviceWidth || 0, h: md.deviceHeight || 0 })
      } else if (m.id && shotId.has(m.id)) {
        shotId.delete(m.id)
        if (m.result?.data) send('frame', { d: m.result.data, w: 0, h: 0 })
      } else if (m.method === 'Page.frameNavigated' && !m.params?.frame?.parentId) {
        send('info', { url: mask(clip(m.params.frame.url || '', 300)) })
      } else if (m.method === 'Inspector.detached' || m.method === 'Target.targetDestroyed') { send('gone', {}); end() }
    }
    ws.onclose = () => { if (!closed) { send('gone', {}); end() } }
    ws.onerror = () => {}
  }

  /* ── The shared browser ── */

  const sharedAlive = () => !!shared && shared.proc.exitCode === null && !shared.proc.killed
  async function startShared() {
    if (sharedAlive()) return { port: shared.port }
    const exe = browserExe()
    if (!exe) return null
    // a port nothing answers on yet
    let port = 0
    for (const p of SHARED_PORTS) if (!(await getJson(p, 'version', 500))) { port = p; break }
    if (!port) return null
    const profile = path.join(dataDir, '.runtime', 'shared-browser')
    fs.mkdirSync(profile, { recursive: true })
    const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore', windowsHide: true })
    proc.on('error', () => {})
    shared = { proc, port, startedAt: Date.now() }
    // ready when it answers
    for (let i = 0; i < 40 && !(await getJson(port, 'version', 500)); i++) await new Promise((r) => setTimeout(r, 250))
    allowed.add(port)
    return { port }
  }
  function stopShared() {
    if (!shared) return
    const { proc, port } = shared
    shared = null
    allowed.delete(port)
    if (WIN) { try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
    else { try { proc.kill('SIGTERM') } catch {} }
  }
  const sharedPort = () => (sharedAlive() ? shared.port : 0)
  process.on('exit', stopShared)

  return { list, stream, startShared, stopShared, sharedPort }
}
