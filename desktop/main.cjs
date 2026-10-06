// ELOP Crew (AI Agent Monitor) as a desktop app: runs the monitor server inside the app, shows it in its own window,
// and lives in the tray — so it no longer depends on a terminal or on VS Code staying open.
const { app, BaseWindow, BrowserWindow, WebContentsView, Tray, Menu, shell, dialog, nativeImage, nativeTheme, ipcMain, Notification, globalShortcut, screen, clipboard, powerMonitor } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { pathToFileURL } = require('node:url')

const PORT = Number(process.env.PORT) || 4777
const URL = `http://127.0.0.1:${PORT}/`
// the monitor's code: next to this folder while developing, in the app's resources once installed
const CODE = app.isPackaged ? path.join(process.resourcesPath, 'monitor') : path.join(__dirname, '..')
const ICON = path.join(__dirname, 'icon.png')
const MAC = process.platform === 'darwin'
const RELEASES = 'https://github.com/elopstudio/elop-crew/releases/latest'
// the terminal panel's shells; loaded before the server sets its PORT and MONITOR_HOME, which the shells must not get
const terminals = require('./terminal.cjs')

/* ── settings: where the monitor keeps config.json, boards/ and its agent list ── */
// read before startServer sets it for the server
const GIVEN_HOME = process.env.MONITOR_HOME || ''
// `npm run try`: a test app beside the installed one — no notifications, global shortcut or hook installs of its own
const TRY = process.env.MONITOR_TRY === '1'
const NAME = () => (TRY ? t('tryName') : 'ELOP Crew')
// The app was called Agent Monitor before it became ELOP Crew, and Electron names its folder and its Windows id after
// the app. Both keep the old name, so an update keeps the settings, the window's place and the page's storage, and
// Windows its autostart entry (filed under the id), taskbar and notification settings. A --user-data-dir (npm run try) wins.
// package.json keeps the Windows program file's name too (Agent Monitor.exe): the hooks and that autostart entry run it.
const OLD_NAME = 'Agent Monitor'
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), OLD_NAME))
if (process.platform === 'win32') app.setAppUserModelId('electron.app.' + OLD_NAME)
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return {} } }
function writeSettings(s) { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)) }
function dataDir() {
  // a MONITOR_HOME given to the app wins, as it does for npm start (and keeps a test run away from the real folder)
  if (GIVEN_HOME) return GIVEN_HOME
  const s = readSettings()
  if (s.dataDir && fs.existsSync(s.dataDir)) return s.dataDir
  // while developing, the repository itself; installed, a folder in the home directory
  return app.isPackaged ? path.join(app.getPath('home'), '.claude-agent-monitor') : CODE
}

