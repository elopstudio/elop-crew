// State files that survive a power cut or a hard reset.
//
// On 13 Nov a PC that rebooted by itself left .runtime/agents.json as 117 KB of NUL bytes: Windows had the new size on
// disk but not the data (a plain writeFileSync is only in the cache until it is flushed). The app could not read it
// and started with no agents. So every state file is now written to a temporary file first, flushed to the disk
// (fsync), and only then renamed over the real one; the one it replaces is kept as <file>.bak, the last good copy.
// Reading takes the file, else the .bak (a file that does not parse, or has NUL bytes, is set aside as
// <file>.broken-<time> and the .bak put back in its place), so a broken file is never taken for an empty list.
// Plain CommonJS so the desktop app's main process (terminal tabs, settings) uses the same code as the server.
const fs = require('node:fs')
const path = require('node:path')

const WIN = process.platform === 'win32'
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch {} }

// a rename on Windows fails now and then while something else has the file open (a virus scanner, a reader): tried again
function renameHard(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return } catch (e) {
      if (i >= 5 || !/^(EPERM|EBUSY|EACCES)$/.test(e.code)) throw e
      sleep(20 * (i + 1))
    }
  }
}
// the folder's entry for the renamed file made durable too (POSIX; Windows has no way to open a folder for this)
function syncDir(dir) {
  if (WIN) return
  try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } catch {}
}
// whole at a glance: not empty, and neither its first nor its last byte a NUL (a file the disk never got the data of
// is NUL all through; one cut short ends in them)
function looksWhole(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    if (!size) return false
    const b = Buffer.alloc(1)
    fs.readSync(fd, b, 0, 1, 0)
    if (b[0] === 0) return false
    fs.readSync(fd, b, 0, 1, size - 1)
    return b[0] !== 0
  } catch { return false } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch {} }
}

// write: data (a string or a Buffer) to a temporary file beside it, flushed, renamed over the file. backup (on unless
// false): the file it replaces, if whole, becomes <file>.bak. mode: for a file only its owner may read (0o600).
function writeDurable(file, data, { backup = true, mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
  const fd = fs.openSync(tmp, 'w', mode)
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    fs.fsyncSync(fd)
  } catch (e) { try { fs.closeSync(fd) } catch {} try { fs.unlinkSync(tmp) } catch {} throw e }
  fs.closeSync(fd)
  try {
    // the last good copy: the file being replaced moves to .bak (it was flushed when it was written). A broken file
    // is not moved there, over a good .bak
    if (backup && looksWhole(file)) { try { renameHard(file, file + '.bak') } catch {} }
    renameHard(tmp, file)
  } catch (e) { try { fs.unlinkSync(tmp) } catch {} throw e }
  syncDir(path.dirname(file))
}
const writeJson = (file, value, opts) => writeDurable(file, JSON.stringify(value, null, opts?.indent ?? 1) + '\n', opts)

// read: parse(text) of the file, else of its .bak, else undefined (nothing there, or nothing that reads). parse throws on
// what it cannot take. A broken file is kept aside, and a .bak that reads is written back as the file, so the next save
// starts from it. log(message): told what happened (a broken file, a copy put back). nulOnly: for a file people and
// agents edit by hand (the boards, config.json) only NULs count as broken — one that does not parse may be half-way
// through an edit, and is left alone (undefined comes back, as for a file not there).
function readDurable(file, { parse = JSON.parse, log = (m) => console.warn('[durable] ' + m), nulOnly = false } = {}) {
  const tryRead = (f) => {
    let text
    try { text = fs.readFileSync(f, 'utf8') } catch (e) { return { missing: e.code === 'ENOENT' } }
    if (text.includes('\0')) return { broken: 'NUL bytes' }
    try { return { value: parse(text), text } } catch (e) { return { broken: e.message || 'unreadable' } }
  }
  const main = tryRead(file)
  if ('value' in main) return main.value
  if (main.broken && nulOnly && main.broken !== 'NUL bytes') return undefined
  const bak = tryRead(file + '.bak')
  if (main.broken) {
    const aside = file + '.broken-' + new Date().toISOString().replace(/[:.]/g, '-')
    try { renameHard(file, aside); log(path.basename(file) + ' was broken (' + main.broken + '); kept as ' + path.basename(aside)) } catch {}
  }
  if ('value' in bak) {
    try { writeDurable(file, bak.text, { backup: false }); log(path.basename(file) + (main.broken ? ' put back' : ' was missing; put back') + ' from its last good copy (.bak)') } catch {}
    return bak.value
  }
  return undefined
}
const readJson = (file, opts) => readDurable(file, opts)

// Claude Code's own transcripts (~/.claude/projects/<folder>/<session>.jsonl) end in NUL bytes after the same kind of
// reset, its last lines lost. Before a conversation is carried on, its file is mended: the NULs at its end (and any
// line with NULs in it, or a last line cut short) are taken out; the file as it was is kept as <file>.nul-<time>.
// Returns how many bytes went, 0 when the file was fine (or is not there).
function mendTranscript(file) {
  let fd, size
  try { fd = fs.openSync(file, 'r'); size = fs.fstatSync(fd).size } catch { return 0 }
  try {
    // a quick look first: the last 64 KB
    const n = Math.min(size, 65536)
    if (!n) return 0
    const tail = Buffer.alloc(n)
    fs.readSync(fd, tail, 0, n, size - n)
    if (!tail.includes(0)) return 0
  } finally { try { fs.closeSync(fd) } catch {} }
  if (size > 512 * 1024 * 1024) return 0   // not read whole into memory
  const buf = fs.readFileSync(file)
  const lines = buf.toString('utf8').split('\n')
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    if (l.includes('\0')) continue
    // the last line written may have been cut short: kept only if it reads
    if (i >= lines.length - 2) { try { JSON.parse(l) } catch { continue } }
    kept.push(l)
  }
  const out = Buffer.from(kept.length ? kept.join('\n') + '\n' : '', 'utf8')
  if (out.length === buf.length) return 0
  const aside = file + '.nul-' + new Date().toISOString().replace(/[:.]/g, '-')
  try { fs.copyFileSync(file, aside) } catch { return 0 }
  writeDurable(file, out, { backup: false })
  return buf.length - out.length
}

module.exports = { writeDurable, writeJson, readDurable, readJson, mendTranscript, looksWhole }
