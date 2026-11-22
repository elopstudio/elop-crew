// Agents the monitor runs itself: the list, what each one said and does, carrying them on after a restart, a login
// back or a usage limit reset, and the API the page uses. What runs an agent is its driver — today always the
// installed `claude` program (drivers/claude.mjs), which starts and stops it, talks to it and reads what it prints.
//
//   start   the driver starts its program; a message sent to a stopped agent starts it too
//   send    a user message (text, and attachments) through the driver
//   stop    ends the process; the next message resumes the same session
//   prompts permission prompts and questions come back from the driver's prompt tool (hooks/permission-mcp.mjs),
//           and are asked of the page here (prompt)
//
// What the page receives is normalised and masked like the conversation view: text arrives as the whole block
// so far (so a pattern split across two chunks is still masked), tool calls and results as whole entries.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { writeJson, readJson } from './durable.cjs'
import { createClaudeDriver, CONFIG_DIR, LIMIT_HIT } from './drivers/claude.mjs'
// what only the assistant's own tools server is given (an agent knows the monitor's token, never this): its calls are its
const ASSISTANT_KEY = crypto.randomBytes(16).toString('hex')
import { execFileSync } from 'node:child_process'

const HISTORY = 600                 // normalised events kept per agent for a dialog opened later
const MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']   // claude's --effort; none = its own default
const effortOf = (v) => (EFFORTS.includes(v) ? v : '')
// the crown is not on offer: it marks the leader
const ACCS = ["ball","twin","phones","sprout","bolt"]
// { c: palette index 0-7, acc: headgear } — anything else means "the usual look from the name"
const avatarOf = (v) => (v && Number.isInteger(v.c) && v.c >= 0 && v.c < 8 && ACCS.includes(v.acc) ? { c: v.c, acc: v.acc } : null)
// the assistant may also keep the crown it wears by default (the leader's mark on the cards, where it never appears)
// What the monitor itself tells an agent (carry on after a restart, a login back, a usage limit reset, a nudge): in the
// conversation view a one-line note of what it was, not a bubble as if the person had written it
const SYSTEM_NOTES = [
  [/^The agent monitor restarted \(an update or a restart of the app\)/, 'restart'],
  [/^Claude Code was logged out while you were working/, 'login'],
  [/^Your Claude usage limit was reached while you were working/, 'limit'],
  [/^Your Claude usage limit stopped your last turn, and Claude Code is now logged in as another account/, 'relimit'],
  [/^It looked like you were stuck, so you were stopped/, 'nudge'],
  // the board's auto-run: a note with the task's title, and with the person's answer to what blocked one
  [/^Next task from the project board \(auto-run is on\): (.*)/, 'task'],
  [/^Answer on the project board to what blocked your task "[^\n]*":\n(.*)/, 'answer'],
  [/^The project check failed for your task "([^\n]*)" \(try/, 'check'],
  // what the monitor's assistant tells an agent: shown as the assistant's, with what it said, not as the person's words
  [/^\[From the monitor's assistant\] ([\s\S]*)/, 'assist'],
]
export const systemNote = (text) => SYSTEM_NOTES.find(([re]) => re.test(String(text || '')))?.[1] || ''
// what the note shows besides its kind: the task, the answer
export const systemNoteText = (text) => { for (const [re] of SYSTEM_NOTES) { const m = String(text || '').match(re); if (m) return (m[1] || '').replace(/\n\n\(Write to the user in [A-Za-z]+\.\)\s*$/, '').trim().slice(0, 1000) } return '' }
const assistantLookOf = (v) => (v && v.acc === 'crown' && Number.isInteger(v.c) && v.c >= 0 && v.c < 8 ? { c: v.c, acc: 'crown' } : avatarOf(v))

export function createAgents({ root, dataDir, mask, clip, clip2, describe, notifyPages, projectRoot, projectKey, askPage, attachedPaths, configPath, historyOf, onTurnEnd, langRule, replyIn, panelsRule, modDirs, compactDefault, nameFor, namesReady }) {
  // what the agent is for, one line written by the user (shown under its name)
  const descOf = (v) => clip(String(v || '').replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim(), 80)
  // its name: one for both languages (a string) or one per language ({ en, ko }); the server reads both shapes
  const nickClean = (v) => clip(String(v || '').replace(/[\x00-\x1f<>]/g, ''), 16)
  const nickOf = (en, ko) => { en = nickClean(en); ko = nickClean(ko); return !en && !ko ? '' : en === ko ? en : { en, ko } }
  const agents = new Map()          // id → agent

  // The list outlives the server: .runtime/agents.json holds who each agent is (folder, name, look, mode, model,
  // session) — never what was said. After a restart they come back stopped; the next message resumes the session.
  // One that was in the middle of a turn when the monitor went away (quit, crash, an update) carries on by itself, and
  // one whose turn had ended just before is asked whether that turn was waiting for this restart (an install it started).
  const FILE = path.join(dataDir || root, '.runtime', 'agents.json')
  const KEEP = ['id', 'kind', 'cwd', 'key', 'name', 'nick', 'desc', 'avatar', 'mode', 'model', 'effort', 'fast', 'sessionId', 'newSessionId', 'startedAt', 'midTurn', 'turnEndedAt', 'compact', 'loginLost', 'limitHit', 'forkFrom', 'forkedFrom', 'ctxTokens', 'movedTo', 'peers']
  const CARRY_ON = 'The agent monitor restarted (an update or a restart of the app) and cut your last turn short. Please carry on where you left off, and keep replying in the language you have been using with the user.'
  const JUST_AFTER = 'The agent monitor restarted (an update or a restart of the app) right after your last turn ended. If that turn started something this restart was part of — installing or updating the app, a restart you asked for — check now that it worked and tell the user what you found. If it had nothing to do with it, just say so in one line.'
  const JUST_AFTER_MS = 2 * 60 * 1000   // how soon after a turn ends a restart counts as "right after"
  // a turn that may have set off the restart: an installer run, a build or release of the app, a restart spoken of
  const RESTARTING = /--force-run|Setup[^\n"]*\.exe|am-setup|npm run (dist|release|try)|electron-builder|quitAndInstall|Start-Process[^\n]*(install|setup)|\brestart(s|ed|ing)?\b|reinstall|재시작|재설치|다시 설치/i
  // Claude Code logged out under a running agent (a login that ran out, a switch to another account): its turn fails with
  // "Not logged in" (the driver says so). The agent is stopped, since a process that keeps running keeps the login it
  // started with, and once Claude Code is logged in again it is started afresh and carries on with what it was doing
  const LOGGED_BACK = 'Claude Code was logged out while you were working (a login that ran out, or a switch to another account), so your last turn failed with "Not logged in". It is logged in again now. Please carry on where you left off, and keep replying in the language you have been using with the user.'
  // A usage limit reached ("You've hit your session limit · resets 4:50pm"): the turn fails, and nothing woke the agent
  // once the limit had reset — on 1 Oct four agents and the assistant sat from 15:30 until long after 16:50. Now it is
  // asked to carry on just after the time the message gave (without one: after half an hour, then longer each time).
  const LIMIT_BACK = 'Your Claude usage limit was reached while you were working, so your last turn failed. The limit has reset now. Please carry on where you left off, and keep replying in the language you have been using with the user.'
  // the limit is the account's: logged in as another one, it may well have usage left — carried on at once
  const LIMIT_ACCOUNT = 'Your Claude usage limit stopped your last turn, and Claude Code is now logged in as another account, which has its own limits. Please carry on where you left off, and keep replying in the language you have been using with the user.'
  const LIMIT_GRACE_MS = 90 * 1000, LIMIT_RETRY_MS = 30 * 60 * 1000
  // How long a conversation may grow before Claude Code compacts it by itself (its autoCompactWindow, in tokens, or
  // "auto"): the agent's own choice, else the monitor's default. Left to "auto" on a 1M model, sessions grew to 970k,
  // and every step read all of it again — after an hour's rest (the cache gone) six of them wrote 3M tokens into the
  // cache within a minute, a fifth of a 5-hour session.
  const compactOf = (v) => (v === 'auto' ? 'auto' : Number.isInteger(Number(v)) && Number(v) >= 100000 && Number(v) <= 1000000 ? Number(v) : null)
  const windowOf = (a) => compactOf(a.compact) || compactOf(compactDefault?.()) || 'auto'
  // when it resets, from its words: "resets 4:50pm", "resets Oct 4, 9am", or the older "…limit reached|1759377600"
  // (a time of day is taken as this PC's, the zone the message names being the account's, usually the same)
  function resetOf(text, now) {
    const s = String(text || '')
    const epoch = s.match(/\|(\d{10})\b/)
    if (epoch) return Number(epoch[1]) * 1000
    const m = s.match(/resets\s+(?:([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i)
    if (!m) return 0
    const d = new Date(now)
    d.setHours(Number(m[3]) % 12 + (m[5].toLowerCase() === 'p' ? 12 : 0), Number(m[4] || 0), 0, 0)
    if (m[1]) {
      const month = new Date(m[1] + ' 1, 2000').getMonth()
      if (Number.isNaN(month)) return 0
      d.setMonth(month, Number(m[2]))
      if (d.getTime() < now - 12 * 3600e3) d.setFullYear(d.getFullYear() + 1)
    } else if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  let shuttingDown = false   // stopping everything on the way out is not the end of their turns
  function save() {
    try {
      // flushed to the disk and renamed in, the last one kept as .bak (durable.cjs): a reset no longer leaves NULs
      writeJson(FILE, [...agents.values()].map((a) => Object.fromEntries(KEEP.map((k) => [k, a[k]]))))
    } catch {}
  }
  // Agents put away as they were ended (End agent → keep in the archive): who each was and which conversation, never
  // what was said, so a new agent can carry that conversation on later. .runtime/archive.json, newest first, up to 100.
  const ARCHIVE = path.join(dataDir || root, '.runtime', 'archive.json')
  const ARCHIVE_KEEP = ['cwd', 'key', 'nick', 'desc', 'avatar', 'mode', 'model', 'effort', 'sessionId']
  const isSessionId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))
  function archived() {
    const l = readJson(ARCHIVE)
    return Array.isArray(l) ? l.filter((x) => x && x.id && isSessionId(x.sessionId)) : []
  }
  function saveArchive(list) {
    try { writeJson(ARCHIVE, list.slice(0, 100)) } catch {}
  }
  async function load() {
    let list = []
    // a broken file (NULs after a reset) is set aside and its last good copy read instead, never taken for no agents
    list = readJson(FILE)
    if (list === undefined) return
    for (const saved of Array.isArray(list) ? list : []) {
      if (!saved?.id || agents.has(saved.id) || !fs.existsSync(String(saved.cwd || ''))) continue
      const a = {
        ...saved, avatar: saved.id === 'assistant' ? assistantLookOf(saved.avatar) : avatarOf(saved.avatar),
        kind: saved.kind || (saved.id === 'assistant' ? 'assistant' : undefined),
        // a list saved before the session id was recorded: the id it was started with is the one to resume
        // taken over but not forked yet (no first turn before the restart): fork again from the VS Code session —
        // its newSessionId was never created, and resuming that left the agent with "No conversation found"
        forkedFrom: saved.forkedFrom || saved.forkFrom || '',   // lists saved before forkedFrom: a fork still pending knows it
        sessionId: saved.forkFrom ? '' : saved.sessionId || '', mode: MODES.includes(saved.mode) ? saved.mode : 'default',
        proc: null, state: 'stopped', stateSince: Date.now(), lastAt: 0, events: [], streams: new Set(), msg: null,
        activity: null, activityAt: 0, turns: 0, stopping: false, peers: Array.isArray(saved.peers) ? saved.peers.slice(-PEERS_KEPT) : [],
      }
      agents.set(a.id, a)
      // the conversation so far, from its transcript, so the dialog is not empty after a restart
      if ((a.sessionId || a.forkFrom) && historyOf) { try { a.events = await historyOf(a.sessionId || a.forkFrom) } catch {} }
      // saved before the id was kept on claude's word: an id it was started with counts only if its conversation exists
      if (historyOf && !a.forkFrom) {
        if (!a.sessionId && saved.newSessionId) { try { const h = await historyOf(saved.newSessionId); if (h.length) { a.sessionId = saved.newSessionId; a.events = h } } catch {} }
        else if (a.sessionId && a.sessionId === saved.newSessionId && !a.events.length) a.sessionId = ''
      }
      markPeers(a)
      // asked only if that last turn could have started this restart (it installed, built or restarted the app): any
      // other agent paid a reload of its whole conversation into a cold cache to answer "nothing to do with me" —
      // 14 such checks cost about 10M tokens in a week
      const turnStart = a.events.map((e) => (e.sys ? 'user' : e.kind)).lastIndexOf('user')   // the monitor's own words begin a turn too
      const restarting = a.events.slice(turnStart + 1).some((e) => (e.kind === 'tool' && RESTARTING.test(String(e.input || ''))) || (e.kind === 'block' && RESTARTING.test(String(e.text || ''))))
      a.justAfter = !a.midTurn && a.turnEndedAt > 0 && Date.now() - a.turnEndedAt < JUST_AFTER_MS && restarting
      // its conversation ended on the usage limit (a list from before limits were kept, or one kept): carried on after
      // the reset like one that hits it now — at once if that time has passed
      const lastSaid = a.events.filter((e) => e.kind === 'block' || e.kind === 'user').pop()
      if (!a.limitHit && !a.midTurn && lastSaid?.kind === 'block' && LIMIT_HIT.test(lastSaid.text) && Date.now() - (lastSaid.at || 0) < 24 * 3600e3) {
        a.limitHit = { at: lastSaid.at || Date.now(), until: resetOf(lastSaid.text, lastSaid.at || Date.now()) || 0 }
      }
    }
    for (const a of agents.values()) {
      const why = a.midTurn ? CARRY_ON : a.justAfter ? JUST_AFTER : ''
      delete a.justAfter
      if (!why) continue
      // the assistant waits for its role (ensureAssistant, a moment later): started without it, it would not know
      // what it is, and its own tools would ask the person
      if (a.kind === 'assistant' && !a.system) { a.resumeWith = why; continue }
      resume(a, why)
    }
    notifyPages()
  }

  function emit(a, ev, kept = true) {
    ev.at = ev.at || Date.now()
    if (kept) a.events.push(ev)
    if (a.events.length > HISTORY) a.events.splice(0, a.events.length - HISTORY)
    const line = 'event: e\ndata: ' + JSON.stringify(ev) + '\n\n'
    for (const res of a.streams) { try { res.write(line) } catch {} }
  }
  // the mods were changed on the page: each running agent loads them again, at once when free, else after its turn
  function reloadMods() {
    for (const a of agents.values()) {
      if (a.kind === 'assistant' || !a.proc) continue
      if (a.state === 'working') a.restartAfterTurn = true; else { a.respawn = true; stop(a) }
    }
  }

  function setState(a, state) {
    if (a.state === state) return
    a.state = state
    a.stateSince = Date.now()
    // written down as it happens, so even a monitor that is killed knows afterwards who was mid-turn
    if (!shuttingDown && a.midTurn !== (state === 'working')) { a.midTurn = state === 'working'; if (!a.midTurn) a.turnEndedAt = Date.now(); save() }
    emit(a, { kind: 'state', state })
    notifyPages()
  }

  // a turn its driver says is over (once the turn's event is out and the agent idle again): what failed it, the login,
  // the usage limit, a restart wanted, the board's next task
  function turnEnded(a, { ok, failed, limited, why, failText }) {
    // why its last turn failed (an API error, a limit, the login), for the page and the assistant; cleared by a good one
    a.lastFail = !ok ? { text: failText, at: Date.now() } : null
    if (ok) { a.loginTriedAt = 0; a.limitTries = 0; if (a.limitHit) { a.limitHit = null; save() } }
    if (failed) { loggedOut(a); return }
    if (limited) limitReached(a, why)
    if (a.restartAfterTurn) { a.restartAfterTurn = false; a.respawn = true; stop(a) }
    // a turn that went well: the project's board may say what comes next (its auto-run, in server.mjs; it looks a moment
    // later, by when a restart above has its new claude)
    if (ok && a.kind !== 'assistant') onTurnEnd?.(a.sessionId || a.newSessionId)
  }
  // its program is gone (the driver has let go of it): started again when that was wanted, else stopped
  function exited(a, { code, errTail, lost }) {
    if (a.respawn) { a.respawn = false; a.stopping = false; spawnAgent(a); setState(a, 'idle'); return }
    if (!a.stopping && code) emit(a, { kind: 'note', text: 'claude exited (' + code + ')' + (errTail ? ': ' + mask(clip(errTail, 300)) : '') })
    if (lost && a.sessionId) {
      a.sessionId = ''; a.newSessionId = crypto.randomUUID(); a.midTurn = false; save()
      emit(a, { kind: 'note', text: 'its earlier conversation could not be found — the next message starts a new one' })
    }
    a.stopping = false
    setState(a, 'stopped')
  }

  // What runs each agent: the installed claude for every one of them, for now
  const claude = createClaudeDriver({ root, configPath, modDirs, langRule, panelsRule, nameFor, windowOf, effortOf, assistantKey: ASSISTANT_KEY, mask, clip, clip2, describe,
    on: { emit, setState, save, notifyPages, turnEnded, exited } })
  const driverOf = () => claude
  function spawnAgent(a) { driverOf(a).start(a) }

  // Messages another agent sent (a script of its own calling /api/agents/send, not the page or the phone): who sent it,
  // when it says, and a fingerprint of each, kept with the agent, so they are told apart from the person's own after a
  // restart too (the transcript has them as plain messages). Never what they said.
  const PEERS_KEPT = 200
  const peerKey = (text) => crypto.createHash('sha256').update(String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300)).digest('hex').slice(0, 16)
  function markPeers(a) {
    if (!a.peers?.length) return
    const by = new Map(a.peers.map((p) => [p.k, p.from || '']))
    for (const e of a.events) if (e.kind === 'user' && !e.peer && by.has(peerKey(e.text))) { e.peer = true; e.from = by.get(peerKey(e.text)) }
  }
  // what the agents said to each other through the monitor, for the page's agent-talk tab: to this agent, and from it
  function peerTalk(name) {
    const out = []
    for (const a of agents.values()) for (const e of a.events) {
      if (e.kind !== 'user' || !e.peer || (a.name !== name && e.from !== name)) continue
      out.push({ from: e.from || '', to: a.name, text: e.text, at: e.at })
    }
    return out.sort((x, y) => x.at - y.at).slice(-200)
  }

  function send(a, text, files, peer) {
    resumeQ.delete(a.id)   // waiting in line to carry on: anything sent now does that
    // a message sent by hand to an agent waiting for the login: it goes now, in a new process with the login there is
    if (a.loginLost) { a.loginLost = 0; save() }
    // and one stopped at the usage limit: a turn that fails again marks it again, with the new time
    if (a.limitHit) { a.limitHit = null; save() }
    if (!a.proc) spawnAgent(a)
    if (!a.proc) return false
    // the monitor's own words (carry on, a board task…) are English: they say which language to answer in
    const own = a.kind !== 'assistant' && !!systemNote(text) && replyIn?.()
    // just moved to another project: the conversation so far says the old folder (asked, it still named that one), so
    // the first message after says the new one
    const moved = a.movedTo ? '\n\n(The monitor moved you to another project: your working directory is now ' + a.movedTo + '. Work there; folders named earlier in this conversation are the old one.)' : ''
    if (!driverOf(a).send(a, (own ? text + '\n\n' + replyIn() : text) + moved, files)) return false
    if (a.movedTo) { a.movedTo = ''; save() }
    // the files' names for the chips, and their place in the uploads folder ("<dir>/<stored name>") for the preview
    // the monitor's own words to it: a note (the assistant's chat has its own way of showing them)
    const sys = a.kind === 'assistant' ? '' : systemNote(text)
    if (sys) emit(a, { kind: 'note', sys, text: mask(systemNoteText(text)) })
    else if (peer) {
      a.peers = [...(a.peers || []), { k: peerKey(mask(clip2(text, 4000))), from: peer.from || '', at: Date.now() }].slice(-PEERS_KEPT)
      save()
      emit(a, { kind: 'user', peer: true, from: peer.from || '', text: mask(clip2(text, 4000)), files: files.map((p) => p.split('/').pop().replace(/^[0-9a-z]+-/, '')), refs: files.map((p) => p.split('/').slice(-2).join('/')) })
    } else emit(a, { kind: 'user', text: mask(clip2(text, 4000)), files: files.map((p) => p.split('/').pop().replace(/^[0-9a-z]+-/, '')), refs: files.map((p) => p.split('/').slice(-2).join('/')) })
    setState(a, 'working')
    return true
  }

  // its turn failed for want of a login: stop it, and say it will carry on by itself
  function loggedOut(a) {
    a.loginLost = Date.now()
    save()
    stop(a)
    emit(a, { kind: 'note', text: 'Claude Code is not logged in — this agent carries on by itself once it is logged in again' })
    notifyPages()
  }
  // its turn failed at the usage limit: noted with when the limit resets, to carry on then (its claude stays: the
  // limit is the account's, not the process's)
  function limitReached(a, why) {
    const now = Date.now()
    a.limitHit = { at: now, until: resetOf(why, now) || 0, who: loginNow().who }
    a.limitTries = (a.limitTries || 0) + 1
    limitSince = now; lastLimit = a.limitHit
    save()
    const at = a.limitHit.until ? new Date(a.limitHit.until).toTimeString().slice(0, 5) : ''
    emit(a, { kind: 'note', text: 'usage limit reached — this agent carries on by itself ' + (at ? 'after it resets at ' + at : 'once it has reset (tried again in a while)') })
    notifyPages()
  }
  // is Claude Code logged in now, and when were its login files last written
  function loginNow() {
    let at = 0, cred = null, state = null
    const credFile = path.join(CONFIG_DIR, '.credentials.json')
    const stateFile = process.env.CLAUDE_CONFIG_DIR ? path.join(CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json')
    try { cred = JSON.parse(fs.readFileSync(credFile, 'utf8')); at = fs.statSync(credFile).mtimeMs } catch {}
    // on macOS the token is in the keychain: the account in .claude.json is all there is to see
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (process.platform === 'darwin') at = Math.max(at, fs.statSync(stateFile).mtimeMs) } catch {}
    // the account, only as a hash: enough to tell another login from the same one
    const acct = state?.oauthAccount?.accountUuid || state?.oauthAccount?.emailAddress || ''
    const who = acct ? crypto.createHash('sha256').update('crew-limit:' + acct).digest('hex').slice(0, 12) : ''
    return { ok: !!process.env.ANTHROPIC_API_KEY || !!(state?.oauthAccount && (cred?.claudeAiOauth?.accessToken || process.platform === 'darwin')), at, who }
  }
  // every 15 s while an agent waits for the login. It is tried again once logged in — at once if the login was
  // written since it failed, else once (it may have failed on a login it held from before) — and then not again
  // until the login changes, so a login that still does not work is not tried over and over
  setInterval(() => {
    if (shuttingDown) return
    const now = Date.now()
    // stopped at the usage limit: carried on just after it resets (a minute and a half late, to be on the safe side);
    // with no time to go by, after half an hour, then an hour, up to two. Logged in as another account meanwhile (the
    // limits are each account's): carried on at once — not on the same account logged in again, whose limit stays
    let seen = null   // the login, read once and only if needed
    for (const a of agents.values()) {
      const l = a.limitHit
      if (!l || a.loginLost || a.state === 'working' || resumeQ.has(a.id)) continue
      const due = l.until ? l.until + LIMIT_GRACE_MS : l.at + LIMIT_RETRY_MS * Math.min(4, a.limitTries || 1)
      if (now >= due) { resume(a, LIMIT_BACK); continue }
      seen = seen || loginNow()
      if (seen.ok && seen.who && l.who && seen.who !== l.who && now - l.at > 5000) resume(a, LIMIT_ACCOUNT)
    }
    const waiting = [...agents.values()].filter((a) => a.loginLost)
    if (!waiting.length) return
    const login = loginNow()
    if (!login.ok) return
    for (const a of waiting) {
      if (a.proc || now - a.loginLost < 20000 || resumeQ.has(a.id)) continue
      if (!(login.at > a.loginLost || !a.loginTriedAt) || now - (a.loginTriedAt || 0) < 60000) continue
      a.loginTriedAt = now
      resume(a, LOGGED_BACK)
    }
  }, 15000).unref?.()

  // Carrying on after a usage limit reset, a restart or a login comes back: one agent at a time, 40 s apart, the
  // smallest conversation first (the assistant last). Each one, rested past the cache's few minutes, reads its whole
  // conversation in again; all at once, six of them wrote 3M tokens within a minute. In line, the limit reached again
  // stops the rest: they wait for that reset instead of each failing on it.
  const RESUME_GAP_MS = 40 * 1000
  const resumeQ = new Map()   // agent id → { text, at }
  let resumedAt = 0, limitSince = 0, lastLimit = null
  function resume(a, text) {
    if (resumeQ.has(a.id)) return
    resumeQ.set(a.id, { text, at: Date.now() })
    if (resumeQ.size > 1 || Date.now() - resumedAt < RESUME_GAP_MS) emit(a, { kind: 'note', text: 'carries on in a moment — the agents waiting to are let go one at a time, so their conversations are not all read in again at once' })
    // a moment later: the others found in the same look join the line first, and the smallest goes first
    setTimeout(resumeNext, 1000)
  }
  // the first after a restart waits for the page's names, so its claude starts with them (see spawnAgent)
  let namesFirst = null
  async function resumeNext() {
    if (shuttingDown || !resumeQ.size || Date.now() - resumedAt < RESUME_GAP_MS) return
    await (namesFirst ||= named())
    if (shuttingDown || Date.now() - resumedAt < RESUME_GAP_MS) return
    const line = [...resumeQ].map(([id, q]) => ({ id, q, a: agents.get(id) }))
      .sort((x, y) => (x.a?.kind === 'assistant') - (y.a?.kind === 'assistant') || (x.a?.ctxTokens || 0) - (y.a?.ctxTokens || 0))
    for (const { id, q, a } of line) {
      resumeQ.delete(id)
      if (!a || a.state === 'working') continue
      if (q.text !== LOGGED_BACK && lastLimit && limitSince > q.at) { a.limitHit = { ...lastLimit }; save(); notifyPages(); continue }
      resumedAt = Date.now()
      if (send(a, q.text, [])) break
    }
  }
  setInterval(resumeNext, 5000).unref?.()

  function stop(a, quiet) {
    if (!a.proc) return
    a.stopping = true
    const pid = a.proc.pid
    // the whole tree: claude may be running a command of its own
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
    else { try { a.proc.kill('SIGTERM') } catch {} }
    if (!quiet) emit(a, { kind: 'note', text: 'stopped' })
  }

  // the page's names for an agent just added, before its claude starts with them (building the state takes a couple of
  // seconds with many sessions; 10 at most)
  const named = () => Promise.race([Promise.resolve(namesReady?.()).catch(() => {}), new Promise((r) => setTimeout(r, 10000))])

  /* ── API ── */
  async function start(body) {
    const cwd = path.resolve(String(body.cwd || ''))
    try { if (!fs.statSync(cwd).isDirectory()) return [400, { error: 'not a folder' }] } catch { return [400, { error: 'no such folder' }] }
    const mode = MODES.includes(body.mode) ? body.mode : 'default'
    const id = crypto.randomBytes(4).toString('hex')
    const a = {
      // a look and a name picked in the new-agent dialog (both optional)
      fast: !!body.fast, avatar: avatarOf(body.avatar), nick: nickOf(body.nick, typeof body.nickKo === 'string' ? body.nickKo : body.nick), desc: descOf(body.desc),
      id, cwd, key: projectKey(projectRoot(cwd)), name: 'monitor-' + id, mode, model: String(body.model || '').replace(/[^\w.:[\]-]/g, '') || '', effort: effortOf(body.effort),
      newSessionId: crypto.randomUUID(), sessionId: '', proc: null, state: 'idle', stateSince: Date.now(), startedAt: Date.now(), lastAt: 0,
      events: [], streams: new Set(), msg: null, activity: null, activityAt: 0, turns: 0, stopping: false,
    }
    agents.set(id, a)
    save()
    const text = clip(body.text, 8000)
    const files = attachedPaths(body.files)
    // claude takes a while to start; start it now, so it is ready by the time the first message is typed — once the
    // page's state has given it its names (a couple of seconds), without keeping the new-agent dialog waiting for that.
    // A message sent to it meanwhile starts it at once, under claude's own name
    named().then(() => {
      if (a.proc || !agents.has(id)) return
      if (text || files.length) send(a, text, files)
      else spawnAgent(a)
      notifyPages()
    })
    notifyPages()
    return [200, { id, name: a.name }]
  }

  // a VS Code session's conversation, carried on as a monitor agent in the same folder, under the same name and mode
  async function fork({ cwd, sessionId, nick, desc, mode }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return [400, {}]
    try { if (!fs.statSync(cwd).isDirectory()) return [400, { error: 'no such folder' }] } catch { return [400, { error: 'no such folder' }] }
    const id = crypto.randomBytes(4).toString('hex')
    const a = {
      fast: false, avatar: null, nick: nick && typeof nick === 'object' ? nickOf(nick.en, nick.ko) : nickOf(nick, nick), desc: descOf(desc),
      id, cwd, key: projectKey(projectRoot(cwd)), name: 'monitor-' + id, mode: MODES.includes(mode) ? mode : 'default', model: '', effort: '',
      newSessionId: crypto.randomUUID(), sessionId: '', forkFrom: sessionId, forkedFrom: sessionId, proc: null, state: 'idle', stateSince: Date.now(), startedAt: Date.now(), lastAt: 0,
      events: [], streams: new Set(), msg: null, activity: null, activityAt: 0, turns: 0, stopping: false,
    }
    // the conversation so far, so the dialog shows where it left off
    if (historyOf) { try { a.events = await historyOf(sessionId) } catch {} }
    markPeers(a)
    a.events.push({ kind: 'note', text: 'taken over from VS Code — the original session is still there; close it in VS Code if you will not use it', at: Date.now() })
    agents.set(id, a)
    save()
    await named()
    spawnAgent(a)
    notifyPages()
    return [200, { id, name: a.name }]
  }

  // a conversation carried on as it is, under its own id: one from the archive, or an earlier one of the folder that
  // nothing has open now (one still open in VS Code is copied instead, as a take-over is — see fork)
  async function adopt({ cwd, sessionId, nick, desc, avatar, mode, model, effort, note }) {
    if (!isSessionId(sessionId)) return [400, {}]
    try { if (!fs.statSync(cwd).isDirectory()) return [400, { error: 'no such folder' }] } catch { return [400, { error: 'no such folder' }] }
    if (byAgentSession(sessionId)) return [409, { error: 'already open' }]
    const id = crypto.randomBytes(4).toString('hex')
    const a = {
      fast: false, avatar: avatarOf(avatar), nick: nick && typeof nick === 'object' ? nickOf(nick.en, nick.ko) : nickOf(nick, nick), desc: descOf(desc),
      id, cwd, key: projectKey(projectRoot(cwd)), name: 'monitor-' + id, mode: MODES.includes(mode) ? mode : 'default',
      model: String(model || '').replace(/[^\w.:[\]-]/g, ''), effort: effortOf(effort),
      newSessionId: crypto.randomUUID(), sessionId, proc: null, state: 'idle', stateSince: Date.now(), startedAt: Date.now(), lastAt: 0,
      events: [], streams: new Set(), msg: null, activity: null, activityAt: 0, turns: 0, stopping: false,
    }
    if (historyOf) { try { a.events = await historyOf(sessionId) } catch {} }
    a.events.push({ kind: 'note', text: note || 'an earlier conversation, carried on', at: Date.now() })
    agents.set(id, a)
    save()
    await named()
    // carried on: it is no longer put away
    saveArchive(archived().filter((x) => x.sessionId !== sessionId))
    spawnAgent(a)
    notifyPages()
    return [200, { id, name: a.name }]
  }

  async function handle(url, body) {
    const a = agents.get(String(body.id || ''))
    if (url.pathname === '/api/agents/start') return start(body)
    if (url.pathname === '/api/agents/archived') return [200, { list: archived().map((x) => ({ ...x, exists: fs.existsSync(String(x.cwd || '')), inUse: !!byAgentSession(x.sessionId) })) }]
    if (url.pathname === '/api/agents/unarchive') { saveArchive(archived().filter((x) => x.id !== String(body.archiveId || ''))); return [200, {}] }
    if (url.pathname === '/api/agents/restore') {
      const x = archived().find((y) => y.id === String(body.archiveId || ''))
      if (!x) return [404, {}]
      if (byAgentSession(x.sessionId)) return [409, { error: 'already open' }]
      return adopt({ ...x, note: 'brought back from the archive — carrying on the same conversation' })
    }
    if (!a) return [404, {}]
    if (url.pathname === '/api/agents/send') {
      const text = clip(body.text, 8000), files = attachedPaths(body.files)
      if (!text && !files.length) return [400, {}]
      return send(a, text, files, body.peer && typeof body.peer === 'object' ? { from: clip(body.peer.from || '', 120) } : null) ? [200, {}] : [500, {}]
    }
    if (url.pathname === '/api/agents/stop') { stop(a); return [200, {}] }
    // the page and the mods: a drawing asked for, a press, typing, a pick, a pane shown or closed
    if (url.pathname === '/api/agents/ui') return driverOf(a).uiRequest(a, body)
    // the "/" list in the message box
    if (url.pathname === '/api/agents/commands') return [200, { commands: await driverOf(a).commands(a) }]
    // looks stuck: stop it, wait until claude is really gone, then ask it to carry on in the same session
    if (url.pathname === '/api/agents/nudge') {
      const proc = a.proc, text = clip(body.text, 2000)
      if (!text) return [400, {}]
      stop(a)
      if (proc) await new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); setTimeout(r, 5000) })
      return send(a, text, []) ? [200, {}] : [500, {}]
    }
    // the dialog of a stopped agent was opened: get claude ready in the background
    if (url.pathname === '/api/agents/warm') { if (!a.proc) { spawnAgent(a); setState(a, 'idle') } return [200, {}] }
    if (url.pathname === '/api/agents/settings') {
      // takes effect from the next message: the process is restarted on the same session
      if (MODES.includes(body.mode)) a.mode = body.mode
      if (typeof body.model === 'string') { a.model = body.model.replace(/[^\w.:[\]-]/g, ''); a.initModel = '' }
      if (typeof body.effort === 'string') a.effort = effortOf(body.effort)
      // '' follows the monitor's default
      if ('compact' in body) a.compact = body.compact === '' || body.compact == null ? '' : compactOf(body.compact) || a.compact || ''
      if (typeof body.nick === 'string' || typeof body.nickKo === 'string') a.nick = nickOf(body.nick, typeof body.nickKo === 'string' ? body.nickKo : body.nick)
      if (body.avatar !== undefined) a.avatar = a.kind === 'assistant' ? assistantLookOf(body.avatar) : avatarOf(body.avatar)
      if (typeof body.desc === 'string') a.desc = descOf(body.desc)
      if (typeof body.nick === 'string' || typeof body.nickKo === 'string' || body.avatar !== undefined || typeof body.desc === 'string') { save(); notifyPages(); if (!('mode' in body) && !('model' in body) && !('effort' in body) && !('compact' in body)) return [200, {}] }
      save()
      const what = 'mode ' + a.mode + (a.model ? ' · model ' + a.model : '') + (a.effort ? ' · effort ' + a.effort : '') + ' · compact at ' + windowOf(a)
      if (!a.proc) { emit(a, { kind: 'note', text: what + ' — from the next message' }); notifyPages(); return [200, {}] }
      if (await driverOf(a).applyLive(a, { mode: 'mode' in body, model: 'model' in body, flags: 'effort' in body || 'compact' in body })) emit(a, { kind: 'note', text: what + ' — now' })
      else if (a.state === 'working') { a.restartAfterTurn = true; emit(a, { kind: 'note', text: what + ' — after this turn' }) }
      else { a.respawn = true; stop(a); emit(a, { kind: 'note', text: what + ' — from the next message' }) }
      notifyPages()
      return [200, {}]
    }
    // into another project: claude restarted in that folder on the same session (a conversation resumes from any
    // folder, its transcript staying where it is; the next turns work, and find their CLAUDE.md and memory, there)
    if (url.pathname === '/api/agents/move') {
      if (a.kind === 'assistant') return [400, {}]
      const cwd = path.resolve(String(body.cwd || ''))
      try { if (!fs.statSync(cwd).isDirectory()) return [400, { error: 'not a folder' }] } catch { return [400, { error: 'no such folder' }] }
      if (cwd === a.cwd) return [200, {}]
      a.cwd = cwd
      a.movedTo = cwd
      a.key = projectKey(projectRoot(cwd))
      save()
      const what = 'moved to ' + a.key + ' (' + cwd + ')'
      if (!a.proc) emit(a, { kind: 'note', text: what + ' — from the next message' })
      else if (a.state === 'working') { a.restartAfterTurn = true; emit(a, { kind: 'note', text: what + ' — after this turn' }) }
      else { a.respawn = true; stop(a); emit(a, { kind: 'note', text: what }) }
      notifyPages()
      return [200, { key: a.key }]
    }
    if (url.pathname === '/api/agents/close') {
      // kept in the archive when asked — only one with a conversation to carry on
      if (body.archive && isSessionId(a.sessionId) && a.kind !== 'assistant') {
        // a name and a note of the person's own, to find it again later (the conversation's title is not always memorable)
        const title = clip(String(body.title || '').replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim(), 60)
        const note = clip(String(body.note || '').replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim(), 200)
        saveArchive([{ id: crypto.randomBytes(4).toString('hex'), ...Object.fromEntries(ARCHIVE_KEEP.map((k) => [k, a[k]])), title, note, archivedAt: Date.now() }, ...archived().filter((x) => x.sessionId !== a.sessionId)])
      }
      stop(a); agents.delete(a.id); save(); notifyPages(); return [200, {}]
    }
    return [404, {}]
  }

  function stream(req, res, id) {
    const a = agents.get(id)
    if (!a) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('event: init\ndata: ' + JSON.stringify({ events: a.events, state: a.state, ui: a.ui || null }) + '\n\n')
    a.streams.add(res)
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 15000)
    req.on('close', () => { clearInterval(ping); a.streams.delete(res) })
  }

  // the prompt tool's request: show it like any other approval, and wait for a person as long as it takes
  async function prompt(body) {
    const a = agents.get(String(body.agent || ''))
    if (!a) return { behavior: 'deny', message: 'Unknown monitor agent' }
    const input = body.input && typeof body.input === 'object' ? body.input : {}
    const r = await askPage({ hook_event_name: 'PermissionRequest', session_id: a.sessionId, tool_name: String(body.tool_name || ''), tool_input: input, permission_mode: a.mode }, { managed: true })
    const d = r?.hookSpecificOutput?.decision
    if (!d) return { behavior: 'deny', message: 'No answer from the monitor' }
    if (d.behavior === 'allow') return { behavior: 'allow', updatedInput: d.updatedInput || input, ...(d.updatedPermissions ? { updatedPermissions: d.updatedPermissions } : {}) }
    return { behavior: 'deny', message: d.message || 'Denied from the agent monitor', ...(d.interrupt ? { interrupt: true } : {}) }
  }

  // agents for the state API, shaped like registry sessions
  function sessions(now) {
    return [...agents.values()].filter((a) => a.kind !== 'assistant').map((a) => ({
      // forkedFrom: the VS Code session it was taken over from, for good (forkFrom only lasts until its first turn)
      managed: true, agentId: a.id, pid: a.proc?.pid || 0, loginLost: a.loginLost || 0, limitHit: a.limitHit || null, lastFail: a.lastFail || null, forkedFrom: a.forkedFrom || '', sessionId: a.sessionId || a.newSessionId, name: a.name, avatar: a.avatar, nick: a.nick, desc: a.desc || '', cwd: a.cwd, root: projectRoot(a.cwd), key: a.key,
      state: a.state === 'working' ? 'working' : a.state === 'idle' ? 'waiting' : 'resting', running: !!a.proc,
      statusSince: a.stateSince, startedAt: a.startedAt, mode: a.mode, model: a.model, ctxWindow: a.ctxWindow || 0, effort: a.effort || '', compact: a.compact || '', activity: a.activity, activityAt: a.activityAt, lastEventAt: a.lastAt,
    }))
  }
  const byAgentSession = (sessionId) => [...agents.values()].find((a) => a.sessionId === sessionId || a.newSessionId === sessionId)

  function shutdown() { shuttingDown = true; for (const a of agents.values()) stop(a) }

  // the same agent in a new conversation (the board's auto-run, when the old one has grown long): its claude is stopped
  // and the text starts the new one. Not while it works. Resolves with the old and new session ids; null when it was not
  // the time (nothing was done); false when its old claude would not stop or the new one would not start.
  async function freshSession(id, text) {
    const a = agents.get(String(id))
    if (!a || a.kind === 'assistant' || a.state === 'working') return null
    const old = a.sessionId || a.newSessionId
    if (a.proc) {
      a.respawn = false
      stop(a, true)
      for (let i = 0; i < 100 && a.proc; i++) await new Promise((r) => setTimeout(r, 100))
      if (a.proc) return false
    }
    a.sessionId = ''; a.newSessionId = crypto.randomUUID(); a.midTurn = false; a.ctxWindow = 0
    delete a.forkFrom
    save()
    emit(a, { kind: 'note', sys: 'fresh', text: '' })
    return send(a, text, []) ? { old, now: a.newSessionId } : false
  }

  // for a command run from the page: where the agent works, and handing it the result as a message
  const cwdOf = (id) => agents.get(String(id))?.cwd || null
  const agentOf = (id) => { const a = agents.get(String(id)); return a && a.kind !== 'assistant' ? { sessionId: a.sessionId || a.newSessionId, cwd: a.cwd } : null }
  const sendText = (id, text) => { const a = agents.get(String(id)); return !!a && send(a, text, []) }

  const loaded = load()   // the saved list is read before anything asks for an agent by id
  // the monitor's own assistant: one fixed agent, kept in the list like the others, never shown with a project
  function ensureAssistant({ cwd, system, model, nick }) {
    let a = agents.get('assistant')
    if (!a) {
      fs.mkdirSync(cwd, { recursive: true })
      a = {
        kind: 'assistant', fast: false, avatar: null, nick: nick || '', id: 'assistant', cwd, key: '', name: 'monitor-assistant', mode: 'default',
        model: model || 'sonnet', effort: '', newSessionId: crypto.randomUUID(), sessionId: '', proc: null, state: 'idle', stateSince: Date.now(),
        startedAt: Date.now(), lastAt: 0, events: [], streams: new Set(), msg: null, activity: null, activityAt: 0, turns: 0, stopping: false,
      }
      agents.set(a.id, a)
      save()
    }
    a.kind = 'assistant'   // a list saved by 312f266 lost it (KEEP had no kind): the fixed id is enough
    a.system = system   // the role as this version of the monitor writes it, never saved
    // a claude started before it had its role gets it now: at once when free, else once its turn is over
    if (a.proc && !a.procHasRole) { if (a.state === 'working') a.restartAfterTurn = true; else { a.respawn = true; stop(a) } }
    // cut short by a restart: carry on now that it knows what it is
    // (not into a claude still on its way out: once the one with the role is there)
    if (a.resumeWith) {
      const why = a.resumeWith
      delete a.resumeWith
      const go = (n) => (a.proc && !a.procHasRole && n < 50 ? setTimeout(() => go(n + 1), 200) : send(a, why, []))
      go(0)
    }
    return a
  }
  // the monitor's default changed: every running agent that follows it gets it now (or, mid-turn, when its turn is over)
  async function compactChanged() {
    for (const a of agents.values()) {
      if (a.compact || !a.proc) continue
      if (await driverOf(a).applyLive(a, { flags: true })) continue
      if (a.state === 'working') a.restartAfterTurn = true; else { a.respawn = true; stop(a) }
    }
  }
  // the assistant's conversations (the page's and the phone's "earlier conversations"): a new one (no sessionId), or an
  // earlier one of its folder carried on. Its claude starts again on it; the chats open on it get the new history (init).
  async function assistantSession(sessionId) {
    const a = agents.get('assistant')
    if (!a) return [404, {}]
    if (sessionId && !isSessionId(sessionId)) return [400, {}]
    if (a.state === 'working') return [409, { error: 'working' }]
    if (sessionId && sessionId === (a.sessionId || a.newSessionId)) return [200, { sessionId }]
    if (sessionId && byAgentSession(sessionId)) return [409, { error: 'already open' }]
    if (a.proc) {
      a.respawn = false; a.restartAfterTurn = false
      stop(a, true)
      for (let i = 0; i < 100 && a.proc; i++) await new Promise((r) => setTimeout(r, 100))
      if (a.proc) return [409, { error: 'busy' }]
    }
    a.midTurn = false; a.ctxWindow = 0; a.limitHit = null
    delete a.forkFrom; delete a.resumeWith
    let events = []
    if (sessionId) {
      if (historyOf) { try { events = await historyOf(sessionId) } catch {} }
      a.sessionId = sessionId
    } else { a.sessionId = ''; a.newSessionId = crypto.randomUUID() }
    a.events = events
    save()
    const init = 'event: init\ndata: ' + JSON.stringify({ events: a.events, state: 'idle', ui: a.ui || null }) + '\n\n'
    for (const res of a.streams) { try { res.write(init) } catch {} }
    spawnAgent(a); setState(a, 'idle')
    notifyPages()
    return [200, { sessionId: a.sessionId || a.newSessionId }]
  }
  const assistantState = () => { const a = agents.get('assistant'); return a ? { state: a.state, turnEndedAt: a.turnEndedAt || 0, running: !!a.proc, mode: a.mode, model: a.model, effort: a.effort || '', compact: a.compact || '', sessionId: a.sessionId, avatar: a.avatar || null, limitHit: a.limitHit || null } : null }
  // a line in the assistant's chat that is not a message: an alert, or something it did on its own
  const noteTo = (id, ev) => { const a = agents.get(id); if (a) emit(a, ev) }

  return { peerTalk, reloadMods, handle, stream, prompt, sessions, byAgentSession, shutdown, claudeExecutable: claude.executable, cwdOf, agentOf, sendText, freshSession, fork, adopt, ensureAssistant, assistantState, assistantSession, compactChanged, noteTo, loaded, assistantKey: () => ASSISTANT_KEY }
}