/* ── the app's own words, in the language picked on the page ── */
// The page keeps its pick in its storage (am.lang) and tells the app when it switches (preload: setLang); the app keeps
// the last one in its settings for a start in the tray, before the page has loaded. Never told yet: the system's language.
const TEXT = {
  ko: {
    tryName: 'ELOP Crew (테스트)', install: '설치', later: '나중에',
    termCmd: '명령 프롬프트', termIn: '프로젝트 폴더에서 열기', termFailed: '셸을 시작하지 못했습니다.',
    termAgents: '에이전트 명령 기록 (읽기 전용)', termNoAgents: '에이전트 없음',
    termAutoAgents: '에이전트가 명령을 실행하면 그 탭을 자동으로 열기', termAutoClose: '자동으로 연 탭은 30분 동안 명령이 없거나 세션이 끝나면 닫기',
    termRename: '이름 바꾸기', termPin: '고정', termUnpin: '고정 해제', termDup: '복제 — 같은 셸·폴더로 새 터미널', termClear: '출력 지우기',
    termSplitRight: '오른쪽으로 분할', termSplitDown: '아래로 분할',
    termLeft: '왼쪽으로 옮기기', termRight: '오른쪽으로 옮기기', termClose: '탭 닫기', termCloseOthers: '다른 탭 닫기 (고정 탭은 남김)', termCloseRight: '오른쪽 탭 닫기 (고정 탭은 남김)',
    hooksAgain: 'Claude Code hook을 이 앱 기준으로 다시 설치할까요?', hooksUpdate: '모니터 hook을 새 버전으로 갱신할까요?', hooksAsk: 'Claude Code에 모니터 hook을 설치할까요?',
    hooksWhy: (file) => '승인·질문에 답하기, 권한 모드 표시, 에이전트에게 메시지 보내기, 리더에게 팀원 알려 주기에 필요합니다.\n' + file + ' 의 모니터 항목만 추가·교체하고, 다른 설정은 그대로 둡니다 (백업: settings.json.before-agent-monitor).\n',
    hooksNode: 'hook은 이 PC의 Node.js로 실행됩니다.', hooksNoNode: 'Node.js가 없어서 hook은 이 앱으로 실행됩니다.',
    hooksDone: 'hook을 설치했습니다.', hooksDoneHow: '실행 중인 Claude Code 세션에도 곧바로 적용됩니다.', hooksFailed: 'hook을 설치하지 못했습니다.',
    open: 'ELOP Crew 열기', settings: '설정…', about: '프로그램 정보',
    updInstall: (v) => '업데이트 ' + v + ' 설치하고 다시 시작', updGet: (v) => '업데이트 ' + v + ' 받으러 가기',
    quitAll: '종료 (모니터 에이전트도 멈춤)', quit: '종료',
    session: (p) => '세션 ' + p + '%', week: (p) => '주간 ' + p + '%',
    waiting: (n) => '답을 기다리는 요청 ' + n + '건', requests: (n) => '요청 ' + n + '건',
    question: '질문', plan: '계획 승인', approval: '승인 요청', waits: '답을 기다립니다', agent: '에이전트',
    stalled: (who) => who + ' 멈춘 듯합니다', stalledHow: (m) => m + '분째 아무 활동이 없습니다',
    limSession: '현재 세션 (5시간)', limWeekAll: '주간 · 전체 모델', limWeekScoped: '주간 · ',
    min: (n) => n + '분', hours: (n) => n + '시간', days: (n) => n + '일', resets: (left) => left + ' 후 초기화',
    usage: (p, name) => 'Claude 사용량 ' + p + '% — ' + name,
    updOut: (v) => 'ELOP Crew ' + v + ' 나옴', updOutHow: '누르면 받는 곳을 엽니다.',
    updGot: (v) => 'ELOP Crew ' + v + ' 받음', updGotHow: '트레이 메뉴나 설정에서 다시 시작하면 바로 적용됩니다. 앱을 끌 때도 적용됩니다.',
    settingsTitle: 'ELOP Crew 설정', dataTitle: '데이터 폴더 (config.json, boards/)',
    restart: '다시 시작', dataMoved: '데이터 폴더를 바꿨습니다.', dataMovedHow: '앱을 다시 시작하면 새 폴더를 씁니다.',
    serverFailed: '모니터 서버를 시작하지 못했습니다.',
    move: '응용 프로그램으로 옮기기', keep: '그대로 쓰기', moveAsk: 'ELOP Crew를 응용 프로그램 폴더로 옮길까요?',
    moveWhy: 'Claude Code hook이 이 앱의 위치를 기억합니다. 디스크 이미지나 다운로드 폴더에서 그대로 쓰면, 그 사본이 없어질 때 hook도 멈춥니다.', moveFailed: '옮기지 못했습니다.',
  },
  en: {
    tryName: 'ELOP Crew (test)', install: 'Install', later: 'Later',
    termCmd: 'Command Prompt', termIn: 'Open in a project folder', termFailed: 'Could not start the shell.',
    termAgents: 'Agent commands (read-only)', termNoAgents: 'No agents',
    termAutoAgents: 'Open an agent\'s tab by itself when it runs a command', termAutoClose: 'Close a tab opened by itself after 30 min without a command, or once its session ends',
    termRename: 'Rename', termPin: 'Pin', termUnpin: 'Unpin', termDup: 'Duplicate — a new terminal, same shell and folder', termClear: 'Clear the output',
    termSplitRight: 'Split right', termSplitDown: 'Split down',
    termLeft: 'Move left', termRight: 'Move right', termClose: 'Close the tab', termCloseOthers: 'Close the others (pinned stay)', termCloseRight: 'Close those to the right (pinned stay)',
    hooksAgain: 'Reinstall the Claude Code hooks for this app?', hooksUpdate: 'Update the monitor hooks to the new version?', hooksAsk: 'Install the monitor hooks in Claude Code?',
    hooksWhy: (file) => 'They let you answer approvals and questions, show permission modes, send messages to agents, and tell leaders who is on their team.\nOnly the monitor\'s entries in ' + file + ' are added or replaced; every other setting stays as it is (backup: settings.json.before-agent-monitor).\n',
    hooksNode: 'The hooks run on this PC\'s Node.js.', hooksNoNode: 'Node.js was not found, so the hooks run on this app.',
    hooksDone: 'Hooks installed.', hooksDoneHow: 'Claude Code sessions already running pick them up right away.', hooksFailed: 'Could not install the hooks.',
    open: 'Open ELOP Crew', settings: 'Settings…', about: 'About',
    updInstall: (v) => 'Install update ' + v + ' and restart', updGet: (v) => 'Get update ' + v,
    quitAll: 'Quit (stops the monitor\'s agents too)', quit: 'Quit',
    session: (p) => 'Session ' + p + '%', week: (p) => 'Week ' + p + '%',
    waiting: (n) => n + (n === 1 ? ' request waiting for an answer' : ' requests waiting for an answer'), requests: (n) => n + (n === 1 ? ' request' : ' requests'),
    question: 'Question', plan: 'Plan approval', approval: 'Approval request', waits: 'Waiting for an answer', agent: 'Agent',
    stalled: (who) => who + ' seems to be stuck', stalledHow: (m) => 'No activity for ' + m + ' min',
    limSession: 'Current session (5 hours)', limWeekAll: 'Weekly · all models', limWeekScoped: 'Weekly · ',
    min: (n) => n + ' min', hours: (n) => n + (n === 1 ? ' hour' : ' hours'), days: (n) => n + (n === 1 ? ' day' : ' days'), resets: (left) => 'Resets in ' + left,
    usage: (p, name) => 'Claude usage ' + p + '% — ' + name,
    updOut: (v) => 'ELOP Crew ' + v + ' is out', updOutHow: 'Click to open the download page.',
    updGot: (v) => 'ELOP Crew ' + v + ' downloaded', updGotHow: 'Restart from the tray menu or the settings to apply it now; otherwise it applies when you quit the app.',
    settingsTitle: 'ELOP Crew Settings', dataTitle: 'Data folder (config.json, boards/)',
    restart: 'Restart', dataMoved: 'Data folder changed.', dataMovedHow: 'The app uses the new folder after a restart.',
    serverFailed: 'Could not start the monitor server.',
    move: 'Move to Applications', keep: 'Keep Here', moveAsk: 'Move ELOP Crew to the Applications folder?',
    moveWhy: 'The Claude Code hooks remember where this app is. Run from the disk image or the Downloads folder, the hooks stop working once that copy is gone.', moveFailed: 'Could not move it.',
  },
}
let lang = 'en'   // set once the app is ready (the system's language is known only then)
const t = (key, ...a) => { const v = TEXT[lang][key]; return typeof v === 'function' ? v(...a) : v }
const systemLang = () => (/^ko/i.test(app.getLocale() || '') ? 'ko' : 'en')
function setLang(v) {
  if (!TEXT[v]) return   // a page that failed to load has no language
  if (readSettings().lang !== v) writeSettings({ ...readSettings(), lang: v })
  if (lang === v) return
  lang = v
  if (tray) tray.setContextMenu(trayMenu())
  paintBadge()
  if (strip) strip.webContents.send('monitor-app-lang', lang)
  if (term) term.webContents.send('monitor-app-lang', lang)
  if (settingsWin) settingsWin.webContents.send('monitor-settings-changed')
}

/* ── Claude Code hooks: approvals, modes, messages ── */
// The monitor learns about permission prompts, modes and idle sessions through hooks registered in
// ~/.claude/settings.json. The app registers them itself, pointing at the scripts it ships, so a new PC
// needs nothing but Claude Code: with Node.js on the PATH the hooks run on it directly; without, this
// app's own executable runs them as Node (ELECTRON_RUN_AS_NODE).
const setup = require('./hooks-setup.cjs')({ hooksDir: path.join(CODE, 'hooks'), execPath: process.execPath, lang: () => lang })
const { hookState, installHooks, findNode, CLAUDE_SETTINGS } = setup

// A question for the user. On macOS a message box with no window runs modally on the main thread, and the
// monitor server lives on that thread: approvals would stop until it is answered. There it goes on the window, as a sheet.
function ask(opts) {
  if (!MAC) return dialog.showMessageBox(opts)
  showWindow()
  return dialog.showMessageBox(win, opts)
}

