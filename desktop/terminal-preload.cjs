// The terminal panel's bridge: its shells and the clipboard, nothing else of Electron or the system.
const { contextBridge, ipcRenderer } = require('electron')

const call = (action, ...a) => ipcRenderer.invoke('monitor-term', action, ...a)
contextBridge.exposeInMainWorld('monitorTerm', {
  // the shells running, and the first time the tabs of the app's last run, to start again
  list: () => call('list'),
  open: (o) => call('open', o),
  write: (id, data) => ipcRenderer.send('monitor-term-write', id, data),
  resize: (id, cols, rows) => call('resize', id, cols, rows),
  close: (id) => call('close', id),
  // a name the person gave the tab, kept while the shell runs
  rename: (id, title) => call('rename', id, title),
  // the shells to start, as a menu under the button at x, y
  menu: (x, y) => call('menu', x, y),
  hide: () => call('hide'),
  // dragging the panel's top edge: the pointer's height on the screen
  drag: (screenY) => ipcRenderer.send('monitor-term-drag', screenY),
  copy: (text) => call('copy', text),
  paste: () => call('paste'),
  onData: (fn) => ipcRenderer.on('monitor-term-data', (_e, id, d) => fn(id, d)),
  onExit: (fn) => ipcRenderer.on('monitor-term-exit', (_e, id, code) => fn(id, code)),
  // a shell started from the app (its menu, or Ctrl+Shift+`), the panel shown, the language switched
  onOpened: (fn) => ipcRenderer.on('monitor-term-opened', (_e, t) => fn(t)),
  onShown: (fn) => ipcRenderer.on('monitor-term-shown', () => fn()),
  onLang: (fn) => ipcRenderer.on('monitor-app-lang', (_e, l) => fn(l)),
})
