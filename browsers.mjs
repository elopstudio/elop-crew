// The browsers the agents drive to look at what they build — headless Chrome, Edge, Playwright's Chromium — shown in
// the monitor's browser panel: which agent has which, the pages open in each, and a live picture of one page.
//
// A browser can be watched when it listens on a DevTools port (--remote-debugging-port): the monitor asks it for its
// pages and, for the page picked, has it send its screen as it changes (the DevTools screencast). One started with
// only a pipe (Playwright's default) cannot be reached from outside; for those the monitor can run a shared browser
// of its own, which the agents are told to connect to instead of launching one. Only ports of browsers the agents
// started, and the shared one, are ever contacted, and only on 127.0.0.1. Nothing seen is kept.
//
// The person can also drive the page they watch, as in a browser of their own: type an address, go back and forward,
// open and close tabs, and click, scroll and type on the picture (each sent to the page as DevTools input events).

import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const WIN = process.platform === 'win32'
const SHARED_PORTS = [9333, 9334, 9335, 9336, 9337]

// a page's DevTools answers, from 127.0.0.1 only
async function getJson(port, what, ms = 1500, method = 'GET') {
  const c = new AbortController()
  const timer = setTimeout(() => c.abort(), ms)
  try { const r = await fetch('http://127.0.0.1:' + port + '/json/' + what, { method, signal: c.signal }); return r.ok ? await r.json() : null } catch { return null } finally { clearTimeout(timer) }
}
const LOCAL_WS = /^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//
// an address the panel may send a page to: the web, or a blank page
function webUrl(u) {
  const s = String(u || '').trim().slice(0, 4000)
  if (s === 'about:blank') return s
  try { const x = new URL(s); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '' } catch { return '' }
}
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)))

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
    if (!target?.webSocketDebuggerUrl || !LOCAL_WS.test(target.webSocketDebuggerUrl)) { res.writeHead(404).end(); return }
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

  /* ── The person driving a page from the panel: its address, back and forward, tabs, and their mouse and keys ── */

  // one DevTools connection per page driven, kept while the person goes on (a click is several events) and let go after a minute
  const conns = new Map()   // 'port:id' → { ask(method, params) → result, touch() }
  async function pageConn(port, id) {
    const key = port + ':' + id
    const had = conns.get(key)
    if (had) { had.touch(); return had }
    const target = ((await getJson(port, 'list')) || []).find((t) => String(t.id) === String(id) && t.type === 'page')
    if (!target?.webSocketDebuggerUrl || !LOCAL_WS.test(target.webSocketDebuggerUrl)) return null
    let ws
    try {
      ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(bad, 3000) })
    } catch { try { ws?.close() } catch {} return null }
    let seq = 0, timer = 0
    const waiting = new Map()
    const drop = () => {
      clearTimeout(timer)
      if (conns.get(key) === c) conns.delete(key)
      for (const w of waiting.values()) w.bad(new Error('gone'))
      waiting.clear()
      try { ws.close() } catch {}
    }
    ws.onmessage = (ev) => {
      let m
      try { m = JSON.parse(String(ev.data)) } catch { return }
      const w = m.id && waiting.get(m.id)
      if (!w) return
      waiting.delete(m.id)
      if (m.error) w.bad(new Error(m.error.message)); else w.ok(m.result || {})
    }
    ws.onclose = drop
    ws.onerror = () => {}
    const c = {
      ask: (method, params = {}) => new Promise((ok, bad) => {
        const i = ++seq
        waiting.set(i, { ok, bad })
        setTimeout(() => { if (waiting.delete(i)) bad(new Error('timeout')) }, 5000)
        try { ws.send(JSON.stringify({ id: i, method, params })) } catch (e) { waiting.delete(i); bad(e) }
      }),
      touch() { clearTimeout(timer); timer = setTimeout(drop, 60 * 1000) },
    }
    c.touch()
    conns.set(key, c)
    return c
  }

  const BUTTONS = new Set(['none', 'left', 'middle', 'right'])
  const MOUSE = new Set(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'])
  const KEYS = new Set(['keyDown', 'rawKeyDown', 'keyUp'])
  // → [status, answer]; a: { act, … } — go (url), back, forward, reload, new (url: a tab of its own), close, mouse, key,
  // text (typed at once: an IME's result, a paste), compose (an IME's text while it is being composed)
  async function act(port, id, a = {}) {
    port = Number(port)
    if (!allowed.has(port)) await list()
    if (!allowed.has(port)) return [404, {}]
    const what = String(a.act || '')
    if (what === 'new') {
      const t = await getJson(port, 'new?' + encodeURIComponent(webUrl(a.url) || 'about:blank'), 3000, 'PUT')
      return t?.id ? [200, { id: String(t.id) }] : [500, {}]
    }
    if (what === 'close') {
      if (!((await getJson(port, 'list')) || []).some((t) => String(t.id) === String(id) && t.type === 'page')) return [404, {}]
      await getJson(port, 'close/' + encodeURIComponent(id))
      return [200, {}]
    }
    const c = await pageConn(port, String(id))
    if (!c) return [404, {}]
    try {
      if (what === 'go') {
        const url = webUrl(a.url)
        if (!url) return [400, {}]
        await c.ask('Page.navigate', { url })
      } else if (what === 'back' || what === 'forward') {
        const h = await c.ask('Page.getNavigationHistory')
        const e = h.entries?.[h.currentIndex + (what === 'back' ? -1 : 1)]
        if (e) await c.ask('Page.navigateToHistoryEntry', { entryId: e.id })
      } else if (what === 'reload') {
        await c.ask('Page.reload')
      } else if (what === 'mouse') {
        if (!MOUSE.has(a.type)) return [400, {}]
        // a tab behind another is hidden in a headless browser: a wheel turn there never ends (and the picture stands
        // still), so the page the person clicks or scrolls comes to the front first
        if (a.type === 'mousePressed' || a.type === 'mouseWheel') await c.ask('Page.bringToFront').catch(() => {})
        await c.ask('Input.dispatchMouseEvent', {
          type: a.type, x: num(a.x, 0, 20000), y: num(a.y, 0, 20000), modifiers: num(a.modifiers, 0, 15),
          button: BUTTONS.has(a.button) ? a.button : 'none', buttons: num(a.buttons, 0, 31), clickCount: num(a.clickCount, 0, 3),
          ...(a.type === 'mouseWheel' ? { deltaX: num(a.deltaX, -10000, 10000), deltaY: num(a.deltaY, -10000, 10000) } : {}),
        })
      } else if (what === 'key') {
        if (!KEYS.has(a.type)) return [400, {}]
        const text = a.type === 'keyDown' ? String(a.text || '').slice(0, 4) : ''
        const code = num(a.keyCode, 0, 255)
        await c.ask('Input.dispatchKeyEvent', {
          type: a.type, key: String(a.key || '').slice(0, 40), code: String(a.code || '').slice(0, 40), modifiers: num(a.modifiers, 0, 15),
          windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, autoRepeat: !!a.repeat, location: num(a.location, 0, 3),
          ...(text ? { text, unmodifiedText: text } : {}),
        })
      } else if (what === 'text') {
        await c.ask('Input.insertText', { text: String(a.text || '').slice(0, 20000) })
      } else if (what === 'compose') {
        const text = String(a.text || '').slice(0, 200)
        await c.ask('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
      } else return [400, {}]
      return [200, {}]
    } catch { return [500, {}] }
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

  return { list, stream, act, startShared, stopShared, sharedPort }
}
