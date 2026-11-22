// The Claude driver: everything about running an agent as the installed `claude` program — the way the VS Code
// extension does it, headless (--print with stream-json in and out), on the user's own Claude Code login.
//
//   start    spawns `claude -p --input-format stream-json --output-format stream-json --include-partial-messages`
//   send     writes a user message (text, and images as image blocks) to its stdin; stdin stays open between turns
//   control  a control request to the running claude (a mode, a model, settings, the mods' drawings), with its answer
//   prompts  permission prompts and questions go to hooks/permission-mcp.mjs (--permission-prompt-tool),
//            which asks the page and waits for an answer
//
// agents.mjs keeps what any agent has, whatever runs it: the list, its events and state, the queue that carries agents
// on after a restart, a login or a usage limit, the API. This file turns what claude prints into those events and
// tells agents.mjs when a turn ends (on.turnEnded) and when its claude is gone (on.exited). Another program (another
// model's CLI) would be a driver of its own beside this one.
//
// What the page receives is normalised and masked like the conversation view: text arrives as the whole block
// so far (so a pattern split across two chunks is still masked), tool calls and results as whole entries.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { mendTranscript } from '../durable.cjs'

export const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
// Claude Code tells a session run without a terminal which claude.ai connectors still want signing in to, and to tell
// the user so; agents added it to the end of their answers, turn after turn. The monitor's Connectors panel shows them
// The others find an agent by the name the person calls it: its claude goes by the page's names (--name), which
// ListAgents and SendMessage show instead of one claude makes up from the folder ("works-17")
const NAMES_RULE = 'Agent monitor: each of the monitor\'s agents goes by the names the user knows it by — in ListAgents and SendMessage ' +
  'its session name is its name in the user\'s language and its other name joined by a dash (say 하영-Ted; one name when it has only one). When the user ' +
  'names an agent, by either name, find it there.'
// the Crew's message bus (bus.mjs, hooks/crew-mcp.mjs): one way for every agent, whatever model runs it, that the
// person sees in the agent-talk tab; claude's own SendMessage reaches only claude sessions, and the monitor never sees it
const CREW_RULE = 'Agent monitor: to message another of the monitor\'s agents, use mcp__crew__send (mcp__crew__agents lists them): it reaches every ' +
  'agent of the monitor, whatever model it runs on, and the user sees it in the agent-talk tab. A message that came to you that way says who sent it; ' +
  'answer it with mcp__crew__send too. Keep SendMessage for Claude sessions outside the monitor.'
const CONNECTORS_RULE ='Agent monitor: connectors that still need authentication are listed in the monitor\'s Connectors panel, so the user already knows. ' +
  'Do not tell the user about them (nor about authorizing them) unless they asked for something that needs one of those connectors.'
// Claude Code logged out under a running agent (a login that ran out, a switch to another account): its turn fails with
// "Not logged in". agents.mjs stops it and starts it afresh once Claude Code is logged in again
const LOGIN_LOST = /Not logged in|Please run \/login|authentication_failed|OAuth token (has )?expired|invalid.{0,20}(api key|bearer token)/i
// a usage limit reached ("You've hit your session limit · resets 4:50pm"): agents.mjs carries it on once it has reset
// (and finds it in a conversation that ended on it before the restart)
export const LIMIT_HIT = /hit your (session |weekly |opus |sonnet |usage )?limit|usage limit reached|limit reached\|\d{10}/i

