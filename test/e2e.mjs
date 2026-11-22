// End-to-end check of the monitor's agents, against a server of its own (its own data folder, link file and port) and
// real claude processes on haiku in throwaway folders — a few cents a run. What it checks, in order:
//   start      an agent started with a message answers it
//   name       its claude goes by the page's names (ListAgents / SendMessage), not one made up from the folder
//   approval   a tool it must ask for (Write) shows as a request; allowed there, it runs
//   peer       a message one agent sends another by name (SendMessage) reaches it, their permission modes differing
//   bus        a message through the crew tools (bus.mjs) reaches the other agent, shown as from the sender, without an
//              approval, and it answers the same way; both are in the agent-talk list
//   args       the arguments its claude is started with, against test/args.baseline.txt (--save-args writes it)
//   commands   the "/" list for its folder (claude's own commands among them)
//   live       a new mode and effort taken by its running claude without a restart, and the mods' drawing requests answered
//   resume     the server killed hard and started again: the agents are back, and the next message carries on the
//              same conversation
//   board      with auto-run on, an agent that ends a turn is handed its queued task, and TASK DONE marks it done
//
//   node test/e2e.mjs [--keep] [--save-args] [--only=start,name,...]
//
// Run it before and after a change to how agents are run: the same checks must pass.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep'), SAVE_ARGS = argv.includes('--save-args')
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
const want = (k) => !ONLY.length || ONLY.includes(k)
const ROOT = path.join(os.tmpdir(), 'crew-e2e-' + Date.now().toString(36))
const HOME = path.join(ROOT, 'home'), ALPHA = path.join(ROOT, 'alpha'), BETA = path.join(ROOT, 'beta')
const PORT = 4850 + Math.floor(Math.random() * 100)
const BASE = 'http://127.0.0.1:' + PORT
const SESSIONS = path.join(os.homedir(), '.claude', 'sessions')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const win = process.platform === 'win32'

/* ── the server ── */
// started from inside a claude session, the CLAUDE_* / ANTHROPIC_* it inherited would make the agents' claudes children
// of it (no sessions file of their own): none of them reach the server
const env = { ...process.env, MONITOR_HOME: HOME, MONITOR_LINK: path.join(HOME, 'link.json'), PORT: String(PORT), MONITOR_USAGE: 'off' }
for (const k of Object.keys(env)) if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete env[k]
let server = null, token = '', viewer = null
async function startServer() {
  try { fs.rmSync(path.join(HOME, '.runtime', 'bridge.json'), { force: true }) } catch {}
  server = spawn(process.execPath, [path.join(REPO, 'server.mjs')], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = fs.createWriteStream(path.join(ROOT, 'server.log'), { flags: 'a' })
  server.stdout.pipe(log); server.stderr.pipe(log)
  await until(() => fs.existsSync(path.join(HOME, '.runtime', 'bridge.json')), 20000, 'the server to start')
  token = JSON.parse(fs.readFileSync(path.join(HOME, '.runtime', 'bridge.json'), 'utf8')).token
  // someone looking at the page: a request is shown, not handed back for want of a viewer
  viewer = new AbortController()
  fetch(BASE + '/api/events', { signal: viewer.signal }).then((r) => r.body?.getReader().read()).catch(() => {})
  await sleep(500)
}
function killTree(pid) {
  if (!pid) return
  if (win) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
  else { try { process.kill(pid, 'SIGKILL') } catch {} }
}
// a crash: the server and the claudes under it, with no shutdown of its own
function killServer() { viewer?.abort(); for (const s of streams.values()) s.abort(); streams.clear(); killTree(server?.pid); server = null }

async function api(p, body) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-monitor-token': token }, body: JSON.stringify(body || {}) })
  let o = null
  try { o = await r.json() } catch {}
  return { status: r.status, body: o }
}
const state = async () => (await fetch(BASE + '/api/state')).json()
async function until(fn, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    let v = null
    try { v = await fn() } catch {}
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting for ' + what)
    await sleep(700)
  }
}

