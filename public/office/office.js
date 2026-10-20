/* The office: a project's agents drawn as clay robots at work in a room (three.js, loaded only when it is opened).
   Each agent has a desk; what it is doing takes it about the room: reading and searching to the library, the web to
   the shared browser on the wall, a message to the leader's desk, a request to its desk, hand up, turned to you;
   waiting dozes at the desk, then the pantry, then the lounge sofa; a finished session sleeps at its desk.
   The page hands in the project on every poll (update); everything here is drawn from that, nothing is stored. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CSS = `
.office{display:grid;grid-template-columns:minmax(0,1fr) 300px;height:clamp(480px,calc(100vh - 214px),1400px);border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface-2)}
.office .ostage{position:relative;overflow:hidden;min-width:0}
@media (max-width:900px){.office{grid-template-columns:minmax(0,1fr)}.office .oside{display:none}}
.office .oside{border-left:1px solid var(--line);background:var(--surface);padding:14px;display:flex;flex-direction:column;gap:14px;overflow:auto;min-height:0}
.office .oside h4{margin:0 0 8px;font-size:11.5px;color:var(--faint);letter-spacing:.06em;font-weight:700}
.office .ocard{border:1px solid var(--line);border-radius:12px;padding:12px;background:linear-gradient(180deg,var(--surface),var(--surface-2))}
.office .ocard.asking{border:2px solid var(--wait);box-shadow:0 0 0 4px var(--wait-soft, rgba(140,106,16,.12))}
.office .ocard .who{display:flex;gap:10px;align-items:center;min-width:0;cursor:pointer}
.office .ocard .who>div:last-child{min-width:0}
.office .ocard .av{width:58px;height:58px;flex:none}.office .ocard .av svg{width:58px;height:58px}
.office .ocard .nm{font:800 16px var(--mono, ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.office .ocard .role{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.office .ocard .badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;border-radius:999px;padding:1px 9px;margin-top:4px}
.office .b-run{background:var(--run-soft);color:var(--run)}.office .b-wait{background:var(--wait-soft);color:var(--wait)}.office .b-rest{background:var(--done-soft);color:var(--done)}.office .b-ask{background:var(--wait);color:var(--surface)}
.office .ocard dl{display:grid;grid-template-columns:72px minmax(0,1fr);gap:6px 10px;margin:12px 0 0;font-size:12px}
.office .ocard dt{color:var(--faint)}.office .ocard dd{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.office .ocard dd.m{font-family:var(--mono, ui-monospace,monospace);font-size:11.5px}
.office .ocard .meter{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:5px}.office .ocard .meter b{display:block;height:100%;background:var(--accent);border-radius:3px}
.office .ocard .acts{display:flex;gap:6px;margin-top:12px}
.office .ocard .acts button,.office .askb .b button{flex:1;appearance:none;border:1px solid var(--line-strong);background:var(--surface);color:var(--text);border-radius:8px;padding:6px 0;font:700 12px var(--sans, inherit);cursor:pointer}
.office .ocard .acts .yes,.office .askb .b .yes{background:var(--accent);border-color:var(--accent);color:#fff}
.office .ocard .acts button:disabled,.office .askb .b button:disabled{opacity:.5;cursor:default}
.office .ofeedbox{flex:1;min-height:0;display:flex;flex-direction:column}
.office .ofeed{display:flex;flex-direction:column;gap:4px;font-size:12px;min-height:0;overflow:hidden}
.office .ofeed div{flex:none;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.office .ofeed div b{color:var(--text)}
.office .ofeed time{font:11px var(--mono, ui-monospace,monospace);color:var(--faint);margin-right:6px}
.office .ofeed .none{color:var(--faint)}
.office .ofeed .in{animation:ofeedin .3s ease-out}
@keyframes ofeedin{from{opacity:0;transform:translateY(-4px)}}
.office .ohud .oname{font:700 12px var(--mono, ui-monospace,monospace);color:var(--muted);padding:0 10px;line-height:22px;white-space:nowrap}
.office .ohud .oname small{font-family:var(--sans, inherit);font-weight:500;color:var(--faint);margin-left:6px}
.office .ohudwrap{position:absolute;top:10px;left:10px;right:10px;z-index:3;display:flex;gap:8px;align-items:center;pointer-events:none}
.office .ohudwrap>*{pointer-events:auto}
.office .oslot{margin-left:auto}
.office canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.office canvas.drag{cursor:grabbing} .office canvas.hot{cursor:pointer}
.office .oov{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.office .oov>*{position:absolute;left:0;top:0;pointer-events:auto;will-change:transform;transition:opacity .2s}
.office .oov>.hide{display:none}
.office .ohud{display:flex;gap:2px;padding:2px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 86%,transparent);backdrop-filter:blur(8px);font:700 12px var(--mono, ui-monospace,monospace);color:var(--muted)}
.office .ohud button{border:none;background:none;color:inherit;width:24px;height:22px;border-radius:999px;font-weight:900;cursor:pointer}
.office .ohud button:hover{background:var(--accent-soft, rgba(58,99,216,.12))}
.office .ohud span{min-width:46px;text-align:center;line-height:22px;cursor:pointer}
.office .ohud .oback{width:auto;padding:0 10px;font:700 12px var(--sans, inherit);white-space:nowrap}
.office .ohud .oback[hidden]{display:none}
.office .ohud .oback:not([hidden])+.oname{border-left:1px solid var(--line)}
.office .ohint{position:absolute;right:10px;bottom:8px;z-index:3;font-size:11px;color:var(--faint);pointer-events:none}
.office .onogl{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:13px;padding:20px;text-align:center}
.office .plate{display:flex;align-items:center;gap:5px;background:color-mix(in srgb,var(--surface) 84%,transparent);backdrop-filter:blur(8px);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);border-radius:999px;padding:1px 9px;font:700 10.5px var(--mono, ui-monospace,monospace);white-space:nowrap;box-shadow:0 4px 14px rgba(59,51,96,.12);cursor:pointer;color:var(--text)}
.office .plate i{width:7px;height:7px;border-radius:50%}
.office .plate.empty{font-family:inherit;font-weight:600;color:var(--faint);border-style:dashed;cursor:default}
.office .plate.new{color:var(--accent);border:1.5px dashed var(--accent);background:var(--accent-soft, rgba(58,99,216,.1))}
.office .plate .away{font-weight:500;color:var(--faint)}
.office .act{background:color-mix(in srgb,var(--surface) 90%,transparent);backdrop-filter:blur(8px);border:1px solid color-mix(in srgb,var(--line) 70%,transparent);border-radius:12px;padding:3px 9px;font-size:11px;white-space:nowrap;box-shadow:0 4px 14px rgba(59,51,96,.13);max-width:260px;overflow:hidden;text-overflow:ellipsis;cursor:pointer;color:var(--text)}
.office .act b{font-weight:800;margin-right:5px}
.office .act.dim{color:var(--faint)}
.office .askb{z-index:10;background:var(--surface);color:var(--text);border:2px solid var(--wait);border-radius:12px;padding:7px 10px 8px;width:250px;box-shadow:0 0 0 5px var(--wait-soft, rgba(140,106,16,.12)),0 10px 26px var(--shadow, rgba(0,0,0,.1));cursor:pointer;animation:oaskpulse 1.6s ease-in-out infinite}
@keyframes oaskpulse{50%{box-shadow:0 0 0 9px var(--wait-soft, rgba(140,106,16,.12)),0 10px 26px var(--shadow, rgba(0,0,0,.1))}}
.office .askb::after{content:"";position:absolute;left:var(--ax,20%);bottom:-7px;width:11px;height:11px;background:var(--surface);border-right:2px solid var(--wait);border-bottom:2px solid var(--wait);transform:translateX(-50%) rotate(45deg)}
.office .askb .h{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;color:var(--wait)}
.office .askb .h .tag{font-size:10px;color:var(--surface);background:var(--wait);border-radius:4px;padding:0 6px}
.office .askb code{display:block;margin-top:5px;font:11.5px var(--mono, ui-monospace,monospace);background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:3px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.office .askb .go{margin-top:5px;font-size:11px;color:var(--muted)}
.office .askb .b{display:flex;gap:6px;margin-top:7px}
.office .askb .b button{padding:4px 0}
.office .zone{pointer-events:none!important;font:800 11px inherit;font-weight:800;font-size:11px;letter-spacing:.08em;color:color-mix(in srgb,var(--muted) 80%,transparent);white-space:nowrap}
.office .wallbtn{font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid var(--line);background:color-mix(in srgb,var(--surface) 88%,transparent);color:var(--text);backdrop-filter:blur(6px);box-shadow:0 2px 8px rgba(59,51,96,.1);white-space:nowrap;cursor:pointer}
.office .wallbtn:hover{border-color:var(--accent);color:var(--accent)}
@media (prefers-reduced-motion:reduce){.office *{animation:none!important}}
`;

const PALETTE = [['#8fb4ff', '#5b83dc'], ['#86dcb0', '#48a878'], ['#c7a8ff', '#9573dc'], ['#ffb37a', '#dc8243'], ['#ff9fb8', '#dc6d8c'], ['#79d6e3', '#43a6b5'], ['#ffd166', '#d9a32a'], ['#b5c46a', '#869636']];
const TH = {
  light: { bg1: '#f6f4fb', bg2: '#d9d5e8', floor: '#ead8c0', slab: '#d8c6ae', wallL: '#ede9f6', wallR: '#e3def1', cap: '#fbfaff', base: '#d8d2e6', frame: '#fbfaf8',
    desk: '#fbf8f3', deskLeg: '#ddd5c8', shelf: '#e6d6c0', sofa: '#a9b8ee', cushion: '#c6d0f6', counter: '#f3efe8', machine: '#e8e5ee', pot: '#e3a07c', leaf: '#7fcf96', leafD: '#57b277',
    rugMeet: '#dde5fb', rugLounge: '#f8e2d0', rugLead: '#f6eed5', rugLib: '#e2eedc', rugPantry: '#f3e8d6', rugMid: '#ebe5f6', chair: '#dcd8e2', metal: '#3d4352', glass: '#dfe8ff', },
  dark: { bg1: '#1d2230', bg2: '#0c0e14', floor: '#3b3f4c', slab: '#262a35', wallL: '#2e3344', wallR: '#282d3c', cap: '#3a4052', base: '#20242f', frame: '#41485a',
    desk: '#555b6b', deskLeg: '#424756', shelf: '#4c443a', sofa: '#4d5c95', cushion: '#62719f', counter: '#525867', machine: '#454a59', pot: '#a86a4c', leaf: '#4f9e69', leafD: '#3c8455',
    rugMeet: '#2f3a5c', rugLounge: '#45382f', rugLead: '#433d2c', rugLib: '#2f3d33', rugPantry: '#3e362b', rugMid: '#342f45', chair: '#4a4f5d', metal: '#2a2e38', glass: '#8fa6e6', },
};
// the office follows the local time, not the page's theme: dawn, morning, noon, afternoon, the sunset, evening, night
// h: the hour; n: how far the room's colours are towards night; sky: top, horizon; sun: strength, colour, path (−1 morning … 1 evening)
const DAY = [
  { h: 0, n: 1, sky: ['#0a1130', '#24305a'], stars: 1, sun: [0.6, '#9fb2ff'], hemi: [0.36, '#8a99d0', '#1a1d26'], env: 0.26, beam: [0.06, '#b9c6ff'], bg: ['#1a1f2d', '#0a0c12'], lights: 1 },
  { h: 4.6, n: 1, sky: ['#0d1534', '#2c3762'], stars: 1, sun: [0.6, '#9fb2ff'], hemi: [0.36, '#8a99d0', '#1a1d26'], env: 0.26, beam: [0.06, '#b9c6ff'], bg: ['#1a1f2d', '#0a0c12'], lights: 1 },
  { h: 5.8, n: 0.6, sky: ['#2e3a6e', '#f0a79c'], stars: 0.3, sun: [1.05, '#ffc2a6'], hemi: [0.62, '#c8b9e2', '#3a3040'], env: 0.36, beam: [0.14, '#ffc9ae'], bg: ['#3b3652', '#191726'], lights: 0.5 },
  { h: 7.2, n: 0.08, sky: ['#8cbef5', '#fde3c8'], stars: 0, sun: [2.0, '#ffeedd'], hemi: [0.95, '#fff6ee', '#dac9b6'], env: 0.5, beam: [0.3, '#fff0d6'], bg: ['#f4f1f8', '#d7d2e5'], lights: 0 },
  { h: 12, n: 0, sky: ['#79b4f7', '#e9f5ff'], stars: 0, sun: [2.4, '#ffffff'], hemi: [1.1, '#ffffff', '#d9c9b4'], env: 0.56, beam: [0.34, '#fff8ea'], bg: ['#f6f4fb', '#d9d5e8'], lights: 0 },
  { h: 15.2, n: 0, sky: ['#8fc0f4', '#f4efe2'], stars: 0, sun: [2.3, '#fff0d4'], hemi: [1.02, '#fffaf2', '#d9c9b4'], env: 0.54, beam: [0.33, '#ffefcf'], bg: ['#f6f3f6', '#dad3e2'], lights: 0 },
  { h: 17.4, n: 0.14, sky: ['#7d9ee0', '#ffd197'], stars: 0, sun: [2.05, '#ffcf8c'], hemi: [0.86, '#ffe6c8', '#d6bea6'], env: 0.48, beam: [0.42, '#ffc784'], bg: ['#f6ebe2', '#dbc8c2'], lights: 0 },
  { h: 18.7, n: 0.45, sky: ['#4a4c92', '#ff8758'], stars: 0.1, sun: [1.45, '#ff985a'], hemi: [0.64, '#eab6a6', '#3e3036'], env: 0.4, beam: [0.32, '#ff9c66'], bg: ['#4c3b50', '#1f1a26'], lights: 0.4 },
  { h: 20, n: 0.86, sky: ['#18214c', '#594a80'], stars: 0.7, sun: [0.72, '#a9b4ff'], hemi: [0.42, '#98a6d8', '#1c1f28'], env: 0.3, beam: [0.08, '#b9c6ff'], bg: ['#1d2230', '#0c0e14'], lights: 1 },
  { h: 24, n: 1, sky: ['#0a1130', '#24305a'], stars: 1, sun: [0.6, '#9fb2ff'], hemi: [0.36, '#8a99d0', '#1a1d26'], env: 0.26, beam: [0.06, '#b9c6ff'], bg: ['#1a1f2d', '#0a0c12'], lights: 1 },
];
const FONT = '"Noto Sans KR",system-ui,"Segoe UI",sans-serif';
const GX = 18, WALL_H = 2.8, DESK_H = 0.62, SEAT_H = 0.38, PER_ROW = 5, SPEED = 2.3;
const COLS = [3.4, 5.8, 8.2, 10.6, 13.0, 15.2];
const LEAD = { seat: [16.45, 2.3], top: { x: 16.8, y: 1.55, w: 1.05, d: 1.5 }, mon: [17.3, 2.3] };
const LIB = [[1.15, 1.15], [1.15, 2.55], [1.15, 3.95], [1.15, 5.35]], WEB = [[7.5, 0.62], [8.7, 0.62], [9.9, 0.62]];
const TO_VIEWER = [1, 1];
const ICON = { shell: '⌨', read: '📖', edit: '✎', search: '🔍', talk: '💬', agent: '🤖', web: '🌐', publish: '📋', skill: '🧩', other: '•' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const angOf = ([dx, dy]) => Math.atan2(dx, dy);
const lerp = (a, b, k) => a + (b - a) * k;
const near = (a, b) => Math.abs(a - b) < 0.06;

export function createOffice(api) {
  if (!document.getElementById('office-css')) { const st = document.createElement('style'); st.id = 'office-css'; st.textContent = CSS; document.head.append(st); }
  const t = api.t;
  const el = document.createElement('div');
  el.className = 'office';
  el.innerHTML = '<div class="ostage"><canvas></canvas><div class="oov"></div><div class="ohudwrap"><div class="ohud"><button type="button" class="oback" hidden></button><span class="oname"></span></div><div class="ohud"><button type="button" data-z="out">−</button><span class="ozv"></span><button type="button" data-z="in">+</button></div><div class="oslot"></div></div><div class="ohint"></div></div>'
    + '<aside class="oside"><div class="osel"></div><div class="ofeedbox"><h4></h4><div class="ofeed"></div></div></aside>';
  const stage = el.querySelector('.ostage'), canvas = el.querySelector('canvas'), ov = el.querySelector('.oov'), slot = el.querySelector('.oslot');
  const side = el.querySelector('.oside'), selBox = el.querySelector('.osel'), feedBox = el.querySelector('.ofeed');
  side.querySelector('h4').textContent = t('officeFeed');
  feedBox.innerHTML = `<div class="none">${esc(t('officeFeedNone'))}</div>`;
  el.querySelector('.ohint').textContent = t('officeHint');
  // out of a project's office, back to the building
  const back = el.querySelector('.oback');
  back.textContent = '← ' + t('officeBack'); back.title = t('officeBackTip');
  back.addEventListener('click', () => api.leave?.());
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { el.replaceChildren(Object.assign(document.createElement('div'), { className: 'onogl', textContent: t('officeNoGL') })); return { el, slot: document.createElement('div'), update() {}, wake() {} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  // the hour (?officeHour=18.7 shows another one), and the light it gives: each value eased between the two marks around it
  const hourNow = () => { const q = +new URLSearchParams(location.search).get('officeHour'); if (q >= 0 && q < 24 && location.search.includes('officeHour')) return q; const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  const ca = new THREE.Color(), cb = new THREE.Color();
  const mixC = (x, y, f) => '#' + ca.set(x).lerp(cb.set(y), f).getHexString();
  function dayAt(h) {
    let i = 0; while (i < DAY.length - 2 && DAY[i + 1].h <= h) i++;
    const A = DAY[i], B = DAY[i + 1], f0 = Math.min(1, Math.max(0, (h - A.h) / (B.h - A.h))), f = f0 * f0 * (3 - 2 * f0);
    const mix = (x, y) => (typeof x === 'number' ? x + (y - x) * f : typeof x === 'string' ? mixC(x, y, f) : x.map((v, k) => mix(v, y[k])));
    const o = {}; for (const k of Object.keys(A)) o[k] = mix(A[k], B[k]);
    o.h = h; return o;
  }
  let day = dayAt(hourNow()), theme = day.n > 0.5 ? 'dark' : 'light';
  const C = (k) => (day.n <= 0 ? TH.light[k] : day.n >= 1 ? TH.dark[k] : mixC(TH.light[k], TH.dark[k], day.n));
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);
  const hemi = new THREE.HemisphereLight(); scene.add(hemi);
  const sun = new THREE.DirectionalLight(); sun.castShadow = true; scene.add(sun, sun.target);
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 5; sun.shadow.blurSamples = 16;

  /* ── materials and textures ── */
  const themed = [], matCache = new Map(), gcache = new Map();
  // clay: a soft rough surface with a faint coat, so the rounded edges catch the light
  function M(key, o = {}) {
    const id = key + JSON.stringify(o); if (matCache.has(id)) return matCache.get(id);
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.62, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.5, ...o });
    if (TH.light[key]) { m.color.set(C(key)); themed.push([m, key]); } else m.color.set(key);
    matCache.set(id, m); return m;
  }
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = maxAniso; return tx; }
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const glowTex = tex(128, 128, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const beamTex = tex(64, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  function skyDraw(g, w, h) {
    const r = g.createLinearGradient(0, 0, 0, h);
    r.addColorStop(0, day.sky[0]); r.addColorStop(1, day.sky[1]); g.fillStyle = r; g.fillRect(0, 0, w, h);
    seed = 11;
    if (day.stars > 0.02) { g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) { g.globalAlpha = (0.3 + rnd() * 0.6) * day.stars; g.fillRect(rnd() * w, rnd() * h * 0.7, 1.5, 1.5); } g.globalAlpha = 1; }
    // the sun crosses from left to right between six and seven; the moon after dark
    const up = (day.h - 6) / 13, night = day.n > 0.7;
    if (night || (up > -0.05 && up < 1.05)) {
      const u = night ? 0.72 : Math.min(1, Math.max(0, up)), x = w * (0.1 + 0.8 * u), y = night ? h * 0.22 : h * (0.75 - Math.sin(Math.PI * u) * 0.6);
      const glow = g.createRadialGradient(x, y, 0, x, y, night ? 26 : 46);
      glow.addColorStop(0, night ? 'rgba(235,240,255,.55)' : 'rgba(255,250,235,.9)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = glow; g.fillRect(x - 50, y - 50, 100, 100);
      g.fillStyle = night ? '#eef1ff' : mixC('#fff7e0', '#ffb070', Math.max(0, Math.abs(u - 0.5) * 2 - 0.5) * 2); g.beginPath(); g.arc(x, y, night ? 9 : 12, 0, 7); g.fill();
      if (night) { g.fillStyle = day.sky[0]; g.beginPath(); g.arc(x + 4, y - 3, 8, 0, 7); g.fill(); }
    }
    seed = 23;
    if (day.n < 0.6) { g.fillStyle = `rgba(255,255,255,${0.85 * (1 - day.n / 0.6)})`; for (let i = 0; i < 5; i++) { const x = rnd() * w, y = h * 0.25 + rnd() * h * 0.4, s = 18 + rnd() * 22; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + k * s * 0.6, y - (k % 2) * s * 0.3, s * 0.55, 0, 7); g.fill(); } } }
    seed = 37;
    const city = mixC('#c9d9ee', '#1f2745', day.n);
    for (let i = 0; i < 9; i++) {
      const bw = 30 + rnd() * 50, bh = 40 + rnd() * 90, bx = i * w / 8 - 10;
      g.fillStyle = city; g.fillRect(bx, h - bh, bw, bh);
      if (day.lights > 0.02) for (let yy = h - bh + 6; yy < h - 6; yy += 9) for (let xx = bx + 4; xx < bx + bw - 6; xx += 8) if (rnd() < 0.42) { g.fillStyle = `rgba(255,214,140,${(0.45 + rnd() * 0.5) * day.lights})`; g.fillRect(xx, yy, 4, 5); }
    }
  }
  const skyTex = tex(512, 256, skyDraw);
  function bgDraw(g, w, h) { const r = g.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, w * 0.75); r.addColorStop(0, day.bg[0]); r.addColorStop(1, day.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); }
  const bgTex = tex(512, 512, bgDraw);
  scene.background = bgTex;

  function rbox(w, h, d, r = 0.04) { r = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)); const k = [w, h, d, r].map((v) => v.toFixed(3)).join(); if (!gcache.has(k)) gcache.set(k, new RoundedBoxGeometry(w, h, d, 4, r)); return gcache.get(k); }
  const cylG = (rt, rb, h, s = 28) => { const k = 'c' + [rt, rb, h, s].join(); if (!gcache.has(k)) gcache.set(k, new THREE.CylinderGeometry(rt, rb, h, s)); return gcache.get(k); };
  const sphG = (r) => { const k = 's' + r; if (!gcache.has(k)) gcache.set(k, new THREE.SphereGeometry(r, 28, 20)); return gcache.get(k); };
  function mesh(parent, geo, mat, x = 0, y = 0, z = 0, o = {}) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = o.cast ?? true; m.receiveShadow = o.recv ?? true; parent.add(m); return m; }
  // a box by its plan corner: plan x → x, plan y → z, height → y
  const pbox = (p, x, y, z, w, d, h, mat, r = 0.04, o) => mesh(p, rbox(w, h, d, r), mat, x + w / 2, z + h / 2, y + d / 2, o);
  const pcyl = (p, x, y, z, r, h, mat, o) => mesh(p, cylG(r, r, h), mat, x, z + h / 2, y, o);

  /* ── the plan: desk rows grow with the crew; everything south of them moves down ── */
  const L = { rows: 0, GY: 13, dy: 0, desks: [], ROWS: [] };
  const B = { w: GX, d: 13 };   // what is drawn: the room (GX × L.GY) or the building
  let MODE = 'room';            // 'room': one project's office; 'bldg': every project a room in one building
  const S = (y) => y + L.dy;   // a place south of the desks
  function layout(rows) {
    L.rows = rows; L.dy = 2.8 * (rows - 2); L.GY = 13 + L.dy; B.w = GX; B.d = L.GY;
    L.desks = []; for (let r = 0; r < rows; r++) for (let c = 0; c < PER_ROW; c++) L.desks.push([3.8 + c * 2.4, 2.2 + r * 2.8]);
    L.ROWS = [...Array.from({ length: rows }, (_, r) => 1.0 + r * 2.8), S(6.7)];
  }
  // each desk: the seat on its left, the top to its right, the screen beside the face (so it never hides it)
  const deskOf = (i) => { const [X, Y] = L.desks[i]; return { X, Y, seat: [X + 0.25, Y + 0.4], top: { x: X + 0.6, y: Y - 0.15, w: 0.9, d: 1.1 }, mon: [X + 1.02, Y + 0.4] }; };
  const PANTRY = () => [[1.55, S(8.75)], [1.55, S(9.85)]], SOFA = () => [[1.65, S(12.1)], [3.05, S(12.1)]], BEAN = () => [[7.6, S(9.3)], [9.0, S(9.9)], [8.1, S(10.9)]];
  // the assistant's desk in the room: by the way in, on the east side
  const recDesk = () => { const X = 16.2, Y = S(5.9); return { X, Y, seat: [X + 0.25, Y + 0.4], top: { x: X + 0.6, y: Y - 0.15, w: 0.9, d: 1.1 }, mon: [X + 1.02, Y + 0.4] }; };
  function spotOf(a, place) {
    if (MODE === 'bldg') return bspot(a, place);
    const k = place.split(':')[0], arg = place.slice(k.length + 1), i = +arg;
    if (k === 'reception') { const d = recDesk(); return { p: d.seat, via: [[d.X - 0.4, d.seat[1]], [d.X - 0.4, L.ROWS.at(-1)]], face: [1, 0], lift: SEAT_H, seat: true }; }
    if (k === 'secvisit') {
      // beside the one it came about: at the leader's corner, or by the desk
      const to = agents.get(arg);
      if (!to || to.leader) return { p: [16.75, 4.4], via: [[15.95, 4.4], [15.95, L.ROWS.at(-1)]], face: [0, -1], lift: 0 };
      const d = deskOf(to.desk); return { p: [d.seat[0] + 0.7, d.Y + 1.2], via: [[d.X - 0.4, d.Y + 1.2]], face: [0, -1], lift: 0 };
    }
    if (k === 'desk') { const d = deskOf(a.desk); return { p: d.seat, via: [[d.X - 0.4, d.seat[1]]], face: [1, 0], lift: SEAT_H, seat: true }; }
    if (k === 'lead') return { p: LEAD.seat, via: [[15.95, LEAD.seat[1]], [15.95, L.ROWS.at(-1)]], face: [1, 0], lift: SEAT_H, seat: true };
    if (k === 'lib') { const p = LIB[i]; return { p, via: [[COLS[0], p[1]]], face: [-1, 0], lift: 0 }; }
    if (k === 'web') { const p = WEB[i]; return { p, via: [[p[0], L.ROWS[0]]], face: [0, -1], lift: 0 }; }
    if (k === 'pantry') { const p = PANTRY()[i]; return { p, via: [[p[0], L.ROWS.at(-1)]], face: [-1, 0], lift: 0 }; }
    if (k === 'sofa') { const p = SOFA()[i]; return { p, via: [[p[0], S(11.15)], [5.0, S(11.15)], [5.0, L.ROWS.at(-1)]], face: [0, 1], lift: 0.44 }; }
    if (k === 'bean') { const p = BEAN()[i]; return { p: [p[0] + 0.05, p[1] + 0.05], via: [[p[0] + 0.05, L.ROWS.at(-1)]], face: TO_VIEWER, lift: 0.3 }; }
    if (k === 'visitlead') return { p: [16.45 + i * 0.55, 3.6], via: [[15.95, 3.6], [15.95, L.ROWS.at(-1)]], face: [0, -1], lift: 0 };
    if (k === 'visit') { const d = deskOf(i); return { p: [d.seat[0] + 0.05, d.Y + 1.2], via: [[d.X - 0.4, d.Y + 1.2]], face: [0, -1], lift: 0 }; }
    return { p: a.pos, via: [], face: TO_VIEWER, lift: 0 };
  }
  function lanePath(Sp, E) {
    const ROWS = L.ROWS, nodes = []; ROWS.forEach((r) => COLS.forEach((c) => nodes.push([c, r])));
    const si = nodes.push(Sp) - 1, ei = nodes.push(E) - 1, adj = nodes.map(() => []);
    const link = (i, j) => { const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]); adj[i].push([j, d]); adj[j].push([i, d]); };
    ROWS.forEach((r, ri) => COLS.forEach((c, ci) => { const i = ri * COLS.length + ci; if (ci + 1 < COLS.length) link(i, i + 1); if (ri + 1 < ROWS.length) link(i, i + COLS.length); }));
    const attach = (k) => {
      const [x, y] = nodes[k];
      const ri = ROWS.findIndex((r) => near(r, y)); if (ri >= 0) { let Lc = -1, R = -1; COLS.forEach((c, ci) => { if (c <= x + 0.001) Lc = ci; if (c >= x - 0.001 && R < 0) R = ci; }); [Lc, R].forEach((ci) => { if (ci >= 0) link(k, ri * COLS.length + ci); }); }
      const ci = COLS.findIndex((c) => near(c, x)); if (ci >= 0) { let Up = -1, Dn = -1; ROWS.forEach((r, rj) => { if (r <= y + 0.001) Up = rj; if (r >= y - 0.001 && Dn < 0) Dn = rj; }); [Up, Dn].forEach((rj) => { if (rj >= 0) link(k, rj * COLS.length + ci); }); }
    };
    attach(si); attach(ei);
    if ((near(Sp[1], E[1]) && ROWS.some((r) => near(r, Sp[1]))) || (near(Sp[0], E[0]) && COLS.some((c) => near(c, Sp[0])))) link(si, ei);
    const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set(); dist[si] = 0;
    for (;;) { let u = -1; dist.forEach((d, i) => { if (!done.has(i) && d < Infinity && (u < 0 || d < dist[u])) u = i; }); if (u < 0 || u === ei) break; done.add(u); for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; } }
    if (dist[ei] === Infinity) return [E];
    const out = []; for (let u = ei; u !== si; u = prev[u]) out.unshift(nodes[u]); return out;
  }

  /* ── the room, built again when the desk rows change ── */
  let world = null, deskScreens = [], ghostDesk = null, trash = [];
  const statics = [];   // labels pinned to the room: {el, at, anchor, prio}
  function staticChip(cls, at, anchor, prio, fn, text) {
    const e = document.createElement(fn ? 'button' : 'div'); if (fn) { e.type = 'button'; e.addEventListener('click', fn); }
    e.className = cls; if (text != null) e.textContent = text; ov.prepend(e);
    const s = { el: e, at, anchor, prio, html: '' }; statics.push(s); return s;
  }
  const plateOf = new Map();
  let chairsOf = [];   // {c: a chair, find: who sits in it}
  function clearWorld() {
    if (world) { scene.remove(world); world.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.cached) { if (![...gcache.values()].includes(o.geometry)) o.geometry.dispose(); } }); }
    for (let i = themed.length - 1; i >= 0; i--) if (trash.includes(themed[i][0])) themed.splice(i, 1);
    for (const x of trash) x.dispose(); trash = [];
    for (const s of statics) s.el.remove(); statics.length = 0; plateOf.clear();
    deskScreens = []; ghostDesk = null; chairsOf = [];
    const W = world = new THREE.Group(); scene.add(W);
    sunAt(); shadowFit();
    return W;
  }
  // floor: soft planks, neutral so the theme colour tints them
  function planks(GW, GY, keep) {
    const floorTex = keep(tex(2048, Math.min(4096, Math.round(2048 * GY / GW)), (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); seed = 7;
      const pw = h / GY * 0.36;
      for (let y = 0; y < h; y += pw) {
        let x = -rnd() * 300;
        while (x < w) { const len = 180 + rnd() * 260, v = 236 + Math.floor(rnd() * 19); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, len, pw);
          g.globalAlpha = 0.05; for (let k = 0; k < 5; k++) { g.fillStyle = '#000'; g.fillRect(x + rnd() * len * 0.2, y + rnd() * pw, len * (0.5 + rnd() * 0.5), 1); } g.globalAlpha = 1;
          g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y, 2, pw); x += len; }
        g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(0, y, w, 1.5); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, y + 1.5, w, 1);
      }
    }));
    const floorMat = keep(new THREE.MeshPhysicalMaterial({ map: floorTex, roughness: 0.7, clearcoat: 0.12, clearcoatRoughness: 0.6 })); floorMat.color.set(C('floor')); themed.push([floorMat, 'floor']);
    const slabG = keep(new THREE.BoxGeometry(GW, 0.32, GY));
    const slab = new THREE.Mesh(slabG, [M('slab'), M('slab'), floorMat, M('slab'), M('slab'), M('slab')]); slab.position.set(GW / 2, -0.16, GY / 2); slab.receiveShadow = true; world.add(slab);
  }
  function buildRoom() {
    const W = clearWorld();
    const GY = L.GY, keep = (x) => { trash.push(x); return x; };
    planks(GX, GY, keep);
    // rugs: a soft mat with a stitched edge
    const rug = (x, y, w, d, key) => {
      const tx = keep(tex(Math.round(w * 90), Math.round(d * 90), (g, cw, ch) => { g.fillStyle = '#ececec'; g.fillRect(0, 0, cw, ch); g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([2, 9]); g.lineCap = 'round'; rr(g, 16, 16, cw - 32, ch - 32, 14); g.stroke(); }));
      const m = keep(new THREE.MeshPhysicalMaterial({ map: tx, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8 })); m.color.set(C(key)); themed.push([m, key]);
      pbox(W, x, y, 0, w, d, 0.035, m, 0.017, { cast: false });
    };
    rug(12.95, S(8.95), 4.75, 3.75, 'rugMeet'); rug(0.4, S(10.9), 4.4, 1.95, 'rugLounge'); rug(15.95, 0.35, 1.8, 4.5, 'rugLead'); rug(0.3, 0.35, 2.3, 5.9, 'rugLib'); rug(0.3, S(7.7), 3.6, 2.9, 'rugPantry'); rug(6.4, S(8.0), 5.2, 3.6, 'rugMid');
    // walls with window holes: the back wall (y=0) and the side wall (x=0)
    const T = 0.22, wallR = M('wallR', { roughness: 0.85, clearcoat: 0 }), wallL = M('wallL', { roughness: 0.85, clearcoat: 0 });
    const WINS_Y = [[11.2, 12.4], [12.8, 14.0], [16.0, 16.9], [17.1, 17.85]], WIN_Y_Z = [0.85, 2.45];
    const WINS_X = [[S(10.9), S(12.6)]], WIN_X_Z = [1.2, 2.5];
    const wallRun = (len, wins, zz, put) => { let s = 0; for (const [a, b] of wins) { put(s, a, 0, WALL_H); put(a, b, 0, zz[0]); put(a, b, zz[1], WALL_H); s = b; } put(s, len, 0, WALL_H); };
    const wallPiece = (len, h) => keep(new THREE.BoxGeometry(len, h, T));
    wallRun(GX, WINS_Y, WIN_Y_Z, (a, b, z1, z2) => { if (b - a > 0.001) mesh(W, wallPiece(b - a, z2 - z1), wallR, (a + b) / 2, (z1 + z2) / 2, -T / 2); });
    wallRun(GY, WINS_X, WIN_X_Z, (a, b, z1, z2) => { if (b - a > 0.001) { const m = mesh(W, wallPiece(b - a, z2 - z1), wallL, -T / 2, (z1 + z2) / 2, (a + b) / 2); m.rotation.y = Math.PI / 2; } });
    pbox(W, -T, -T, 0, T, T, WALL_H, wallL, 0.005);
    pbox(W, -T - 0.04, -T - 0.04, WALL_H, GX + T + 0.04, T + 0.08, 0.09, M('cap'), 0.03); pbox(W, -T - 0.04, -0.04, WALL_H, T + 0.08, GY + 0.04, 0.09, M('cap'), 0.03);
    pbox(W, 0, 0, 0, GX, 0.035, 0.12, M('base'), 0.012, { cast: false }); pbox(W, 0, 0, 0, 0.035, GY, 0.12, M('base'), 0.012, { cast: false });
    // windows: a frame, a mullion, the sky behind
    const skyBasic = new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false }); keep(skyBasic);
    const frame = M('frame', { roughness: 0.4, clearcoat: 0.4 });
    for (const [a, b] of WINS_Y) {
      const [z1, z2] = WIN_Y_Z, m = (a + b) / 2;
      mesh(W, keep(new THREE.PlaneGeometry(b - a, z2 - z1)), skyBasic, m, (z1 + z2) / 2, -T + 0.02, { cast: false, recv: false });
      pbox(W, a - 0.04, -T - 0.02, z1 - 0.06, b - a + 0.08, T + 0.08, 0.07, frame, 0.025); pbox(W, a - 0.04, -T - 0.02, z2 - 0.01, b - a + 0.08, T + 0.04, 0.07, frame, 0.025);
      pbox(W, a - 0.05, -T - 0.02, z1, 0.06, T + 0.04, z2 - z1, frame, 0.02); pbox(W, b - 0.01, -T - 0.02, z1, 0.06, T + 0.04, z2 - z1, frame, 0.02); pbox(W, m - 0.025, -0.12, z1, 0.05, 0.06, z2 - z1, frame, 0.015); pbox(W, a, -0.12, (z1 + z2) / 2, b - a, 0.06, 0.045, frame, 0.015);
    }
    for (const [a, b] of WINS_X) {
      const [z1, z2] = WIN_X_Z, m = (a + b) / 2;
      const p = mesh(W, keep(new THREE.PlaneGeometry(b - a, z2 - z1)), skyBasic, -T + 0.02, (z1 + z2) / 2, m, { cast: false, recv: false }); p.rotation.y = Math.PI / 2;
      pbox(W, -T - 0.02, a - 0.04, z1 - 0.06, T + 0.08, b - a + 0.08, 0.07, frame, 0.025); pbox(W, -T - 0.02, a - 0.04, z2 - 0.01, T + 0.04, b - a + 0.08, 0.07, frame, 0.025);
      pbox(W, -T - 0.02, a - 0.05, z1, T + 0.04, 0.06, z2 - z1, frame, 0.02); pbox(W, -T - 0.02, b - 0.01, z1, T + 0.04, 0.06, z2 - z1, frame, 0.02); pbox(W, -0.12, m - 0.025, z1, 0.06, 0.05, z2 - z1, frame, 0.015);
    }
    // sunlight through the windows, laid on the floor
    const beamMat = keep(new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: day.beam[0], color: day.beam[1] })); beamMat.userData.beam = 1;
    const beam = (p) => { const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap(([x, y]) => [x, 0.045, y]), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); g.setIndex([0, 2, 1, 0, 3, 2]); const m = new THREE.Mesh(g, beamMat); m.userData.noAO = 1; W.add(m); };
    for (const [a, b] of WINS_Y) beam([[a, 0], [b, 0], [b + 1.5, 3.3], [a + 1.5, 3.3]]);
    for (const [a, b] of WINS_X) beam([[0, a], [0, b], [3.2, b + 1.1], [3.2, a + 1.1]]);
    // wall pictures: a texture on a framed panel, all inside its frame
    const wallPanel = (x1, x2, z1, z2, draw, { side = 'y', bezel = frame, emissive = false, px = 420 } = {}) => {
      const w = x2 - x1, h = z2 - z1, tx = keep(tex(Math.round(w * px), Math.round(h * px), draw));
      const mat = keep(emissive ? new THREE.MeshBasicMaterial({ map: tx, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: tx, roughness: 0.8 }));
      const g = new THREE.Group();
      mesh(g, rbox(w + 0.12, h + 0.12, 0.06, 0.04), bezel, 0, 0, 0);
      const f = mesh(g, keep(new THREE.PlaneGeometry(w, h)), mat, 0, 0, 0.032, { cast: false }); if (emissive) f.userData.noAO = 1;
      if (side === 'y') g.position.set((x1 + x2) / 2, (z1 + z2) / 2, 0.035); else { g.position.set(0.035, (z1 + z2) / 2, (x1 + x2) / 2); g.rotation.y = Math.PI / 2; }
      W.add(g); return mat;
    };
    // the task board
    wallPanel(3.6, 6.3, 0.85, 2.3, (g, w, h) => {
      g.fillStyle = '#fffdf8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#4a5160'; g.font = `800 ${h * 0.1}px ${FONT}`; g.fillText(t('officeBoardTitle'), w * 0.05, h * 0.15);
      const cols = [[t('officeTodo'), ['#ffe7a3', '#ffe7a3']], [t('officeDoing'), ['#cfe0ff', '#ffd7a8', '#cfe0ff']], [t('officeDone'), ['#cdeedd', '#cdeedd', '#cdeedd']]];
      const cw = (w * 0.9) / 3; seed = 3;
      cols.forEach(([n, cs], i) => {
        const x0 = w * 0.05 + i * cw;
        g.fillStyle = '#8d95a3'; g.font = `700 ${h * 0.065}px ${FONT}`; g.fillText(n, x0 + cw * 0.06, h * 0.27);
        if (i) g.fillRect(x0 - 1, h * 0.22, 2, h * 0.7);
        cs.forEach((c, k) => {
          const nx = x0 + cw * 0.08, ny = h * 0.33 + k * h * 0.2, nw = cw * 0.8, nh = h * 0.15;
          g.save(); g.translate(nx + nw / 2, ny + nh / 2); g.rotate((rnd() - 0.5) * 0.06); g.shadowColor = 'rgba(60,50,90,.18)'; g.shadowBlur = 6; g.shadowOffsetY = 2; g.fillStyle = c; rr(g, -nw / 2, -nh / 2, nw, nh, 5); g.fill(); g.shadowColor = 'transparent';
          g.fillStyle = 'rgba(60,70,90,.35)'; rr(g, -nw / 2 + 8, -nh / 2 + 9, nw * 0.62, 5, 2.5); g.fill(); rr(g, -nw / 2 + 8, -nh / 2 + 20, nw * 0.4, 5, 2.5); g.fill(); g.restore();
        });
      });
    }, { px: 380 });
    // the shared browser — the "internet"
    const browser = wallPanel(6.85, 10.55, 0.85, 2.42, (g, w, h) => {
      g.fillStyle = '#f4f6fd'; g.fillRect(0, 0, w, h); g.fillStyle = '#dfe4f1'; g.fillRect(0, 0, w, h * 0.1);
      ['#ff7a8a', '#ffd166', '#86dcb0'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(h * 0.05 + i * h * 0.06, h * 0.05, h * 0.018, 0, 7); g.fill(); });
      g.fillStyle = '#fff'; g.strokeStyle = '#c8cdd8'; g.lineWidth = 2; rr(g, w * 0.2, h * 0.16, w * 0.55, h * 0.085, h * 0.04); g.fill(); g.stroke();
      g.strokeStyle = '#8d95a3'; g.lineWidth = 3; g.beginPath(); g.arc(w * 0.2 + h * 0.045, h * 0.2, h * 0.018, 0, 7); g.stroke();
      g.fillStyle = '#3a63d8'; rr(g, w * 0.05, h * 0.33, w * 0.28, h * 0.06, h * 0.03); g.fill();
      g.fillStyle = '#b8bfcc'; [[0.62, 0.46], [0.5, 0.56], [0.57, 0.66], [0.44, 0.76], [0.52, 0.86]].forEach(([ww, y]) => { rr(g, w * 0.05, h * y, w * ww, h * 0.035, h * 0.018); g.fill(); });
      g.fillStyle = '#e3e9fb'; rr(g, w * 0.72, h * 0.33, w * 0.23, h * 0.58, 10); g.fill(); g.fillStyle = '#c9d4f4'; rr(g, w * 0.75, h * 0.38, w * 0.17, h * 0.2, 8); g.fill();
    }, { bezel: M('#262b36', { roughness: 0.35, clearcoat: 0.6 }), emissive: true, px: 340 });
    browser.color.setScalar(0.92);
    // artifacts: framed posters on the side wall, over the pantry
    wallPanel(S(6.6), S(7.7), 1.05, 2.35, (g, w, h) => { g.fillStyle = '#e9eefc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3a63d8'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); [[0.1, 0.75], [0.3, 0.5], [0.48, 0.62], [0.7, 0.3], [0.9, 0.42]].forEach(([x, y], i) => (i ? g.lineTo(w * x, h * y) : g.moveTo(w * x, h * y))); g.stroke(); g.fillStyle = '#b9c8f2'; [0.2, 0.4, 0.6, 0.8].forEach((x) => { rr(g, w * x - 12, h * 0.85, 24, h * 0.08, 4); g.fill(); }); }, { side: 'x' });
    wallPanel(S(8.0), S(9.0), 1.6, 2.35, (g, w, h) => { g.fillStyle = '#fde9e1'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2a58a'; g.beginPath(); g.arc(w / 2, h * 0.45, h * 0.26, 0, 7); g.fill(); g.fillStyle = '#f7c6b4'; g.fillRect(0, h * 0.78, w, h * 0.22); }, { side: 'x' });
    wallPanel(S(8.0), S(9.0), 1.0, 1.42, (g, w, h) => { g.fillStyle = '#e3f5ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#7cc79a'; rr(g, w * 0.1, h * 0.25, w * 0.7, h * 0.16, 6); g.fill(); rr(g, w * 0.1, h * 0.55, w * 0.5, h * 0.16, 6); g.fill(); }, { side: 'x' });
    // library: four bookcases on the side wall, books on each shelf
    const spines = ['#8fb4ff', '#ff9fb8', '#ffd166', '#86dcb0', '#c7a8ff', '#ffb37a', '#79d6e3', '#f4f1ea'];
    const books = []; seed = 5;
    LIB.forEach(([, sy]) => {
      const y = sy - 0.6, d = 1.22, x = 0.04, w = 0.5, h = 2.25, sh = M('shelf');
      pbox(W, x, y, 0, 0.06, d, h, sh, 0.02); pbox(W, x, y, 0, w, 0.05, h, sh, 0.02); pbox(W, x, y + d - 0.05, 0, w, 0.05, h, sh, 0.02); pbox(W, x, y, h - 0.05, w + 0.02, d, 0.06, sh, 0.025);
      for (let lv = 0; lv < 5; lv++) {
        const z = 0.05 + lv * 0.44; pbox(W, x, y, z, w, d, 0.04, sh, 0.015);
        if (lv === 4) continue; let yy = y + 0.07;
        while (yy < y + d - 0.12) { const bw = 0.05 + rnd() * 0.04, bh = 0.26 + rnd() * 0.1; books.push({ x: x + 0.08 + rnd() * 0.06, y: yy, z: z + 0.04, w: 0.3, d: bw, h: bh, c: spines[Math.floor(rnd() * spines.length)], lean: rnd() < 0.08 }); yy += bw + 0.008; if (rnd() < 0.06) yy += 0.1; }
      }
    });
    {
      const im = new THREE.InstancedMesh(rbox(1, 1, 1, 0.06), keep(new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.2 })), books.length), o = new THREE.Object3D(), col = new THREE.Color();
      books.forEach((b, i) => { o.position.set(b.x + b.w / 2, b.z + b.h / 2, b.y + b.d / 2); o.rotation.set(b.lean ? 0.18 : 0, 0, 0); o.scale.set(b.w, b.h, b.d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, col.set(b.c)); });
      im.castShadow = im.receiveShadow = true; W.add(im); trash.push({ dispose: () => im.dispose() });
    }
    // a reading table with a lamp
    pcyl(W, 2.05, 5.95, 0, 0.05, 0.55, M('deskLeg')); pcyl(W, 2.05, 5.95, 0.55, 0.36, 0.05, M('desk'));
    pcyl(W, 2.2, 5.85, 0.6, 0.025, 0.25, M('metal'));
    { const s = mesh(W, keep(new THREE.SphereGeometry(0.09, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), M('#ffd166', { emissive: '#ffd166', emissiveIntensity: 0.4 }), 2.2, 0.92, 5.85); s.rotation.x = Math.PI; }
    pbox(W, 1.85, 5.9, 0.6, 0.22, 0.16, 0.03, M('#8fb4ff'), 0.01);
    // pantry: a counter with a coffee machine and mugs, a fridge, a high table
    {
      const y0 = S(8.2);
      pbox(W, 0.04, y0, 0, 0.78, 2.2, 0.82, M('counter'), 0.05); pbox(W, 0.02, y0 - 0.02, 0.82, 0.84, 2.24, 0.05, M('#f9f7f3', { roughness: 0.3, clearcoat: 0.5 }), 0.02);
      pbox(W, 0.1, y0 + 0.15, 0.87, 0.48, 0.5, 0.55, M('machine'), 0.08); pbox(W, 0.5, y0 + 0.25, 1.0, 0.1, 0.3, 0.28, M('#2b303b', { roughness: 0.3 }), 0.03); pcyl(W, 0.42, y0 + 0.4, 0.87, 0.05, 0.08, M('#ffffff'));
      pcyl(W, 0.42, y0 + 1.1, 0.87, 0.055, 0.11, M('#ffffff', { roughness: 0.3, clearcoat: 0.6 })); pcyl(W, 0.5, y0 + 1.5, 0.87, 0.055, 0.11, M('#8fb4ff', { roughness: 0.3, clearcoat: 0.6 }));
      pbox(W, 0.12, y0 + 1.75, 0.87, 0.35, 0.3, 0.22, M('#e0a46d'), 0.06);
      const f = M('#f1f3f8', { roughness: 0.3, clearcoat: 0.6 }); pbox(W, 0.04, S(10.45), 0, 0.78, 0.8, 1.7, f, 0.09); pbox(W, 0.8, S(10.55), 0.95, 0.04, 0.05, 0.45, M('#b8bfcc', { metalness: 0.6, roughness: 0.3 }), 0.02);
      pcyl(W, 2.85, S(9.3), 0, 0.06, 1.0, M('deskLeg')); pcyl(W, 2.85, S(9.3), 0, 0.28, 0.03, M('deskLeg')); pcyl(W, 2.85, S(9.3), 1.0, 0.42, 0.05, M('desk'));
    }
    // lounge: a sofa, a side table
    {
      const soft = { roughness: 0.9, clearcoat: 0, sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffffff') };
      const so = M('sofa', soft), cu = M('cushion', soft), y0 = S(11.4);
      pbox(W, 0.8, y0 + 0.02, 0, 3.2, 1.12, 0.3, so, 0.12); pbox(W, 0.8, y0, 0.2, 3.2, 0.36, 0.78, so, 0.16); pbox(W, 0.62, y0, 0, 0.3, 1.15, 0.6, so, 0.13); pbox(W, 3.88, y0, 0, 0.3, 1.15, 0.6, so, 0.13);
      pbox(W, 0.95, y0 + 0.35, 0.28, 1.45, 0.78, 0.16, cu, 0.08); pbox(W, 2.43, y0 + 0.35, 0.28, 1.45, 0.78, 0.16, cu, 0.08);
      const pl = pbox(W, 1.0, y0 + 0.22, 0.45, 0.42, 0.16, 0.38, M('#ffd7a8', { roughness: 0.9, clearcoat: 0 }), 0.08); pl.rotation.z = 0.12;
      pcyl(W, 4.7, S(12.3), 0, 0.3, 0.42, M('desk')); pcyl(W, 4.62, S(12.25), 0.42, 0.05, 0.1, M('#ffffff'));
    }
    // the middle: bean bags, a water cooler, plants
    BEAN().forEach(([x, y], i) => { const c = ['#ffd7a8', '#cfe0ff', '#cdeedd'][i]; const m = mesh(W, sphG(0.42), M(c, { roughness: 0.95, clearcoat: 0, sheen: 0.7, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff') }), x, 0.26, y); m.scale.set(1, 0.6, 1); const tp = mesh(W, sphG(0.28), m.material, x - 0.06, 0.48, y - 0.06); tp.scale.set(1, 0.55, 1); });
    {
      const y = S(9.0);
      pbox(W, 10.38, y - 0.22, 0, 0.44, 0.44, 0.95, M('#f1f3f8', { roughness: 0.35, clearcoat: 0.5 }), 0.08);
      const b = mesh(W, cylG(0.17, 0.17, 0.42), keep(new THREE.MeshPhysicalMaterial({ color: '#9fd0ff', roughness: 0.05, transparent: true, opacity: 0.65, clearcoat: 1 })), 10.6, 1.17, y); b.userData.noAO = 1;
      pcyl(W, 10.6, y, 1.38, 0.05, 0.04, M('#9fd0ff'));
    }
    const plant = (x, y, s = 1) => {
      pcyl(W, x, y, 0, 0.2 * s, 0.38 * s, M('pot', { roughness: 0.7 })); pcyl(W, x, y, 0.38 * s, 0.19 * s, 0.02, M('#6b4f3a'));
      seed = Math.floor(x * 13 + y * 7) || 1; const lf = [M('leaf', { roughness: 0.7 }), M('leafD', { roughness: 0.7 })];
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + rnd(), r = 0.12 * s + rnd() * 0.1 * s, l = mesh(W, sphG(+(0.15 * s).toFixed(3)), lf[i % 2], x + Math.cos(a) * r, 0.55 * s + rnd() * 0.35 * s, y + Math.sin(a) * r); l.scale.set(1, 0.85, 1); }
      mesh(W, sphG(+(0.18 * s).toFixed(3)), lf[0], x, 0.95 * s, y);
    };
    plant(0.45, 6.75, 1.1); plant(17.55, 0.45, 1); plant(5.6, S(12.5), 1); plant(11.9, S(12.3), 1.2); plant(2.95, 0.45, 0.9); plant(15.25, 0.45, 0.9); plant(6.2, S(7.6), 0.8); plant(12.2, S(7.6), 0.8);
    // meeting room: glass on a frame, a door gap
    const glassMat = keep(new THREE.MeshPhysicalMaterial({ color: C('glass'), roughness: 0.08, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide })); themed.push([glassMat, 'glass']);
    const rail = M('frame', { roughness: 0.4, clearcoat: 0.4 });
    const glassY = (y, x1, x2, h) => { const g = mesh(W, keep(new THREE.PlaneGeometry(x2 - x1, h)), glassMat, (x1 + x2) / 2, h / 2, y, { cast: false, recv: false }); g.userData.noAO = 1; pbox(W, x1, y - 0.03, h - 0.02, x2 - x1, 0.06, 0.06, rail, 0.025); pbox(W, x1, y - 0.03, 0, x2 - x1, 0.06, 0.05, rail, 0.02); [x1, x2].forEach((x) => pbox(W, x - 0.03, y - 0.03, 0, 0.06, 0.06, h, rail, 0.02)); };
    const glassX = (x, y1, y2, h) => { const g = mesh(W, keep(new THREE.PlaneGeometry(y2 - y1, h)), glassMat, x, h / 2, (y1 + y2) / 2, { cast: false, recv: false }); g.rotation.y = Math.PI / 2; g.userData.noAO = 1; pbox(W, x - 0.03, y1, h - 0.02, 0.06, y2 - y1, 0.06, rail, 0.025); pbox(W, x - 0.03, y1, 0, 0.06, y2 - y1, 0.05, rail, 0.02); [y1, y2].forEach((y) => pbox(W, x - 0.03, y - 0.03, 0, 0.06, 0.06, h, rail, 0.02)); };
    glassY(S(8.6), 12.6, 14.3, 1.9); glassY(S(8.6), 15.2, 18, 1.9); glassX(12.6, S(8.6), GY, 1.9);
    const MC = [15.4, S(10.9)];
    pcyl(W, MC[0], MC[1], 0, 0.5, 0.04, M('deskLeg')); pcyl(W, MC[0], MC[1], 0, 0.12, DESK_H, M('deskLeg')); pcyl(W, MC[0], MC[1], DESK_H - 0.05, 1.05, 0.06, M('desk', { roughness: 0.35, clearcoat: 0.5 }));
    pcyl(W, 15.0, S(10.6), DESK_H, 0.05, 0.1, M('#c7a8ff')); pbox(W, 15.5, S(11.0), DESK_H, 0.42, 0.3, 0.02, M('#ffffff'), 0.008);
    [[14.3, 10.0], [16.4, 9.7], [14.1, 11.6], [15.9, 12.25], [17.1, 11.2]].forEach(([x, y]) => chair(W, x, S(y), [MC[0] - x, MC[1] - S(y)], C('chair')));
    // the lead's corner: low glass, a door gap on the left
    glassX(15.6, 0, 5.2, 0.95); glassY(5.2, 16.5, 18, 0.95);
    desk(W, LEAD, -1, () => [...agents.values()].find((x) => x.leader)); chair(W, LEAD.seat[0], LEAD.seat[1], [1, 0], PALETTE[6][0]).userData.leadChair = 1;
    // the assistant's small desk at the way in
    { const d = recDesk(); desk(W, d, -2, () => agents.get(SEC)); chair(W, d.seat[0], d.seat[1], [1, 0], PALETTE[5][0]); pbox(W, d.top.x + d.top.w, d.top.y - 0.02, 0, 0.1, d.top.d + 0.04, 0.98, M('desk', { roughness: 0.45, clearcoat: 0.35 }), 0.03); }
    // desks; the first free one is the "new seat"
    L.desks.forEach((_, i) => { const d = deskOf(i); desk(W, d, i, () => [...agents.values()].find((x) => !x.leader && !x.sec && x.desk === i)); d.chair = chair(W, d.seat[0], d.seat[1], [1, 0], C('chair')); chairsOf.push({ c: d.chair, find: () => [...agents.values()].find((x) => !x.leader && !x.sec && x.desk === i) }); });
    // labels
    L.desks.forEach((_, i) => { const d = deskOf(i); plateOf.set(i, staticChip('plate', [d.top.x + d.top.w / 2 - 0.1, 0, d.top.y + d.top.d + 0.12], 'top', 3, () => plateClick(i))); });
    plateOf.set('lead', staticChip('plate', [LEAD.top.x + LEAD.top.w / 2, 0, LEAD.top.y + LEAD.top.d + 0.12], 'top', 3, () => plateClick('lead')));
    [[1.7, 6.55, 'officeLib'], [2.9, S(7.95), 'officePantry'], [2.5, S(12.8), 'officeLounge'], [16.6, S(12.75), 'officeMeet'], [16.9, 4.85, 'officeLead'], [9.1, S(11.75), 'officeBreak'], [17.3, S(7.25), 'officeReception']].forEach(([x, y, k]) => staticChip('zone', [x, 0, y], 'center-hide', 5, null, t(k)));
    staticChip('wallbtn', [4.95, 2.52, 0.05], 'bottom', 4, () => api.board(), t('officeBoard'));
    staticChip('wallbtn', [8.7, 2.62, 0.05], 'bottom', 4, () => api.browsers(), '🌐 ' + t('officeBrowser'));
    staticChip('wallbtn', [0.05, 2.58, S(7.8)], 'bottom', 4, () => api.artifacts(), t('officeArtifacts'));
    fitCamera(); dirtyPlates = true;
  }
  // a desk: a top on two clay panels, a screen turned to the seat, a keyboard, a mug or a little plant; find: who works at it
  function desk(W, d, i, find) {
    const { x, y, w, d: dd } = d.top, leg = M('deskLeg'), top = M('desk', { roughness: 0.45, clearcoat: 0.35 });
    pbox(W, x + 0.04, y + 0.05, 0, 0.07, dd - 0.1, DESK_H - 0.04, leg, 0.03); pbox(W, x + w - 0.11, y + 0.05, 0, 0.07, dd - 0.1, DESK_H - 0.04, leg, 0.03); pbox(W, x + 0.06, y + 0.08, 0.25, w - 0.12, 0.04, 0.25, leg, 0.015);
    pbox(W, x, y, DESK_H - 0.05, w, dd, 0.06, top, 0.025);
    const g = new THREE.Group(), sw = i < 0 ? 0.62 : 0.52, sh = i < 0 ? 0.36 : 0.32; g.position.set(d.mon[0], DESK_H + 0.01, d.mon[1]);
    g.rotation.y = Math.atan2(d.seat[0] - d.mon[0], d.seat[1] - d.mon[1]);
    const metal = M('metal', { roughness: 0.35, clearcoat: 0.5 });
    mesh(g, cylG(0.1, 0.11, 0.02), metal, 0, 0.01, -0.02); mesh(g, rbox(0.05, 0.22, 0.035, 0.015), metal, 0, 0.12, -0.05);
    mesh(g, rbox(sw, sh, 0.04, 0.02), metal, 0, 0.13 + sh / 2, -0.02);
    const scrMat = new THREE.MeshBasicMaterial({ color: '#1f232c', toneMapped: false }); trash.push(scrMat);
    const scr = mesh(g, new THREE.PlaneGeometry(sw - 0.04, sh - 0.04), scrMat, 0, 0.13 + sh / 2, 0.001, { cast: false }); scr.userData.noAO = 1; trash.push(scr.geometry);
    const ledMat = new THREE.MeshBasicMaterial({ color: '#59606e', toneMapped: false }); trash.push(ledMat);
    mesh(g, sphG(0.016), ledMat, sw / 2 - 0.06, 0.17, -0.042, { cast: false });
    W.add(g);
    // the screen's light on the desk top, the colour of what it is doing
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#3a63d8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }); trash.push(glowMat);
    const glow = mesh(W, rbox(0.95, 0.001, 0.8, 0.0005), glowMat, (d.mon[0] + d.seat[0]) / 2 + 0.08, DESK_H + 0.012, d.mon[1], { cast: false, recv: false }); glow.userData.noAO = 1;
    pbox(W, x + 0.12, d.seat[1] - 0.2, DESK_H + 0.01, 0.14, 0.4, 0.02, M('#f7f7f9', { roughness: 0.4 }), 0.008);
    mesh(W, rbox(0.06, 0.025, 0.09, 0.012), M('#f7f7f9', { roughness: 0.4 }), x + 0.2, DESK_H + 0.02, d.seat[1] + 0.32);
    const mugMat = new THREE.MeshPhysicalMaterial({ color: '#e6e2da', roughness: 0.3, clearcoat: 0.6 }); trash.push(mugMat);
    if (i < 0 || i % 2 === 0) pcyl(W, x + w - 0.18, y + 0.18, DESK_H + 0.01, 0.05, 0.1, mugMat);
    else { pcyl(W, x + w - 0.18, y + 0.18, DESK_H + 0.01, 0.06, 0.09, M('pot')); const l = mesh(W, sphG(0.09), M('leaf'), x + w - 0.18, DESK_H + 0.17, y + 0.18); l.scale.set(1, 1.2, 1); }
    if (i < 0) pbox(W, x + 0.5, y + 1.1, DESK_H + 0.01, 0.3, 0.22, 0.03, M('#ffd166'), 0.01);
    deskScreens.push({ i, find, scrMat, glowMat, ledMat, mugMat });
  }
  // a chair: seat, back, a stem on a star of wheels; front faces dir
  function chair(W, x, y, dir, col) {
    const g = new THREE.Group(); g.position.set(x, 0, y); g.rotation.y = Math.atan2(dir[0], dir[1]);
    const m = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.75, clearcoat: 0.1, sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff') }); trash.push(m);
    const metal = M('metal', { roughness: 0.35, clearcoat: 0.5 });
    mesh(g, rbox(0.46, 0.08, 0.44, 0.035), m, 0, SEAT_H - 0.04, 0.02);
    mesh(g, rbox(0.44, 0.4, 0.07, 0.03), m, 0, SEAT_H + 0.24, -0.22); mesh(g, rbox(0.05, 0.2, 0.04, 0.015), metal, 0, SEAT_H + 0.03, -0.22);
    mesh(g, cylG(0.025, 0.025, SEAT_H - 0.1), metal, 0, (SEAT_H - 0.1) / 2 + 0.04, 0);
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, s = mesh(g, rbox(0.2, 0.025, 0.035, 0.01), metal, Math.cos(a) * 0.1, 0.045, Math.sin(a) * 0.1); s.rotation.y = -a; mesh(g, sphG(0.022), metal, Math.cos(a) * 0.2, 0.022, Math.sin(a) * 0.2); }
    g.userData.mat = m;
    W.add(g); return g;
  }

  /* ── robots in clay ── */
  function faceTex(kind) {
    return tex(288, 156, (g) => {
      g.setTransform(8, 0, 0, 8, -14 * 8, -19 * 8);
      const eye = '#aef3ff'; g.lineCap = 'round'; g.lineJoin = 'round';
      const stroke = (d, c, w) => { g.strokeStyle = c; g.lineWidth = w; g.stroke(new Path2D(d)); };
      const ell = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
      if (kind !== 'resting') { g.globalAlpha = 0.5; ell(18.6, 34.5, 2.3, 2.3, '#ff8fa8'); ell(45.4, 34.5, 2.3, 2.3, '#ff8fa8'); g.globalAlpha = 1; }
      if (kind === 'waiting') { stroke('M22 28 Q25 30.5 28 28', eye, 2.2); stroke('M36 28 Q39 30.5 42 28', eye, 2.2); ell(32, 34, 1.5, 1.5, eye); }
      else if (kind === 'asking') { ell(25, 27.5, 3.5, 4.6, eye); ell(39, 27.5, 3.5, 4.6, eye); ell(26.3, 25.6, 1.3, 1.3, '#fff'); ell(40.3, 25.6, 1.3, 1.3, '#fff'); g.strokeStyle = eye; g.lineWidth = 1.6; g.beginPath(); g.arc(32, 34.3, 1.9, 0, 7); g.stroke(); }
      else if (kind === 'resting') { stroke('M22 28 L28 28', '#7b8594', 2.2); stroke('M36 28 L42 28', '#7b8594', 2.2); stroke('M30 34 L34 34', '#7b8594', 1.6); }
      else if (kind === 'blink') { stroke('M22 28 L28 28', eye, 2); stroke('M36 28 L42 28', eye, 2); stroke('M28.5 33 Q32 36.2 35.5 33', eye, 1.8); }
      else { ell(25, 27.5, 3.1, 3.9, eye); ell(39, 27.5, 3.1, 3.9, eye); ell(26.2, 26, 1.1, 1.1, '#fff'); ell(40.2, 26, 1.1, 1.1, '#fff'); stroke('M28.5 33 Q32 36.2 35.5 33', eye, 1.8); }
    });
  }
  const FACES = Object.fromEntries(['working', 'blink', 'waiting', 'asking', 'resting'].map((k) => [k, faceTex(k)]));
  const zTex = tex(64, 64, (g) => { g.font = `900 52px ${FONT}`; g.fillStyle = '#6c7486'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', 32, 34); });
  const alertTex = tex(64, 64, (g) => { g.fillStyle = '#e0a91e'; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke(); g.fillStyle = '#fff'; g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 32, 35); });
  const screenDark = new THREE.MeshPhysicalMaterial({ color: '#1d2230', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1 });
  const GREY = new THREE.Color('#a9adb6');
  const people = new THREE.Group(); scene.add(people);
  function makeRobot(id, look) {
    const [bodyC, darkC] = PALETTE[look.c] || PALETTE[0];
    const own = [];
    const mine = (m) => { own.push(m); return m; };
    const mb = mine(new THREE.MeshPhysicalMaterial({ color: bodyC, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.25, sheenColor: new THREE.Color('#ffffff') }));
    const md = mine(new THREE.MeshPhysicalMaterial({ color: darkC, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 }));
    const root = new THREE.Group(), rig = new THREE.Group(); root.add(rig);
    mesh(rig, rbox(0.38, 0.24, 0.3, 0.09), md, 0, 0.12, 0);
    mesh(rig, rbox(0.19, 0.1, 0.03, 0.025), screenDark, 0, 0.125, 0.145);
    mesh(rig, sphG(0.022), mine(new THREE.MeshBasicMaterial({ color: '#aef3ff', toneMapped: false })), 0, 0.125, 0.163, { cast: false });
    const head = new THREE.Group(); head.position.y = 0.234; rig.add(head);
    mesh(head, rbox(0.75, 0.5, 0.56, 0.17), mb, 0, 0.25, 0);
    mesh(head, rbox(0.58, 0.33, 0.05, 0.11), screenDark, 0, 0.24, 0.265);
    const faceMat = mine(new THREE.MeshBasicMaterial({ map: FACES.working, transparent: true, toneMapped: false }));
    const faceGeo = new THREE.PlaneGeometry(0.54, 0.2925); own.push(faceGeo);
    mesh(head, faceGeo, faceMat, 0, 0.24, 0.292, { cast: false, recv: false }).userData.noAO = 1;
    // the back: a panel with vents
    mesh(head, rbox(0.42, 0.28, 0.03, 0.08), md, -0.03, 0.25, -0.278);
    for (let k = 0; k < 3; k++) mesh(head, rbox(k === 2 ? 0.18 : 0.26, 0.022, 0.02, 0.01), mb, -0.03 - (k === 2 ? 0.04 : 0), 0.33 - k * 0.065, -0.295);
    if (look.acc === 'phones') {
      const pm = mine(new THREE.MeshPhysicalMaterial({ color: '#3b4252', roughness: 0.4, clearcoat: 0.5 }));
      [-1, 1].forEach((s) => mesh(head, rbox(0.12, 0.26, 0.22, 0.05), pm, s * 0.415, 0.24, 0));
      const tg = new THREE.TorusGeometry(0.42, 0.035, 12, 32, Math.PI); own.push(tg); mesh(head, tg, pm, 0, 0.24, 0);
    } else [-1, 1].forEach((s) => mesh(head, rbox(0.08, 0.18, 0.16, 0.035), md, s * 0.4, 0.24, 0));
    const top = new THREE.Group(); top.position.y = 0.5; head.add(top);
    const bulbM = (c) => mine(new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.3, clearcoat: 0.8 }));
    const stem = (x, tilt, len = 0.1) => { const s = mesh(top, cylG(0.016, 0.016, len, 10), md, x, len / 2, 0); s.rotation.z = tilt; return [x - Math.sin(tilt) * len, Math.cos(tilt) * len]; };
    const bulbs = [];
    switch (look.acc) {
      case 'twin': [-1, 1].forEach((s) => { const [bx, by] = stem(s * 0.1, -s * 0.5, 0.12); bulbs.push(mesh(top, sphG(0.045), bulbM('#ff7a8a'), bx, by, 0)); }); break;
      case 'sprout': { stem(0, 0, 0.09); const lm = mine(new THREE.MeshPhysicalMaterial({ color: '#5cc27f', roughness: 0.5, clearcoat: 0.4 })); [-1, 1].forEach((s) => { const l = mesh(top, sphG(0.07), lm, s * 0.06, 0.11, 0); l.scale.set(1, 0.32, 0.6); l.rotation.z = s * 0.5; }); break; }
      case 'bolt': {
        const sh = new THREE.Shape(); [[0, 0], [-0.04, 0.05], [0.02, 0.06], [-0.03, 0.12], [0, 0.12], [0.05, 0.05], [-0.01, 0.045], [0.03, 0]].forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
        const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }); own.push(eg);
        mesh(top, eg, md, 0, 0, -0.015); bulbs.push(mesh(top, sphG(0.035), bulbM('#ffe066'), -0.02, 0.15, 0)); break;
      }
      case 'crown': {
        const gold = mine(new THREE.MeshPhysicalMaterial({ color: '#ffcf3f', metalness: 0.6, roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide }));
        const cg = new THREE.CylinderGeometry(0.19, 0.19, 0.09, 32, 1, true), co = new THREE.ConeGeometry(0.04, 0.09, 10); own.push(cg, co);
        mesh(top, cg, gold, 0, 0.03, 0);
        for (let k = 0; k < 5; k++) { const an = k / 5 * Math.PI * 2; mesh(top, co, gold, Math.sin(an) * 0.19, 0.115, Math.cos(an) * 0.19); }
        bulbs.push(mesh(top, sphG(0.03), bulbM('#ff6b81'), 0, 0.04, 0.195)); break;
      }
      default: { const [bx, by] = stem(0, 0, 0.1); bulbs.push(mesh(top, sphG(0.047), bulbM('#ff7a8a'), bx, by, 0)); }
    }
    const capG = new THREE.CapsuleGeometry(0.042, 0.09, 6, 12); own.push(capG);
    const arm = (s) => { const p = new THREE.Group(); p.position.set(s * 0.235, 0.2, 0); rig.add(p); mesh(p, capG, mb, 0, -0.07, 0); return p; };
    const armL = arm(1), armR = arm(-1);
    const book = new THREE.Group(); book.position.set(0, 0.25, 0.3); book.rotation.x = -0.9; rig.add(book);
    mesh(book, rbox(0.26, 0.02, 0.18, 0.008), mine(new THREE.MeshPhysicalMaterial({ color: '#3a63d8', roughness: 0.5, clearcoat: 0.4 })), 0, 0, 0);
    mesh(book, rbox(0.24, 0.012, 0.16, 0.004), mine(new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.8 })), 0, 0.015, 0);
    const page = new THREE.Group(); page.position.set(0, 0.022, 0); book.add(page);
    const pg = new THREE.PlaneGeometry(0.11, 0.155); own.push(pg);
    mesh(page, pg, mine(new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide })), 0.058, 0, 0, { cast: false }).rotation.x = -Math.PI / 2;
    const mug = new THREE.Group(); mug.position.set(0, -0.14, 0.03); armR.add(mug);
    const white = mine(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.25, clearcoat: 0.8 }));
    mesh(mug, cylG(0.045, 0.04, 0.09), white, 0, 0, 0); mesh(mug, cylG(0.038, 0.038, 0.005), mine(new THREE.MeshStandardMaterial({ color: '#7a4a2a' })), 0, 0.043, 0);
    const hg = new THREE.TorusGeometry(0.025, 0.008, 8, 16); own.push(hg); mesh(mug, hg, white, 0.05, 0, 0);
    const zs = [0, 1].map(() => { const s = new THREE.Sprite(mine(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false }))); s.scale.setScalar(0.2); root.add(s); return s; });
    const alert = new THREE.Sprite(mine(new THREE.SpriteMaterial({ map: alertTex, transparent: true, depthTest: false }))); alert.scale.setScalar(0.24); alert.renderOrder = 5; root.add(alert);
    root.traverse((c) => { c.userData.agent = id; });
    people.add(root);
    return { root, rig, head, armL, armR, faceMat, book, page, mug, zs, alert, mb, md, bulbs, base: [new THREE.Color(bodyC), new THREE.Color(darkC)], dispose() { people.remove(root); for (const x of own) x.dispose(); } };
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 48), new THREE.MeshBasicMaterial({ color: '#3a63d8', transparent: true, opacity: 0.75, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.userData.noAO = 1; ring.visible = false; scene.add(ring);

  /* ── camera: a fixed angle fit to the box; drag to move, Ctrl+wheel to zoom ── */
  const CAM_DIR = new THREE.Vector3(1, 0.92, 1).normalize();
  let VW = 1, VH = 1, zoom = 1; const pan = new THREE.Vector2(); let fit = { cx: 0, cy: 0, fw: 1, fh: 1 };
  const zv = el.querySelector('.ozv');
  function fitCamera() {
    const target = new THREE.Vector3(B.w / 2, 0.5, B.d / 2);
    camera.position.copy(target).addScaledVector(CAM_DIR, 80); camera.lookAt(target); camera.updateMatrixWorld();
    const v = new THREE.Vector3(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const x of [-0.3, B.w]) for (const h of [-0.35, WALL_H + 0.1]) for (const z of [-0.3, B.d]) { v.set(x, h, z).applyMatrix4(camera.matrixWorldInverse); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    let fw = (x1 - x0) * 1.03, fh = (y1 - y0) * 1.06; const asp = VW / VH; if (fw / fh < asp) fw = fh * asp; else fh = fw / asp;
    fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, fw, fh }; applyCamera();
  }
  function applyCamera() {
    const hw = fit.fw / 2 / zoom, hh = fit.fh / 2 / zoom;
    const lim = (v, half, full) => { const m = Math.max(0, full / 2 - half + 0.5); return Math.max(-m, Math.min(m, v)); };
    pan.x = lim(pan.x, hw, fit.fw); pan.y = lim(pan.y, hh, fit.fh);
    const cx = fit.cx + pan.x, cy = fit.cy + pan.y;
    camera.left = cx - hw; camera.right = cx + hw; camera.top = cy + hh; camera.bottom = cy - hh; camera.updateProjectionMatrix();
    zv.textContent = Math.round(zoom * 100) + '%';
  }
  function setZoom(z, sx = VW / 2, sy = VH / 2) {
    z = Math.max(0.8, Math.min(3, z));
    const nx = sx / VW - 0.5, ny = 0.5 - sy / VH;
    const px = fit.cx + pan.x + nx * fit.fw / zoom, py = fit.cy + pan.y + ny * fit.fh / zoom;
    zoom = z; pan.x = px - nx * fit.fw / zoom - fit.cx; pan.y = py - ny * fit.fh / zoom - fit.cy; applyCamera();
  }
  const v3 = new THREE.Vector3();
  const toScreen = (x, h, y) => { v3.set(x, h, y).project(camera); return [(v3.x + 1) / 2 * VW, (1 - v3.y) / 2 * VH]; };
  el.querySelector('[data-z=in]').addEventListener('click', () => setZoom(zoom * 1.2));
  el.querySelector('[data-z=out]').addEventListener('click', () => setZoom(zoom / 1.2));
  zv.addEventListener('click', () => { zoom = 1; pan.set(0, 0); applyCamera(); });
  zv.title = t('officeReset');

  /* ── ambient occlusion; glass, sprites, faces and light on the floor take no part in it ── */
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
  ao.blendIntensity = 0.85;
  { const base = ao._overrideVisibility.bind(ao); ao._overrideVisibility = function () { base(); this.scene.traverse((o) => { if ((o.userData.noAO || o.isSprite) && o.visible) { o.visible = false; this._visibilityCache.push(o); } }); }; }
  composer.addPass(ao); composer.addPass(new OutputPass());
  function resize() {
    const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    VW = r.width; VH = r.height;
    renderer.setSize(VW, VH, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(VW, VH); fitCamera();
  }
  new ResizeObserver(resize).observe(stage);

  /* ── pointer: drag to move the view, click a robot to open the agent ── */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let hovered = null, drag = null;
  function pick(e) {
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObjects(people.children, true)) if (h.object.visible && h.object.userData.agent && !h.object.isSprite) return h.object.userData.agent;
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 4) { drag.moved = true; canvas.classList.add('drag'); }
      if (drag.moved) { pan.x = drag.px - dx / VW * fit.fw / zoom; pan.y = drag.py + dy / VH * fit.fh / zoom; applyCamera(); }
      return;
    }
    hovered = pick(e); const room = hovered ? null : pickRoom(e); canvas.classList.toggle('hot', !!hovered || !!room);
    if (room !== hoverRoom) { hoverRoom = room; for (const [k, m] of BL.rugs) m.emissive.set(k === room ? '#3a63d8' : '#000000').multiplyScalar(k === room ? 0.14 : 0); }
  });
  canvas.addEventListener('pointerup', (e) => { const d = drag; drag = null; canvas.classList.remove('drag'); if (d && !d.moved) { const id = pick(e); const a = id && agents.get(id.split('#')[0]); if (a?.sec) api.openAssistant?.(); else if (a) select(a); else { const k = pickRoom(e); if (k) api.enter?.(k); } } });
  canvas.addEventListener('dblclick', (e) => { const id = pick(e); const a = id && agents.get(id.split('#')[0]); if (a && !a.sec) api.open(a.s); });
  canvas.addEventListener('pointerleave', () => { hovered = null; });
  // a room of the building, under the pointer: its project
  let hoverRoom = null;
  function pickRoom(e) {
    if (MODE !== 'bldg') return null;
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(BL.floors, false)[0]?.object.userData.room || null;
  }
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); setZoom(zoom * Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  /* ── the agents ── */
  const agents = new Map();   // session name → agent
  const seats = new Map();    // session name → desk index (kept while it is on the page)
  let leaderName = null, project = null, dirtyPlates = true, approvals = new Map();
  const FACE = { idle: 'working', walking: 'working', typing: 'working', reading: 'working', web: 'working', sip: 'working', visit: 'working', doze: 'waiting', sofadoze: 'waiting', sleep: 'resting', ask: 'asking' };
  function newAgent(s, leader) {
    const look = api.look(s, leader);
    const a = { name: s.name, s, leader, look, lookKey: look.c + look.acc, pos: [0, 0], path: [], lift: 0, liftTo: 0, size: leader ? 1.34 : 1.2, mode: 'typing', ang: 0, angTo: 0, vis: 0, phase: Math.random() * 10, place: null, spot: null, want: null, wantSince: 0, arrivedAt: 0, minis: [] };
    a.r = makeRobot(a.name, look);
    a.chip = document.createElement('div'); a.chip.className = 'act hide'; ov.append(a.chip);
    // a request's bubble answers it here (allow, deny) or opens it; any other bubble picks the agent
    a.chip.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]'), ask = approvals.get(a.name);
      if (b && ask) { for (const x of a.chip.querySelectorAll('button')) x.disabled = true; answer(a, ask, b.dataset.a); return; }
      if (a.sec) api.openAssistant?.(); else if (ask) api.open(a.s); else select(a);
    });
    return a;
  }
  function dropAgent(a) { a.r.dispose(); a.chip.remove(); for (const m of a.minis) m.r.dispose(); }
  function put(a, place) { const s = spotOf(a, place); a.pos = [...s.p]; a.spot = s; a.place = place; a.ang = a.angTo = angOf(s.face); a.lift = a.liftTo = s.lift; a.arrivedAt = performance.now(); }
  function go(a, place) {
    const tgt = spotOf(a, place), cur = a.spot || { p: a.pos, via: [] };
    const fromNet = cur.via.length ? cur.via[cur.via.length - 1] : cur.p, toNet = tgt.via.length ? tgt.via[tgt.via.length - 1] : tgt.p;
    a.path = (MODE === 'bldg' ? bpath(cur, tgt) : [...cur.via, ...lanePath(fromNet, toNet), ...[...tgt.via].reverse().slice(1), tgt.p]).filter((p, i, arr) => (i === 0 ? Math.hypot(p[0] - a.pos[0], p[1] - a.pos[1]) > 0.01 : Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 0.01));
    a.spot = null; a.place = place; a.liftTo = 0;
    a.arrive = () => { a.spot = tgt; a.angTo = angOf(tgt.face); a.liftTo = tgt.lift; a.arrivedAt = performance.now(); dirtyPlates = true; };
    dirtyPlates = true;
    const k = place.split(':')[0];
    if (!['desk', 'lead', 'bdesk', 'reception'].includes(k)) log(a, '→ ' + placeName(a, place) + (a.s.state === 'working' && a.s.activity ? ' · ' + (ICON[a.s.activity.kind] || '') + ' ' + api.actText(a.s.activity) : ''));
  }
  // where an agent is, in words
  function placeName(a, place) {
    const [k, i] = (place || '').split(':');
    if (k === 'secvisit' || k === 'bvisit') { const to = agents.get(place.slice(k.length + 1)); return to ? t('officeAtOf', { x: api.name(to.s) }) : t('officeAtVisit'); }
    if (k === 'visit') { const to = [...agents.values()].find((x) => !x.leader && x.desk === +i); return to ? t('officeAtOf', { x: api.name(to.s) }) : t('officeAtVisit'); }
    return t({ desk: 'officeAtDesk', bdesk: 'officeAtDesk', lead: a.leader ? 'officeAtDesk' : 'officeLead', lib: 'officeLib', web: 'officeBrowser', pantry: 'officePantry', sofa: 'officeLounge', bean: 'officeBreak', bbean: 'officeLounge', visitlead: 'officeLead', reception: 'officeReception' }[k] || 'officeAtDesk');
  }
  const home = (a) => (a.sec ? 'reception' : MODE === 'bldg' ? 'bdesk' : a.leader ? 'lead' : 'desk');
  // a place is held by the one in it, then by the one on its way there (or waiting to go)
  function claims() {
    const taken = new Map();
    for (const a of agents.values()) if (a.place) taken.set(a.place, a);
    for (const a of agents.values()) if (a.want && !taken.has(a.want)) taken.set(a.want, a);
    return taken;
  }
  // straight to where its state calls for, without the walk
  function settle(a) { const w = wanted(a, claims(), Date.now()); if (w !== a.place) put(a, w); a.want = a.place; }
  // the place a session's state calls for; shared places are handed out one each
  function wanted(a, taken, now) {
    const s = a.s, ask = approvals.get(a.name);
    if (ask) return home(a);
    const mine = (id) => !taken.has(id) || taken.get(id) === a;
    const free = (k, n) => { for (let j = 0; j < n; j++) { const id = k + ':' + j; if (mine(id)) return id; } return null; };
    if (a.sec) { const to = secTarget(); return to && mine('secvisit:' + to) ? 'secvisit:' + to : 'reception'; }
    if (MODE === 'bldg') {
      // in its project's room: at its desk, by a teammate's desk with a message, on a bean bag when idle for long or done
      const bean = () => free('bbean:' + (BL.byKey.get(a.room)?.i ?? 0), 2);
      if (s.state === 'working') {
        const to = s.activity?.kind === 'talk' && a.talkTo && agents.get(a.talkTo);
        if (to && to !== a && to.room === a.room && !to.sec) { const id = 'bvisit:' + to.name; return mine(id) ? id : home(a); }
        return home(a);
      }
      if (s.state === 'waiting') {
        if (!a.waitSince) a.waitSince = Math.min(now, s.activityAt || now);
        return now - a.waitSince > 5 * 60000 ? bean() || home(a) : home(a);
      }
      return bean() || home(a);
    }
    if (s.state === 'working') {
      const k = s.activity?.kind;
      if (k === 'read' || k === 'search') return free('lib', LIB.length) || home(a);
      if (k === 'web') return free('web', WEB.length) || home(a);
      if (k === 'talk') {
        // a message: to the desk of the one it is for (the leader's corner for the leader)
        const to = a.talkTo && agents.get(a.talkTo);
        if (to && to !== a) {
          if (to.leader) return free('visitlead', 3) || home(a);
          const id = 'visit:' + to.desk;
          return mine(id) ? id : home(a);
        }
        if (!a.leader && leaderName && agents.has(leaderName)) return free('visitlead', 3) || home(a);
      }
      return home(a);
    }
    if (s.state === 'waiting') {
      if (!a.waitSince) a.waitSince = Math.min(now, s.activityAt || now);
      const waited = now - a.waitSince;
      if (waited > 5 * 60000) return free('sofa', 2) || free('bean', 3) || free('pantry', 2) || home(a);
      if (waited > 60000) return free('pantry', 2) || free('sofa', 2) || home(a);
      return home(a);
    }
    // its session is over: asleep on the sofa, or at its desk when the lounge is full
    return free('sofa', 2) || free('bean', 3) || home(a);
  }
  function modeAt(a) {
    if (a.path.length) return 'walking';
    const k = (a.place || '').split(':')[0], st = approvals.has(a.name) ? 'ask' : a.s.state;
    if (a.sec) return st === 'ask' ? 'ask' : k !== 'reception' ? 'visit' : st === 'working' ? 'typing' : st === 'resting' ? 'doze' : 'idle';
    if (k === 'desk' || k === 'lead' || k === 'bdesk') return st === 'ask' ? 'ask' : st === 'working' ? 'typing' : st === 'waiting' ? 'doze' : 'sleep';
    if (k === 'lib') return 'reading';
    if (k === 'web') return 'web';
    if (k === 'pantry') return 'sip';
    if (k === 'sofa' || k === 'bean' || k === 'bbean') return st === 'resting' ? 'sleep' : 'sofadoze';
    if (k === 'visitlead' || k === 'visit' || k === 'bvisit') return 'visit';
    return 'typing';
  }
  /* ── the assistant (the monitor's secretary): at its desk by the way in (the lobby's, in the building); when it
     works on an agent (a message, a look at its conversation, a nudge, an answer to its request) it goes to that
     agent's desk while it is at it, then back ── */
  const SEC = 'monitor-assistant';
  function secSync() {
    const info = api.assistant?.(); let a = agents.get(SEC);
    if (!info) { if (a) { dropAgent(a); agents.delete(SEC); } return; }
    const s = { name: SEC, nick: 'Assistant', nickKo: t('assistTitle'), short: t('assistTitle'), state: info.state === 'working' ? 'working' : info.exists ? 'waiting' : 'resting' };
    const look = api.look(s, false);
    if (a && a.lookKey !== look.c + look.acc) { dropAgent(a); agents.delete(SEC); a = null; }
    if (!a) { a = newAgent(s, false); a.sec = true; agents.set(SEC, a); put(a, 'reception'); a.want = a.place; }
    a.s = s; a.info = info;
  }
  // the agent it is busy with: while its turn lasts, or a little after the last thing it did about it
  function secTarget() {
    const info = agents.get(SEC)?.info, act = info?.act, now = Date.now();
    if (!act?.agent || act.agent === SEC || !agents.has(act.agent)) return null;
    const age = now - act.at;
    return age < 120000 && (age < 15000 || info.state === 'working') ? act.agent : null;
  }
  const plateClick = (i) => {
    const a = [...agents.values()].find((x) => (i === 'lead' ? x.leader : !x.leader && x.desk === i));
    if (a) select(a); else if (i === newSeat) api.newAgent();
  };
  let newSeat = -1;


  /* ── the building: every project a glass-fronted room off one corridor, the assistant at the lobby's desk; a room
     grows with its crew, a second row of rooms faces the first across the corridor once there are more than four ── */
  const DX = 2.4, DZ = 1.9;
  let BL = { rooms: [], byKey: new Map(), rugs: new Map(), floors: [], CY: 0, sig: '' };
  function bplan(projects) {
    const sized = projects.map((p, i) => { const n = Math.max(1, (p.sessions || []).length), cols = n <= 4 ? 2 : n <= 9 ? 3 : 4; return { p, key: p.key, i, cols, rows: Math.ceil(n / cols), w: cols * DX + 0.45 }; });
    const nA = sized.length > 4 ? Math.ceil(sized.length / 2) : sized.length, A = sized.slice(0, nA), Bq = sized.slice(nA);
    const RA = Math.max(1, ...A.map((r) => r.rows)), RB = Bq.length ? Math.max(1, ...Bq.map((r) => r.rows)) : 0;
    const DA = 3.15 + (RA - 1) * DZ, CW = 1.7, zB = DA + CW, DB = RB ? 3.45 + (RB - 1) * DZ : 0;
    const rooms = []; let x = 0;
    for (const r of A) { rooms.push({ ...r, x0: x, x1: x + r.w, z0: 0, z1: DA, front: 's', aisle: DA - 1.3, beansZ: DA - 0.6 }); x += r.w; }
    const xa = x; x = 0;
    for (const r of Bq) { rooms.push({ ...r, x0: x, x1: x + r.w, z0: zB, z1: zB + DB, front: 'n', aisle: zB + 1.3, beansZ: zB + 0.6 }); x += r.w; }
    for (const r of rooms) { r.doorX = r.x0 + 0.85; r.beans = [[r.x1 - 0.8, r.beansZ], [r.x1 - 1.85, r.beansZ]]; }
    const XE = Math.max(xa, x, 4), LW = 4.9, CY = DA + CW / 2;
    const recX = XE + 1.7;
    return { rooms, byKey: new Map(rooms.map((r) => [r.key, r])), rugs: new Map(), floors: [], CY, DA, zB, XE, W: XE + LW, D: Math.max(zB + DB, DA + CW + 1.6),
      rec: { X: recX, Y: CY - 0.4, seat: [recX + 0.25, CY], top: { x: recX + 0.6, y: CY - 0.55, w: 0.9, d: 1.1 }, mon: [recX + 1.02, CY] }, lobbyDoor: [XE + 0.6, CY],
      sig: rooms.map((r) => r.key + ':' + r.cols + 'x' + r.rows).join('|') };
  }
  function bdeskOf(room, i) {
    const c = i % room.cols, r = Math.floor(i / room.cols), X = room.x0 + 0.75 + c * DX, Y = room.front === 's' ? room.z0 + 0.6 + r * DZ : room.z0 + 1.85 + r * DZ;
    return { X, Y, seat: [X + 0.25, Y + 0.4], top: { x: X + 0.6, y: Y - 0.15, w: 0.9, d: 1.1 }, mon: [X + 1.02, Y + 0.4] };
  }
  function bspot(a, place) {
    const k = place.split(':')[0], arg = place.slice(k.length + 1);
    if (k === 'reception') return { p: BL.rec.seat, via: [BL.lobbyDoor], face: [1, 0], lift: SEAT_H, seat: true, room: 'lobby' };
    if (k === 'bdesk') {
      const room = BL.byKey.get(a.room); if (!room) return { p: a.pos, via: [], face: TO_VIEWER, lift: 0 };
      const d = bdeskOf(room, a.desk); return { p: d.seat, via: [[d.X - 0.4, d.seat[1]], [d.X - 0.4, room.aisle]], face: [1, 0], lift: SEAT_H, seat: true, room: room.key };
    }
    if (k === 'bbean') {
      const [ri, j] = arg.split(':').map(Number), room = BL.rooms.find((r) => r.i === ri); if (!room) return { p: a.pos, via: [], face: TO_VIEWER, lift: 0 };
      const q = room.beans[j]; return { p: [q[0] + 0.05, q[1] + 0.05], via: [[q[0] + 0.05, room.aisle]], face: TO_VIEWER, lift: 0.3, room: room.key };
    }
    if (k === 'bvisit' || k === 'secvisit') {
      const to = agents.get(arg), room = to && BL.byKey.get(to.room); if (!room) return { p: a.pos, via: [], face: TO_VIEWER, lift: 0 };
      const d = bdeskOf(room, to.desk), y = d.Y + 1.25;
      return { p: [d.seat[0] + (k === 'secvisit' ? 0.7 : 0.05), y], via: [[d.X - 0.4, y], [d.X - 0.4, room.aisle]], face: [0, -1], lift: 0, room: room.key };
    }
    return { p: a.pos, via: [], face: TO_VIEWER, lift: 0 };
  }
  // out along its room's aisle to the door, down the corridor, in at the other door
  const doorWay = (key) => { const r = BL.byKey.get(key); return r ? [[r.doorX, r.aisle], [r.doorX, BL.CY]] : []; };
  function bpath(cur, tgt) {
    const out = [...cur.via];
    if (cur.room !== tgt.room) out.push(...doorWay(cur.room), ...doorWay(tgt.room).reverse());
    return [...out, ...[...tgt.via].reverse(), tgt.p];
  }
  function buildBuilding() {
    const W = clearWorld(), keep = (x) => { trash.push(x); return x; };
    const { rooms, CY, DA, XE } = BL, GW = B.w, GD = B.d;
    planks(GW, GD, keep);
    const rug = (x, y, w, d, key, room) => {
      const tx = keep(tex(Math.min(2048, Math.round(w * 90)), Math.min(2048, Math.round(d * 90)), (g, cw, ch) => { g.fillStyle = '#ececec'; g.fillRect(0, 0, cw, ch); g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([2, 9]); g.lineCap = 'round'; rr(g, 16, 16, cw - 32, ch - 32, 14); g.stroke(); }));
      const m = keep(new THREE.MeshPhysicalMaterial({ map: tx, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8 })); m.color.set(C(key)); themed.push([m, key]);
      const r = pbox(W, x, y, 0, w, d, 0.035, m, 0.017, { cast: false });
      if (room) { r.userData.room = room; BL.rugs.set(room, m); BL.floors.push(r); }
    };
    // the corridor and the lobby
    rug(0.15, DA + 0.2, XE - 0.3, CY - DA - 0.2 + 0.65, 'rugMid');
    rug(XE + 0.3, 0.35, GW - XE - 0.6, GD - 0.7, 'rugLead');
    const KEYS = ['rugMeet', 'rugLib', 'rugLounge', 'rugPantry', 'rugMid', 'rugLead'];
    for (const r of rooms) rug(r.x0 + 0.2, r.z0 + 0.2, r.w - 0.4, r.z1 - r.z0 - 0.4, KEYS[r.i % KEYS.length], r.key);
    // the back wall (north) and the side wall (west), a window in each room's
    const T = 0.22, wallR = M('wallR', { roughness: 0.85, clearcoat: 0 }), wallL = M('wallL', { roughness: 0.85, clearcoat: 0 });
    const WZ = [0.85, 2.45], winsY = rooms.filter((r) => r.front === 's').map((r) => { const c = (r.x0 + r.x1) / 2, h = Math.min(1.3, r.w / 2 - 0.9); return [c - h, c + h]; });
    winsY.push([XE + 1.0, GW - 1.0]);
    const winsX = [[0.9, DA - 0.9]], rowB = rooms.filter((r) => r.front === 'n'); if (rowB.length) winsX.push([BL.zB + 1.0, GD - 0.9]);
    const wallRun = (len, wins, zz, put) => { let s = 0; for (const [a, b] of wins) { put(s, a, 0, WALL_H); put(a, b, 0, zz[0]); put(a, b, zz[1], WALL_H); s = b; } put(s, len, 0, WALL_H); };
    const piece = (len, h) => keep(new THREE.BoxGeometry(len, h, T));
    wallRun(GW, winsY, WZ, (a, b, z1, z2) => { if (b - a > 0.001) mesh(W, piece(b - a, z2 - z1), wallR, (a + b) / 2, (z1 + z2) / 2, -T / 2); });
    wallRun(GD, winsX, WZ, (a, b, z1, z2) => { if (b - a > 0.001) { const m = mesh(W, piece(b - a, z2 - z1), wallL, -T / 2, (z1 + z2) / 2, (a + b) / 2); m.rotation.y = Math.PI / 2; } });
    pbox(W, -T, -T, 0, T, T, WALL_H, wallL, 0.005);
    pbox(W, -T - 0.04, -T - 0.04, WALL_H, GW + T + 0.04, T + 0.08, 0.09, M('cap'), 0.03); pbox(W, -T - 0.04, -0.04, WALL_H, T + 0.08, GD + 0.04, 0.09, M('cap'), 0.03);
    const skyBasic = keep(new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false })), frame = M('frame', { roughness: 0.4, clearcoat: 0.4 });
    for (const [a, b] of winsY) { mesh(W, keep(new THREE.PlaneGeometry(b - a, WZ[1] - WZ[0])), skyBasic, (a + b) / 2, (WZ[0] + WZ[1]) / 2, -T + 0.02, { cast: false, recv: false }); pbox(W, a - 0.04, -T - 0.02, WZ[0] - 0.06, b - a + 0.08, T + 0.08, 0.07, frame, 0.025); pbox(W, a - 0.04, -T - 0.02, WZ[1] - 0.01, b - a + 0.08, T + 0.04, 0.07, frame, 0.025); }
    for (const [a, b] of winsX) { const pl = mesh(W, keep(new THREE.PlaneGeometry(b - a, WZ[1] - WZ[0])), skyBasic, -T + 0.02, (WZ[0] + WZ[1]) / 2, (a + b) / 2, { cast: false, recv: false }); pl.rotation.y = Math.PI / 2; pbox(W, -T - 0.02, a - 0.04, WZ[0] - 0.06, T + 0.08, b - a + 0.08, 0.07, frame, 0.025); pbox(W, -T - 0.02, a - 0.04, WZ[1] - 0.01, T + 0.04, b - a + 0.08, 0.07, frame, 0.025); }
    const beamMat = keep(new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: day.beam[0], color: day.beam[1] })); beamMat.userData.beam = 1;
    for (const [a, b] of winsY) { const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute([[a, 0], [b, 0], [b + 1.2, 2.6], [a + 1.2, 2.6]].flatMap(([x, y]) => [x, 0.045, y]), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); g.setIndex([0, 2, 1, 0, 3, 2]); const m = new THREE.Mesh(g, beamMat); m.userData.noAO = 1; W.add(m); }
    // glass between the rooms and on their fronts, a door gap in each front
    const glassMat = keep(new THREE.MeshPhysicalMaterial({ color: C('glass'), roughness: 0.08, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide })); themed.push([glassMat, 'glass']);
    const rail = M('frame', { roughness: 0.4, clearcoat: 0.4 }), GH = 1.9;
    const glassY = (y, x1, x2) => { if (x2 - x1 < 0.05) return; const g = mesh(W, keep(new THREE.PlaneGeometry(x2 - x1, GH)), glassMat, (x1 + x2) / 2, GH / 2, y, { cast: false, recv: false }); g.userData.noAO = 1; pbox(W, x1, y - 0.03, GH - 0.02, x2 - x1, 0.06, 0.06, rail, 0.025); pbox(W, x1, y - 0.03, 0, x2 - x1, 0.06, 0.05, rail, 0.02); [x1, x2].forEach((x) => pbox(W, x - 0.03, y - 0.03, 0, 0.06, 0.06, GH, rail, 0.02)); };
    const glassX = (x, y1, y2) => { const g = mesh(W, keep(new THREE.PlaneGeometry(y2 - y1, GH)), glassMat, x, GH / 2, (y1 + y2) / 2, { cast: false, recv: false }); g.rotation.y = Math.PI / 2; g.userData.noAO = 1; pbox(W, x - 0.03, y1, GH - 0.02, 0.06, y2 - y1, 0.06, rail, 0.025); pbox(W, x - 0.03, y1, 0, 0.06, y2 - y1, 0.05, rail, 0.02); [y1, y2].forEach((y) => pbox(W, x - 0.03, y - 0.03, 0, 0.06, 0.06, GH, rail, 0.02)); };
    for (const r of rooms) {
      const fz = r.front === 's' ? r.z1 : r.z0;
      glassY(fz, r.x0 + 0.05, r.doorX - 0.55); glassY(fz, r.doorX + 0.55, r.x1 - 0.05);
      glassX(r.x1, r.z0, r.z1);
      // desks, bean bags, a plant
      for (let i = 0; i < r.cols * r.rows; i++) {
        const d = bdeskOf(r, i), find = () => [...agents.values()].find((x) => !x.sec && x.room === r.key && x.desk === i);
        desk(W, d, i, find); chairsOf.push({ c: chair(W, d.seat[0], d.seat[1], [1, 0], C('chair')), find });
      }
      r.beans.forEach(([x, y], j) => { const c = ['#ffd7a8', '#cfe0ff', '#cdeedd'][(r.i + j) % 3]; const m = mesh(W, sphG(0.42), M(c, { roughness: 0.95, clearcoat: 0, sheen: 0.7, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff') }), x, 0.26, y); m.scale.set(1, 0.6, 1); const tp = mesh(W, sphG(0.28), m.material, x - 0.06, 0.48, y - 0.06); tp.scale.set(1, 0.55, 1); });
      const py = r.front === 's' ? r.z0 + 0.4 : r.z1 - 0.4; pcyl(W, r.x1 - 0.4, py, 0, 0.17, 0.32, M('pot', { roughness: 0.7 })); mesh(W, sphG(0.24), M('leaf', { roughness: 0.7 }), r.x1 - 0.4, 0.58, py).scale.set(1, 1.15, 1);
      // its name over the room: a click goes in
      const lz = r.front === 's' ? 0.05 : r.z0;
      r.chip = staticChip('wallbtn', [(r.x0 + r.x1) / 2, r.front === 's' ? WALL_H - 0.2 : GH + 0.12, lz], 'bottom', 4, () => api.enter?.(r.key), '');
    }
    // the lobby: the assistant's counter, plants, the way in
    const d = BL.rec;
    desk(W, d, -2, () => agents.get(SEC)); chair(W, d.seat[0], d.seat[1], [1, 0], PALETTE[5][0]);
    const counter = M('desk', { roughness: 0.45, clearcoat: 0.35 });
    pbox(W, d.top.x + d.top.w, d.top.y - 0.25, 0, 0.12, d.top.d + 0.5, 1.0, counter, 0.04); pbox(W, d.top.x - 0.1, d.top.y - 0.25, 0, d.top.w + 0.22, 0.12, 1.0, counter, 0.04); pbox(W, d.top.x - 0.1, d.top.y + d.top.d + 0.13, 0, d.top.w + 0.22, 0.12, 1.0, counter, 0.04);
    pbox(W, d.top.x + d.top.w - 0.05, d.top.y - 0.3, 1.0, 0.24, d.top.d + 0.6, 0.05, M('#f9f7f3', { roughness: 0.3, clearcoat: 0.5 }), 0.02);
    for (const [x, y, k] of [[GW - 0.5, 0.5, 1.1], [XE + 0.5, 0.5, 0.9], [GW - 0.5, GD - 0.6, 1]]) { pcyl(W, x, y, 0, 0.2 * k, 0.38 * k, M('pot', { roughness: 0.7 })); mesh(W, sphG(+(0.3 * k).toFixed(3)), M('leaf', { roughness: 0.7 }), x, 0.72 * k, y).scale.set(1, 1.2, 1); mesh(W, sphG(+(0.2 * k).toFixed(3)), M('leafD', { roughness: 0.7 }), x + 0.08, 1.0 * k, y - 0.05); }
    staticChip('zone', [d.seat[0] + 0.5, 0, d.top.y + d.top.d + 0.75], 'center-hide', 5, null, t('officeReception'));
    fitCamera(); dirtyPlates = true;
  }
  // the page hands in every project on every poll, for the building
  function building(data) {
    const fresh = MODE !== 'bldg';
    if (fresh) { MODE = 'bldg'; back.hidden = true; project = null; selected = null; sideKey = ''; feedBox.innerHTML = `<div class="none">${esc(t('officeFeedNone'))}</div>`; for (const a of agents.values()) dropAgent(a); agents.clear(); seats.clear(); BL.sig = ''; }
    approvals = new Map(); for (const x of data?.approvals || []) if (x.session && !approvals.has(x.session)) approvals.set(x.session, x);
    const projects = data?.projects || [], all = projects.flatMap((p) => (p.sessions || []).map((s) => [p, s])), names = new Set(all.map(([, s]) => s.name));
    el.querySelector('.oname').innerHTML = `${esc(t('officeBuilding'))}<small>${esc(t('officeRooms', { n: projects.length }))}${esc(t('officeAgents', { n: all.length }))}</small>`;
    for (const [n, a] of agents) if (n !== SEC && !names.has(n)) { log(a, t('officeLogLeave')); dropAgent(a); agents.delete(n); seats.delete(n); }
    const plan = bplan(projects), rebuild = plan.sig !== BL.sig;
    if (rebuild) { const rugs = BL.rugs; BL = plan; B.w = plan.W; B.d = plan.D; rugs.clear(); hoverRoom = null; }
    else for (const r of plan.rooms) { const o = BL.byKey.get(r.key); if (o) o.p = r.p; }
    // desks: each keeps the one it had in its room
    for (const r of BL.rooms) {
      const ss = r.p.sessions || [], cap = r.cols * r.rows, used = new Set();
      for (const s of ss) { const d = seats.get(s.name); if (d != null && d < cap && !used.has(d)) used.add(d); else seats.delete(s.name); }
      for (const s of ss) if (!seats.has(s.name)) { let d = 0; while (used.has(d)) d++; seats.set(s.name, d); used.add(d); }
    }
    if (rebuild) buildBuilding();
    for (const [p, s] of all) {
      let a = agents.get(s.name);
      const leader = !!s.isLeader, look = api.look(s, leader);
      if (a && (a.leader !== leader || a.lookKey !== look.c + look.acc)) { dropAgent(a); agents.delete(s.name); a = null; }
      const born = !a;
      if (!a) { a = newAgent(s, leader); agents.set(s.name, a); a.room = p.key; a.desk = seats.get(s.name); put(a, home(a)); a.want = a.place; a.vis = fresh ? 1 : 0; }
      a.s = s; a.room = p.key; a.desk = seats.get(s.name);
      if (s.state !== 'waiting') a.waitSince = 0;
      a.talkTo = null;
      if (s.activity?.kind === 'talk') a.talkTo = (p.messages || []).find((m) => m.from === s.name && m.at >= (s.activityAt || 0) - 120000)?.to || null;
      if (born && !rebuild) settle(a);
      track(a, s, fresh, born);
    }
    secSync();
    if (rebuild) { for (const a of agents.values()) { a.path = []; a.arrive = null; put(a, home(a)); a.want = a.place; } for (const a of agents.values()) settle(a); }
    // each room's name with how its crew is doing
    for (const r of BL.rooms) {
      const c = r.p.counts || {}, bits = [c.working ? '▶' + c.working : '', c.waiting ? '○' + c.waiting : '', approvals.size && (r.p.sessions || []).some((x) => approvals.has(x.name)) ? '❗' : ''].filter(Boolean).join(' ');
      const text = api.projName(r.p) + (bits ? '  ' + bits : '');
      if (r.chip && r.chip.el.textContent !== text) { r.chip.el.textContent = text; r.chip.el.title = t('officeEnter'); }
    }
    dirtyPlates = true;
  }
  /* ── the side panel: the agent picked, what just happened, where each kind of work is done ── */
  let selected = null, sideKey = '';
  function select(a) { selected = a.name; sideKey = ''; sideCard(); }
  async function answer(a, ask, how) {
    const ok = await api.decide(ask, how).catch(() => false);
    log(a, ok ? (how === 'allow' ? '✓ ' + t('didAllow').replace(/^✓\s*/, '') : '✕ ' + t('didDeny').replace(/^✕\s*/, '')) : t('failed'));
    sideKey = '';
  }
  const hhmmss = (d) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
  function log(a, text) {
    feedBox.querySelector('.none')?.remove();
    const d = document.createElement('div');
    d.innerHTML = `<time>${hhmmss(new Date())}</time><b>${esc(api.name(a.s))}</b> ${esc(text)}`;
    d.title = d.textContent;
    // only the new line slides in: the page puts the office back on every poll, which would start every line's animation again
    d.className = 'in'; d.addEventListener('animationend', () => d.classList.remove('in'), { once: true });
    feedBox.prepend(d);
    while (feedBox.children.length > 40) feedBox.lastChild.remove();
  }
  function stateOf(a) { return approvals.has(a.name) ? 'asking' : a.s.state; }
  function sideCard() {
    let a = selected && agents.get(selected);
    if (!a) {
      const all = [...agents.values()].filter((x) => !x.sec);
      a = all.find((x) => approvals.has(x.name)) || all.find((x) => x.s.state === 'working' && !x.leader) || all.find((x) => x.leader) || all[0];
    }
    if (!a) { if (sideKey !== '-') { sideKey = '-'; selBox.innerHTML = `<h4>${esc(t('officeSelected'))}</h4><div class="ocard"><div class="role">${esc(t('officePickHint'))}</div></div>`; } return; }
    const s = a.s, ask = approvals.get(a.name), st = stateOf(a);
    const badge = { asking: ['b-ask', '❗ ' + t('asking')], working: ['b-run', '▶ ' + t('working')], waiting: ['b-wait', '○ ' + t('waiting')] }[st] || ['b-rest', '– ' + t('resting')];
    const now = ask ? String(ask.what || ask.code || ask.tool || '').split('\n')[0] : s.state === 'working' && s.activity ? (ICON[s.activity.kind] || '•') + ' ' + api.actText(s.activity) : '—';
    const where = a.path.length ? t('officeWalking') : placeName(a, a.place);
    const ctx = s.context ? Math.min(100, Math.round(s.context / (s.ctxWindow || 1e6) * 100)) : 0;
    const key = JSON.stringify([a.name, st, ask?.id, now, where, ctx, s.today?.total, Math.floor(Date.now() / 30000), api.name(s), s.desc]);
    if (key === sideKey) return;
    sideKey = key;
    const tool = ask && !ask.questions && !ask.plan;
    const rows = [[t('dNow'), now, !!ask], [t('officeWhere'), where]];
    if (s.model) rows.push([t('modelLabel'), s.model, true]);
    if (s.startedAt) rows.push([t('dUp'), api.dur(s.startedAt)]);
    if (s.today?.total) rows.push([t('dToday'), api.tokens(s.today.total)]);
    selBox.innerHTML = `<h4>${esc(t('officeSelected'))}</h4><div class="ocard${ask ? ' asking' : ''}">
      <div class="who"><div class="av"></div><div><div class="nm">${esc(api.name(s))}</div>${s.desc ? `<div class="role">${esc(s.desc)}</div>` : a.leader ? `<div class="role">${esc(t('leader'))}</div>` : ''}<span class="badge ${badge[0]}">${esc(badge[1])}</span></div></div>
      <dl>${rows.map(([k, v, m]) => `<dt>${esc(k)}</dt><dd${m ? ' class="m"' : ''} title="${esc(v)}">${esc(v)}</dd>`).join('')}${ctx ? `<dt>${esc(t('officeCtx'))}</dt><dd>${ctx}%<div class="meter"><b style="width:${ctx}%"></b></div></dd>` : ''}</dl>
      <div class="acts">${tool ? `<button type="button" class="yes" data-a="allow">${esc(t('allow'))}</button><button type="button" data-a="deny">${esc(t('deny'))}</button>` : ask ? `<button type="button" class="yes" data-a="open">${esc(t('answer'))}</button>` : ''}<button type="button" data-a="conv">${esc(t('tabConv'))}</button></div></div>`;
    selBox.querySelector('.av').append(api.robot(s, st));
    selBox.querySelector('.who').addEventListener('click', () => api.open(s));
    for (const b of selBox.querySelectorAll('button[data-a]')) b.addEventListener('click', () => {
      const how = b.dataset.a;
      if (how === 'conv') api.open(s, true, 'conv');
      else if (how === 'open') api.open(s);
      else if (ask) { for (const x of selBox.querySelectorAll('.acts button')) x.disabled = true; answer(a, ask, how); }
    });
  }

  // the page hands in the project on every poll
  function update(p, data) {
    const fresh = MODE !== 'room' || !project || project.key !== p.key;
    if (MODE !== 'room') { MODE = 'room'; L.rows = 0; }
    back.hidden = !api.leave;
    project = p;
    el.querySelector('.oname').innerHTML = `${esc(api.projName(p))}<small>${esc(t('officeAgents', { n: (p.sessions || []).length }))}</small>`;
    if (fresh) { selected = null; sideKey = ''; feedBox.innerHTML = `<div class="none">${esc(t('officeFeedNone'))}</div>`; }
    approvals = new Map(); for (const x of data?.approvals || []) if (x.session && !approvals.has(x.session)) approvals.set(x.session, x);
    const sessions = p.sessions || [], names = new Set(sessions.map((s) => s.name));
    if (fresh) { for (const a of agents.values()) dropAgent(a); agents.clear(); seats.clear(); }
    for (const [n, a] of agents) if (n !== SEC && !names.has(n)) { log(a, t('officeLogLeave')); dropAgent(a); agents.delete(n); seats.delete(n); }
    const lead = sessions.find((s) => s.isLeader); leaderName = lead ? lead.name : null;
    const crew = sessions.filter((s) => !s.isLeader);
    // desks: each keeps the one it had; rows grow so that one desk stays free for a new agent
    const rows = Math.max(2, Math.ceil((crew.length + 1) / PER_ROW));
    const rebuild = rows !== L.rows;
    if (rebuild) { layout(rows); }
    const used = new Set(); for (const s of crew) { const d = seats.get(s.name); if (d != null && d < rows * PER_ROW && !used.has(d)) used.add(d); else seats.delete(s.name); }
    for (const s of crew) if (!seats.has(s.name)) { let d = 0; while (used.has(d)) d++; seats.set(s.name, d); used.add(d); }
    newSeat = 0; while (used.has(newSeat)) newSeat++;
    if (rebuild) buildRoom();
    for (const s of sessions) {
      let a = agents.get(s.name);
      const leader = !!s.isLeader, look = api.look(s, leader);
      if (a && (a.leader !== leader || a.lookKey !== look.c + look.acc)) { dropAgent(a); agents.delete(s.name); a = null; }
      const born = !a;
      if (!a) { a = newAgent(s, leader); agents.set(s.name, a); a.desk = seats.get(s.name); put(a, home(a)); a.want = a.place; a.vis = fresh ? 1 : 0; }
      a.s = s; a.desk = leader ? -1 : seats.get(s.name);
      if (s.state !== 'waiting') a.waitSince = 0;
      // a message: who it went to (the newest one it sent since this started)
      a.talkTo = null;
      if (s.activity?.kind === 'talk') a.talkTo = (p.messages || []).find((m) => m.from === s.name && m.at >= (s.activityAt || 0) - 120000)?.to || null;
      if (born && !rebuild) settle(a);
      track(a, s, fresh, born);
    }
    if (rebuild) { for (const a of agents.values()) { a.path = []; a.arrive = null; put(a, home(a)); a.want = a.place; } for (const a of agents.values()) settle(a); }
    secSync();
    dirtyPlates = true;
  }
  // what changed for an agent since the last poll, in the feed
  function track(a, s, fresh, born) {
      const ask = approvals.get(s.name), subs = (s.subagents || []).filter((x) => x.running).length;
      const now = { state: s.state, ask: ask?.id || '', subs };
      if (born && !fresh && !a.prev) log(a, t('officeLogJoin'));
      const was = a.prev;
      if (was && !fresh) {
        if (now.ask && now.ask !== was.ask) log(a, '❗ ' + t('officeLogAsk', { x: ask.questions ? t('questionKind') : ask.plan ? t('planKind') : String(ask.tool || '') }));
        if (now.state !== was.state) {
          if (now.state === 'waiting') log(a, '💤 ' + t('officeLogWait'));
          else if (now.state === 'resting') log(a, '🛋 ' + t('officeLogRest'));
          else if (now.state === 'working') log(a, '▶ ' + (s.activity ? api.actText(s.activity) : t('working')));
        }
        if (subs > was.subs) log(a, '🤖 ' + t('officeLogSubs', { n: subs - was.subs }));
        else if (!subs && was.subs) log(a, '🤖 ' + t('officeLogSubsDone'));
      }
      a.prev = now;
  }

  /* ── posing, each frame ── */
  function pose(a, m, t, dt) {
    const r = a.r, T = t + a.phase, k = Math.min(1, dt * 10);
    let face = FACE[m]; if (face === 'working' && (T % 4.3) < 0.13) face = 'blink';
    r.faceMat.map = FACES[face];
    const toward = m === 'ask' ? angOf(TO_VIEWER) : m === 'doze' ? angOf([1, 0.5]) : a.angTo;
    let d = toward - a.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); a.ang += d * Math.min(1, dt * (m === 'walking' ? 12 : 5));
    let y = 0, rz = 0, sy = 1, hx = 0, hy = 0, aL = 0, aR = 0, aLz = 0, aRz = 0;
    switch (m) {
      case 'walking': { const s = T * 11; y = Math.abs(Math.sin(s)) * 0.06; rz = Math.sin(s) * 0.07; aL = Math.sin(s) * 0.7; aR = -aL; break; }
      case 'typing': y = Math.sin(T * 3.4) * 0.01; aL = -1.05 + Math.sin(T * 15) * 0.18; aR = -1.05 - Math.sin(T * 15) * 0.18; hx = 0.12 + Math.sin(T * 1.3) * 0.03; break;
      case 'reading': aL = aR = -1.15; aLz = 0.25; aRz = -0.25; hx = 0.32 + Math.sin(T * 1.7) * 0.05; hy = Math.sin(T * 0.7) * 0.12; y = Math.sin(T * 2) * 0.008; break;
      case 'web': hx = -0.12; hy = Math.sin(T * 0.6) * 0.18; y = Math.sin(T * 2.2) * 0.012; aL = -0.15; aR = Math.sin(T * 0.9) > 0.6 ? -1.4 : -0.15; break;
      case 'sip': { const up = (T % 4.5) > 3.1 && (T % 4.5) < 4.1; aR = up ? -2.0 : -0.75; hx = up ? -0.12 : 0.05; y = Math.sin(T * 2.2) * 0.01; break; }
      case 'visit': y = Math.sin(T * 2.6) * 0.012; hx = Math.sin(T * 7) * 0.05; aR = -0.6 + Math.sin(T * 4) * 0.35; aL = -0.1; break;
      case 'doze': case 'sofadoze': sy = 1 + Math.sin(T * 1.7) * 0.025; hx = 0.32 + Math.sin(T * 0.85) * 0.08; hy = m === 'sofadoze' ? 0.25 : 0; rz = m === 'sofadoze' ? 0.12 : 0; break;
      case 'sleep': sy = 1 + Math.sin(T * 1.2) * 0.02; hx = 0.42; rz = 0.2; break;
      case 'idle': y = Math.sin(T * 2) * 0.008; hx = 0.04; hy = Math.sin(T * 0.45) * 0.3; aL = aR = -0.4; break;
      case 'ask': { const ph = (T * 0.9) % 1; y = ph < 0.3 ? Math.sin(ph / 0.3 * Math.PI) * 0.11 : 0; aL = -2.75 + Math.sin(T * 8) * 0.18; aLz = -0.25; aR = -0.1; break; }
    }
    r.rig.position.y = lerp(r.rig.position.y, y, m === 'walking' || m === 'ask' ? 1 : k);
    r.rig.rotation.z = lerp(r.rig.rotation.z, rz, k); r.rig.scale.y = lerp(r.rig.scale.y, sy, k);
    r.head.rotation.x = lerp(r.head.rotation.x, hx, k); r.head.rotation.y = lerp(r.head.rotation.y, hy, k);
    r.armL.rotation.x = lerp(r.armL.rotation.x, aL, k * 1.5); r.armR.rotation.x = lerp(r.armR.rotation.x, aR, k * 1.5);
    r.armL.rotation.z = lerp(r.armL.rotation.z, aLz, k); r.armR.rotation.z = lerp(r.armR.rotation.z, aRz, k);
    r.book.visible = m === 'reading'; r.page.rotation.z = (T % 2.4) > 2.0 ? -Math.sin(((T % 2.4) - 2.0) / 0.4 * Math.PI) * 2.8 : 0;
    r.mug.visible = m === 'sip'; r.mug.rotation.x = -r.armR.rotation.x;
    const zzOn = m === 'doze' || m === 'sofadoze' || m === 'sleep';
    r.zs.forEach((s, i) => { s.visible = zzOn; if (!zzOn) return; const p = ((T / 3) + i * 0.5) % 1; s.position.set(0.28 + p * 0.22, 0.8 + p * 0.4, 0); s.material.opacity = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8; s.scale.setScalar((0.13 + p * 0.1) * (i ? 0.8 : 1)); });
    r.alert.visible = m === 'ask'; if (m === 'ask') { r.alert.position.set(-0.38, 0.95, 0); r.alert.scale.setScalar(0.22 * (1 + 0.15 * Math.max(0, Math.sin(T * 6)))); }
    const st = a.s?.state; r.bulbs.forEach((b) => { b.material.emissiveIntensity = st === 'working' ? 0.35 + 0.3 * Math.sin(T * 5.5) : 0.1; });
    const grey = st === 'resting' ? 0.75 : 0; r.mb.color.copy(r.base[0]).lerp(GREY, grey); r.md.color.copy(r.base[1]).lerp(GREY, grey);
    const hot = hovered && hovered.split('#')[0] === a.name ? 0.18 : 0; r.mb.emissive.set('#3a63d8').multiplyScalar(hot); r.md.emissive.set('#3a63d8').multiplyScalar(hot);
  }
  // a working agent's running subagents: small ones by its desk
  function minis(a, t, dt) {
    const n = a.place && (a.place === 'desk' || a.place === 'lead') && !a.path.length ? Math.min(3, (a.s.subagents || []).filter((x) => x.running).length) : 0;
    while (a.minis.length < n) { const i = a.minis.length, r = makeRobot(a.name + '#' + i, a.look); a.minis.push({ r, vis: 0, phase: Math.random() * 10 }); }
    a.minis.forEach((m, i) => {
      const on = i < n; m.vis += ((on ? 1 : 0) - m.vis) * Math.min(1, dt * 6);
      const d = a.leader ? { x: LEAD.top.x + LEAD.top.w + 0.0, y: LEAD.top.y } : (() => { const q = deskOf(a.desk); return { x: q.top.x + q.top.w + 0.28, y: q.Y + 0.0 }; })();
      const x = d.x - (a.leader ? 0.45 : 0), y = d.y + 0.05 + i * 0.5;
      const R = m.r.root; R.position.set(x, 0, y); R.rotation.y = angOf([-0.6, i % 2 ? -0.4 : 0.4]); R.scale.setScalar(0.62 * Math.max(0.001, m.vis)); R.visible = m.vis > 0.02;
      const T = t + m.phase; m.r.rig.position.y = Math.abs(Math.sin(T * 6)) * 0.03; m.r.armL.rotation.x = -1 + Math.sin(T * 14) * 0.2; m.r.armR.rotation.x = -1 - Math.sin(T * 14) * 0.2;
      m.r.faceMat.map = (T % 3.7) < 0.12 ? FACES.blink : FACES.working;
    });
    while (a.minis.length > n && a.minis.at(-1).vis < 0.02) a.minis.pop().r.dispose();
  }

  /* ── the labels ── */
  const PAD = 6;
  function chipFor(a, m) {
    const s = a.s, ask = approvals.get(a.name), nm = esc(api.name(s));
    if (a.sec && !ask) {
      const to = secTarget() && agents.get(secTarget()), act = a.info?.act;
      if (to && (m === 'walking' || m === 'visit')) return ['act', `<b>${nm}</b>→ ${esc(api.name(to.s))}${act?.label ? ' · ' + esc(act.label) : ''}`];
      if (s.state === 'working') return ['act', `<b>${nm}</b>✎ ${esc(act && Date.now() - act.at < 60000 && act.label ? act.label : t('working'))}`];
      return m === 'walking' ? ['act dim', `<b>${nm}</b>🚶`] : ['act hide', ''];
    }
    if (ask) {
      const kind = ask.questions ? t('questionKind') : ask.plan ? t('planKind') : t('askTitle');
      const what = String(ask.what || ask.code || ask.tool || '').split('\n')[0];
      const tool = !ask.questions && !ask.plan;
      return ['askb', `<div class="h"><span class="tag">${esc(kind)}</span>${nm}${ask.tool ? ' · ' + esc(ask.tool) : ''}</div>${what ? `<code>${esc(what)}</code>` : ''}${tool ? `<div class="b"><button type="button" class="yes" data-a="allow">${esc(t('allow'))}</button><button type="button" data-a="deny">${esc(t('deny'))}</button></div>` : `<div class="go">${esc(t('officeAnswer'))}</div>`}`];
    }
    if (s.state === 'working' && s.activity) return ['act', `<b>${nm}</b>${ICON[s.activity.kind] || '•'} ${esc(api.actText(s.activity))}`];
    if (s.state === 'working') return ['act', `<b>${nm}</b>${esc(t('working'))}`];
    if (s.state === 'waiting' && m !== 'walking') return ['act dim', `<b>${nm}</b>💤 ${esc(t('waiting'))}`];
    if (m === 'walking') return ['act dim', `<b>${nm}</b>🚶`];
    return ['act hide', ''];
  }
  function plates() {
    const where = { lib: t('officeLib'), web: t('officeBrowser'), pantry: t('officePantry'), sofa: t('officeLounge'), bean: t('officeLounge'), visitlead: t('officeLead'), visit: t('officeAwayVisit') };
    const dot = (st) => ({ working: 'var(--run)', waiting: 'var(--wait)' })[st] || 'var(--faint)';
    for (const [i, p] of plateOf) {
      const a = [...agents.values()].find((x) => (i === 'lead' ? x.leader : !x.leader && x.desk === i));
      let cls = 'plate', html;
      if (a) {
        const k = (a.place || '').split(':')[0], away = a.path.length ? ' · ' + t('officeWalking') : (k !== 'desk' && k !== 'lead' && where[k]) ? ' · ' + where[k] : '';
        html = `<i style="background:${dot(a.s.state)}"></i>${esc(api.name(a.s))}<span class="away">${a.leader ? ' · ' + esc(t('officeLeadShort')) : ''}${esc(away)}</span>`;
      } else if (i === newSeat) { cls = 'plate new'; html = '+ ' + esc(t('officeNewSeat')); }
      else if (i === 'lead') { cls = 'plate hide'; html = ''; }
      else { cls = 'plate empty'; html = esc(t('officeEmpty')); }
      if (p.html !== cls + html) { p.html = cls + html; p.el.className = cls; p.el.innerHTML = html; }
    }
  }
  function screens() {
    const RUN = new THREE.Color('#5b83ff'), WAIT = new THREE.Color('#f0b429'), OFF = new THREE.Color('#1f232c'), LED = new THREE.Color('#59606e');
    for (const sc of deskScreens) {
      const a = sc.find?.();
      const here = a && a.place === home(a) && !a.path.length;
      const ask = a && approvals.has(a.name), on = here && (a.s.state === 'working' || ask), col = ask ? WAIT : RUN;
      sc.scrMat.color.copy(on ? col : OFF).multiplyScalar(on ? 1 + 0.25 * day.n : 1);
      sc.glowMat.color.copy(col); sc.glowMat.opacity = on ? 0.35 + 0.2 * day.n : 0;
      sc.ledMat.color.copy(on ? col : LED);
      sc.mugMat.color.set(a ? PALETTE[a.look.c][0] : '#e6e2da');
    }
    for (const { c, find } of chairsOf) { const a = find(); c.userData.mat?.color.set(a ? PALETTE[a.look.c][0] : C('chair')); }
  }
  function hudRects() { const w = stage.getBoundingClientRect(); return [...stage.querySelectorAll('.ohud,.oslot>*,.ohint')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left - w.left, t: r.top - w.top, w: r.width, h: r.height }; }); }
  function layoutChips() {
    const items = [];
    const add = (e, ax, ay, anchor, prio, mode) => {
      if (e.classList.contains('hide')) return;
      const key = e.innerHTML + e.className;
      if (e._key !== key) { e._key = key; e.style.transform = 'translate(-9999px,0)'; e._w = e.offsetWidth; e._h = e.offsetHeight; }
      items.push({ e, ax, ay, anchor, prio, mode, w: e._w, h: e._h });
    };
    for (const a of agents.values()) {
      if (a.chip.classList.contains('hide') || a.vis < 0.5) continue;
      const top = a.lift + (0.86 + (a.look.acc === 'crown' || a.look.acc === 'twin' ? 0.08 : 0)) * a.size;
      const [sx, sy] = toScreen(a.pos[0], top + 0.06, a.pos[1]);
      const ask = a.chip.className === 'askb';
      add(a.chip, sx, sy - (ask ? 12 : 2), ask ? 'askb' : 'bottom', ask ? 0 : 2, 'up');
    }
    for (const s of statics) { const [sx, sy] = toScreen(...s.at); add(s.el, sx, sy, s.anchor, s.prio, s.anchor === 'top' ? 'down' : s.anchor === 'center-hide' ? 'hide' : 'up'); }
    items.sort((p, q) => p.prio - q.prio);
    const placed = hudRects(), hit = (l, tp, w, h) => placed.find((p) => l < p.l + p.w + 3 && l + w + 3 > p.l && tp < p.t + p.h + 2 && tp + h + 2 > p.t);
    const clampL = (l, w) => Math.max(PAD, Math.min(VW - w - PAD, l)), clampT = (tp, h) => Math.max(PAD, Math.min(VH - h - PAD, tp));
    for (const it of items) {
      let l = it.anchor === 'askb' ? it.ax - it.w * 0.2 : it.ax - it.w / 2;
      let tp = it.anchor === 'top' ? it.ay : it.anchor.startsWith('center') ? it.ay - it.h / 2 : it.ay - it.h;
      l = clampL(l, it.w); tp = clampT(tp, it.h);
      if (it.mode !== 'hide') for (let n = 0; n < 14; n++) {
        const o = hit(l, tp, it.w, it.h); if (!o) break;
        // slide up over it (down for the name plates); sideways when the edge stops it
        const nt = it.mode === 'down' ? o.t + o.h + 3 : o.t - it.h - 3;
        if (nt < PAD || nt > VH - it.h - PAD) l = clampL(it.ax < o.l + o.w / 2 ? o.l - it.w - 4 : o.l + o.w + 4, it.w); else tp = nt;
      }
      // a label with nowhere to go, or whose place is out of view, steps aside instead of covering something
      const off = it.ax < -20 || it.ax > VW + 20 || it.ay < -20 || it.ay > VH + 40;
      const stuck = (it.prio >= 3 || it.mode === 'hide') && !!hit(l, tp, it.w, it.h);
      it.e.style.opacity = off || stuck ? 0 : 1; it.e.style.pointerEvents = off || stuck ? 'none' : '';
      it.e.style.transform = `translate(${Math.round(l)}px,${Math.round(tp)}px)`;
      if (off || stuck) continue;
      placed.push({ l, t: tp, w: it.w, h: it.h });
      it.e.style.setProperty('--ax', Math.max(12, Math.min(it.w - 12, it.ax - l)) + 'px');
    }
  }

  /* ── the time of day ── */
  // the sun comes in low from the front left in the morning, high at noon, low from the right at the sunset; the moon stays put
  function sunAt() {
    const up = Math.min(1, Math.max(-1, (day.h - 12.5) / 6.5)), t = day.n > 0.7 ? 0.35 : up;
    sun.position.set(B.w / 2 + 8 + 6 * t, 16 - 7 * Math.abs(t), B.d / 2 + 11 - 5 * t); sun.target.position.set(B.w / 2, 0, B.d / 2);
  }
  function shadowFit() {
    const half = Math.max(15, Math.max(B.w, B.d) / 2 + 7.5);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 70 + Math.max(B.w, B.d) }); sun.shadow.camera.updateProjectionMatrix();
  }
  function applyTheme() {
    day = dayAt(hourNow()); theme = day.n > 0.5 ? 'dark' : 'light';
    for (const [m, key] of themed) m.color.set(C(key));
    hemi.intensity = day.hemi[0]; hemi.color.set(day.hemi[1]); hemi.groundColor.set(day.hemi[2]); sun.intensity = day.sun[0]; sun.color.set(day.sun[1]); scene.environmentIntensity = day.env;
    sunAt();
    scene.traverse((o) => { if (o.material?.userData?.beam) { o.material.opacity = day.beam[0]; o.material.color.set(day.beam[1]); } });
    skyDraw(skyTex.image.getContext('2d'), 512, 256); skyTex.needsUpdate = true;
    bgDraw(bgTex.image.getContext('2d'), 512, 512); bgTex.needsUpdate = true;
  }
  setInterval(() => { if (el.isConnected && !document.hidden) applyTheme(); }, 60000);

  /* ── the frame: only while the office is on the page and shown ── */
  let last = performance.now(), running = false, lastPlates = 0;
  function frame(now) {
    if (!el.isConnected || document.hidden) { running = false; return; }
    const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
    // where each one wants to be; a move waits a moment, so a quick look at a file does not send it across the room
    const taken = claims();
    for (const a of agents.values()) {
      const w = wanted(a, taken, Date.now());
      if (w !== a.want) { if (taken.get(a.want) === a && a.want !== a.place) taken.delete(a.want); a.want = w; a.wantSince = now; taken.set(w, a); }
      const urgent = approvals.has(a.name) || a.sec;
      if (a.want !== a.place && !a.path.length && (urgent || (now - a.wantSince > 2500 && now - a.arrivedAt > 3500))) { if (taken.get(a.place) === a) taken.delete(a.place); go(a, a.want); }
      if (a.path.length) {
        const [tx, ty] = a.path[0], dx = tx - a.pos[0], dy = ty - a.pos[1], d = Math.hypot(dx, dy), step = SPEED * dt;
        if (d > 0.001) a.angTo = Math.atan2(dx, dy);
        if (d <= step) { a.pos = [tx, ty]; a.path.shift(); if (!a.path.length && a.arrive) { const f = a.arrive; a.arrive = null; f(); } }
        else a.pos = [a.pos[0] + dx / d * step, a.pos[1] + dy / d * step];
      }
      a.lift += (a.liftTo - a.lift) * Math.min(1, dt * 9);
      a.vis += (1 - a.vis) * Math.min(1, dt * 6);
      const R = a.r.root; R.position.set(a.pos[0], a.lift, a.pos[1]); R.rotation.y = a.ang; R.scale.setScalar(a.size * Math.max(0.001, a.vis));
      const m = modeAt(a); a.mode = m;
      pose(a, m, t, dt); minis(a, t, dt);
      const [cls, html] = chipFor(a, m);
      if (a.chipKey !== cls + html) { a.chipKey = cls + html; a.chip.className = cls; a.chip.innerHTML = html; }
    }
    const sel = (hovered && agents.get(hovered.split('#')[0])) || (selected && agents.get(selected));
    ring.visible = !!sel; if (sel) { ring.position.set(sel.pos[0], 0.05, sel.pos[1]); ring.scale.setScalar(sel.size * (1 + 0.06 * Math.sin(t * 4))); ring.material.opacity = 0.55 + 0.25 * Math.sin(t * 4); }
    if (dirtyPlates || now - lastPlates > 500) { dirtyPlates = false; lastPlates = now; secSync(); plates(); screens(); sideCard(); }
    composer.render(dt);
    layoutChips();
    requestAnimationFrame(frame);
  }
  // the page puts the office back in after this is called, so the first frame looks again
  function wake() { if (running) return; running = true; last = performance.now(); requestAnimationFrame((now) => { if (el.isConnected) resize(); frame(now); }); }
  document.addEventListener('visibilitychange', wake);

  applyTheme();
  return {
    el,
    slot,   // the page's own buttons, at the top right of the room
    update(p, data) { if (p) update(p, data); else building(data); wake(); },   // no project: the building
    wake,
  };
}
