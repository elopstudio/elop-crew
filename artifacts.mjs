// Artifacts: pages an agent made for the person to look at — a mockup, a report, a chart — shown in the page beside
// the work, and shown again as the file is saved. An agent puts one up with show_artifact (hooks/terminal-mcp.mjs);
// the person can open a file by its path too.
//
// Kept in <data>/artifacts.json: where each file is, its title, who put it up and when — never what is in it. The
// file is read from where it is, each time it is shown, with what sits beside it (its styles, scripts, pictures).
// Served at /artifact/<id>/<file>: the id is random and is all that opens it; only web files below the artifact's
// folder are served, never a dot file. A page is served sandboxed (its own, opaque origin), so nothing in it can read
// the monitor's API or its token. Not under /api/, so the phone app's relay never carries it.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX = 100
const MAX_FILE = 20 * 1024 * 1024
const ENTRY = /\.(html?|svg|png|jpe?g|gif|webp|pdf)$/i
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}
// its own origin: scripts run, links open in a new window, but it is not the monitor's page
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
const clean = (s, n) => String(s || '').replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

export function createArtifacts({ dataDir, notifyPages = () => {} }) {
  const file = path.join(dataDir, 'artifacts.json')
  let list = load()   // newest first: { id, path, title, by, session, project, at }

  function load() {
    try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(a) ? a.filter((x) => x && /^[0-9a-f]{24}$/.test(x.id) && typeof x.path === 'string') : [] } catch { return [] }
  }
  function save() {
    const tmp = file + '.' + process.pid + '.tmp'
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n'); fs.renameSync(tmp, file) } catch {}
  }

  // put one up (again): the same file keeps its id and comes first. [code, entry | { error }]
  async function add({ file: f, title, by = '', session = '', project = '' }) {
    const full = path.resolve(String(f || ''))
    if (!f || !ENTRY.test(full)) return [400, { error: 'type', message: 'An .html, .svg, picture or .pdf file.' }]
    let st
    try { st = await fsp.stat(full) } catch { return [404, { error: 'missing', message: 'No such file: ' + full }] }
    if (!st.isFile()) return [404, { error: 'missing', message: 'Not a file: ' + full }]
    if (st.size > MAX_FILE) return [413, { error: 'large', message: 'Larger than 20 MB.' }]
    const was = list.find((x) => path.resolve(x.path).toLowerCase() === full.toLowerCase())
    // untitled: its file's name, or its folder's for an index.html (every mockup is one)
    const named = /^index\.html?$/i.test(path.basename(full)) ? path.basename(path.dirname(full)) : path.basename(full)
    const entry = { id: was?.id || crypto.randomBytes(12).toString('hex'), path: full, title: clean(title, 80) || was?.title || named, by: clean(by, 40) || was?.by || '', session: clean(session, 120) || was?.session || '', project: clean(project, 80) || was?.project || '', at: Date.now() }
    list = [entry, ...list.filter((x) => x.id !== entry.id)].slice(0, MAX)
    save()
    notifyPages()
    return [200, entry]
  }
  function remove(id) {
    const n = list.length
    list = list.filter((x) => x.id !== id)
    if (list.length === n) return 404
    save()
    notifyPages()
    return 200
  }
  // for the page: each with whether its file is there and when it last changed (a change shows it again)
  async function info() {
    return Promise.all(list.map(async (x) => {
      let st = null
      try { st = await fsp.stat(x.path) } catch {}
      return { id: x.id, title: x.title, name: path.basename(x.path), path: x.path, by: x.by, session: x.session || '', project: x.project, at: x.at, exists: !!st, mtime: st?.mtimeMs || 0 }
    }))
  }
  const count = () => list.length
  const latest = () => list[0]?.at || 0

  // GET /artifact/<id>/<rel>: the artifact itself, or a file below its folder
  async function serve(res, rest) {
    const [id, ...parts] = rest.split('/')
    const a = list.find((x) => x.id === id)
    if (!a) { res.writeHead(404).end(); return }
    const dir = path.dirname(a.path)
    let rel
    try { rel = parts.map((p) => decodeURIComponent(p)).join('/') } catch { res.writeHead(400).end(); return }
    if (!rel || rel === path.basename(a.path)) rel = path.basename(a.path)
    if (rel.split('/').some((p) => !p || p.startsWith('.') || /[\\:]/.test(p))) { res.writeHead(404).end(); return }
    const target = path.join(dir, ...rel.split('/'))
    const type = TYPES[path.extname(target).toLowerCase()]
    if (!type) { res.writeHead(404).end(); return }
    try {
      const [realDir, real] = await Promise.all([fsp.realpath(dir), fsp.realpath(target)])
      const r = path.relative(realDir, real)
      if (!r || r.startsWith('..') || path.isAbsolute(r)) { res.writeHead(404).end(); return }
      const st = await fsp.stat(real)
      if (!st.isFile() || st.size > MAX_FILE) { res.writeHead(404).end(); return }
      res.writeHead(200, {
        'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': SANDBOX, 'referrer-policy': 'no-referrer',
      })
      fs.createReadStream(real).pipe(res)
    } catch { res.writeHead(404).end() }
  }

  return { add, remove, info, count, latest, serve }
}
