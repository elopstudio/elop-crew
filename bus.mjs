// The Crew's message bus: how the monitor's agents talk to each other through the monitor, whatever program runs each
// one. Every agent gets the crew tools (hooks/crew-mcp.mjs): agents, the Crew as the page shows it, and send, a message
// to one of them by any of its names. The monitor hands it on (agents.sendPeer): the recipient sees who it is from and
// how to answer, and the person sees it in the agent-talk tab — not so with claude's own SendMessage, which only claude
// sessions have and the monitor never sees.
//
// What it guards: a sender and a recipient that answer each other without end (at most PAIR_PER_HOUR messages an hour
// each way), a recipient stopped at the usage limit or waiting for the login (a message would only wake it to fail).
// VS Code sessions are listed but not reached: they have no crew tools to answer with.
export const BUS_HEADER = /^\[Message from [^\]\n]+ through the agent monitor[^\]\n]*\]\n/

export function createBus({ agents, state, labelOf, clip }) {
  const PAIR_PER_HOUR = 20
  const sent = new Map()   // "from→to" → times, this hour
  const left = (k) => { const now = Date.now(), l = (sent.get(k) || []).filter((t) => now - t < 3600e3); sent.set(k, l); return PAIR_PER_HOUR - l.length }

  const all = (data) => (data.projects || []).flatMap((p) => p.sessions.map((s) => ({ ...s, project: p.key, projectName: p.name || '' })))
  const label = (s) => (s.managed && labelOf(s.agentId)) || s.nickKo || s.nick || s.short || s.name
  const names = (s) => [label(s), s.nickKo, s.nick, s.short, s.name, s.pinNick].filter(Boolean).map((x) => String(x).toLowerCase())
  function find(data, name) {
    const n = String(name || '').trim().toLowerCase()
    return n ? all(data).find((s) => names(s).includes(n)) : null
  }

  function list(data, me) {
    const lines = []
    for (const s of all(data)) {
      const you = s.managed && s.agentId === me
      lines.push(`- ${label(s)}${you ? ' (you)' : ''}` + (s.nickKo && s.nick && s.nickKo !== s.nick ? ` — ${s.nickKo} / ${s.nick}` : '') +
        ` · project ${s.project}${s.projectName ? ' "' + s.projectName + '"' : ''} · ${s.state}` +
        (s.title ? ` · on: ${clip(String(s.title), 80)}` : '') + (s.role ? ` · role: ${clip(String(s.role), 60)}` : '') +
        (s.managed ? '' : ' · a VS Code session: not reachable with send') +
        (s.loginLost ? ' · stopped, waiting for the login' : '') + (s.limitHit ? ' · stopped at the usage limit' : ''))
    }
    return lines.length ? "The monitor's agents (send to one by the first name shown, or any of its names):\n" + lines.join('\n') : 'No agents.'
  }

  // a tool call from an agent's crew server
  async function tool(body) {
    const me = String(body.agent || '')
    const self = agents.agentOf(me)
    if (!self) return 'Only the monitor\'s agents have these tools.'
    const args = body.args || {}
    const data = await state()
    const from = all(data).find((s) => s.managed && s.agentId === me)
    if (String(body.tool) === 'agents') return list(data, me)
    if (String(body.tool) !== 'send') return 'No such tool.'
    const text = String(args.text || '').trim().slice(0, 4000)
    if (!text) return 'Nothing to send.'
    const to = find(data, args.to)
    if (!to) return `No agent called "${clip(String(args.to || ''), 60)}". Use the names from the agents tool.`
    if (to.managed && to.agentId === me) return 'That is you.'
    if (!to.managed) return `${label(to)} is a VS Code session: the crew tools cannot reach it.`
    if (to.loginLost) return `${label(to)} is stopped, waiting for Claude Code's login, and carries on by itself once it is back: try later.`
    if (to.limitHit) return `${label(to)} is stopped at the usage limit and carries on by itself once it resets: try later.`
    const key = me + '→' + to.agentId
    if (left(key) <= 0) return `You have sent ${label(to)} ${PAIR_PER_HOUR} messages in the last hour: no more for now. If you two are going back and forth, stop and tell the user.`
    const mine = from ? label(from) : 'another agent'
    const header = `[Message from ${mine} through the agent monitor — to answer, use the crew tool send with to "${mine}"]`
    if (!agents.sendPeer(to.agentId, text, { from: from?.name || '', header })) return `Could not deliver it to ${label(to)}.`
    sent.get(key).push(Date.now())
    return `Delivered to ${label(to)}` + (to.state === 'working' ? ' (it is working: it reads it when it can).' : '.')
  }

  return { tool }
}
