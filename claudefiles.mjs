// Claude Code's own instructions, settings, memory and extensions, shown and edited from the page.
//
// Only these places are opened — every other path is refused, whatever the page asks:
//   <claude>/CLAUDE.md, settings.json, settings.local.json             the user's own, for every project
//   <claude>/skills|agents|commands/**, <claude>/plans/*                 the user's skills, subagents, commands, plans
//   <claude>/projects/<slug>/memory/*.md                                 each folder's memory, MEMORY.md its index
//   <project>/CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md, .mcp.json   for the projects on the page only
//   <project>/.claude/settings(.local).json, .claude/skills|agents|commands/**
//   ~/.claude.json: its mcpServers (the user's) and projects.<folder>.mcpServers (one folder's) — never the rest of it
//
// Files are written whole, through a temporary file renamed over the old one, and only when nobody changed them since
// the page read them (else 409). Nothing is copied or kept here: the page holds what was there before, for its undo.
// These answers are not under /api/, so the phone app's relay never carries them — they are shown unmasked, to edit.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const MAX_FILE = 1024 * 1024
const MAX_LISTED = 300
const TEXT_EXT = /\.(md|markdown|txt|json|jsonc|ya?ml|toml|js|mjs|cjs|ts|py|sh|ps1|bat|cmd|html|css|xml|csv|ini|cfg)$/i
const SAFE_SEG = /^(?!\.)[^<>:"|?*\x00-\x1f\\/]{1,120}$/   // a file or folder name: no dot files, nothing a path could hide behind
const SLUG = /^[A-Za-z0-9-]{1,240}$/
const MEMORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.md$/
const TREES = ['skills', 'agents', 'commands']
const PROJECT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json', '.mcp.json']
const GLOBAL_FILES = ['CLAUDE.md', 'settings.json', 'settings.local.json']

// skills claude.ai keeps in step with the account: changed here, they are put back at the next sync
const synced = (rel) => /^skills\/synced\//.test(rel)
const kindOf = (file) => (/\.jsonc?$/i.test(file) ? 'json' : /\.(md|markdown)$/i.test(file) ? 'md' : 'text')
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
// a folder's slug, as Claude Code names its folder under projects/
export const slugOf = (dir) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-')

// claude: Claude Code's folder (~/.claude); projects(): the projects on the page, [{ key, root, name }]
export function createClaudeFiles({ claude, projects }) {
  const stateFile = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json')
  const projectsDir = path.join(claude, 'projects')

  // a relative path below a folder, made of plain names only
  function relOk(rel) {
    const parts = String(rel || '').split('/')
    return parts.length <= 6 && parts.every((x) => SAFE_SEG.test(x) && x !== '..' && x.trim() === x)
  }
  // the nearest existing folder at or above target must really be inside base (a link may point anywhere)
  async function inside(base, target) {
    let real
    try { real = await fsp.realpath(base) } catch { real = path.resolve(base) }
    let d = target
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fsp.realpath(d)
        const rel = path.relative(real, r)
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
      } catch { const up = path.dirname(d); if (up === d) return false; d = up }
    }
    return false
  }

  // ref → where it is. g|<rel> the user's own, p|<key>|<rel> a project's, m|<slug>|<name> memory, x|user / x|<key> MCP
  async function resolve(ref) {
    const [scope, a, ...rest] = String(ref || '').split('|')
    if (scope === 'g') {
      const rel = [a, ...rest].join('|')
      const top = rel.split('/')[0]
      const ok = GLOBAL_FILES.includes(rel) || ((TREES.includes(top) || top === 'plans') && rel.includes('/') && relOk(rel) && TEXT_EXT.test(rel))
      if (!ok) return null
      const file = path.join(claude, ...rel.split('/'))
      if (!(await inside(claude, file))) return null
      return { file, kind: kindOf(rel), removable: !synced(rel), readonly: synced(rel) ? 'synced' : '' }
    }
    if (scope === 'p') {
      const rel = rest.join('|')
      const p = (await projects()).find((x) => x.key === a)
      if (!p) return null
      const top = rel.split('/').slice(0, 2).join('/')
      const ok = PROJECT_FILES.includes(rel) || (TREES.some((t) => top === '.claude/' + t) && rel.split('/').length > 2 && relOk(rel.slice(8)) && TEXT_EXT.test(rel))
      if (!ok) return null
      const file = path.join(p.root, ...rel.split('/'))
      if (!(await inside(p.root, file))) return null
      return { file, kind: kindOf(rel), removable: true }
    }
    if (scope === 'm') {
      const name = rest.join('|')
      if (!SLUG.test(a) || !MEMORY_NAME.test(name)) return null
      const dir = path.join(projectsDir, a, 'memory')
      const file = path.join(dir, name)
      if (!(await inside(projectsDir, file))) return null
      return { file, kind: 'md', removable: name !== 'MEMORY.md', memory: { dir, name } }
    }
    if (scope === 'x' && !rest.length) {
      if (a === 'user') return { mcp: { project: null }, kind: 'json' }
      const p = (await projects()).find((x) => x.key === a)
      return p ? { mcp: { project: p.root }, kind: 'json' } : null
    }
    return null
  }

  async function readState() {
    try { return JSON.parse(await fsp.readFile(stateFile, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return {}; throw e }
  }
  // ~/.claude.json names a folder in more than one way ("C:\\x", "c:/x"): the one that has servers, else the first
  function localKey(state, root) {
    const want = norm(root)
    const keys = Object.keys(state.projects || {}).filter((k) => norm(k) === want)
    return keys.find((k) => Object.keys(state.projects[k]?.mcpServers || {}).length) || keys[0] || null
  }
  function mcpOf(state, where) {
    if (!where.project) return state.mcpServers || {}
    const k = localKey(state, where.project)
    return (k && state.projects[k]?.mcpServers) || {}
  }

  async function stat(file) {
    try { const st = await fsp.stat(file); return st.isFile() ? st : null } catch { return null }
  }
  const versionOf = (st) => (st ? Math.round(st.mtimeMs) + ':' + st.size : '')

  // what is in a folder tree: text files only, no dot files, a few levels deep
  async function walk(base, relBase, out, depth = 0) {
    let names = []
    try { names = await fsp.readdir(base, { withFileTypes: true }) } catch { return }
    names.sort((x, y) => x.name.localeCompare(y.name))
    for (const d of names) {
      if (out.length >= MAX_LISTED) return
      if (!SAFE_SEG.test(d.name) || d.name === 'node_modules') continue
      const rel = relBase + '/' + d.name
      if (d.isDirectory() && depth < 4) await walk(path.join(base, d.name), rel, out, depth + 1)
      else if (d.isFile() && TEXT_EXT.test(d.name)) {
        const st = await stat(path.join(base, d.name))
        if (st) out.push({ rel, size: st.size, at: st.mtimeMs })
      }
    }
  }
  async function fixed(base, rels, refOf) {
    return Promise.all(rels.map(async (rel) => {
      const st = await stat(path.join(base, ...rel.split('/')))
      return { ref: refOf(rel), path: rel, exists: !!st, size: st?.size || 0, at: st?.mtimeMs || 0 }
    }))
  }
  // a skill is its SKILL.md (its scripts and the rest are not listed); each .md with what its frontmatter says it is
  async function trees(base, prefix, refOf) {
    const out = {}
    for (const t of [...TREES, ...(prefix ? [] : ['plans'])]) {
      let list = []
      await walk(path.join(base, ...(prefix ? [prefix, t] : [t])), (prefix ? prefix + '/' : '') + t, list)
      if (t === 'skills') list = list.filter((f) => /\/SKILL\.md$/i.test(f.rel))
      out[t] = await Promise.all(list.map(async (f) => ({
        ref: refOf(f.rel), path: f.rel, exists: true, size: f.size, at: f.at, ...(synced(f.rel) ? { readonly: 'synced' } : {}),
        ...(/\.md$/i.test(f.rel) && f.size < 64 * 1024 ? frontmatter(await fsp.readFile(path.join(base, ...f.rel.split('/')), 'utf8').catch(() => '')) : {}),
      })))
    }
    return out
  }
  function frontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!m) return {}
    const get = (k) => new RegExp('^\\s*' + k + ':\\s*(.+)$', 'm').exec(m[1])?.[1].trim().replace(/^["']|["']$/g, '') || ''
    return { name: get('name'), description: get('description'), type: get('type') }
  }

  async function list() {
    const shown = await projects()
    const state = await readState().catch(() => ({}))
    const servers = (o) => Object.keys(o || {}).sort()
    const global = {
      base: claude,
      files: await fixed(claude, GLOBAL_FILES, (rel) => 'g|' + rel),
      ...(await trees(claude, '', (rel) => 'g|' + rel)),
      mcp: { ref: 'x|user', path: stateFile, servers: servers(state.mcpServers) },
    }
    const projs = []
    for (const p of shown) {
      projs.push({
        key: p.key, name: p.name || '', root: p.root,
        files: await fixed(p.root, PROJECT_FILES, (rel) => 'p|' + p.key + '|' + rel),
        ...(await trees(p.root, '.claude', (rel) => 'p|' + p.key + '|' + rel)),
        mcp: { ref: 'x|' + p.key, servers: servers(mcpOf(state, { project: p.root })) },
      })
    }
    // every folder with a memory, the ones on the page first, named by their project
    const bySlug = new Map(shown.map((p) => [slugOf(p.root).toLowerCase(), p]))
    const memory = []
    let slugs = []
    try { slugs = (await fsp.readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory() && SLUG.test(d.name)).map((d) => d.name) } catch {}
    for (const slug of slugs) {
      const dir = path.join(projectsDir, slug, 'memory')
      let names = []
      try { names = (await fsp.readdir(dir)).filter((n) => MEMORY_NAME.test(n)) } catch { continue }
      const files = []
      for (const name of names.sort((x, y) => (x === 'MEMORY.md' ? -1 : y === 'MEMORY.md' ? 1 : x.localeCompare(y)))) {
        const file = path.join(dir, name), st = await stat(file)
        if (!st) continue
        let fm = {}
        if (name !== 'MEMORY.md' && st.size < 64 * 1024) { try { fm = frontmatter(await fsp.readFile(file, 'utf8')) } catch {} }
        files.push({ ref: 'm|' + slug + '|' + name, path: name, exists: true, size: st.size, at: st.mtimeMs, ...fm })
      }
      if (!files.length) continue
      const p = bySlug.get(slug.toLowerCase())
      memory.push({ slug, key: p?.key || '', name: p?.name || '', root: p?.root || '', files })
    }
    memory.sort((x, y) => (!!y.key - !!x.key) || x.slug.localeCompare(y.slug))
    return [200, { global, projects: projs, memory }]
  }

  async function read(ref) {
    const r = await resolve(ref)
    if (!r) return [404, { error: 'not allowed' }]
    if (r.mcp) {
      const text = JSON.stringify(mcpOf(await readState(), r.mcp), null, 2) + '\n'
      return [200, { ref, kind: 'json', exists: true, text, version: hash(text), mcp: true }]
    }
    const st = await stat(r.file)
    if (!st) return [200, { ref, kind: r.kind, exists: false, text: '', version: '', removable: r.removable, readonly: r.readonly || '' }]
    if (st.size > MAX_FILE) return [413, { error: 'too large' }]
    return [200, { ref, kind: r.kind, exists: true, text: await fsp.readFile(r.file, 'utf8'), version: versionOf(st), removable: r.removable, readonly: r.readonly || '' }]
  }

  async function writeAtomic(file, text) {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = file + '.' + process.pid + '.tmp'
    await fsp.writeFile(tmp, text)
    await fsp.rename(tmp, file)
  }

  // { ref, text, version } saves (version '' = a new file, refused if one is there by now); { ref, remove, version } removes
  async function write(body) {
    const ref = String(body.ref || '')
    const r = await resolve(ref)
    if (!r || r.readonly) return [404, { error: 'not allowed' }]
    const version = String(body.version ?? '')
    if (r.mcp) {
      if (body.remove) return [400, { error: 'not removable' }]
      let servers
      try { servers = JSON.parse(String(body.text || '')) } catch (e) { return [400, { error: 'json', message: String(e.message).slice(0, 200) }] }
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [400, { error: 'json', message: 'an object of servers by name' }]
      const state = await readState()
      if (hash(JSON.stringify(mcpOf(state, r.mcp), null, 2) + '\n') !== version) return [409, { error: 'changed' }]
      if (!r.mcp.project) state.mcpServers = servers
      else {
        state.projects = state.projects || {}
        const k = localKey(state, r.mcp.project) || path.resolve(r.mcp.project).replace(/\\/g, '/')
        state.projects[k] = { ...(state.projects[k] || {}), mcpServers: servers }
      }
      await writeAtomic(stateFile, JSON.stringify(state, null, 2))
      const text = JSON.stringify(servers, null, 2) + '\n'
      return [200, { version: hash(text) }]
    }
    const st = await stat(r.file)
    if (versionOf(st) !== version) return [409, { error: 'changed' }]
    if (body.remove) {
      if (!r.removable || !st) return [400, { error: 'not removable' }]
      await fsp.unlink(r.file)
      // a memory taken out leaves no line pointing at it in MEMORY.md; what the index was goes back, for the undo
      if (r.memory) {
        const index = path.join(r.memory.dir, 'MEMORY.md'), ist = await stat(index)
        if (ist) {
          const was = await fsp.readFile(index, 'utf8')
          const now = was.split('\n').filter((l) => !l.includes('](' + r.memory.name + ')')).join('\n')
          if (now !== was) { await writeAtomic(index, now); return [200, { index: { ref: 'm|' + ref.split('|')[1] + '|MEMORY.md', was, version: versionOf(await stat(index)) } }] }
        }
      }
      return [200, {}]
    }
    const text = String(body.text ?? '')
    if (Buffer.byteLength(text) > MAX_FILE) return [413, { error: 'too large' }]
    if (r.kind === 'json') { try { JSON.parse(text) } catch (e) { return [400, { error: 'json', message: String(e.message).slice(0, 200) }] } }
    await writeAtomic(r.file, text)
    return [200, { version: versionOf(await stat(r.file)) }]
  }

  return { list, read, write }
}
