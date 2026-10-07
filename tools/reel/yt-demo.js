// A demo monitor for the YouTube walkthrough: the real page, title strip, terminal panel and settings window, served
// with made-up projects, agents, conversations and requests. Nothing here comes from this PC's sessions or accounts.
// The stage (youtube.html) moves the story on with /demo/* calls.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PORT = 4797;
const T0 = Date.now();
const min = (n) => Date.now() - n * 60000;
const streams = new Set();
const changed = () => { for (const s of streams) s.write('event: changed\ndata: {}\n\n'); };
// the English walkthrough (YT_LANG=en): everything the page gets, put into English on its way out
const EN = process.env.YT_LANG === 'en', DICT = require('./yt-en.js');
const KEYS = Object.keys(DICT).sort((a, b) => b.length - a.length);
const tr = (s) => { if (!EN || typeof s !== 'string' || !/[가-힣]/.test(s)) return s; if (DICT[s] != null) return DICT[s]; for (const k of KEYS) s = s.split(k).join(DICT[k]); return s; };
const out = (o) => (!EN ? o : typeof o === 'string' ? tr(o) : Array.isArray(o) ? o.map(out) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, out(v)])) : o);

/* ── the bridges the desktop app's preloads give each view, stood in for by the stage ── */
const STUB = {
  'strip.html': 'window.monitorApp = parent.STUB.app(window)',
  'terminal.html': 'window.monitorTerm = parent.STUB.term(window)',
  'settings.html': 'window.monitorSettings = parent.STUB.settings(window)',
  'index.html': 'window.monitorApp = parent.STUB.app(window)',
};
const html = (file, name) => fs.readFileSync(file, 'utf8').replace('__MONITOR_TOKEN__', 'demo').replace('<head>', '<head><script>try{' + STUB[name] + '}catch(e){}</script>');