// raised whenever the hooks gain something: a "later" to an older update does not hold back a newer one
const HOOKS_REV = 3   // 2: the team hook for leaders (UserPromptSubmit); 3: the inbox waits a week, not a day
async function offerHooks(always) {
  if (TRY && !always) return   // the hooks belong to the installed app
  const state = hookState()
  if (state === 'ok' && !always) return
  const settings = readSettings()
  // hooks from an older version: offered once, even to someone who once said no to installing them
  const outdated = state === 'outdated'
  if (!always && (outdated ? settings.hooksUpdateDeclined === HOOKS_REV : settings.hooksDeclined)) return
  const r = await ask({
    type: 'question', buttons: [t('install'), t('later')], defaultId: 0, cancelId: 1,
    message: always ? t('hooksAgain') : outdated ? t('hooksUpdate') : t('hooksAsk'),
    detail: t('hooksWhy', CLAUDE_SETTINGS) + (findNode() ? t('hooksNode') : t('hooksNoNode')),
  })
  if (quitting) return   // a box closed by quitting is not an answer
  // read again: the box may have been open while the zoom or the window's place changed
  if (r.response !== 0) { if (!always) writeSettings({ ...readSettings(), ...(outdated ? { hooksUpdateDeclined: HOOKS_REV } : { hooksDeclined: true }) }); return }
  try { installHooks(); await ask({ type: 'info', message: t('hooksDone'), detail: t('hooksDoneHow') }) }
  catch (e) { dialog.showErrorBox('ELOP Crew', t('hooksFailed') + '\n\n' + (e && e.message || e)) }
  if (tray) tray.setContextMenu(trayMenu())
}

/* ── the server ── */
// another monitor may already be answering on the port (npm start in a terminal): use it instead of starting one
function answering() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/state', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}
let ownServer = false
async function startServer() {
  if (await answering()) return
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })
  process.env.MONITOR_HOME = dir
  process.env.PORT = String(PORT)
  await import(pathToFileURL(path.join(CODE, 'server.mjs')).href)
  ownServer = true
  for (let i = 0; i < 40 && !(await answering()); i++) await new Promise((r) => setTimeout(r, 150))
}

/* ── window and tray ── */
// The window is two views: a 36 px title strip (strip.html) on the window buttons' line, and the monitor page
// under it. Zoom, reload and history apply to the page only, so the strip keeps its size like the buttons do.
const STRIP = 36
const DARK = { color: '#171b22', symbolColor: '#e8eaef', height: STRIP }, LIGHT = { color: '#ffffff', symbolColor: '#171a21', height: STRIP }
// the theme picked in the page's menu, for the whole app (its header strip, the title bar, settings); kept in the settings
function setTheme(v) {
  v = ['light', 'dark'].includes(v) ? v : 'system'
  if (nativeTheme.themeSource !== v) nativeTheme.themeSource = v
  if ((readSettings().theme || 'system') !== v) writeSettings({ ...readSettings(), theme: v })
}
const overlay = () => (nativeTheme.shouldUseDarkColors ? DARK : LIGHT)
nativeTheme.on('updated', () => { if (win && !MAC) { try { win.setTitleBarOverlay(overlay()) } catch {} } })
// no system title bar: Windows draws minimise / maximise / close over the strip, macOS its traffic lights on the left
const titleBar = () => (MAC ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 11 } } : { titleBarStyle: 'hidden', titleBarOverlay: overlay() })
const LOGIN = { args: ['--hidden'] }   // started at login: stay in the tray
const zoom = () => { const z = Number(readSettings().zoom); return z >= 0.5 && z <= 2 ? z : 1 }
let win = null, page = null, strip = null, term = null
let browsersPanel = { on: false, n: 0 }   // the page's browsers panel, as it last said
function pageState() {
  if (!page) return { zoom: 1, canBack: false, canForward: false, term: false }
  const wc = page.webContents, h = wc.navigationHistory
  return { zoom: wc.getZoomFactor(), canBack: h.canGoBack(), canForward: h.canGoForward(), term: termOpen, browsers: browsersPanel }
}
function report() { if (strip) strip.webContents.send('monitor-app-state', pageState()) }
function appAction(action) {
  if (!page) return
  const wc = page.webContents, h = wc.navigationHistory
  if (action === 'back' && h.canGoBack()) h.goBack()
  else if (action === 'forward' && h.canGoForward()) h.goForward()
  else if (action === 'reload') wc.reloadIgnoringCache()
  else if (action.startsWith('zoom')) {
    const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    const cur = wc.getZoomFactor()
    let next = 1
    if (action === 'zoom-in') next = steps.find((x) => x > cur + 0.001) || 2
    if (action === 'zoom-out') next = [...steps].reverse().find((x) => x < cur - 0.001) || 0.5
    wc.setZoomFactor(next)
    writeSettings({ ...readSettings(), zoom: next })
  }
  setTimeout(report, 50)
}
ipcMain.handle('monitor-app', (_e, action) => {
  if (action === 'settings') { showSettings(); return pageState() }
  if (action === 'terminal') { toggleTerminal(); return pageState() }
  // the browsers panel is the page's: the strip's button presses the page's own, and the page says what came of it
  if (action === 'browsers') { if (page) page.webContents.executeJavaScript("document.getElementById('browser-btn')?.click()").catch(() => {}); return pageState() }
  if (String(action).startsWith('panel:browsers:')) { const [, , on, n] = String(action).split(':'); browsersPanel = { on: on === '1', n: Number(n) || 0 }; report(); return pageState() }
  // the usage in the strip opens the page's account dialog
  if (String(action).startsWith('theme:')) { setTheme(String(action).slice(6)); return pageState() }
  if (String(action).startsWith('lang:')) { setLang(String(action).slice(5)); return pageState() }
  if (action === 'account') { if (page) page.webContents.executeJavaScript("document.getElementById('acct-btn')?.click()").catch(() => {}); return pageState() }
  if (action !== 'state') appAction(String(action))
  return pageState()
})
function layout() {
  if (!win) return
  const { width, height } = win.getContentBounds()
  strip.setBounds({ x: 0, y: 0, width, height: STRIP })
  // the terminal panel, when shown, under the page: the page keeps at least 120 px
  const room = Math.max(0, height - STRIP)
  const th = term && termOpen ? Math.max(140, Math.min(termH || termHeight(), room - 120)) : 0
  page.setBounds({ x: 0, y: STRIP, width, height: room - th })
  if (term) { term.setVisible(termOpen); if (termOpen) term.setBounds({ x: 0, y: STRIP + room - th, width, height: th }) }
}
// the usual shortcuts, in either view: zoom, reload, back / forward
function shortcuts(wc) {
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return
    const k = i.key, mod = i.control || i.meta
    const act = mod && (k === '=' || k === '+') ? 'zoom-in' : mod && k === '-' ? 'zoom-out' : mod && k === '0' ? 'zoom-reset'
      : k === 'F5' || (mod && k.toLowerCase() === 'r') ? 'reload' : i.alt && k === 'ArrowLeft' ? 'back' : i.alt && k === 'ArrowRight' ? 'forward' : null
    if (act) { e.preventDefault(); appAction(act) }
  })
  termKeys(wc)
}
// Ctrl+` shows or hides the terminal panel and Ctrl+Shift+` starts a new shell in it, as in VS Code (⌃` on a Mac too)
function termKeys(wc) {
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' || !i.control || i.alt || i.meta || i.code !== 'Backquote') return
    e.preventDefault()
    if (i.shift) newTerminal(); else toggleTerminal()
  })
}

