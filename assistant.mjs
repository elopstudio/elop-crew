// The monitor's assistant: one fixed monitor agent, behind the floating chat button, that looks after all the
// others for the person. It works only through the tools in hooks/assistant-mcp.mjs (answered here) and is told
// about what matters as it happens: a permission request (at once, so it can answer before a VS Code session's
// request goes back to VS Code), a question or plan left waiting, an agent that finished, failed or looks stuck, the
// login going away or coming back, the plan running out. Nothing here is stored beyond what the agent list already
// keeps; events are held in memory until passed on, and the account is known to it only as logged in or not.
import path from 'node:path'

const SYSTEM = `You are the assistant of ELOP Crew (the AI Agent Monitor) on this PC: a dashboard of every Claude Code session here — the agents
the monitor runs itself and the sessions open in VS Code — grouped by project. The person talks to you in a chat
window on that dashboard. Your job is to look after the agents for them: know what each is doing, keep work moving,
answer what is routine yourself, and bring the person only what needs them — with what you recommend.

Your tools (mcp__assistant__*):
- status: every project (with its folder) and agent, what it is doing, stuck, failed or waiting-for-login ones, the
  requests waiting for an answer, whether Claude Code is logged in, and the plan's usage. Look before you act or
  report; never guess at state.
- conversation: the last of one agent's conversation — what it was asked, what it said, the tools it used. Read it
  before judging what an agent is doing, why it failed or what should come next.
- send_message: tell an agent something (to carry on, retry, report, or a reminder).
- answer_request: allow or deny a waiting permission request.
- nudge: stop a stuck monitor agent and ask it to carry on.
- notify_user: get the person's attention (desktop notification and a badge).
- terminals: the shells open in the desktop app's terminal panel — the person's own terminals, not agents: each
  one's id, tab, shell, name, the folder it is in and when it last printed.
- terminal_output: the last lines one of them shows (keys, tokens and e-mail addresses masked). Read it to tell the
  person whether a build, test or server there finished, failed or is still going.
- terminal_type: type a command into one of them. Each time the person is asked on the page first and it runs only
  if they allow it; give the reason. Use it only when the person asked for it or it plainly helps them (rerun a
  failed command, stop a server with Ctrl+C), never to type secrets, and never in place of an agent's own work.
- terminal_open: open new tabs there, each a shell in a folder with a command run in it (a dev server the person asked
  for). The person is asked on the page first, as with terminal_type. The monitor's agents have it too, with the others.

How you work
- Messages that start with "[Monitor events]" come from the monitor, not the person. For each batch: call status,
  act on what you can, then write to the person — one short line when nothing needs them.
- Be decisive: handle what is routine yourself. When something is the person's to decide, put it in one line with
  your recommendation and why ("허용 추천: …" / "Recommend allowing: …"), so they can answer at a glance.
- Be ahead of the person: when an agent finishes or fails, read its conversation if it matters and say in a line or
  two what happened and the next step you suggest — or take it (tell the agent to carry on, retry or report). Do not
  report routine progress nobody needs.

The person decides how far you may answer requests (status shows it, and the monitor holds you to it): off — answer
none, recommend instead; reading only — allow only what changes nothing; in the project — the rules below.

Permission requests (they reach you at once; a VS Code session's request goes back to VS Code when its time runs
out — status shows how long it has — so answer those first)
Allow, without asking, work inside the agent's own project folder that can be undone:
- reading, listing and searching files; git status, diff, log, show, branch;
- creating and editing files in the project;
- building, type-checking, linting, formatting, running the tests and the project's own scripts (npm/pnpm/yarn run,
  npx of the project's tools, pytest, cargo, go test, make …);
- installing the project's dependencies inside it (npm install, pip install in its virtualenv) — never global installs;
- local git that can be undone: add, commit, creating or switching a branch, stash;
- starting or stopping the project's dev server; requests to localhost.
Leave to the person, with your recommendation: any git push, force, reset --hard, rebase or other history rewrites;
deleting files other than build output; anything outside the project folder; credentials, tokens, keys, .env files;
deploys and releases; money; sending messages or e-mail; network calls to hosts other than package registries and the
project's own; global installs and system settings; anything you cannot tell is safe.
Deny only what is clearly wrong for the task, and tell the person why.
Questions an agent asks the person, and plans to approve, are always the person's: say in a line what is asked and
what you would pick.

The login
- When the monitor says Claude Code was logged out, every agent that tries to work fails with "Not logged in". Tell
  the person once, plainly, that Claude Code needs to be logged in again (Account in the page's menu, or
  \`claude auth login\` in a terminal) and which agents are held up. Monitor agents waiting for the login carry on by
  themselves once it is back: do not nudge or message them about it. VS Code sessions need a new message in VS Code.
- When it is back, say so in a line; if it is another account than before, add that usage and limits are now that
  account's.

Agents
- One that looks stuck: read its conversation; nudge a monitor agent if it really is stuck, tell the person about a VS
  Code session (it is stopped in its own panel).
- A failed turn: a passing error (overloaded, network, rate limit) — nudge or message it once to retry; one that needs
  the person (the login, a usage limit reached, billing) — tell them.

Write to the person in the language the monitor tells you they use, briefly, with agent names as status shows them.
Every answer you give a request is shown to the person with your reason; keep it short and concrete.
You have no project of your own: do not edit files or run commands unless the person asks you to.`