/* ── projects and agents ── */
const act = (key, kind, arg = '') => ({ key, kind, arg });
let n = 0;
function sess(id, nickKo, o) {
  return {
    id, name: 'monitor-' + id, short: '-' + id.slice(0, 2), nick: nickKo, nickKo, named: { en: nickKo, ko: nickKo }, avatar: null, desc: '',
    state: 'working', statusSince: min(6), startedAt: min(95 + n++ * 7), kind: 'monitor', managed: true, agentId: id, running: true,
    role: '', title: '', activity: null, activityAt: min(0.2), lastEventAt: min(0.1), sentCount: 0, mode: 'acceptEdits', model: 'opus', effort: '', compact: '',
    listening: false, queued: 0, context: 48000, ctxWindow: 1000000, errors: 0, results: 12, lastErrorAt: 0, lastSignAt: min(0.1), subagents: [],
    today: { total: 1.2e6, in: 300, out: 24000, cacheRead: 1.1e6, cacheWrite: 60000 }, stalledFor: 0, isLeader: false,
    procs: { n: 2, cpu: 1.5, mem: 380e6, hooks: 1, browsers: 0 }, limitHit: null, lastFail: null, loginLost: 0, away: null, ...o,
  };
}
const S = {
  minjun: sess('a1minjun', '민준', { isLeader: true, role: '리더 · 결제 화면 개편', activity: act('edit', 'edit', 'CheckoutPage.tsx'), context: 182000, today: { total: 3.2e6, in: 900, out: 61000, cacheRead: 3.0e6, cacheWrite: 140000 }, procs: { n: 3, cpu: 4, mem: 520e6, hooks: 1, browsers: 1 } }),
  seoyeon: sess('b3seoyeon', '서연', { role: '결제 테스트', activity: act('shell', 'shell', '결제 모듈 테스트 실행'), context: 96000, subagents: [{ type: 'Explore', at: min(1) }], procs: { n: 5, cpu: 38, mem: 910e6, hooks: 1, browsers: 0 } }),
  jiho: sess('c7jiho', '지호', { state: 'waiting', statusSince: min(4), role: '디자인 QA', activity: act('read', 'read', 'design-tokens.css'), activityAt: min(4), context: 61000 }),
  haeun: sess('d9haeun', '하은', { role: '배포 준비', activity: act('shell', 'shell', '스테이징 빌드'), mode: 'default', context: 74000, procs: { n: 4, cpu: 22, mem: 640e6, hooks: 1, browsers: 0 } }),
  doyun: sess('e2doyun', '도윤', { state: 'resting', statusSince: min(48), role: '문서 정리', activity: act('write', 'edit', 'CHANGELOG.md'), activityAt: min(48), running: false, context: 352000 }),
  sua: sess('f2sua', '수아', { isLeader: true, role: '리더 · 주문 API', activity: act('grep', 'search'), context: 140000 }),
  yejun: sess('g5yejun', '예준', { state: 'waiting', statusSince: min(7), role: 'DB 마이그레이션', activity: act('edit', 'edit', 'orders.sql'), activityAt: min(7) }),
  harin: sess('h8harin', '하린', { role: '성능 점검', activity: act('shell', 'shell', '부하 테스트 실행'), procs: { n: 6, cpu: 61, mem: 1.3e9, hooks: 1, browsers: 0 } }),
  siwoo: sess('i4siwoo', '시우', { isLeader: true, state: 'waiting', statusSince: min(12), role: '리더 · 푸시 알림', activity: act('read', 'read', 'push.ts'), activityAt: min(12) }),
  chaewon: sess('j6chaewon', '채원', { state: 'resting', statusSince: min(70), role: '스토어 설명 번역', activity: act('write', 'edit', 'store-ko.md'), activityAt: min(70), running: false }),
};
const msg = (a, b, summary, ago) => ({ from: a.name, to: b.name, summary, at: min(ago), fromNick: a.nickKo, fromNickKo: a.nickKo, toNick: b.nickKo, toNickKo: b.nickKo });
const tasks = {
  shop: [
    { title: '결제 화면 새 디자인 적용', session: S.minjun.name, status: 'running', startedAt: new Date(min(40)).toISOString() },
    { title: '결제 모듈 테스트', session: S.seoyeon.name, status: 'running', startedAt: new Date(min(12)).toISOString() },
    { title: '스테이징 배포', session: S.haeun.name, status: 'queued', order: 1 },
    { title: '영수증 메일 문구 정리', status: 'queued', order: 2 },
    { title: '다크 모드 색 점검', session: S.jiho.name, status: 'done', doneAt: new Date(min(9)).toISOString() },
    { title: '장바구니 쿠폰 계산 수정', session: S.seoyeon.name, status: 'done', doneAt: new Date(min(26)).toISOString() },
  ],
};
const D = {
  asking: false, asked: false, newAgent: false, filter: '',
  decisions: [{ title: '쿠폰 중복 적용을 허용할까요?', status: 'open', order: 1 }],
  extraMsgs: [],
};
function projects() {
  const shop = [S.minjun, S.seoyeon, S.jiho, S.haeun, S.doyun];
  if (D.newAgent) shop.push(S.new);
  const api = [S.sua, S.yejun, S.harin];
  const app = [S.siwoo, S.chaewon];
  const count = (list) => ({ working: list.filter((s) => s.state === 'working').length, waiting: list.filter((s) => s.state === 'waiting').length, resting: list.filter((s) => s.state === 'resting').length });
  return [
    { key: 'shop-web', root: 'C:/work/shop-web', name: '', label: '쇼핑몰', leader: S.minjun.name, sessions: shop, counts: count(shop), guests: [], check: 'npm test',
      messages: [
        ...D.extraMsgs,
        msg(S.seoyeon, S.minjun, '결제 테스트 42개 통과, 쿠폰 계산 1개 실패', 1),
        msg(S.minjun, S.seoyeon, '쿠폰 계산 고쳤어요, 다시 돌려 주세요', 2),
        msg(S.minjun, S.haeun, '테스트 통과하면 스테이징에 올려 주세요', 5),
        msg(S.jiho, S.minjun, '버튼 색 대비 확인 끝 — 4.8:1', 9),
        msg(S.minjun, S.doyun, 'CHANGELOG 에 결제 개편 항목 추가 부탁해요', 31),
      ],
      board: { updatedAt: new Date(min(1)).toISOString(), auto: true, roles: {}, decisions: D.decisions, tasks: tasks.shop } },
    { key: 'api-server', root: 'C:/work/api-server', name: '', label: '주문 API', leader: S.sua.name, sessions: api, counts: count(api), guests: [], board: null,
      messages: [msg(S.sua, S.yejun, '인덱스 추가하고 알려 주세요', 3), msg(S.harin, S.sua, 'p95 182ms, 느린 쿼리 3개', 6)] },
    { key: 'mobile-app', root: 'C:/work/mobile-app', name: '', label: '앱', leader: S.siwoo.name, sessions: app, counts: count(app), guests: [], board: null, messages: [] },
  ];
}
const usage = () => ({ source: 'live', at: Date.now(), limits: [
  { kind: 'session', model: null, percent: D.usage || 38, resetsAt: new Date(T0 + 2.6 * 3600e3).toISOString(), severity: '', active: true },
  { kind: 'weekly_all', model: null, percent: 27, resetsAt: new Date(T0 + 4 * 86400e3).toISOString(), severity: '', active: false },
] });
function state() {
  const now = Date.now();
  const ask = (s, o) => ({ id: 'ask-' + s.id, project: 'shop-web', session: s.name, short: s.short, nick: s.nickKo, nickKo: s.nickKo, assistant: false, isLeader: s.isLeader, about: s.role, managed: true, options: [], questions: null, plan: '', at: now - 1500, expiresAt: now + 600000, ...o });
  const approvals = [];
  if (D.asking) approvals.push(ask(S.haeun, { tool: 'Bash', what: '스테이징 배포 스크립트 실행', code: './scripts/deploy.sh --env staging', options: ['Bash(./scripts/deploy.sh:*)'] }));
  if (D.asked) approvals.push(ask(S.jiho, { tool: 'AskUserQuestion', what: '', code: '', questions: [{ question: '버튼 모서리를 어떻게 할까요?', header: '디자인', multiSelect: false, options: [{ label: '8px 둥글게', description: '지금 카드와 같은 반경' }, { label: '완전히 둥글게', description: '알약 모양' }, { label: '각지게', description: '반경 0' }] }] }));
  if (D.termAsk) approvals.push(ask(S.minjun, { tool: 'Terminal', what: '새 터미널 탭 1개 — 개발 서버와 워커를 띄워 확인', code: '[shop-web]\n  C:/work/shop-web/api  > npm run dev\n  C:/work/shop-web/web  > npm run dev\n  C:/work/shop-web/worker  > npm run worker' }));
  return {
    now, version: '0.2.27', token: 'demo', inEditor: [], recent: [], approvals, usage: usage(), projects: projects(),
    compact: { window: D.compact || 300000, vscode: false }, hooks: { events: {}, permission: { shown: 0, skippedNoViewer: 0, tools: {} }, notifications: {}, lastAt: now, viewerSeenAgo: 0, openPages: 1 },
  };
}

