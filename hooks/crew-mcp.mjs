#!/usr/bin/env node
// The Crew's message bus for the monitor's agents (an MCP server over stdio, JSON-RPC), whatever program runs each one:
//   claude -p … --mcp-config {crew: this file} --allowedTools mcp__crew
// agents lists the monitor's agents as the page shows them; send hands one of them a message through the monitor
// (/hook/crew, answered by bus.mjs), which says who it is from and shows it in the page's agent-talk tab.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const RUNTIME = [process.env.MONITOR_LINK || '', path.join(os.homedir(), '.claude-agent-monitor', 'bridge.json'), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.runtime', 'bridge.json')]
  .find((p) => p && fs.existsSync(p)) || ''
const AGENT = process.env.MONITOR_AGENT || ''

const TOOLS = [
  {
    name: 'agents',
    description: 'The agents of the agent monitor (ELOP Crew) the user works with: for each, the name to send to (its names in both languages), its project, whether it is working, waiting or resting, and what it is on. Marks which one is you.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send',
    description: 'Send another of the monitor\'s agents a message, by any of its names (as the user calls it, or from agents). It is delivered through the monitor, whatever model that agent runs on, tells it who it is from and how to answer, and the user sees it in the agent-talk tab. An agent that is working reads it when it can. Use it to hand over work, ask a question or report back; not to chat.',
    inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'The agent\'s name' }, text: { type: 'string', description: 'The message' } }, required: ['to', 'text'] },
  },
]

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })

function call(tool, args) {
  return new Promise((resolve) => {
    let conf
    try { conf = JSON.parse(fs.readFileSync(RUNTIME, 'utf8')) } catch { return resolve('The agent monitor is not running.') }
    const body = JSON.stringify({ agent: AGENT, tool, args })
    const req = http.request({
      host: '127.0.0.1', port: conf.port, path: '/hook/crew', method: 'POST', timeout: 30000,
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
      reply(m.id, { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent-monitor-crew', version: '1.0.0' } })
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