/* ── the terminal panel ── */
// A view under the page with the shells installed here (terminal.cjs runs them). Hidden, its shells keep running;
// the panel's height is kept in the settings.
let termOpen = false, termH = 0, termKeep = null
const termHeight = () => { const h = Number(readSettings().termHeight); return h >= 140 ? h : 300 }
terminals.onSend((event, ...a) => { if (term) term.webContents.send('monitor-term-' + event, ...a) })
terminals.keepIn(path.join(app.getPath('userData'), 'terminals.json'))
function toggleTerminal(show = !termOpen) {
  if (!win && !show) return
  if (show) showWindow()
  termOpen = show
  // shown at the next start too, with its tabs, if it was when the app quit
  if (!!readSettings().termOpen !== show) writeSettings({ ...readSettings(), termOpen: show })
  if (show && !term) {
    term = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'terminal-preload.cjs') } })
    term.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0f1116' : '#ffffff')
    win.contentView.addChildView(term)
    const wc = term.webContents
    wc.loadFile(path.join(__dirname, 'terminal.html'), { query: { platform: process.platform, lang } })
    wc.on('did-finish-load', () => { if (termOpen && term) wc.send('monitor-term-shown') })
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
    wc.on('will-navigate', (e) => e.preventDefault())
    termKeys(wc)
  }
  layout()
  if (show) { term.webContents.focus(); if (!term.webContents.isLoading()) term.webContents.send('monitor-term-shown') }
  else if (page) page.webContents.focus()
  report()
}
// the folder of the project picked on the page (its tab is the address's #, else the one it remembers), and every project's
async function termFolders() {
  let key = '', projects = []
  try { key = await page.webContents.executeJavaScript("decodeURIComponent(location.hash.slice(1)) || localStorage.getItem('am.tab') || ''") } catch {}
  try { projects = (await (await fetch(URL + 'api/state')).json()).projects.map((p) => ({ key: p.key, root: p.root, name: p.name || p.key })) } catch {}
  return { cur: projects.find((p) => p.key === key)?.root || '', projects }
}
// a shell started from the app (the shell menu, Ctrl+Shift+`), handed to the panel; one picked becomes the default
async function startShell(shellId, cwd) {
  if (shellId) writeSettings({ ...readSettings(), termShell: shellId })
  try {
    const info = terminals.open({ shell: shellId || readSettings().termShell, cwd: cwd || (await termFolders()).cur })
    if (term) term.webContents.send('monitor-term-opened', info)
  } catch (e) { dialog.showErrorBox('ELOP Crew', t('termFailed') + '\n\n' + (e && e.message || e)) }
}
function newTerminal() {
  // a panel not drawn yet, or with no shell, starts one itself once shown
  const starts = !term || term.webContents.isLoading() || !terminals.count()
  toggleTerminal(true)
  if (!starts) startShell()
}
async function termMenu(x, y) {
  const { projects } = await termFolders()
  const shells = terminals.shells(), def = readSettings().termShell || shells[0]?.id
  // every agent's commands, as a read-only tab (only with the monitor's server in this app)
  const runs = globalThis.agentMonitorRuns
  const crew = runs ? await runs.agents().catch(() => []) : null
  const agentItems = !crew ? [] : [{ type: 'separator' }, {
    label: t('termAgents'),
    submenu: crew.length ? crew.map((a) => ({ label: (lang === 'ko' ? a.nick : a.nickEn) + '   ' + a.project, click: () => { if (term) term.webContents.send('monitor-term-agent', { name: a.name, label: lang === 'ko' ? a.nick : a.nickEn, project: a.project }) } }))
      : [{ label: t('termNoAgents'), enabled: false }],
  }, { label: t('termAutoAgents'), type: 'checkbox', checked: termPrefs().autoAgents, click: (i) => setTermPref('termAutoAgents', i.checked) },
  { label: t('termAutoClose'), type: 'checkbox', checked: termPrefs().autoClose, enabled: termPrefs().autoAgents, click: (i) => setTermPref('termAutoClose', i.checked) }]
  const menu = Menu.buildFromTemplate([
    ...shells.map((s) => ({ label: s.id === 'cmd' ? t('termCmd') : s.name, type: 'checkbox', checked: s.id === def, click: () => startShell(s.id) })),
    ...(projects.length ? [{ type: 'separator' }, { label: t('termIn'), submenu: projects.map((p) => ({ label: p.name + '   ' + p.root, click: () => startShell(null, p.root) })) }] : []),
    ...agentItems,
  ])
  if (term && win) menu.popup({ window: win, x: Math.round(x), y: Math.round(term.getBounds().y + y) })
}
// a tab's own menu (right-click on it); what is picked is done by the panel
function tabMenu(id, s, x, y) {
  if (!term || !win) return
  const run = (cmd) => () => { if (term) term.webContents.send('monitor-term-cmd', cmd, id) }
  const menu = Menu.buildFromTemplate([
    { label: t('termRename'), accelerator: 'F2', registerAccelerator: false, click: run('rename') },
    { label: t(s.pinned ? 'termUnpin' : 'termPin'), click: run(s.pinned ? 'unpin' : 'pin') },
    { label: t('termDup'), enabled: s.dup !== false, click: run('dup') },
    { type: 'separator' },
    { label: t('termSplitRight'), accelerator: 'Ctrl+Shift+5', registerAccelerator: false, enabled: !!s.splitRight, click: run('splitRight') },
    { label: t('termSplitDown'), enabled: !!s.splitDown, click: run('splitDown') },
    { type: 'separator' },
    { label: t('termLeft'), accelerator: 'Ctrl+Shift+PageUp', registerAccelerator: false, enabled: !!s.left, click: run('left') },
    { label: t('termRight'), accelerator: 'Ctrl+Shift+PageDown', registerAccelerator: false, enabled: !!s.right, click: run('right') },
    { type: 'separator' },
    { label: t('termClear'), ...(MAC ? { accelerator: 'Cmd+K', registerAccelerator: false } : {}), click: run('clear') },
    { type: 'separator' },
    { label: t('termClose'), click: run('close') },
    { label: t('termCloseOthers'), enabled: !!s.others, click: run('closeOthers') },
    { label: t('termCloseRight'), enabled: !!s.toRight, click: run('closeRight') },
  ])
  menu.popup({ window: win, x: Math.round(x), y: Math.round(term.getBounds().y + y) })
}
// The monitor's assistant (in the server, in this process) sees the terminals: the tabs and their shells, the last of
// what one printed (as the panel draws it, else from what was kept), and types into one — but only once the person
// has allowed it, which the server asks them on the page
globalThis.agentMonitorTerminals = {
  list: () => terminals.info(),
  async lines(id, n) {
    if (!terminals.has(id)) return null
    if (term && !term.webContents.isDestroyed() && !term.webContents.isLoading()) {
      try { const l = await term.webContents.executeJavaScript(`window.__crewLines ? window.__crewLines(${id | 0}, ${n | 0}) : null`); if (Array.isArray(l)) return l } catch {}
    }
    return terminals.tail(id, n)
  },
  type(id, text) { if (!terminals.has(id)) return false; terminals.write(id, text); return true },
  // a new tab an agent or the assistant opens (the person allowed it on the page): shown in the panel, and its command
  // typed once the shell has printed its prompt
  async open({ cwd, title, command }) {
    const info = terminals.open({ shell: readSettings().termShell, cwd, title })
    const tell = () => { if (term && !term.webContents.isDestroyed()) term.webContents.send('monitor-term-opened', info) }
    if (term && term.webContents.isLoading()) term.webContents.once('did-finish-load', tell)
    else tell()   // none yet: the panel shown below starts with the shells running
    if (!termOpen) toggleTerminal(true)
    let typed = false
    if (command) {
      for (let i = 0; i < 80 && terminals.has(info.id) && !(terminals.tail(info.id, 1) || []).length; i++) await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 500))
      if (terminals.has(info.id)) { terminals.write(info.id, command + '\r'); typed = true }
    }
    return { id: info.id, shell: info.name, folder: info.cwd, typed }
  },
}
// An agent that starts a shell command gets its read-only tab opened by itself, behind the one in view (a setting, on
// by default); the panel closes such a tab again after a while without commands (another setting, read by the panel)
const termPrefs = () => { const s = readSettings(); return { autoAgents: s.termAutoAgents !== false, autoClose: s.termAutoClose !== false } }
function setTermPref(key, on) {
  writeSettings({ ...readSettings(), [key]: !!on })
  if (term) term.webContents.send('monitor-term-prefs', termPrefs())
}
const shellSeen = new Map()   // agent → when its last shell command began, as last seen
let shellPrimed = false
async function autoAgentTabs() {
  const runs = globalThis.agentMonitorRuns
  if (!runs || !term || term.webContents.isLoading() || !termPrefs().autoAgents) return
  const crew = await runs.agents().catch(() => null)
  if (!crew || !term) return
  for (const a of crew) {
    const at = a.shellAt || 0, before = shellSeen.has(a.name) ? shellSeen.get(a.name) : shellPrimed ? 0 : at
    shellSeen.set(a.name, at)
    // the first look only learns where each one is (what began before is not news); one that came since starts at none
    if (at > before) term.webContents.send('monitor-term-agent', { name: a.name, label: lang === 'ko' ? a.nick : a.nickEn, project: a.project, auto: true })
  }
  shellPrimed = true
}
setInterval(() => { autoAgentTabs().catch(() => {}) }, 3000).unref?.()
const fromTerm = (e) => !!term && e.sender === term.webContents
ipcMain.handle('monitor-term', async (e, action, ...a) => {
  if (!fromTerm(e)) return null
  // the shells running; with none, the tabs of the app's last run, to start again
  if (action === 'list') return { running: terminals.list(), layout: terminals.layout(), saved: terminals.count() ? [] : terminals.saved() }
  if (action === 'open') {
    const o = a[0] || {}
    return terminals.open({ cols: o.cols, rows: o.rows, title: o.title, inherit: !!o.inherit, hid: o.hid, prior: typeof o.prior === 'string' ? o.prior.slice(-64 * 1024) : '', shell: o.shell || readSettings().termShell, cwd: o.cwd || (await termFolders()).cur })
  }
  if (action === 'resize') terminals.resize(a[0], a[1], a[2])
  if (action === 'close') terminals.close(a[0])
  if (action === 'rename') terminals.rename(a[0], a[1])
  if (action === 'layout') terminals.setLayout(a[0])
  if (action === 'prefs') return termPrefs()
  // an agent's commands and what they printed (masked), for its read-only tab
  if (action === 'runs') return globalThis.agentMonitorRuns ? globalThis.agentMonitorRuns.runs(String(a[0] || '')).catch(() => null) : null
  if (action === 'clear') terminals.clearBuf(a[0])
  if (action === 'tabMenu') tabMenu(a[0], a[1] || {}, a[2], a[3])
  if (action === 'hide') toggleTerminal(false)
  if (action === 'menu') termMenu(a[0], a[1])
  if (action === 'copy') clipboard.writeText(String(a[0] || ''))
  if (action === 'paste') return clipboard.readText()
  return null
})
ipcMain.on('monitor-term-write', (e, id, data) => { if (fromTerm(e)) terminals.write(id, data) })
// the panel's top edge dragged to a height on the screen
ipcMain.on('monitor-term-drag', (e, screenY) => {
  if (!fromTerm(e) || !win || !Number.isFinite(screenY)) return
  const b = win.getContentBounds()
  termH = Math.max(140, Math.min(b.y + b.height - screenY, b.height - STRIP - 120))
  layout()
  clearTimeout(termKeep)
  termKeep = setTimeout(() => writeSettings({ ...readSettings(), termHeight: termH }), 400)
})
let tray = null, quitting = false
// the window opens where it was and as big as it was, maximised if it was — unless that place is on no screen now
// (a monitor unplugged since), when it opens at the default size on the main one
function savedBounds() {
  const b = readSettings().bounds
  if (!b || !(b.width >= 720 && b.height >= 480) || ![b.x, b.y].every(Number.isFinite)) return null
  const a = screen.getDisplayMatching(b).workArea
  const onScreen = b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 8 && b.y < a.y + a.height - 80
  return onScreen ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
}
let keepTimer = null
function keepBounds() {
  clearTimeout(keepTimer)
  keepTimer = null
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  // the normal bounds even when maximised, so un-maximising after a restart goes back to the right size
  writeSettings({ ...readSettings(), bounds: win.getNormalBounds(), maximized: win.isMaximized() })
}
const keepSoon = () => { clearTimeout(keepTimer); keepTimer = setTimeout(keepBounds, 600) }
function showWindow() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return }
  const dark = nativeTheme.shouldUseDarkColors
  const at = savedBounds()
  win = new BaseWindow({
    width: 1440, height: 920, ...(at || {}), minWidth: 720, minHeight: 480, title: 'ELOP Crew', icon: ICON,
    backgroundColor: dark ? '#0f1116' : '#f2f3f7',
    ...titleBar(),
  })
  if (at && readSettings().maximized) win.maximize()
  const safe = { contextIsolation: true, sandbox: true }
  strip = new WebContentsView({ webPreferences: { ...safe, preload: path.join(__dirname, 'preload.cjs') } })
  // the page gets the same bridge, for the theme and the language it tells the app
  page = new WebContentsView({ webPreferences: { ...safe, preload: path.join(__dirname, 'preload.cjs') } })
  page.setBackgroundColor(dark ? '#0f1116' : '#f2f3f7')
  win.contentView.addChildView(page)
  win.contentView.addChildView(strip)
  strip.webContents.loadFile(path.join(__dirname, 'strip.html'), { query: { platform: process.platform, lang } })
  strip.webContents.on('did-finish-load', () => { if (strip) strip.webContents.send('monitor-app-usage', usage) })
  page.webContents.loadURL(URL + '?app=1&v=' + encodeURIComponent(app.getVersion()) + (TRY ? '&try=1' : ''))
  layout()
  win.on('resize', layout)
  win.on('maximize', layout)
  win.on('unmaximize', layout)
  for (const e of ['resize', 'move', 'maximize', 'unmaximize']) win.on(e, keepSoon)
  const wc = page.webContents
  // the language the page shows (its pick, or its default): it tells the app itself only when it switches
  wc.on('did-finish-load', () => { wc.setZoomFactor(zoom()); report(); wc.executeJavaScript('document.documentElement.lang').then(setLang).catch(() => {}) })
  wc.on('did-navigate-in-page', report)
  // Ctrl + mouse wheel: the same steps as the buttons, and remembered
  wc.on('zoom-changed', (_e, direction) => appAction(direction === 'in' ? 'zoom-in' : 'zoom-out'))
  shortcuts(wc)
  shortcuts(strip.webContents)
  // links in replies open in the real browser, not inside the app
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(URL)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url) } })
  // closing the window keeps the monitor running in the tray
  win.on('close', (e) => { keepBounds(); if (quitting) return; if (readSettings().closeToTray === false) { quit(); return } e.preventDefault(); win.hide() })
  win.on('closed', () => { win = page = strip = term = null; termOpen = false })
  win.on('session-end', () => terminals.closeAll())   // Windows: shutting down or logging off
  // the terminal panel, open when the app last quit: open again, its tabs started again
  if (readSettings().termOpen) setImmediate(() => toggleTerminal(true))
  win.on('focus', () => { try { win.flashFrame(false) } catch {} })
  paintBadge()
}
// the page's about dialog, from the settings or the tray
function showAbout() {
  showWindow()
  if (page) page.webContents.executeJavaScript("document.getElementById('about-btn')?.click()").catch(() => {})
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: t('open'), click: showWindow },
    { label: t('settings'), click: showSettings },
    { label: t('about'), click: showAbout },
    ...(update.status === 'ready' ? [{ label: t('updInstall', update.version), click: installUpdate }] : []),
    ...(update.status === 'available' ? [{ label: t('updGet', update.version), click: installUpdate }] : []),
    { type: 'separator' },
    { label: ownServer ? t('quitAll') : t('quit'), click: quit },
  ])
}