/* ── an agent's events (its stream, as the page reads it) ── */
const streams = new Map()   // agent id → AbortController
const events = new Map()    // agent id → [event]
function follow(id) {
  if (streams.has(id)) return
  const ac = new AbortController()
  streams.set(id, ac)
  if (!events.has(id)) events.set(id, [])
  const list = events.get(id)
  ;(async () => {
    try {
      const r = await fetch(BASE + '/api/agent-stream?token=' + token + '&id=' + id, { signal: ac.signal })
      const reader = r.body.getReader(), dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
          const ev = /^event: (\w+)/m.exec(chunk)?.[1], data = /^data: (.*)$/m.exec(chunk)?.[1]
          if (!data) continue
          try { const o = JSON.parse(data); if (ev === 'e') list.push(o) } catch {}
        }
      }
    } catch {}
    streams.delete(id)
  })()
}
const said = (id) => (events.get(id) || []).filter((e) => e.kind === 'block' && e.type === 'text' && e.done).map((e) => e.text).join('\n')
const turns = (id) => (events.get(id) || []).filter((e) => e.kind === 'turn').length
// sends a message and waits for the turn it starts to end
async function ask(id, text, ms = 120000) {
  const before = turns(id)
  const r = await api('/api/agents/send', { id, text })
  if (r.status !== 200) throw new Error('send failed: ' + r.status)
  await until(() => turns(id) > before, ms, 'the turn to end')
}

/* ── what claude says about the sessions, and the processes ── */
function registry() {
  let files = []
  try { files = fs.readdirSync(SESSIONS).filter((f) => /^\d+\.json$/.test(f)) } catch {}
  return files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(SESSIONS, f), 'utf8')) } catch { return null } }).filter(Boolean)
    .filter((o) => { try { process.kill(o.pid, 0); return true } catch (e) { return e.code === 'EPERM' } })
}
const mine = (o) => path.resolve(String(o.cwd || '')).toLowerCase().startsWith(ROOT.toLowerCase())
function commandLine(pid) {
  if (win) {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', windowsHide: true })
    return out.trim()
  }
  return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim()
}
// the page's label for an agent, as the server makes it (server.mjs sessionLabel; the page's language unset: Korean first)
function labelOf(s) {
  const clean = (v) => String(v || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 24)
  const ko = clean(s.nickKo), en = clean(s.nick)
  return !ko ? en : !en || ko.toLowerCase() === en.toLowerCase() ? ko : ko + '-' + en
}
async function sessionOf(agentId) {
  const st = await state()
  for (const p of st.projects) for (const s of p.sessions) if (s.agentId === agentId) return { s, p, st }
  return null
}

/* ── the checks ── */
const results = []
async function check(name, fn) {
  if (!want(name)) return
  const t0 = Date.now()
  process.stdout.write('· ' + name + ' … ')
  try { const note = await fn(); results.push({ name, ok: true }); console.log('ok' + (note ? ' — ' + note : '') + ' (' + Math.round((Date.now() - t0) / 1000) + 's)') }
  catch (e) { results.push({ name, ok: false, why: e.message }); console.log('FAILED — ' + e.message) }
}