export function createClaudeDriver({ root, configPath, modDirs, langRule, panelsRule, nameFor, windowOf, effortOf, assistantKey, mask, clip, clip2, describe, on }) {
  const { emit, setState, save, notifyPages } = on
  // the session's flag settings, given whole each time (a new set may replace the last): effort and the compact window
  const flagSettings = (a) => ({ effortLevel: a.effort || null, autoCompactWindow: windowOf(a) })

  // Where `claude` actually is.
  //
  // An app opened from Finder never goes through a login shell, so it gets
  // launchd's bare PATH (/usr/bin:/bin:/usr/sbin:/sbin) and nothing that .zshrc
  // adds: nvm, Homebrew on Apple silicon, ~/.local/bin. Started from a terminal
  // the same code finds claude straight away, which is why this only ever breaks
  // for the packaged app.
  //
  // So: the configured path wins, then the known install locations, then the
  // login shell is asked once. The answer is kept for the life of the process;
  // an agent that starts and stops all day must not pay for a shell each time.
  let foundClaude = null
  function runnable(p) {
    try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false }
  }
  function executable() {
    if (configPath) return configPath
    if (foundClaude) return foundClaude
    if (process.platform === 'win32') {
      try {
        for (const line of execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)) {
          const exe = path.join(path.dirname(line.trim()), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
          if (line.trim() && fs.existsSync(exe)) return exe
        }
      } catch {}
      return 'claude.exe'
    }

    // 1. the usual places, cheapest first. nvm keeps one bin dir per node version,
    //    so that one is a glob rather than a fixed path.
    const home = os.homedir()
    const fixed = [
      path.join(home, '.claude', 'local', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.bun', 'bin', 'claude'),
    ]
    for (const c of fixed) if (runnable(c)) return (foundClaude = c)
    try {
      const vers = path.join(home, '.nvm', 'versions', 'node')
      // newest version first, so a machine with several keeps using the current one
      for (const v of fs.readdirSync(vers).sort().reverse()) {
        const c = path.join(vers, v, 'bin', 'claude')
        if (runnable(c)) return (foundClaude = c)
      }
    } catch {}

    // 2. ask the login shell. -i so interactive-only rc files are read too, which
    //    is where nvm usually lands. Bounded, and a failure just falls through.
    try {
      const sh = process.env.SHELL || '/bin/zsh'
      const out = execFileSync(sh, ['-ilc', 'command -v claude'], {
        encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().split('\n').pop().trim()
      if (out && runnable(out)) return (foundClaude = out)
    } catch {}

    // Nothing found. Return the bare name so spawn fails with ENOENT and the
    // dialog shows 'could not start claude', rather than failing silently.
    return 'claude'
  }

  // Mods (Claude Code plugins with a hooks module) draw in the agent's dialog: its claude is told this page is a surface
  // (ui_attach, as Claude Code for VS Code: no Client modules to run), and what the mods show comes as system messages:
  // a status line, toasts, log lines, the panes they opened, a redraw wanted. They go to the page as they are; the status
  // and the panes are kept, for a dialog opened later. The page asks for the drawings (ui_render) and passes on presses,
  // typing and picks through /api/agents/ui.
  const UI_SURFACE = 'vscode', UI_CLIENT = 'crew'
  const UI_OPS = new Set(['render', 'press', 'input', 'select', 'close', 'pane_show', 'pane_focus', 'scroll', 'focus', 'panes'])
  const plainJson = (v, max) => { try { const s = JSON.stringify(v); return s && s.length <= max ? JSON.parse(s) : null } catch { return null } }
  function onUi(a, o) {
    const ui = a.ui || (a.ui = { status: {}, panes: null })
    const plugin = clip(String(o.plugin || ''), 80)
    if (o.subtype === 'ui_status') {
      const text = typeof o.text === 'string' && o.text ? mask(clip(o.text, 2000)) : ''
      if (text) ui.status[plugin] = text; else delete ui.status[plugin]
      emit(a, { kind: 'ui', ui: 'status', plugin, text }, false)
      return
    }
    if (o.subtype === 'ui_log') {
      if (/\breloaded\b/.test(String(o.text || ''))) a.modCmds = null   // its commands may have changed
      emit(a, { kind: 'note', mod: plugin, text: mask(clip2(String(o.text || ''), 4000)) })
      return
    }
    if (o.subtype === 'ui_toast') { emit(a, { kind: 'ui', ui: 'toast', plugin, text: mask(clip(String(o.text || ''), 2000)), ms: Math.min(60000, Math.max(1500, Number(o.timeout_ms) || 4000)) }, false); return }
    // the rest as they are (the panes, a redraw, focus, a scroll...), without the envelope
    const { type, uuid, session_id, subtype, ...rest } = o
    const body = plainJson(rest, 200000)
    if (!body) return
    if (subtype === 'ui_panes') ui.panes = body
    emit(a, { ...body, kind: 'ui', ui: String(subtype).slice(3), at: 0 }, false)
  }
  // the page and the mods: a drawing asked for, a press, typing, a pick, a pane shown or closed (UI_OPS)
  async function uiRequest(a, body) {
    const op = String(body.op || '')
    if (!UI_OPS.has(op) || a.kind === 'assistant') return [400, {}]
    if (!a.proc) return [200, { ok: false, error: 'not running' }]
    const fields = plainJson(body.request && typeof body.request === 'object' ? body.request : {}, 100000)
    if (!fields) return [400, {}]
    const r = await control(a, { ...fields, subtype: 'ui_' + op, surface: UI_SURFACE, client_id: UI_CLIENT }, op === 'render' ? 15000 : 8000)
    return [200, r.subtype === 'success' ? { ok: true, response: r.response ?? null } : { ok: false, error: clip(String(r.error || 'failed'), 300) }]
  }
  // the mod folders the agents load (config.json "mods"): each a plugin, or a folder of them
  const modArgs = () => [...new Set(modDirs?.() || [])].slice(0, 40).flatMap((p) => ['--plugin-dir', p])

  // one line of stream-json from the child → zero or more page events
  function onLine(a, line) {
    let o
    try { o = JSON.parse(line) } catch { return }
    a.lastAt = Date.now()
    if (o.type === 'control_response') {
      const r = o.response || {}, done = a.controls?.get(r.request_id)
      if (done) { a.controls.delete(r.request_id); done(r) }
      return
    }
    if (o.type === 'system' && typeof o.subtype === 'string' && o.subtype.startsWith('ui_')) { if (a.kind !== 'assistant') onUi(a, o); return }
    if (o.type === 'system' && o.subtype === 'init') {
      if (o.session_id && o.session_id !== a.sessionId) { a.sessionId = o.session_id; delete a.forkFrom; save() }
      // the model claude says it runs is written down only when it changed under it (/model): an alias picked
      // here (sonnet) stays an alias rather than becoming the version it stands for today
      if (o.model) { if (a.initModel && o.model !== a.initModel) a.model = o.model; a.initModel = o.model }
      if (o.permissionMode) a.mode = o.permissionMode
      notifyPages()
      return
    }
    if (o.type === 'stream_event' && o.event) {
      const e = o.event
      if (o.parent_tool_use_id) return   // a subagent's own stream stays out of the main conversation
      if (e.type === 'message_start') { a.msg = { id: e.message?.id || crypto.randomUUID(), blocks: {} }; setState(a, 'working') }
      else if (e.type === 'content_block_start' && a.msg) {
        const b = e.content_block || {}
        if (b.type === 'text' || b.type === 'thinking') a.msg.blocks[e.index] = { type: b.type, text: '' }
      } else if (e.type === 'content_block_delta' && a.msg) {
        const blk = a.msg.blocks[e.index]
        const d = e.delta || {}
        if (blk && d.type === 'text_delta') blk.text += d.text || ''
        else if (blk && d.type === 'thinking_delta') blk.text += d.thinking || ''
        else return
        const now = Date.now()
        if (now - (blk.sentAt || 0) > 120) { blk.sentAt = now; emit(a, { kind: 'block', msg: a.msg.id, index: e.index, type: blk.type, text: mask(clip2(blk.text, 20000)) }) }
      } else if (e.type === 'content_block_stop' && a.msg) {
        const blk = a.msg.blocks[e.index]
        if (blk) emit(a, { kind: 'block', msg: a.msg.id, index: e.index, type: blk.type, text: mask(clip2(blk.text, 20000)), done: true })
      }
      return
    }
    if (o.type === 'assistant' && !o.parent_tool_use_id && o.message?.usage && o.message.model !== '<synthetic>') {
      const u = o.message.usage, n = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0)
      if (n) a.ctxTokens = n
    }
    if (o.type === 'assistant' && o.error === 'authentication_failed') a.loginFailed = true
    if (o.type === 'assistant' && o.error === 'rate_limit') a.limitFailed = true
    // a slash command's answer (/context, /usage, /model…) is no model reply: claude writes it as one whole message
    // with no stream before it, so it is shown here, as the agent's text
    if (o.type === 'assistant' && o.message?.model === '<synthetic>' && !o.parent_tool_use_id && Array.isArray(o.message.content)) {
      const text = o.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n')
      if (text) emit(a, { kind: 'block', msg: String(o.message.id || crypto.randomUUID()), index: 0, type: 'text', text: mask(clip2(text, 20000)), done: true })
      const eff = /^Set effort level to (\w+)/.exec(text)
      if (eff) { a.effort = effortOf(eff[1]); save(); notifyPages() }
      return
    }
    // /clear: a new conversation in the same process; its id comes with the next init
    if (o.type === 'conversation_reset') { emit(a, { kind: 'note', text: 'a new conversation — the earlier one stays on disk' }); return }
    if (o.type === 'assistant' && !o.parent_tool_use_id && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c?.type === 'tool_use') {
          a.activity = describe(c.name, c.input)
          a.activityAt = Date.now()
          emit(a, { kind: 'tool', id: String(c.id || ''), name: String(c.name || ''), action: a.activity, input: mask(clip2(JSON.stringify(c.input ?? {}, null, 1), 8000)) })
        }
      }
      return
    }
    if (o.type === 'user' && !o.parent_tool_use_id && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c?.type !== 'tool_result') continue
        const raw = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => x?.type === 'text' ? x.text : '[' + (x?.type || 'data') + ']').join('\n') : ''
        // images in it go by count only; the page fetches them from the transcript (/img/result in server.mjs)
        const images = Array.isArray(c.content) ? c.content.filter((x) => x?.type === 'image').length : 0
        emit(a, { kind: 'result', id: String(c.tool_use_id || ''), error: !!c.is_error, text: mask(clip2(raw, 3000)), ...(images ? { images } : {}) })
      }
      return
    }
    if (o.type === 'result') {
      a.turns++
      // how much context its model holds, as claude says, for the meter by the message box (the largest: a small
      // model's side jobs are listed too)
      const win = Math.max(0, ...Object.values(o.modelUsage || {}).map((v) => Number(v?.contextWindow) || 0))
      if (win) a.ctxWindow = win
      // a failed turn says why (an API error, a limit…) instead of ending silently
      emit(a, { kind: 'turn', ok: !o.is_error, subtype: String(o.subtype || ''), ms: o.duration_ms || 0, ...(o.is_error ? { text: mask(clip(String(o.result || (o.errors || []).join('; ') || o.subtype || ''), 400)) } : {}) })
      setState(a, 'idle')
      const why = String(o.result || (o.errors || []).join('; '))
      const failed = o.is_error && (a.loginFailed || LOGIN_LOST.test(why))
      const limited = o.is_error && !failed && (a.limitFailed || LIMIT_HIT.test(why))
      a.loginFailed = false; a.limitFailed = false
      // the rest is agents.mjs's: what failed it, the login, the limit, a restart wanted, the board's next task
      on.turnEnded(a, { ok: !o.is_error, failed, limited, why, failText: o.is_error ? mask(clip(String(o.result || (o.errors || []).join('; ') || o.subtype || ''), 200)) : '' })
    }
  }

  // The slash commands claude offers in a folder (its built-ins, the user's and the project's skills and commands,
  // plugins'), for the "/" list in the message box: a claude started only to ask its initialize request, without
  // hooks or MCP servers and without a message, so no session is made and no one is billed. Kept a few minutes per folder.
  // The few that only mean something in the terminal (colours, the focus view) are left out, as claude itself does.
  const TERMINAL_ONLY = new Set(['color', 'focus', 'reload-plugins', 'heapdump'])
  const commandList = (cmds) => (Array.isArray(cmds) ? cmds : []).filter((c) => c && typeof c.name === 'string' && !c.name.startsWith('__') && !TERMINAL_ONLY.has(c.name)).slice(0, 300).map((c) => ({
    name: clip(c.name, 80), desc: clip(String(c.description || '').replace(/\s+/g, ' '), 240), hint: clip(String(c.argumentHint || ''), 80),
    aliases: Array.isArray(c.aliases) ? c.aliases.filter((x) => typeof x === 'string').slice(0, 5) : [], builtin: !!c.builtin,
  }))
  // the commands its mods register (the claude above runs no hooks, so no mod): asked of the agent's own claude, once
  // per claude and again after a mod is reloaded. reload_plugins answers with the whole list, and leaves unchanged mods as they are
  async function modCommands(a) {
    if (!a.proc || !modArgs().length) return []
    if (!a.modCmds) a.modCmds = control(a, { subtype: 'reload_plugins' }, 15000).then((r) => r.subtype === 'success' ? commandList(r.response?.commands) : [])
    return a.modCmds
  }
  const commandCache = new Map()   // cwd → { at, list | promise }
  function commandsIn(cwd) {
    const hit = commandCache.get(cwd)
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list
    const list = new Promise((resolve) => {
      let child, rest = '', done = false
      const end = (v) => { if (done) return; done = true; clearTimeout(timer); try { child?.kill() } catch {}; resolve(v) }
      const timer = setTimeout(() => end([]), 20000)
      try {
        child = spawn(executable(), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--settings', JSON.stringify({ disableAllHooks: true })],
          { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: process.env })
      } catch { return end([]) }
      child.on('error', () => end([]))
      child.stdin.on('error', () => end([]))
      child.on('exit', () => end([]))
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        const parts = (rest + chunk).split('\n')
        rest = parts.pop()
        for (const l of parts) {
          let o
          try { o = JSON.parse(l) } catch { continue }
          if (o.type !== 'control_response') continue
          end(commandList((o.response?.response || o.response || {}).commands))
        }
      })
      try { child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'cmds', request: { subtype: 'initialize' } }) + '\n') } catch { end([]) }
    })
    commandCache.set(cwd, { at: Date.now(), list })
    list.then((v) => { if (!v.length) commandCache.delete(cwd) })   // none came back: ask again next time
    return list
  }
  // the "/" list: the folder's, and its mods' that are not among them
  async function commands(a) {
    const [base, mods] = await Promise.all([commandsIn(a.cwd), modCommands(a)])
    const have = new Set(base.map((c) => c.name))
    return [...base, ...mods.filter((c) => !have.has(c.name))]
  }

  // the monitor's own PORT is not the agents': a dev server one starts (Nuxt, Vite…) takes PORT over its own setting
  const agentEnv = () => { const env = { ...process.env }; delete env.PORT; return env }
  function start(a) {
    // MONITOR_LINK: a second monitor (the test app) has its own link file, and its agents' tools must reach it, not the installed one
    const nodeEnv = { MONITOR_AGENT: a.id, ...(process.env.MONITOR_LINK ? { MONITOR_LINK: process.env.MONITOR_LINK } : {}), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
    const servers = { monitor: { command: process.execPath, args: [path.join(root, 'hooks', 'permission-mcp.mjs')], env: nodeEnv } }
    // the assistant (see assistant.mjs) also gets the monitor's own tools: look at every agent, message, answer, alert
    // the desktop app's terminal panel for the others: open a tab for a dev server, read one, type into one (each asks the person)
    if (a.kind !== 'assistant') servers.terminal = { command: process.execPath, args: [path.join(root, 'hooks', 'terminal-mcp.mjs')], env: nodeEnv }
    // the Crew's message bus (bus.mjs): the other agents, and a message to one of them through the monitor
    if (a.kind !== 'assistant') servers.crew = { command: process.execPath, args: [path.join(root, 'hooks', 'crew-mcp.mjs')], env: nodeEnv }
    if (a.kind === 'assistant') servers.assistant = { command: process.execPath, args: [path.join(root, 'hooks', 'assistant-mcp.mjs')], env: { ...nodeEnv, MONITOR_ASSISTANT_KEY: assistantKey } }
    const mcp = JSON.stringify({ mcpServers: servers })
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--permission-mode', a.mode, '--mcp-config', mcp, '--permission-prompt-tool', 'mcp__monitor__approve',
      // lets "All OK" (bypassPermissions) be chosen, at the start or later; it is on only while that mode is picked
      '--allow-dangerously-skip-permissions']
    // the assistant: its role, and its monitor tools used without a prompt (anything else still asks the person)
    // its own tools never ask, with or without its role; the role itself once the assistant module has given it
    if (a.kind === 'assistant') args.push('--allowedTools', 'mcp__assistant')
    // the terminal tools ask the person themselves (opening, typing), so Claude Code does not ask again; the crew tools
    // only reach the person's own agents, through the monitor, which shows what was said
    else args.push('--allowedTools', 'mcp__terminal,mcp__crew')
    if (a.kind === 'assistant' && a.system) args.push('--append-system-prompt', a.system + '\n\n' + CONNECTORS_RULE)
    // the person's language, and the monitor's panels it may use, where every step sees them (a line in the conversation
    // drifts out of view, or a compaction drops it)
    else if (a.kind !== 'assistant') { const sys = [langRule?.(), panelsRule?.(), NAMES_RULE, CREW_RULE, CONNECTORS_RULE].filter(Boolean).join('\n\n'); if (sys) args.push('--append-system-prompt', sys) }
    a.procHasRole = a.kind === 'assistant' && !!a.system
    // the name the others see it by (a new one once the page has given it one: the next claude it starts takes it)
    const label = a.kind === 'assistant' ? '' : nameFor?.(a) || ''
    if (label) args.push('--name', label)
    a.procName = label
    if (a.model) args.push('--model', a.model)
    if (a.effort) args.push('--effort', a.effort)
    // crossSessionInbound "accept": a message another session sends it (SendMessage) is delivered even when the two run
    // in different permission modes. Claude Code holds those for its user's approval, which a claude run like this has
    // no way to ask, so they expired undelivered ("not approved before expiry") between, say, an agent on All OK and
    // one asking first. The senders are the person's own sessions on this PC; a repo's or the organization's "hold" still wins
    args.push('--settings', JSON.stringify({ autoCompactWindow: windowOf(a), crossSessionInbound: 'accept' }))
    // quick start: only the monitor's own tool, none of the user's MCP servers and connectors
    if (a.fast) args.push('--strict-mcp-config')
    // the mods (not for the assistant, whose chat draws none of it)
    if (a.kind !== 'assistant') args.push(...modArgs())
    // a conversation carried on whose transcript a reset left with NULs at its end: mended first (kept as it was beside it)
    const resumed = a.sessionId || a.forkFrom
    if (resumed) {
      try {
        const cut = mendTranscript(path.join(CONFIG_DIR, 'projects', String(a.cwd).replace(/[^a-zA-Z0-9]/g, '-'), resumed + '.jsonl'))
        if (cut) emit(a, { kind: 'note', text: 'Its conversation file ended in ' + cut + ' broken bytes (a reset of the PC); they were taken out before carrying on, and the file as it was kept beside it (.nul-…)' })
      } catch {}
    }
    if (a.sessionId) args.push('--resume', a.sessionId)
    // taken over from a VS Code session: a copy of that conversation with an id of its own, so the original can
    // stay open in VS Code without the two writing to one transcript; claude tells the new id on its first turn
    else if (a.forkFrom) args.push('--resume', a.forkFrom, '--fork-session')
    else args.push('--session-id', a.newSessionId)
    let child
    // a claudePath that cannot be run at all throws right here, not as an 'error' event
    // a mod edited while it runs is loaded again (each reload says so in a log line)
    try { child = spawn(executable(), args, { cwd: a.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: a.kind === 'assistant' ? agentEnv() : { ...agentEnv(), CLAUDE_CODE_PLUGIN_DIR_WATCH: '1' } }) }
    catch (e) { emit(a, { kind: 'note', text: 'could not start claude: ' + e.message }); a.proc = null; setState(a, 'stopped'); return }
    a.proc = child
    // claude gone between a write and its 'exit' (EPIPE): the write failed, and an error with no listener would take the
    // whole app down; its exit says the rest
    child.stdin.on('error', (e) => { if (a.proc === child) emit(a, { kind: 'note', text: 'claude closed its input (' + (e.code || e.message) + '): the last message may not have reached it' }) })
    a.ui = { status: {}, panes: null }
    a.modCmds = null
    emit(a, { kind: 'ui', ui: 'reset' }, false)
    // this page draws what the mods show
    if (a.kind !== 'assistant') control(a, { subtype: 'ui_attach', surface: UI_SURFACE, client_id: UI_CLIENT, viewport: { columns: 100, rows: 30, isFullscreen: true } })
    // the session id is kept only once claude has said it (its first output, above): an agent started and then
    // restarted before its first turn has no conversation yet, and resuming one left it with "No conversation found"
    let rest = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const parts = (rest + chunk).split('\n')
      rest = parts.pop()
      for (const l of parts) if (l.trim()) onLine(a, l)
    })
    let errTail = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000) })
    child.on('error', (e) => { emit(a, { kind: 'note', text: 'could not start claude: ' + e.message }); a.proc = null; setState(a, 'stopped') })
    child.on('exit', (code) => {
      if (a.proc !== child) return
      a.proc = null
      a.ui = null
      emit(a, { kind: 'ui', ui: 'reset' }, false)
      for (const done of a.controls?.values() || []) done({ subtype: 'error', error: 'claude exited' })
      a.controls = null
      // the rest is agents.mjs's (started again, or stopped); its conversation gone when claude could not find it
      on.exited(a, { code, errTail, lost: /No conversation found with session ID/i.test(errTail) })
    })
  }

  // a control request to the running claude (a new mode or model without a restart); resolves with its answer
  let controlSeq = 0
  function control(a, request, ms = 5000) {
    return new Promise((resolve) => {
      if (!a.proc) return resolve({ subtype: 'error', error: 'not running' })
      const id = 'm' + (++controlSeq)
      a.controls = a.controls || new Map()
      const timer = setTimeout(() => { a.controls?.delete(id); resolve({ subtype: 'error', error: 'no answer' }) }, ms)
      a.controls.set(id, (r) => { clearTimeout(timer); resolve(r) })
      try { a.proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n') } catch { a.controls.delete(id); clearTimeout(timer); resolve({ subtype: 'error', error: 'write failed' }) }
    })
  }
  // a new mode, model, or flag settings (effort, the compact window) for the running claude, without a restart:
  // true when it took every one (false: it has to be restarted for them)
  async function applyLive(a, { mode, model, flags }) {
    const asks = [...(mode ? [{ subtype: 'set_permission_mode', mode: a.mode }] : []), ...(model ? [{ subtype: 'set_model', ...(a.model ? { model: a.model } : {}) }] : []),
      // effort and the compact window have no request of their own: they go in as the session's settings
      ...(flags ? [{ subtype: 'apply_flag_settings', settings: flagSettings(a) }] : [])]
    const answers = await Promise.all(asks.map((r) => control(a, r)))
    return answers.every((r) => r.subtype === 'success')
  }

  // a user message: text plus attachments — images inline as image blocks, other files by path
  function userMessage(text, files) {
    const content = []
    const others = []
    for (const p of files) {
      const type = IMAGE_TYPES[path.extname(p).toLowerCase()]
      if (type) { try { content.push({ type: 'image', source: { type: 'base64', media_type: type, data: fs.readFileSync(p).toString('base64') } }); continue } catch {} }
      others.push(p)
    }
    const body = [text, others.length ? 'Attached files (open them with the Read tool):\n' + others.map((p) => '  ' + p).join('\n') : ''].filter(Boolean).join('\n')
    if (body) content.push({ type: 'text', text: body })
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
  }
  // to its running claude; false when that failed
  function send(a, text, files) {
    const msg = userMessage(text, files)
    try { a.proc.stdin.write(JSON.stringify(msg) + '\n') } catch { return false }
    return true
  }

  return { executable, start, send, control, applyLive, uiRequest, commands }
}
