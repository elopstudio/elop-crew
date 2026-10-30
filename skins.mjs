// Skins: the person's own pictures in place of the robots, kept on this PC only and never shipped with the app (a
// character someone else owns is theirs to use for themselves, not ours to hand out).
//
// A skin is a folder in <data>/skins/: a skin.json and its pictures beside it.
//   { "name": "…", "characters": [ { "id": "…", "name": "…", "leader": true,
//       "images": { "working": "a.png", "waiting": "b.png", "resting": "c.png", "asking": "d.png" } } … ],
//     "agents": { "<agent name>": "<character id>" } }
// A state without a picture falls back to another (asking → working; resting → waiting → working). Each agent gets the
// character "agents" names for it, else the leader the one marked "leader", else one picked by its name (the same each
// time). The skin in use is config.json "skin" (its folder's name); none: the robots.
//
// Pictures are served at /skin/<folder>/<file>: only .png .jpg .jpeg .gif .webp .svg right in the folder, never a dot
// file, and sandboxed (an .svg's scripts never run on the monitor's page). Not under /api/: the phone app never gets them.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PICTURE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
const STATES = ['working', 'waiting', 'resting', 'asking']
const MAX_PICTURE = 5 * 1024 * 1024
const MAX_CHARACTERS = 40
const SANDBOX = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
const clean = (s, n) => String(s ?? '').replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
// a folder's or a picture's name: one name, nothing that climbs out
const plainName = (s) => typeof s === 'string' && !!s && s.length <= 120 && !/[\\/:*?"<>|\x00-\x1f]/.test(s) && !s.startsWith('.')

// what a new skin starts as: two characters to fill in, and a note on how
const TEMPLATE = {
  name: 'My skin',
  characters: [
    { id: 'leader', name: 'Leader', leader: true, images: { working: 'leader-working.png', waiting: 'leader-waiting.png', resting: 'leader-resting.png' } },
    { id: 'crew', name: 'Crew', images: { working: 'crew-working.png', waiting: 'crew-waiting.png', resting: 'crew-resting.png' } },
  ],
  agents: {},
}
const HELP = `ELOP Crew skin
==============
Put pictures (.png .jpg .gif .webp .svg, 5 MB at most) in this folder and name them in skin.json:
- characters: each with an id, a name, "leader": true for the one the project leaders get, and one picture per state
  (working, waiting, resting, asking). A state without a picture uses another one.
- agents: "<agent name>": "<character id>" to give an agent a character (the Skin window does it too).
A square picture with a transparent background looks best. Kept on this PC only.

ELOP Crew 스킨
==============
이 폴더에 그림(.png .jpg .gif .webp .svg, 5MB 이하)을 넣고 skin.json 에 이름을 적으세요.
- characters: 캐릭터마다 id, 이름, 프로젝트 리더가 쓸 캐릭터면 "leader": true, 상태별 그림(working 작업 중, waiting 대기,
  resting 쉬는 중, asking 질문). 그림이 없는 상태는 다른 상태의 그림을 씁니다.
- agents: "<에이전트 이름>": "<캐릭터 id>" 로 에이전트에게 캐릭터를 정해 줍니다(스킨 창에서도 할 수 있습니다).
배경이 투명한 정사각형 그림이 가장 잘 어울립니다. 이 PC 에만 저장됩니다.
`

export function createSkins({ dataDir, loadConfig, editConfig, notifyPages = () => {} }) {
  const home = path.join(dataDir, 'skins')

  // one skin as the page uses it, read from its folder; a broken skin.json says so instead
  async function readSkin(dir) {
    const folder = path.join(home, dir)
    let o
    try { o = JSON.parse(await fsp.readFile(path.join(folder, 'skin.json'), 'utf8')) } catch (e) { return { dir, name: dir, characters: [], agents: {}, problem: e.code === 'ENOENT' ? 'no skin.json' : 'skin.json: ' + clean(e.message, 120) } }
    let files = []
    try { files = await fsp.readdir(folder) } catch {}
    const have = new Set(files)
    const missing = []
    const characters = (Array.isArray(o?.characters) ? o.characters : []).slice(0, MAX_CHARACTERS).map((c, i) => {
      const images = {}
      for (const st of STATES) {
        const f = c?.images?.[st]
        if (!plainName(f) || !PICTURE[path.extname(f).toLowerCase()]) continue
        if (have.has(f)) images[st] = f
        else missing.push(f)
      }
      return { id: clean(c?.id, 40) || 'c' + (i + 1), name: clean(c?.name, 40) || clean(c?.id, 40) || 'c' + (i + 1), leader: c?.leader === true, images }
    }).filter((c) => Object.keys(c.images).length)
    const ids = new Set(characters.map((c) => c.id))
    const agents = Object.fromEntries(Object.entries(o?.agents && typeof o.agents === 'object' ? o.agents : {})
      .map(([k, v]) => [clean(k, 120), clean(v, 40)]).filter(([k, v]) => k && ids.has(v)).slice(0, 500))
    let at = 0
    try { at = (await fsp.stat(path.join(folder, 'skin.json'))).mtimeMs } catch {}
    return { dir, name: clean(o?.name, 60) || dir, characters, agents, at, ...(missing.length ? { problem: 'missing: ' + [...new Set(missing)].slice(0, 5).join(', ') } : {}), ...(!characters.length && !missing.length ? { problem: 'no characters with pictures' } : {}) }
  }
  async function dirs() {
    try { return (await fsp.readdir(home, { withFileTypes: true })).filter((d) => d.isDirectory() && plainName(d.name)).map((d) => d.name).sort().slice(0, 50) } catch { return [] }
  }
  const active = () => { const s = loadConfig().skin; return plainName(s) ? s : '' }

  async function list() {
    const skins = await Promise.all((await dirs()).map(readSkin))
    return { folder: home, active: skins.some((s) => s.dir === active()) ? active() : '', skins }
  }
  // for each poll: which skin, and when its skin.json last changed (the page reads it again then)
  let sigCache = { at: 0, v: null }
  function sig() {
    if (Date.now() - sigCache.at < 5000) return sigCache.v
    const dir = active()
    let v = null
    if (dir) { try { v = { dir, at: fs.statSync(path.join(home, dir, 'skin.json')).mtimeMs } } catch { v = { dir, at: 0 } } }
    sigCache = { at: Date.now(), v }
    return v
  }

  // the page's changes: the skin in use, an agent's character, a new skin, the folder opened. → [code, list]
  async function handle(body) {
    const known = await dirs()
    if (body.use !== undefined) {
      const dir = String(body.use || '')
      if (dir && !known.includes(dir)) return [404, {}]
      const code = await editConfig((c) => { if (dir) c.skin = dir; else delete c.skin })
      if (code !== 200) return [code, {}]
    }
    if (body.assign) {
      const dir = String(body.assign.skin || ''), agent = clean(body.assign.agent, 120), id = clean(body.assign.character, 40)
      if (!known.includes(dir) || !agent) return [400, {}]
      const file = path.join(home, dir, 'skin.json')
      let o
      try { o = JSON.parse(await fsp.readFile(file, 'utf8')) } catch { return [409, {}] }
      o.agents = o.agents && typeof o.agents === 'object' ? o.agents : {}
      if (id) o.agents[agent] = id; else delete o.agents[agent]
      await fsp.writeFile(file, JSON.stringify(o, null, 2) + '\n')
    }
    if (body.create !== undefined) {
      const name = clean(body.create, 60) || 'My skin'
      let dir = name.replace(/[\\/:*?"<>|.]/g, '_').trim() || 'skin'
      for (let n = 2; known.includes(dir); n++) dir = name.replace(/[\\/:*?"<>|.]/g, '_').trim() + ' ' + n
      const folder = path.join(home, dir)
      await fsp.mkdir(folder, { recursive: true })
      await fsp.writeFile(path.join(folder, 'skin.json'), JSON.stringify({ ...TEMPLATE, name }, null, 2) + '\n')
      await fsp.writeFile(path.join(folder, 'README.txt'), HELP)
      open(folder)
    }
    if (body.open !== undefined) {
      const dir = String(body.open || '')
      if (dir && !known.includes(dir)) return [404, {}]
      fs.mkdirSync(home, { recursive: true })
      open(dir ? path.join(home, dir) : home)
    }
    sigCache.at = 0
    notifyPages()
    return [200, await list()]
  }
  function open(dir) {
    const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    try { spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref() } catch {}
  }

  async function serve(res, rest) {
    let dir, file
    try { [dir, file] = rest.split('/').map(decodeURIComponent) } catch { res.writeHead(400).end(); return }
    const type = plainName(dir) && plainName(file) && rest.split('/').length === 2 && PICTURE[path.extname(file).toLowerCase()]
    if (!type) { res.writeHead(404).end(); return }
    try {
      const real = await fsp.realpath(path.join(home, dir, file)), realDir = await fsp.realpath(path.join(home, dir))
      if (path.dirname(real) !== realDir) { res.writeHead(404).end(); return }
      const st = await fsp.stat(real)
      if (!st.isFile() || st.size > MAX_PICTURE) { res.writeHead(404).end(); return }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff', 'content-security-policy': SANDBOX, 'referrer-policy': 'no-referrer' })
      fs.createReadStream(real).pipe(res)
    } catch { res.writeHead(404).end() }
  }

  return { list, sig, handle, serve, home }
}