/* ── attention: requests waiting, agents that look stuck, limits running out ── */
// The app reads the same state the page does, so it can badge the taskbar and the tray and send desktop
// notifications while the window is hidden. The page leaves notifications to the app (?app=1).
const ORANGE = [0x1f, 0x8c, 0xf5]   // BGR of the "waiting" colour
function dot(size, r, cx, cy, into) {
  const buf = into || Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    if (d > r + 0.5) continue
    const i = (y * size + x) * 4, edge = d > r - 1.2   // a light rim keeps the dot readable on the icon
    buf[i] = edge ? 0xff : ORANGE[0]; buf[i + 1] = edge ? 0xff : ORANGE[1]; buf[i + 2] = edge ? 0xff : ORANGE[2]; buf[i + 3] = 0xff
  }
  return buf
}
let trayPlain = null, trayDot = null, overlayDot = null, waitingCount = 0, usage = null
const usageLine = () => { const l = usage?.limits || [], s = l.find((x) => x.kind === 'session'), w = l.find((x) => x.kind === 'weekly_all'); return [s && t('session', Math.round(s.percent)), w && t('week', Math.round(w.percent))].filter(Boolean).join(' · ') }
function paintBadge() {
  if (!trayPlain) {
    trayPlain = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })
    trayDot = nativeImage.createFromBitmap(dot(16, 4.5, 11, 11, Buffer.from(trayPlain.toBitmap())), { width: 16, height: 16 })
    overlayDot = nativeImage.createFromBitmap(dot(16, 7, 8, 8), { width: 16, height: 16 })
  }
  const n = waitingCount
  if (tray) { tray.setImage(n ? trayDot : trayPlain); tray.setToolTip([NAME(), usageLine(), n ? t('waiting', n) : ''].filter(Boolean).join('\n')) }
  if (MAC) { if (app.dock) app.dock.setBadge(n ? String(n) : '') }
  else if (win) { try { win.setOverlayIcon(n ? overlayDot : null, n ? t('requests', n) : '') } catch (e) { console.error('overlay icon:', e.message) } }
}
const shown = new Set()   // a notification that is garbage-collected no longer answers its click
function notify(title, body, onClick) {
  if (TRY || !Notification.isSupported()) return   // the installed app already says it
  const n = new Notification({ title, body, icon: ICON, silent: false })
  shown.add(n)
  n.on('click', () => { shown.delete(n); showWindow(); if (onClick) onClick() })
  n.on('close', () => shown.delete(n))
  n.show()
}
const focused = () => !!(win && win.isVisible() && win.isFocused())
const usageLevel = (x) => (x.percent >= 95 || /exceed|critical|block/.test(String(x.severity || '')) ? 2 : x.percent >= 80 || x.severity === 'warning' ? 1 : 0)
const LIMIT_NAMES = { session: 'limSession', weekly_all: 'limWeekAll' }
const limitName = (x) => x.kind === 'weekly_scoped' ? t('limWeekScoped') + (x.model || '') : LIMIT_NAMES[x.kind] ? t(LIMIT_NAMES[x.kind]) : x.kind
// the Korean nickname on a Korean page, as the page names them
const who = (a) => (lang === 'ko' && a.nickKo) || a.nick || a.nickKo || a.session || t('agent')
let seenAsks = null, seenStalls = null
function watch(data) {
  const approvals = data.approvals || [], inEditor = data.inEditor || []
  const count = approvals.length + inEditor.length
  const u = data.usage || null
  const usageChanged = JSON.stringify(u) !== JSON.stringify(usage)
  if (usageChanged) { usage = u; if (strip) strip.webContents.send('monitor-app-usage', usage) }
  if (count !== waitingCount || usageChanged) { waitingCount = count; paintBadge() }
  // a request that has just arrived: flash the taskbar and say who is asking (not on the first look)
  const fresh = seenAsks ? approvals.filter((a) => !seenAsks.has(a.id)) : []
  seenAsks = new Set(approvals.map((a) => a.id))
  if (fresh.length && !focused()) {
    if (MAC) { if (app.dock) app.dock.bounce('informational') }
    else if (win) { try { win.flashFrame(true) } catch {} }
    for (const a of fresh.slice(0, 3)) notify((a.questions ? t('question') : a.plan ? t('plan') : t('approval')) + ' · ' + who(a), [a.tool, a.what].filter(Boolean).join(' — ') || t('waits'))
  }
  // an agent that starts to look stuck: once, until it moves again
  const sessions = (data.projects || []).flatMap((p) => p.sessions || [])
  const stalled = sessions.filter((x) => x.stalledFor)
  if (seenStalls && !focused()) for (const x of stalled.filter((x) => !seenStalls.has(x.name))) notify(t('stalled', who(x)), t('stalledHow', Math.round(x.stalledFor / 60000)))
  seenStalls = new Set(stalled.map((x) => x.name))
  // limits: once past 80 % and again past 95 %, remembered until that limit resets
  const limits = data.usage?.limits || []
  if (limits.length) {
    const cur = readSettings(), told = cur.usageTold || {}, next = {}
    let changed = false
    for (const x of limits) {
      const k = x.kind + '|' + (x.model || '') + '|' + String(x.resetsAt || '').slice(0, 16), lv = usageLevel(x)
      next[k] = Math.max(lv, told[k] || 0)
      if (lv > (told[k] || 0)) {
        changed = true
        const at = Date.parse(x.resetsAt), left = at - Date.now()
        const when = left > 0 ? t('resets', left < 3600e3 ? t('min', Math.round(left / 60000)) : left < 86400e3 ? t('hours', Math.round(left / 3600e3)) : t('days', Math.round(left / 86400e3))) : ''
        notify(t('usage', Math.round(x.percent), limitName(x)), when)
      }
    }
    if (changed || Object.keys(next).length !== Object.keys(told).length) writeSettings({ ...readSettings(), usageTold: next })
  }
}
async function watchLoop() {
  try {
    const r = await fetch(URL + 'api/state', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (r.ok) watch(await r.json())
  } catch {}
  setTimeout(watchLoop, 2000)
}

/* ── a global shortcut: bring the window up from anywhere, and back down ── */
// Ctrl+Alt ones: VS Code and the browsers hardly use them. Until one is picked, the first one no other program has.
const HOTKEYS = ['Control+Alt+J', 'Control+Alt+M', 'Control+Alt+Space', 'Control+Alt+K', 'off']
let hotkeyOk = true, hotkeyNow = HOTKEYS[0]
const picked = () => { const k = readSettings().hotkey; return HOTKEYS.includes(k) ? k : null }
function hotkey() { return hotkeyNow }
function toggleWindow() {
  if (focused()) { win.hide(); return }
  showWindow()
  // the keys go to the page, so the number keys answer the first request straight away
  if (page) page.webContents.focus()
}
function registerHotkey() {
  globalShortcut.unregisterAll()
  if (TRY) { hotkeyOk = true; hotkeyNow = 'off'; return }   // the installed app has the key
  const k = picked()
  if (k) { hotkeyNow = k; hotkeyOk = k === 'off' || globalShortcut.register(k, toggleWindow); return }   // false: another program has it
  hotkeyOk = false
  for (const c of HOTKEYS.filter((x) => x !== 'off')) if (globalShortcut.register(c, toggleWindow)) { hotkeyNow = c; hotkeyOk = true; return }
  hotkeyNow = HOTKEYS[0]
}

/* ── updates from GitHub Releases ── */
// An installed app checks at start and every six hours, downloads in the background and installs on the next
// restart (or at once from the tray or the settings). While developing there is nothing to update.
let updater = null
const update = { status: app.isPackaged ? 'idle' : 'dev', version: null, percent: 0 }
function setUpdate(status, extra) {
  Object.assign(update, { status }, extra || {})
  if (tray) tray.setContextMenu(trayMenu())
  if (settingsWin) settingsWin.webContents.send('monitor-settings-changed')
}
function checkUpdates() { if (updater) updater.checkForUpdates().catch(() => setUpdate('error')) }
function setupUpdates() {
  if (!app.isPackaged) return
  try { updater = require('electron-updater').autoUpdater } catch { return }
  // the macOS build is not signed with a Developer ID, and macOS applies an update only to a signed app:
  // there the app says a new version is out and opens the release page
  updater.autoDownload = !MAC
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => setUpdate('checking'))
  updater.on('update-available', (i) => {
    if (!MAC) { setUpdate('downloading', { version: i.version, percent: 0 }); return }
    const fresh = update.version !== i.version
    setUpdate('available', { version: i.version })
    if (fresh) notify(t('updOut', i.version), t('updOutHow'), () => shell.openExternal(RELEASES))
  })
  updater.on('update-not-available', () => setUpdate('latest'))
  updater.on('download-progress', (p) => { update.percent = Math.round(p.percent || 0); if (settingsWin) settingsWin.webContents.send('monitor-settings-changed') })
  updater.on('update-downloaded', (i) => { setUpdate('ready', { version: i.version }); notify(t('updGot', i.version), t('updGotHow')) })
  // no release published yet is not a failure
  updater.on('error', (e) => setUpdate(/404|No published versions|Unable to find latest/i.test(String(e && e.message)) ? 'none' : 'error'))
  checkUpdates()
  setInterval(checkUpdates, 6 * 3600e3).unref()
}
function installUpdate() {
  if (update.status === 'available') { shell.openExternal(RELEASES); return }
  if (!updater || update.status !== 'ready') return
  quitting = true
  if (ownServer && typeof globalThis.agentMonitorShutdown === 'function') globalThis.agentMonitorShutdown()
  updater.quitAndInstall(true, true)
}

