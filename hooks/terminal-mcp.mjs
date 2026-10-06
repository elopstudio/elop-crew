#!/usr/bin/env node
// The desktop app's terminal panel for the monitor's agents (an MCP server over stdio, JSON-RPC):
//   claude -p … --mcp-config {terminal: this file} --allowedTools mcp__terminal
// An agent opens a tab there for what runs long and the person wants to see (a dev server, a worker), reads what a
// tab shows, and types into one. Each call goes to the monitor on 127.0.0.1 (/hook/terminal), which asks the person
// on the page before anything is opened or typed; reading never asks.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const RUNTIME = [process.env.MONITOR_LINK || '', path.join(os.homedir(), '.claude-agent-monitor', 'bridge.json'), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.runtime', 'bridge.json')]
  .find((p) => p && fs.existsSync(p)) || ''
const AGENT = process.env.MONITOR_AGENT || ''

const TAB = {
  type: 'object',
  properties: {
    cwd: { type: 'string', description: 'The folder it starts in (default: your own folder)' },
    title: { type: 'string', description: 'The tab\'s name, short (e.g. "backend")' },
    command: { type: 'string', description: 'One line typed into the new shell and run (e.g. "npm run dev"); none: just the shell' },
  },
}
const TOOLS = [
  {
    name: 'terminal_open',
    description: 'Open new tabs in the ELOP Crew desktop app\'s terminal panel, each a shell in a folder with a command run in it, where the person sees it and can type into it. Use it for what runs long and the person wants to watch or use — a dev server, a worker, an app they asked you to start — instead of a separate window or your own background job. Several at once with tabs (e.g. backend, frontend, worker). The person is asked on the page first and it opens only if they allow it (it waits up to 10 minutes); give the reason. The answer gives each tab\'s terminal id and what it printed so far: read more later with terminal_output. A port set for the app: the tabs do not get the monitor\'s own PORT.',
    inputSchema: { type: 'object', properties: { ...TAB.properties, tabs: { type: 'array', items: TAB, description: 'Several tabs at once (at most 6), instead of cwd/title/command' }, reason: { type: 'string' } }, required: ['reason'] },
  },
  {
    name: 'terminals',
    description: 'The shells open in the app\'s terminal panel: for each, its id, tab (and pane when the tab is split), shell, name, the folder it is in now and when it last printed. Only in the desktop app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'terminal_output',
    description: 'The last lines one terminal shows, as the person sees them (keys, tokens and e-mail addresses masked). Use it to tell whether a server there is up, a build finished or something failed.',
    inputSchema: { type: 'object', properties: { terminal: { type: 'number', description: 'Its id from terminals or terminal_open' }, lines: { type: 'number', description: 'How many of the last lines (default 60, at most 200)' } }, required: ['terminal'] },
  },
  {
    name: 'terminal_type',
    description: 'Type into one terminal: a command (Enter pressed after it unless enter is false), or Ctrl+C to stop what runs there. The person is asked on the page every time and it is typed only if they allow it; the answer then shows what the terminal printed. Give the reason. Never secrets.',
    inputSchema: { type: 'object', properties: { terminal: { type: 'number' }, text: { type: 'string' }, enter: { type: 'boolean' }, ctrl_c: { type: 'boolean', description: 'Send Ctrl+C instead of text' }, reason: { type: 'string' } }, required: ['terminal', 'reason'] },
  },
]

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })

// opening and typing wait for the person to allow it
const WAITS = { terminal_type: 11 * 60 * 1000, terminal_open: 11 * 60 * 1000 }
function call(tool, args) {
  return new Promise((resolve) => {
    let conf
    try { conf = JSON.parse(fs.readFileSync(RUNTIME, 'utf8')) } catch { return resolve('The agent monitor is not running.') }
    const body = JSON.stringify({ agent: AGENT, tool, args })
    const req = http.request({
      host: '127.0.0.1', port: conf.port, path: '/hook/terminal', method: 'POST', timeout: WAITS[tool] || 30000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-monitor-token': conf.token },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => { try { resolve(String(JSON.parse(Buffer.concat(chunks).toString('utf8')).text || '')) } catch { resolve('Bad answer from the agent monitor.') } })
    })
    req.on('timeout', () => { req.destroy(); resolve('The agent monitor did not answer.') })
    req.on('error', () => resolve('Could not reach the agent monitor.'))
    req.end(body)
  })
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  const lines = (buf + chunk).split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    let m
    try { m = JSON.parse(line) } catch { continue }
    if (m.method === 'initialize') {
      reply(m.id, { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent-monitor-terminal', version: '1.0.0' } })
    } else if (m.method === 'tools/list') {
      reply(m.id, { tools: TOOLS })
    } else if (m.method === 'tools/call') {
      const name = String(m.params?.name || '')
      const text = TOOLS.some((t) => t.name === name) ? await call(name, m.params?.arguments || {}) : 'No such tool.'
      reply(m.id, { content: [{ type: 'text', text }] })
    } else if (m.id !== undefined) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