/* ── conversations ── */
const at = (ago) => Date.now() - ago * 1000;
let seq = 0;
const ev = {
  user: (text, ago = 0) => ({ kind: 'user', text, at: at(ago) }),
  text: (text, ago = 0, msgId = 'm' + ++seq) => ({ kind: 'block', type: 'text', msg: msgId, index: 0, text, done: true, at: at(ago) }),
  tool: (id, name, action, input, ago = 0) => ({ kind: 'tool', id, name, action, input: JSON.stringify(input), at: at(ago) }),
  result: (id, text, ago = 0, error = false) => ({ kind: 'result', id, text, error, at: at(ago) }),
  turn: (ms, ago = 0) => ({ kind: 'turn', ok: true, ms, at: at(ago) }),
  state: (state) => ({ kind: 'state', state }),
};
const LOGS = {
  b3seoyeon: () => [
    ev.user('결제 모듈 테스트 돌리고 실패하는 거 있으면 고쳐 줘', 420),
    ev.text('결제 모듈 테스트부터 돌려 볼게요.', 410),
    ev.tool('t1', 'Bash', act('shell', 'shell', '결제 모듈 테스트 실행'), { command: 'npm test -- payments', description: '결제 모듈 테스트 실행' }, 405),
    ev.result('t1', ' PASS  payments/card.test.ts (41)\n FAIL  payments/coupon.test.ts\n   ✕ 쿠폰 두 장을 겹쳐 쓰면 할인액이 두 번 빠진다 (12 ms)\n\nTests: 1 failed, 42 passed, 43 total', 380),
    ev.text('**42개 통과, 1개 실패**입니다. 쿠폰 두 장을 겹쳐 쓸 때 할인이 두 번 들어가요. `applyCoupons` 를 볼게요.', 370),
    ev.tool('t2', 'Read', act('read', 'read', 'coupon.ts'), { file_path: 'C:/work/shop-web/src/payments/coupon.ts' }, 360),
    ev.result('t2', 'export function applyCoupons(total, coupons) { … }', 358),
    ev.tool('t3', 'Edit', act('edit', 'edit', 'coupon.ts'), { file_path: 'C:/work/shop-web/src/payments/coupon.ts', old_string: '  for (const c of coupons) total -= c.amount', new_string: '  const best = Math.max(0, ...coupons.map((c) => c.amount))\n  total -= best' }, 300),
    ev.result('t3', 'The file was updated.', 298),
    ev.turn(118000, 290),
  ],
};
const agentStreams = new Map();   // agent id → set of open responses
function emit(id, e) { for (const r of agentStreams.get(id) || []) r.write('event: e\ndata: ' + JSON.stringify(out(e)) + '\n\n'); }
// the agent's reply, typed out piece by piece as Claude Code streams it
async function stream(id, text, { msgId = 'm' + ++seq, step = 3, ms = 28 } = {}) {
  text = tr(text);   // whole, before it is cut into pieces
  for (let i = step; i < text.length + step; i += step) {
    emit(id, { kind: 'block', type: 'text', msg: msgId, index: 0, text: text.slice(0, i), done: false, at: Date.now() });
    await new Promise((r) => setTimeout(r, ms));
  }
  emit(id, { kind: 'block', type: 'text', msg: msgId, index: 0, text, done: true, at: Date.now() });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAYS = {
  // 서연 runs the tests again after the fix, and tells the leader
  async seoyeon() {
    const id = 'b3seoyeon';
    emit(id, ev.state('working'));
    await stream(id, '고친 걸로 다시 돌려 볼게요.');
    await sleep(500);
    emit(id, ev.tool('t4', 'Bash', act('shell', 'shell', '결제 모듈 테스트 다시 실행'), { command: 'npm test -- payments', description: '결제 모듈 테스트 다시 실행' }));
    await sleep(2600);
    emit(id, ev.result('t4', ' PASS  payments/card.test.ts (41)\n PASS  payments/coupon.test.ts (2)\n\nTests: 43 passed, 43 total'));
    await sleep(400);
    emit(id, ev.tool('t5', 'SendMessage', act('message', 'talk', '민준'), { to: '민준', message: '결제 테스트 43개 모두 통과했어요' }));
    D.extraMsgs.unshift(msg(S.seoyeon, S.minjun, '결제 테스트 43개 모두 통과했어요', 0));
    changed();
    await sleep(900);
    emit(id, ev.result('t5', 'Sent.'));
    await stream(id, '**43개 모두 통과**했어요. 쿠폰은 이제 가장 큰 할인 한 장만 적용됩니다. 민준에게도 알렸어요.');
    emit(id, ev.turn(9400));
    emit(id, ev.state('idle'));
    S.seoyeon.state = 'waiting'; S.seoyeon.statusSince = Date.now(); changed();
  },
  // the assistant answers about the team
  async assistant(text) {
    emit('assistant', ev.user(text));
    emit('assistant', ev.state('working'));
    await sleep(900);
    emit('assistant', ev.tool('a1', 'mcp__assistant__agents', act('team', 'other'), {}));
    await sleep(1100);
    emit('assistant', ev.result('a1', '10 agents in 3 projects'));
    await stream('assistant', '지금 **10명** 중 6명이 일하고 있어요.\n\n- **쇼핑몰**: 서연이 결제 테스트를 모두 통과시켰고, 하은이 스테이징 배포 허락을 기다려요.\n- **주문 API**: 예준이 DB 마이그레이션 검토를 기다리는 중이에요.\n- **앱**: 시우가 푸시 알림 문구 확인을 기다려요.\n\n먼저 **하은의 배포 요청**에 답해 주시면 쇼핑몰 작업이 이어집니다.', { step: 4, ms: 22 });
    emit('assistant', ev.turn(6100));
    emit('assistant', ev.state('idle'));
  },
};

/* ── the processes the agents run ── */
function processes() {
  const now = Date.now();
  const list = [S.harin, S.seoyeon, S.haeun, S.minjun, S.sua];
  const pr = (name, kind, depth, cpu, mem, ago, cmd) => ({ pid: 1000 + Math.floor(Math.random() * 9000), name, kind, depth, cpu, mem, start: now - ago * 60000, cmd });
  const PROCS = {
    h8harin: [pr('node.exe', 'shell', 1, 44, 420e6, 6, 'k6 run load/orders.js'), pr('node.exe', '', 2, 12, 310e6, 6, 'node dist/server.js'), pr('node.exe', 'mcp', 1, 0.2, 60e6, 90, 'mcp server')],
    b3seoyeon: [pr('node.exe', 'shell', 1, 28, 380e6, 1, 'vitest run payments'), pr('esbuild.exe', '', 2, 6, 40e6, 1, 'esbuild --service')],
    d9haeun: [pr('node.exe', 'shell', 1, 17, 290e6, 3, 'vite build --mode staging')],
    a1minjun: [pr('node.exe', 'shell', 1, 2.5, 210e6, 22, 'nuxt dev'), pr('chrome.exe', '', 1, 1.1, 180e6, 15, 'chrome --headless')],
    f2sua: [pr('node.exe', 'mcp', 1, 0.3, 70e6, 80, 'mcp server')],
  };
  const sessions = list.map((s) => {
    const procs = PROCS[s.id] || [];
    const self = { pid: 900, name: 'claude.exe', cpu: 1.2, mem: 240e6, start: s.startedAt, cmd: 'claude' };
    return { name: s.name, nick: s.nickKo, nickKo: s.nickKo, project: s.id === 'h8harin' || s.id === 'f2sua' ? 'api-server' : 'shop-web', isLeader: s.isLeader, managed: true, state: s.state, self,
      total: { n: procs.length + 1, cpu: self.cpu + procs.reduce((a, p) => a + p.cpu, 0), mem: self.mem + procs.reduce((a, p) => a + p.mem, 0), hooks: 0 }, procs };
  });
  const history = [];
  for (let i = 180; i >= 0; i--) {
    const t = now - i * 5000, w = (k, base, amp) => Math.max(0, base + amp * Math.sin(i / 9 + k) + amp * 0.5 * Math.sin(i / 3.3 + k * 2));
    const by = {};
    sessions.forEach((s, k) => { by[s.name] = [w(k, s.total.cpu * 0.8, s.total.cpu * 0.25), s.total.mem]; });
    history.push({ at: t, cpu: 18 + Object.values(by).reduce((a, x) => a + x[0], 0) / 8, mem: 14e9, by });
  }
  return { at: now, cores: 16, memTotal: 32e9, history, sessions };
}

/* ── the server ── */
const body = (q) => new Promise((r) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer(async (q, r) => {
  const url = new URL(q.url, 'http://x'), u = url.pathname;
  const json = (o) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(out(o))); };
  const sse = () => { r.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); r.write('retry: 2000\n\n'); };
  if (u === '/') { r.writeHead(200, { 'content-type': MIME['.html'] }); return r.end(html(path.join(ROOT, 'public', 'index.html'), 'index.html')); }
  if (u === '/yt-en.js') { r.writeHead(200, { 'content-type': MIME['.js'] }); return r.end(fs.readFileSync(path.join(__dirname, 'yt-en.js'))); }
  if (u === '/youtube.html') { r.writeHead(200, { 'content-type': MIME['.html'] }); return r.end(fs.readFileSync(path.join(__dirname, 'youtube.html'))); }
  if (u.startsWith('/desktop/')) {
    const f = path.join(ROOT, 'desktop', path.normalize(u.slice(9)).replace(/^(\.\.[\\/])+/, ''));
    if (!f.startsWith(path.join(ROOT, 'desktop')) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    return r.end(STUB[path.basename(f)] ? html(f, path.basename(f)) : fs.readFileSync(f));
  }
  if (u === '/api/state') return json(state());
  if (u === '/api/events') { sse(); streams.add(r); q.on('close', () => streams.delete(r)); return; }
  if (u === '/api/agent-stream') {
    const id = url.searchParams.get('id');
    sse();
    if (!agentStreams.has(id)) agentStreams.set(id, new Set());
    agentStreams.get(id).add(r);
    q.on('close', () => agentStreams.get(id).delete(r));
    const a = Object.values(S).find((s) => s.agentId === id);
    r.write('event: init\ndata: ' + JSON.stringify(out({ events: (LOGS[id] || (() => []))(), state: id === 'assistant' ? 'idle' : a?.state === 'working' ? 'working' : 'idle', ui: null })) + '\n\n');
    return;
  }
  if (u === '/api/live') { sse(); r.write('event: init\ndata: []\n\n'); return; }
  if (u === '/api/processes') return json(processes());
  if (u === '/api/browsers') return json({ sessions: [], shared: null, canShare: true });
  if (u === '/api/assistant') return json({ assistant: { state: 'idle', running: true, mode: 'default', model: 'opus', effort: '', compact: '', sessionId: 'assistant-demo', avatar: null, limitHit: null, options: { approve: 'ask', asks: true, waiting: true, finished: true, failed: true, stuck: true, login: true, usage: true } } });
  if (u === '/api/agents/commands') return json({ commands: [{ name: 'compact', description: '대화를 요약해 줄이기' }, { name: 'model', description: '모델 바꾸기' }, { name: 'review', description: '변경 사항 검토' }] });
  if (u === '/api/decide') { const b = await body(q); if (String(b.id).includes('d9haeun')) { D.asking = false; S.haeun.state = 'working'; } if (String(b.id).includes('c7jiho')) D.asked = false; if (String(b.id).includes('a1minjun')) D.termAsk = false; changed(); return json({ ok: true }); }
  if (u === '/api/agents/send') {
    const b = await body(q);
    if (b.id === 'assistant') PLAYS.assistant(String(b.text || ''));
    else { emit(b.id, ev.user(String(b.text || ''))); if (b.id === 'b3seoyeon') setTimeout(() => PLAYS.seoyeon(), 600); }
    return json({ ok: true, delivered: 'now' });
  }
  if (u.startsWith('/api/')) { await body(q); return json({ ok: true }); }
  // the stage's cues
  if (u === '/demo/set') { const b = await body(q); for (const [k, v] of Object.entries(b)) D[k] = v; if (b.newAgent) S.new = sess('k1junseo', '준서', { role: '영수증 메일', activity: act('read', 'read', 'mail/receipt.html'), state: 'working', context: 12000, statusSince: Date.now(), startedAt: Date.now() }); changed(); return json({ ok: true }); }
  if (u === '/demo/agent') { const b = await body(q); Object.assign(S[b.who], b.set); changed(); return json({ ok: true }); }
  r.writeHead(404); r.end();
}).listen(PORT, '127.0.0.1', () => console.log('demo on', PORT));
module.exports = { PORT };