/* ── settings window: start at login, close to tray, data folder, hooks, about ── */
let settingsWin = null
// centred on the screen the app's window is on (else the pointer's): left to Windows, it opened on the main screen,
// out of sight of an app window on the other one, so the settings button seemed to do nothing
function centreOn(width, height) {
  const ref = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() ? screen.getDisplayMatching(win.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const a = ref.workArea
  return { x: Math.round(a.x + Math.max(0, (a.width - width) / 2)), y: Math.round(a.y + Math.max(0, (a.height - height) / 2)), width, height }
}
function showSettings() {
  if (settingsWin) {
    // brought to the app's screen if it is on another
    const [w, h] = settingsWin.getSize(), at = centreOn(w, h)
    if (screen.getDisplayMatching(settingsWin.getBounds()).id !== screen.getDisplayMatching(at).id) settingsWin.setBounds(at)
    if (settingsWin.isMinimized()) settingsWin.restore()
    settingsWin.show(); settingsWin.focus(); return
  }
  settingsWin = new BrowserWindow({
    ...centreOn(620, 800), resizable: false, minimizable: false, maximizable: false, title: t('settingsTitle'), icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1116' : '#f2f3f7', autoHideMenuBar: true,
    ...titleBar(),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'settings-preload.cjs') },
  })
  settingsWin.loadFile(path.join(__dirname, 'settings.html'), { query: { platform: process.platform, lang } })
  settingsWin.on('closed', () => { settingsWin = null })
}
ipcMain.handle('monitor-settings', async (_e, action, key, value) => {
  const cur = readSettings()
  // the test app has the installed app's Windows id, so its autostart entry and the hooks would be the installed app's
  if (action === 'set' && key === 'openAtLogin' && !TRY) app.setLoginItemSettings({ openAtLogin: !!value, ...LOGIN })
  if (action === 'set' && key === 'closeToTray') writeSettings({ ...cur, closeToTray: !!value })
  if (action === 'set' && key === 'hotkey' && HOTKEYS.includes(value)) { writeSettings({ ...cur, hotkey: value }); registerHotkey() }
  if (action === 'checkUpdates') checkUpdates()
  if (action === 'installUpdate') installUpdate()
  if (action === 'openData') shell.openPath(dataDir())
  if (action === 'openBrowser') shell.openExternal(URL)
  if (action === 'about') showAbout()
  if (action === 'installHooks' && !TRY) {
    try { installHooks() } catch (e) { dialog.showErrorBox('ELOP Crew', t('hooksFailed') + '\n\n' + (e && e.message || e)) }
  }
  if (action === 'pickData') {
    const r = await dialog.showOpenDialog(settingsWin, { title: t('dataTitle'), defaultPath: dataDir(), properties: ['openDirectory', 'createDirectory'] })
    if (!r.canceled && r.filePaths[0]) {
      writeSettings({ ...readSettings(), dataDir: r.filePaths[0] })
      const ok = await dialog.showMessageBox(settingsWin, { type: 'info', buttons: [t('restart'), t('later')], message: t('dataMoved'), detail: t('dataMovedHow') })
      if (ok.response === 0) { app.relaunch(); quit() }
    }
  }
  const s2 = readSettings()
  return {
    openAtLogin: app.getLoginItemSettings(LOGIN).openAtLogin, closeToTray: s2.closeToTray !== false,
    dataDir: dataDir(), ownServer, hooks: hookState(), node: !!findNode(), version: app.getVersion(), url: URL,
    hotkey: hotkey(), hotkeys: HOTKEYS, hotkeyOk, update: { ...update }, platform: process.platform, lang, try: TRY,
  }
})
function quit() {
  quitting = true
  terminals.closeAll()
  if (ownServer && typeof globalThis.agentMonitorShutdown === 'function') globalThis.agentMonitorShutdown()
  app.quit()
}