let A = '', B = ''
async function main() {
  for (const d of [HOME, ALPHA, BETA]) fs.mkdirSync(d, { recursive: true })
  console.log('e2e in ' + ROOT + ' (port ' + PORT + ')')
  await startServer()

  // always: the two agents the checks use
  const a = await api('/api/agents/start', { cwd: ALPHA, model: 'haiku', mode: 'default', text: 'Reply with exactly the word ALPHA-1 and nothing else.' })
  if (a.status !== 200) throw new Error('could not start an agent: ' + a.status)
  A = a.body.id; follow(A)

  await check('start', async () => {
    await until(() => turns(A) >= 1, 120000, 'its first turn')
    if (!/ALPHA-1/.test(said(A))) throw new Error('it said: ' + said(A).slice(0, 200))
  })

  await check('name', async () => {
    const { s } = await until(() => sessionOf(A), 10000, 'the agent on the page')
    const label = labelOf(s)
    const reg = await until(() => registry().find((o) => mine(o) && path.resolve(o.cwd).toLowerCase() === ALPHA.toLowerCase()), 20000, 'its claude in the sessions registry')
    if (reg.name !== label) throw new Error('registry name ' + JSON.stringify(reg.name) + ', page label ' + JSON.stringify(label))
    return label
  })

  await check('approval', async () => {
    const before = turns(A)
    // a file written: always asked in the default mode (a read-only command such as echo is let through without asking)
    await api('/api/agents/send', { id: A, text: 'Use the Write tool to create the file e2e-approved.txt in your working directory, containing only the line E2E-APPROVED-7. Then reply DONE.' })
    const req = await until(async () => (await state()).approvals?.find((q) => /e2e-approved\.txt/i.test(String(q.code || '') + String(q.what || ''))), 90000, 'the approval request')
    const d = await api('/api/decide', { id: req.id, answer: 'allow' })
    if (d.status !== 200) throw new Error('decide answered ' + d.status)
    await until(() => turns(A) > before, 120000, 'the turn to end')
    const f = path.join(ALPHA, 'e2e-approved.txt')
    if (!fs.existsSync(f) || !/E2E-APPROVED-7/.test(fs.readFileSync(f, 'utf8'))) throw new Error('allowed, but the file is not there')
  })

  // the second agent, in another permission mode
  const b = await api('/api/agents/start', { cwd: BETA, model: 'haiku', mode: 'bypassPermissions', text: 'Reply with exactly the word BETA-1 and nothing else.' })
  B = b.body?.id || ''
  if (B) follow(B)

  await check('peer', async () => {
    if (!B) throw new Error('the second agent did not start')
    await until(() => turns(B) >= 1, 120000, "the second agent's first turn")
    const { s } = await until(() => sessionOf(B), 10000, 'the second agent on the page')
    const label = labelOf(s)
    // anything A asks for while sending (SendMessage, ListAgents) is allowed
    let stop = false
    ;(async () => { while (!stop) { try { for (const q of (await state()).approvals || []) await api('/api/decide', { id: q.id, answer: 'allow' }) } catch {} await sleep(1000) } })()
    try {
      await ask(A, 'Use the SendMessage tool to send the message E2E-PEER-9 to the session named ' + label + '. Then reply with one line saying what the tool result said.')
      await until(() => (events.get(B) || []).some((e) => /E2E-PEER-9/.test(String(e.text || ''))) || /E2E-PEER-9/.test(said(B)), 90000, 'the message to reach ' + label)
    } finally { stop = true }
    return 'to ' + label
  })

  await check('bus', async () => {
    if (!B) throw new Error('the second agent did not start')
    const a = (await sessionOf(A)).s, b = (await sessionOf(B)).s
    const n = (events.get(B) || []).length
    await ask(A, 'Use the mcp__crew__send tool to send the agent named ' + labelOf(b) + ' this message: "E2E-BUS-5 — please answer me with the word ACK." Then reply with one line saying what the tool result said.')
    if ((await state()).approvals?.some((q) => /crew/i.test(String(q.tool || '')))) throw new Error('the crew tool asked for approval')
    const got = await until(() => (events.get(B) || []).slice(n).find((e) => e.kind === 'user' && e.peer && /E2E-BUS-5/.test(String(e.text || ''))), 60000, 'the message to reach ' + labelOf(b))
    if (got.from !== a.name) throw new Error('from ' + JSON.stringify(got.from) + ', not ' + JSON.stringify(a.name))
    if (/through the agent monitor/.test(got.text)) throw new Error('the page shows the header line')
    // it knows who sent it and answers through the bus too
    await until(() => (events.get(A) || []).some((e) => e.kind === 'user' && e.peer && e.from === b.name), 120000, 'an answer from ' + labelOf(b))
    const talk = await (await fetch(BASE + '/api/agents/peers?token=' + token + '&name=' + encodeURIComponent(b.name))).json()
    if (!talk.list?.some((m) => /E2E-BUS-5/.test(m.text))) throw new Error('not in the agent-talk list')
    return labelOf(a) + ' → ' + labelOf(b) + ' and back'
  })

  await check('args', async () => {
    const reg = registry().find((o) => mine(o) && path.resolve(o.cwd).toLowerCase() === ALPHA.toLowerCase())
    if (!reg) throw new Error('its claude is not running')
    const { s } = await sessionOf(A)
    let line = commandLine(reg.pid)
    // what changes from run to run, and from machine to machine
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const [from, to] of [[ROOT, '<root>'], [ROOT.replace(/\\/g, '\\\\'), '<root>'], [ROOT.replace(/\\/g, '/'), '<root>'], [REPO, '<repo>'], [REPO.replace(/\\/g, '\\\\'), '<repo>'], [REPO.replace(/\\/g, '/'), '<repo>'], [process.execPath, '<node>'], [process.execPath.replace(/\\/g, '\\\\'), '<node>']]) line = line.replace(new RegExp(esc(from), 'gi'), to)
    line = line.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(new RegExp(esc(A), 'g'), '<agent>')
      .replace(new RegExp(esc(labelOf(s)), 'g'), '<label>').replace(/^.*?(?=\s-p\s|\s--print\s)/, '<claude>').replace(/"autoCompactWindow\\?":\d+/, '"autoCompactWindow":<n>')
    const file = path.join(REPO, 'test', 'args.baseline.txt')
    if (SAVE_ARGS) { fs.writeFileSync(file, line + '\n'); return 'saved to test/args.baseline.txt' }
    if (!fs.existsSync(file)) throw new Error('no baseline yet: run with --save-args on code you trust')
    // a checkout with core.autocrlf turns the line breaks inside it (the system prompt's) into CRLF
    const base = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim()
    if (base !== line) {
      fs.writeFileSync(path.join(ROOT, 'args.now.txt'), line + '\n')
      throw new Error('differs from the baseline (now: ' + path.join(ROOT, 'args.now.txt') + ')')
    }
  })

  await check('commands', async () => {
    const r = await api('/api/agents/commands', { id: A })
    const names = (r.body?.commands || []).map((c) => c.name)
    if (r.status !== 200 || !names.includes('compact')) throw new Error('answered ' + r.status + ' with ' + names.length + ' commands')
    return names.length + ' commands'
  })

  await check('live', async () => {
    const pid = registry().find((o) => mine(o) && path.resolve(o.cwd).toLowerCase() === ALPHA.toLowerCase())?.pid
    const notes = () => (events.get(A) || []).filter((e) => e.kind === 'note' && / — now$/.test(String(e.text || ''))).length
    const n = notes()
    // a mode and an effort for the running claude, taken without a restart
    const r = await api('/api/agents/settings', { id: A, mode: 'acceptEdits', effort: 'low' })
    if (r.status !== 200) throw new Error('settings answered ' + r.status)
    await until(() => notes() > n, 15000, 'the note that they took effect now')
    const again = registry().find((o) => mine(o) && path.resolve(o.cwd).toLowerCase() === ALPHA.toLowerCase())?.pid
    if (!pid || again !== pid) throw new Error('its claude was restarted (' + pid + ' → ' + again + ')')
    await api('/api/agents/settings', { id: A, mode: 'default', effort: '' })
    await until(() => notes() > n + 1, 15000, 'the settings back')
    // the mods' drawings: asked of its claude and answered (with no mod loaded, whatever it says)
    const ui = await api('/api/agents/ui', { id: A, op: 'panes', request: {} })
    if (ui.status !== 200 || typeof ui.body?.ok !== 'boolean') throw new Error('ui answered ' + ui.status + ' ' + JSON.stringify(ui.body))
  })

  await check('resume', async () => {
    const before = await sessionOf(A)
    killServer()
    await sleep(1500)
    await startServer()
    const back = await until(() => sessionOf(A), 20000, 'the agent back on the page')
    if (!back) throw new Error('the agent is gone after the restart')
    if (B && !(await sessionOf(B))) throw new Error('the second agent is gone after the restart')
    follow(A)
    await ask(A, 'What word did my very first message ask you to reply with? Reply with just that word.')
    if (!/ALPHA-1/.test(said(A).split('\n').slice(-3).join('\n'))) throw new Error('it does not remember: ' + said(A).slice(-200))
    const reg = await until(() => registry().find((o) => mine(o) && path.resolve(o.cwd).toLowerCase() === ALPHA.toLowerCase()), 20000, 'its claude again')
    if (reg.name !== labelOf(back.s)) throw new Error('after the restart its claude goes by ' + JSON.stringify(reg.name))
    if (before && back.s.id !== before.s.id) throw new Error('another session: ' + before.s.id + ' → ' + back.s.id)
  })

  await check('board', async () => {
    const { s, p } = await sessionOf(A)
    const file = path.join(HOME, 'boards', p.key + '.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ auto: true, tasks: [{ title: 'E2E board task', status: 'queued', session: s.name, order: 1, detail: 'Reply with exactly E2E-BOARD-3 on one line.' }], decisions: [] }, null, 2))
    await ask(A, 'Reply with exactly OK.')
    const done = await until(() => { const t = JSON.parse(fs.readFileSync(file, 'utf8')).tasks[0]; return t.status === 'done' ? t : null }, 180000, 'the task to be marked done')
    if (!/E2E-BOARD-3/.test(said(A))) throw new Error('done, but it never said E2E-BOARD-3')
    return 'status ' + done.status
  })
}

function cleanup() {
  killServer()
  for (const o of registry()) if (mine(o)) killTree(o.pid)
  if (!KEEP) { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {} }
}

let code = 0
try { await main() } catch (e) { console.log('STOPPED — ' + e.message); code = 1 }
finally {
  cleanup()
  const failed = results.filter((r) => !r.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed' + (failed.length ? ' — failed: ' + failed.map((r) => r.name).join(', ') : ''))
  if (KEEP || failed.length || code) console.log('files: ' + ROOT + (KEEP ? '' : ' (removed; --keep to look at them)'))
  if (failed.length) code = 1
  process.exit(code)
}