// what the person lets it do, from its settings: how far it may answer requests, and what it is told about (each event
// it is told costs a turn, so any of them can be left out)
const APPROVE = ['off', 'read', 'project']
const EVENTS = ['asks', 'waiting', 'finished', 'failed', 'stuck', 'login', 'usage']
function optionsOf(v) {
  const o = { approve: APPROVE.includes(v?.approve) ? v.approve : 'project' }
  for (const k of EVENTS) o[k] = v?.[k] !== false
  return o
}
const APPROVE_TEXT = {
  off: 'OFF — the person answers every request; do not answer any, recommend instead',
  read: 'READING ONLY — allow only work that changes nothing (reading, listing, searching, git status/diff/log/show, running tests); leave everything else to the person with your recommendation',
  project: 'IN THE PROJECT — allow routine work inside the agent\'s own project that can be undone, as your instructions say',
}
// changes nothing: one command (pipes allowed, no chaining or redirection) that only reads, lists, searches or tests
const READ_TOOLS = /^(Read|Glob|Grep|LS|NotebookRead|WebSearch|TodoWrite)$/
const READ_COMMAND = /^\s*(git\s+(status|diff|log|show|branch|blame|remote(\s+-v)?|rev-parse|describe|ls-files)\b|ls\b|dir\b|cat\b|type\b|head\b|tail\b|grep\b|rg\b|findstr\b|find\b|pwd\b|echo\b|wc\b|which\b|where\b|tree\b|Get-ChildItem\b|Get-Content\b|Select-String\b|Test-Path\b|(npm|pnpm|yarn)\s+(test|run\s+(test|lint|typecheck|check))\b|npx\s+(tsc\s+--noEmit|eslint|vitest\s+run|jest)\b|pytest\b|go\s+(test|vet)\b|cargo\s+(test|check|clippy)\b)/i
// never the assistant's to allow, whatever it is let do: pushes and history rewrites, recursive deletes, publishing and
// deploying, secrets — held by the monitor, not only asked of it
const NEVER = /\bgit\s+(push|reset\s+--hard|rebase|filter-(branch|repo)|clean\s+-[a-z]*f)\b|--force\b|\s-f\b.*\bpush\b|\brm\s+-[a-z]*r|\bRemove-Item\b[^|;]*-Recurse|\brmdir\s+\/s|\b(npm|pnpm|yarn)\s+publish\b|\bdeploy\b|\brelease\b|(^|[\\/\s"'])\.env(\.|\b)|credential|secret|\.pem\b|id_rsa|\btoken\b/i
const neverAllow = (a) => NEVER.test(String(a.code || '')) || NEVER.test(String(a.what || ''))
const readOnly = (a) => READ_TOOLS.test(a.tool) || (/^(Bash|PowerShell)$/.test(a.tool) && !!a.code && !String(a.code).endsWith('…') && READ_COMMAND.test(a.code) && !/;|&&|\|\||>|<|`|\$\(|\b(rm|del|Remove-Item|mv|move|cp|copy|Set-Content|Out-File)\b/i.test(a.code))

const WAIT_TELL_MS = 2 * 60 * 1000   // a question or plan left this long is passed on (they are the person's)
const WORKED_MS = 60 * 1000          // a turn this long, ended, is passed on as finished
// Each event it is told is a turn, and a turn after a few minutes' rest reads its whole conversation into a cold cache
// again. Requests, questions, failures, stuck agents and the login are told at once; a finished turn or a usage level
// waits until something urgent goes anyway, its cache is still warm (its last turn ended under 4 min ago), or 20 min.
const URGENT = new Set(['asks', 'waiting', 'failed', 'stuck', 'login'])
const WARM_MS = 4 * 60 * 1000, ROUTINE_WAIT_MS = 20 * 60 * 1000
const TICK_MS = 15 * 1000

export function createAssistant({ agents, dataDir, state, decide, sendTo, requestSession, personOnly, notifyPages, lang, login, conversation, options, saveOptions, terminals, mask, askPerson }) {
  const opts = () => optionsOf(options?.())
  async function setOptions(body) {
    const o = optionsOf(body)
    const code = await saveOptions(o)
    if (code === 200) notifyPages()
    return code
  }
  // a request the assistant itself is waiting on (its own tool calls): never for it to answer
  const ownRequest = (id) => { const me = agents.assistantState(); return !!personOnly?.(id) || (!!me?.sessionId && requestSession(id) === me.sessionId) }
  let on = false
  const cwd = path.join(dataDir, '.runtime', 'assistant')

  // created the first time the chat is opened, and from then on kept like any monitor agent
  async function start() {
    await agents.loaded
    agents.ensureAssistant({ cwd, system: SYSTEM, model: 'sonnet' })
    on = true
    return { id: 'assistant' }
  }
  // after a restart: an assistant from before is there already — give it its role again and keep watching
  agents.loaded.then(() => { if (agents.assistantState()) start() }).catch(() => {})

  const who = (s) => s.nickKo || s.nick || s.name
  const allSessions = (data) => (data.projects || []).flatMap((p) => p.sessions.map((s) => ({ ...s, project: p.key, root: p.root })))
  function findAgent(data, name) {
    const n = String(name || '').trim().toLowerCase()
    return allSessions(data).find((s) => [s.nickKo, s.nick, s.name, s.short].some((x) => x && String(x).toLowerCase() === n))
  }
  const mins = (ms) => Math.max(0, Math.round(ms / 60000))
  let loginNow = null   // { loggedIn, plan, who } — who is a hash, compared here and never shown

  function statusText(data) {
    const now = Date.now(), lines = []
    if (loginNow) lines.push('Claude Code login: ' + (loginNow.loggedIn ? 'logged in' + (loginNow.plan ? ' (plan ' + loginNow.plan + ')' : '') : 'NOT LOGGED IN — every agent that tries to work fails'))
    if (lang?.()) lines.push("The person's language: " + lang())
    lines.push('Answering requests for the person: ' + APPROVE_TEXT[opts().approve])
    for (const p of data.projects || []) {
      lines.push(...(lines.length ? [''] : []), `Project ${p.key}${p.name ? ' "' + p.name + '"' : ''}${p.label ? ' (' + p.label + ')' : ''} — folder ${p.root || '?'}:`)
      for (const s of p.sessions) {
        const act = s.activity ? [s.activity.key, s.activity.arg].filter(Boolean).join(' ') : ''
        lines.push(`- ${who(s)}${s.isLeader ? ' [leader]' : ''} · ${s.managed ? 'monitor agent' : 'VS Code session'} · ${s.state}` +
          (s.title ? ` · on: ${s.title}` : '') + (s.role ? ` · role: ${s.role}` : '') + (act ? ` · ${act}` : '') +
          (s.loginLost ? ' · STOPPED, WAITING FOR THE LOGIN (carries on by itself once logged in)' : '') +
          (s.limitHit ? ' · STOPPED AT THE USAGE LIMIT (carries on by itself ' + (s.limitHit.until ? 'after it resets at ' + new Date(s.limitHit.until).toTimeString().slice(0, 5) : 'once it has reset') + ')' : '') +
          (s.lastFail ? ` · last turn failed ${mins(now - s.lastFail.at)} min ago: ${s.lastFail.text}` : '') +
          (s.stalledFor ? ` · LOOKS STUCK for ${mins(now - s.stalledFor)} min` : '') +
          (s.errors ? ` · ${s.errors}/${s.results} recent tool results failed` : '') + (s.mode ? ` · mode ${s.mode}` : ''))
      }
    }
    const asks = (data.approvals || []).filter((a) => !ownRequest(a.id))
    lines.push('', asks.length ? 'Waiting for an answer:' : 'No requests waiting.')
    for (const a of asks) {
      const kind = a.questions ? 'question for the person' : a.plan ? 'plan to approve (for the person)' : 'permission'
      const left = a.expiresAt ? Math.round((a.expiresAt - now) / 1000) : 0
      lines.push(`- id ${a.id} · ${a.nickKo || a.nick || a.session} (${a.project || '?'}, ${a.managed ? 'monitor agent' : 'VS Code session'}) · ${kind} · ${a.tool}` +
        (a.what ? ': ' + a.what : '') + (a.code ? ' · ' + String(a.code).slice(0, 800) : '') + ` · waiting ${Math.round((now - a.at) / 1000)} s` +
        (!a.managed && left > 0 && !a.questions && !a.plan ? ` · goes back to VS Code in ${left} s` : ''))
    }
    for (const x of data.usage?.limits || []) lines.push(`Usage ${x.kind}${x.model ? ' ' + x.model : ''}: ${Math.round(x.percent)}%`)
    return lines.join('\n')
  }

  // the last of a conversation, as lines: what it was asked, what it said, the tools it used and what failed
  function conversationText(events) {
    const out = []
    for (const e of events.slice(-40)) {
      if (e.kind === 'user') out.push('asked: ' + String(e.text || '').slice(0, 400))
      else if (e.kind === 'block' && e.text) out.push('said: ' + String(e.text).slice(0, 700))
      else if (e.kind === 'tool') out.push('tool: ' + (e.action ? [e.action.key, e.action.arg].filter(Boolean).join(' ') : e.name))
      else if (e.kind === 'result' && e.error) out.push('tool failed: ' + String(e.text || '').slice(0, 200))
      else if (e.kind === 'note') out.push('(' + String(e.text || '').slice(0, 200) + ')')
    }
    return out.slice(-16).join('\n')
  }

  // the terminal panel: only in the desktop app, with this server in it
  const NO_TERMINALS = 'The terminal panel is only in the ELOP Crew desktop app, and this monitor is not running inside it.'
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 90 ? s + ' s ago' : mins(s * 1000) + ' min ago' }
  function terminalsText(list) {
    if (!list.length) return 'No terminals are open in the app\'s terminal panel.'
    const lines = ['Terminals in the app\'s terminal panel (shells the person or an agent opened there, not agents):']
    for (const g of list) {
      for (const p of g.panes) {
        lines.push(`- terminal ${p.id} · tab ${g.tab}${g.panes.length > 1 ? ' (split, pane ' + (g.panes.indexOf(p) + 1) + ' of ' + g.panes.length + ')' : ''}${g.pinned ? ' · pinned' : ''}` +
          ` · ${p.shell}${p.title ? ' "' + p.title + '"' : ''} · in ${p.folder} · last printed ${ago(p.lastAt)}`)
      }
    }
    return lines.join('\n')
  }
  const findTerminal = (list, id) => list.flatMap((g) => g.panes.map((p) => ({ ...p, tab: g.tab }))).find((p) => p.id === Number(id))
  // caller: who asks, the assistant or one of the monitor's agents (the request goes on its card)
  async function terminalTool(name, args, caller = { sessionId: agents.assistantState()?.sessionId || '', cwd: '' }) {
    const T = terminals?.()
    if (!T) return NO_TERMINALS
    if (name === 'terminal_open') return openTerminals(T, args, caller)
    const list = T.list()
    if (name === 'terminals') return terminalsText(list)
    const t = findTerminal(list, args.terminal)
    if (!t) return `No terminal ${args.terminal}. Use the ids from terminals.`
    const label = `terminal ${t.id} (${t.title || t.shell}, tab ${t.tab}, in ${t.folder})`
    if (name === 'terminal_output') {
      const lines = await T.lines(t.id, Math.max(5, Math.min(200, Number(args.lines) || 60)))
      if (!lines) return `${label} has closed.`
      const text = mask(lines.join('\n')).slice(-12000)
      return text.trim() ? `The last of ${label}:\n${text}` : `${label} shows nothing yet.`
    }
    if (name === 'terminal_type') {
      const text = args.ctrl_c ? '' : String(args.text || '').replace(/\r?\n$/, '')
      if (!text && !args.ctrl_c) return 'Nothing to type.'
      // everything typed is shown on the person's card: one line, short, nothing that acts unseen
      if (text.length > 300) return 'Too long to show the person in full (300 characters at most): type less at a time.'
      if (/[\x00-\x1f\x7f]/.test(text)) return 'One line of plain text only: no line breaks, tabs or control keys (use ctrl_c to stop what runs).'
      const enter = args.enter !== false
      const shown = args.ctrl_c ? 'Ctrl+C' : text + (enter ? '  ⏎' : '')
      // the person says yes or no on the page, every time; the assistant never answers this request
      const ok = await askPerson(caller.sessionId, { tool: 'Terminal', what: (lang?.() === 'Korean' ? '터미널에 입력: ' : 'Type into ') + `#${t.id} ${t.title || t.shell} · ${t.folder}` + (args.reason ? ' — ' + String(args.reason).slice(0, 120) : ''), code: shown })
      if (!ok) return 'The person did not allow it (denied, or no answer in 10 minutes). Nothing was typed.'
      if (!T.type(t.id, args.ctrl_c ? '\x03' : text + (enter ? '\r' : ''))) return `${label} has closed; nothing was typed.`
      await new Promise((r) => setTimeout(r, 2500))
      const after = await T.lines(t.id, 30)
      return `Typed into ${label}. What it shows now:\n${after ? mask(after.join('\n')).slice(-6000) : '(closed)'}`
    }
    return 'No such tool.'
  }

  // New tabs, each a shell in a folder with one command typed into it (a dev server, a worker), or one tab split into
  // panes (panes, beside one another or one under another), or a pane put beside a terminal already open: all of them
  // shown to the person at once and opened only if they allow it; the answer has each one's id and what it printed so far
  const MAX_OPEN = 8, PANES = 4
  async function openTerminals(T, args, caller) {
    if (!T.open) return 'This version of the app cannot open terminals.'
    const asked = Array.isArray(args.tabs) && args.tabs.length ? args.tabs : [args]
    const open = list => new Set(list.flatMap((g) => g.panes.map((p) => p.id)))
    const ids = open(T.list())
    const opens = []   // each pane to open: { cwd, title, command, tab, dir, after: index in opens | null, beside: terminal id | null }
    for (const [k, tab] of asked.entries()) {
      if (!tab || typeof tab !== 'object') return 'Each tab is an object: cwd, title, command, or panes.'
      const dir = /^(down|column|vertical|below)$/i.test(String(tab.direction || '')) ? 'column' : 'row'
      const panes = Array.isArray(tab.panes) && tab.panes.length ? tab.panes : [tab]
      if (panes.length > PANES) return `A tab holds at most ${PANES} panes.`
      const beside = tab.beside == null || tab.beside === '' ? null : Number(tab.beside)
      if (beside != null && !ids.has(beside)) return `No terminal ${tab.beside} to split beside. Use the ids from terminals.`
      for (const [j, p] of panes.entries()) {
        const command = String(p?.command || '').replace(/\r?\n$/, '')
        if (command.length > 300) return 'A command is too long to show the person in full (300 characters at most).'
        if (/[\x00-\x1f\x7f]/.test(command)) return 'One line of plain text per command: no line breaks, tabs or control keys.'
        opens.push({ cwd: String(p?.cwd || tab.cwd || caller.cwd || ''), title: String(p?.title || '').trim().slice(0, 40), command, tab: k, dir,
          after: j ? opens.length - 1 : null, beside: j ? null : beside })
      }
    }
    if (opens.length > MAX_OPEN) return `At most ${MAX_OPEN} terminals at a time.`
    const ko = lang?.() === 'Korean'
    const head = (o) => o.beside != null ? (ko ? `터미널 #${o.beside} 옆에` : `beside terminal #${o.beside}`) + (o.dir === 'column' ? (ko ? ' (아래로)' : ' (below)') : '')
      : (ko ? '새 탭' : 'new tab') + (opens.filter((x) => x.tab === o.tab).length > 1 ? (o.dir === 'column' ? (ko ? ' (위아래 분할)' : ' (split down)') : (ko ? ' (좌우 분할)' : ' (split right)')) : '')
    const shown = opens.map((o) => (o.after == null ? head(o) + '\n' : '') + '  ' + (o.title ? '[' + o.title + '] ' : '') + (o.cwd || '~') + (o.command ? '\n    > ' + o.command : '')).join('\n')
    if (shown.length > 1200) return 'Too much to show the person at once: open fewer terminals, or shorter commands.'
    const tabs = new Set(opens.filter((o) => o.beside == null).map((o) => o.tab)).size
    const what = (ko ? `터미널 ${opens.length}개${tabs ? ` (새 탭 ${tabs}개)` : ''}` : `${opens.length} terminal${opens.length > 1 ? 's' : ''}${tabs ? ` (${tabs} new tab${tabs > 1 ? 's' : ''})` : ''}`) + (args.reason ? ' — ' + String(args.reason).slice(0, 120) : '')
    const ok = await askPerson(caller.sessionId, { tool: 'Terminal', what, code: shown })
    if (!ok) return 'The person did not allow it (denied, or no answer in 10 minutes). Nothing was opened.'
    const opened = []
    for (const o of opens) {
      const beside = o.after != null ? opened[o.after]?.id : o.beside
      try { opened.push(await T.open({ cwd: o.cwd, title: o.title, command: o.command, ...(beside != null ? { beside, dir: o.dir } : {}) })) } catch (e) { opened.push({ error: String(e?.message || e) }) }
    }
    await new Promise((r) => setTimeout(r, 3000))
    const out = []
    for (const [i, r] of opened.entries()) {
      const o = opens[i]
      const name = `Tab ${o.tab + 1}${o.after != null || opens.some((x) => x.after === i) ? ' pane ' + (opens.slice(0, i + 1).filter((x) => x.tab === o.tab).length) : ''}${o.title ? ' "' + o.title + '"' : ''}`
      if (r.error) { out.push(`${name}: could not open (${r.error}).`); continue }
      const where = r.beside != null ? (r.placed ? ` · beside terminal ${r.beside}` : ` · in a tab of its own (terminal ${r.beside}'s tab could not take another pane that way)`) : ''
      const lines = await T.lines(r.id, 15)
      out.push(`${name}: terminal ${r.id} · ${r.shell} · in ${r.folder}${where}${o.command && !r.typed ? ' · the command was NOT typed (the shell did not start in time)' : ''}\n` + (lines ? mask(lines.join('\n')).slice(-3000) || '(nothing printed yet)' : '(closed)'))
    }
    return out.join('\n\n') + '\n\nRead more later with terminal_output; stop one with terminal_type ctrl_c.'
  }
  // a tool call from one of the monitor's agents (its terminal MCP server): only the terminal tools
  async function agentTool(body) {
    const a = agents.agentOf(String(body.agent || ''))
    if (!a) return 'Only the monitor\'s agents have these tools.'
    const name = String(body.tool || '')
    if (!/^terminal(s|_output|_type|_open)$/.test(name)) return 'No such tool.'
    return terminalTool(name, body.args || {}, { sessionId: a.sessionId, cwd: a.cwd })
  }

  // a tool call from the assistant's MCP server
  async function tool(body) {
    if (String(body.agent || '') !== 'assistant' || String(body.key || '') !== agents.assistantKey()) return 'Only the monitor\'s assistant has these tools.'
    const args = body.args || {}
    if (/^terminal(s|_output|_type|_open)$/.test(String(body.tool || ''))) return terminalTool(String(body.tool), args)
    const data = await state()
    switch (String(body.tool || '')) {
      case 'status': return statusText(data)
      case 'conversation': {
        const s = findAgent(data, args.agent)
        if (!s) return `No agent called "${args.agent}". Use the names from status.`
        const text = conversationText(await conversation(s.name).catch(() => []))
        return text ? `The last of ${who(s)}'s conversation:\n${text}` : `Nothing to show for ${who(s)} yet.`
      }
      case 'send_message': {
        const s = findAgent(data, args.agent)
        const text = String(args.text || '').trim().slice(0, 4000)
        if (!s) return `No agent called "${args.agent}". Use the names from status.`
        if (!text) return 'Nothing to send.'
        const line = '[From the monitor\'s assistant] ' + text
        if (s.managed) return agents.sendText(s.agentId, line) ? `Sent to ${who(s)}.` : `Could not send to ${who(s)}.`
        const code = await sendTo(s.name, line)
        if (code !== 200) return `Could not send to ${who(s)}.`
        return s.listening || s.state === 'working' ? `Sent to ${who(s)}.` : `Queued for ${who(s)}, but it is not listening: it gets it only after its next turn in VS Code.`
      }
      case 'answer_request': {
        const a = (data.approvals || []).find((x) => x.id === String(args.id || ''))
        if (!a) return 'No such request waiting (answered or timed out already?). Check status.'
        if (ownRequest(a.id)) return 'You cannot answer your own requests; the person does.'
        if (a.questions || a.plan) return 'Questions and plans are for the person to answer.'
        const decision = args.decision === 'allow' ? 'allow' : 'deny'
        // how far the person lets it go, held here and not only in what it is told
        const level = opts().approve
        if (level === 'off') return 'The person has turned answering off: leave it to them, and tell them what you recommend (notify_user if it waits).'
        if (decision === 'allow' && neverAllow(a)) return 'This one is never yours to allow (a push or history rewrite, a recursive delete, a publish or deploy, or secrets): leave it to the person with your recommendation.'
        if (level === 'read' && decision === 'allow' && !readOnly(a)) return 'The person lets you allow only work that changes nothing, and this is not plainly that: leave it to them with your recommendation.'
        const reason = String(args.reason || '').trim().slice(0, 300)
        if (!decide(a.id, decision)) return 'It could not be answered (gone just now?).'
        // the person sees every answer given for them, with why
        agents.noteTo('assistant', { kind: 'notice', level: decision === 'allow' ? 'info' : 'warn', text: `${decision === 'allow' ? '✓' : '✕'} ${a.nickKo || a.nick || a.session}: ${a.tool}${a.what ? ' — ' + a.what : ''}${reason ? ' · ' + reason : ''}`, act: decision })
        notifyPages()
        return `${decision === 'allow' ? 'Allowed' : 'Denied'}.`
      }
      case 'nudge': {
        const s = findAgent(data, args.agent)
        if (!s) return `No agent called "${args.agent}".`
        if (!s.managed) return `${who(s)} is a VS Code session: it has to be stopped in its panel (Esc). Tell the person.`
        if (s.loginLost) return `${who(s)} is waiting for the login and carries on by itself once Claude Code is logged in; nudging it now would only fail again.`
        const [code] = await agents.handle(new URL('http://x/api/agents/nudge'), { id: s.agentId, text: 'It looked like you were stuck, so you were stopped. Please carry on with what you were doing.' })
        return code === 200 ? `Stopped ${who(s)} and asked it to carry on.` : `Could not nudge ${who(s)}.`
      }
      case 'notify_user': {
        const text = String(args.text || '').trim().slice(0, 500)
        if (!text) return 'Nothing to say.'
        agents.noteTo('assistant', { kind: 'notice', level: args.level === 'warn' ? 'warn' : 'info', text, alert: true })
        notifyPages()
        return 'The person has been notified.'
      }
    }
    return 'No such tool.'
  }

  // what is passed on: each thing once, and again only after it went away and came back
  const told = { asks: new Set(), stuck: new Set(), usage: new Map(), login: new Set(), fail: new Map(), limit: new Map() }
  const workingSince = new Map()   // agent → when it was first seen working this turn
  let lastWho = ''                 // the last account seen logged in (a hash), to tell a switch from a return
  let queue = []
  async function watch() {
    if (!on) return
    let data
    try { data = await state() } catch { return }
    const now = Date.now(), o = opts()
    // each kind of event only if the person has it on
    const tell = (kind, text) => { if (o[kind]) { queue.push({ text, urgent: URGENT.has(kind), at: now }); if (queue.length > 50) queue.shift() } }
    // the login: gone, back (the same account or another), or switched
    try {
      const l = await login()
      if (loginNow) {
        if (loginNow.loggedIn && !l.loggedIn) {
          tell('login', 'Claude Code was logged out: agents that try to work now fail with "Not logged in" until it is logged in again')
          // the assistant cannot say it itself (it needs the login too): the monitor puts it in the chat, with an alert
          if (o.login) agents.noteTo('assistant', { kind: 'notice', level: 'warn', alert: true, text: lang?.() === 'Korean'
            ? 'Claude Code 로그인이 풀렸습니다. 다시 로그인할 때까지 에이전트가 일을 하지 못합니다 — 메뉴의 계정에서 로그인하거나 터미널에서 claude auth login. 모니터 에이전트는 로그인되면 스스로 이어 갑니다.'
            : 'Claude Code is logged out. Agents cannot work until it is logged in again — log in from Account in the menu, or run claude auth login in a terminal. Monitor agents carry on by themselves once it is back.' })
          notifyPages()
        }
        else if (!loginNow.loggedIn && l.loggedIn) tell('login', 'Claude Code is logged in again' + (lastWho && l.who && l.who !== lastWho ? ', as another account than before' : '') + '; monitor agents that were waiting for it carry on by themselves')
        else if (loginNow.loggedIn && l.loggedIn && loginNow.who && l.who && loginNow.who !== l.who) tell('login', 'Claude Code is now logged in as another account than before')
      }
      if (l.loggedIn && l.who) lastWho = l.who
      loginNow = l
    } catch {}
    const asks = (data.approvals || []).filter((a) => !ownRequest(a.id))
    for (const a of asks) {
      if (told.asks.has(a.id)) continue
      const forPerson = a.questions || a.plan
      // a permission request at once, for the assistant to answer; a question or plan once it has waited a while
      if (forPerson && now - a.at < WAIT_TELL_MS) continue
      told.asks.add(a.id)
      const left = a.expiresAt ? Math.round((a.expiresAt - now) / 1000) : 0
      tell(forPerson ? 'waiting' : 'asks', forPerson
        ? `${a.nickKo || a.nick || a.session} (${a.project}) has waited ${mins(now - a.at)} min for the person: ${a.questions ? 'a question' : 'a plan to approve'} (id ${a.id})`
        : `${a.nickKo || a.nick || a.session} (${a.project}, ${a.managed ? 'monitor agent' : 'VS Code session'}) asks permission: ${a.tool}${a.what ? ' — ' + a.what : ''} (id ${a.id})${!a.managed && left > 0 ? `; it goes back to VS Code in ${left} s` : ''}`)
    }
    for (const id of told.asks) if (!asks.some((a) => a.id === id)) told.asks.delete(id)
    const sessions = allSessions(data)
    const held = [], limited = []
    for (const s of sessions) {
      if (s.stalledFor && !told.stuck.has(s.name)) { told.stuck.add(s.name); tell('stuck', `${who(s)} (${s.project}, ${s.managed ? 'monitor agent' : 'VS Code session'}) is working but has shown no sign of activity for ${mins(now - s.stalledFor)} min`) }
      if (!s.stalledFor) told.stuck.delete(s.name)
      if (s.loginLost && !told.login.has(s.name)) { told.login.add(s.name); held.push(who(s) + ' (' + s.project + ')') }
      if (!s.loginLost) told.login.delete(s.name)
      // a failed turn, once each (the login has its own line)
      // stopped at the usage limit, once each time (it carries on by itself after the reset)
      if (s.limitHit && told.limit.get(s.name) !== s.limitHit.at) { told.limit.set(s.name, s.limitHit.at); limited.push(s) }
      if (!s.limitHit) told.limit.delete(s.name)
      if (s.lastFail && !s.loginLost && !s.limitHit && told.fail.get(s.name) !== s.lastFail.at) { told.fail.set(s.name, s.lastFail.at); tell('failed', `${who(s)} (${s.project}): its last turn failed — ${s.lastFail.text}`) }
      // a turn of some length that ended well: what it was on, for the assistant to judge whether the person needs it
      if (s.state === 'working') { if (!workingSince.has(s.name)) workingSince.set(s.name, now) }
      else if (workingSince.has(s.name)) {
        const since = workingSince.get(s.name)
        workingSince.delete(s.name)
        if (now - since >= WORKED_MS && !s.lastFail && !s.loginLost) tell('finished', `${who(s)} (${s.project}, ${s.managed ? 'monitor agent' : 'VS Code session'}) finished a turn after ${mins(now - since)} min${s.title ? ' — on: ' + s.title : ''}`)
      }
    }
    for (const name of workingSince.keys()) if (!sessions.some((s) => s.name === name)) workingSince.delete(name)
    if (limited.length) {
      const ends = limited.map((s) => s.limitHit.until).filter(Boolean), at = ends.length ? new Date(Math.min(...ends)).toTimeString().slice(0, 5) : ''
      const names = limited.map(who).join(', ')
      tell('usage', 'Stopped at the Claude usage limit (they carry on by themselves ' + (at ? 'after it resets at ' + at : 'once it has reset') + '): ' + limited.map((s) => who(s) + ' (' + s.project + ')').join(', '))
      // the assistant is held by the same limit and cannot say it: the monitor puts it in the chat
      if (o.usage) agents.noteTo('assistant', { kind: 'notice', level: 'warn', alert: true, text: lang?.() === 'Korean'
        ? 'Claude 사용량 한도에 걸렸습니다' + (at ? ' — ' + at + '에 풀리면' : ' — 풀리면') + ' 멈춘 에이전트가 스스로 이어 갑니다: ' + names
        : 'The Claude usage limit is reached' + (at ? ' — once it resets at ' + at + ',' : ' — once it resets,') + ' the stopped agents carry on by themselves: ' + names })
      notifyPages()
    }
    if (held.length) tell('login', 'Stopped and waiting for the Claude Code login (they carry on by themselves once it is back): ' + held.join(', '))
    for (const x of data.usage?.limits || []) {
      const level = x.percent >= 95 ? 95 : x.percent >= 80 ? 80 : 0, k = x.kind + (x.model || '')
      if (level > (told.usage.get(k) || 0)) tell('usage', `The plan's ${x.kind}${x.model ? ' ' + x.model : ''} usage is at ${Math.round(x.percent)}%`)
      told.usage.set(k, level)
    }
    // one message for all of it, when the assistant is free (and not for want of a login it cannot work without)
    const st = agents.assistantState()
    const due = queue.some((q) => q.urgent) || (st && now - (st.turnEndedAt || 0) < WARM_MS) || queue.some((q) => now - q.at >= ROUTINE_WAIT_MS)
    if (queue.length && due && st && st.state !== 'working' && loginNow?.loggedIn !== false && !st.limitHit) {
      const text = '[Monitor events]\n' + queue.slice(-25).map((q) => '- ' + q.text).join('\n')
      queue = []
      agents.sendText('assistant', text)
    }
  }
  const timer = setInterval(() => { watch().catch(() => {}) }, TICK_MS)
  timer.unref?.()

  return { start, tool, agentTool, setOptions, info: () => { const s = agents.assistantState(); return s ? { ...s, options: opts() } : null } }
}