/* ── lifecycle ── */
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWindow)
  app.whenReady().then(async () => {
    if (!MAC) Menu.setApplicationMenu(null)
    setTheme(readSettings().theme)   // the theme picked last time, before any window shows
    lang = TEXT[readSettings().lang] ? readSettings().lang : systemLang()   // and the language
    try { await startServer() } catch (e) {
      dialog.showErrorBox('ELOP Crew', t('serverFailed') + '\n\n' + (e && e.message || e))
      app.quit()
      return
    }
    // run from the disk image or Downloads, the hooks would point at a copy that goes away: offer to move it first
    if (MAC && app.isPackaged && !app.isInApplicationsFolder() && !readSettings().moveDeclined) {
      const r = await ask({ type: 'question', buttons: [t('move'), t('keep')], defaultId: 0, cancelId: 1, message: t('moveAsk'), detail: t('moveWhy') })
      // a box closed by quitting is not a yes
      if (quitting) return
      if (r.response === 0) { try { if (app.moveToApplicationsFolder()) return } catch (e) { dialog.showErrorBox('ELOP Crew', t('moveFailed') + '\n\n' + (e && e.message || e)) } }
      else writeSettings({ ...readSettings(), moveDeclined: true })
    }
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
    tray.setToolTip(NAME())
    tray.setContextMenu(trayMenu())
    tray.on('click', showWindow)
    // started at login: stay in the tray until opened (macOS says so itself; Windows passes --hidden)
    let atLogin = process.argv.includes('--hidden')
    if (MAC) { try { atLogin = atLogin || app.getLoginItemSettings().wasOpenedAtLogin } catch {} }
    if (!atLogin) showWindow()
    // a PC where the monitor's hooks are not registered yet: offer to register them
    offerHooks(false)
    paintBadge()
    watchLoop()
    registerHotkey()
    setupUpdates()
  })
  app.on('window-all-closed', () => { /* the tray keeps the app alive */ })
  // the Dock icon brings the window back
  app.on('activate', () => { if (tray) showWindow() })
  // Cmd+Q and the Dock's Quit come here without going through quit(): stop the agents the same way
  app.on('before-quit', () => {
    if (!quitting && ownServer && typeof globalThis.agentMonitorShutdown === 'function') globalThis.agentMonitorShutdown()
    quitting = true
  })
  // an update installing, Cmd+Q: the terminal tabs written down and their shells ended, as quit() does
  app.on('will-quit', () => { globalShortcut.unregisterAll(); terminals.closeAll() })
  // the PC shutting down or logging off may end the shells before the app quits: their tabs written down first
  powerMonitor.on('shutdown', () => terminals.closeAll())
}
