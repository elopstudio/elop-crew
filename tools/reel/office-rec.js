// Records office.html (served by yt-demo.js) to an MP4: the office on YouTube — 1920×1080, or with --short the vertical
// short at 1080×1920 — 30 fps, H.264. The page is zoomed to 1.25, so the stage is laid out at 1536×864 CSS pixels (864×1536)
// and the 3D office renders at the video's own size (its pixel ratio 1.25). Frames come from Electron's offscreen rendering and go straight to ffmpeg.
//   npm run record:office                    →  out/office.mp4, a still every 3 s in out/office-stills/
//   npm run record:office -- --short         →  out/office-short.mp4, out/office-short-stills/
//   npm run record:office -- --from=3 --len=20 --stills-only   (start at scene 3, 20 s, stills only: for checking)
const { app, BrowserWindow, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const SCALE = 1.25;
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(__dirname, 'out', 'office-profile'));
nativeTheme.themeSource = 'dark';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SHORT = process.argv.includes('--short'), NAME = SHORT ? 'office-short' : 'office';
const { PORT } = require('./yt-demo.js');

const OUT = path.join(__dirname, 'out', NAME + '.mp4'), STILLS = path.join(__dirname, 'out', NAME + '-stills');
const W = SHORT ? 1080 : 1920, H = SHORT ? 1920 : 1080;
const FPS = 30, FROM = Number(arg('from', 0)), ONLY = process.argv.includes('--stills-only'), EVERY = Number(arg('every', 3));
const FFMPEG = require('ffmpeg-static');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  for (const f of fs.existsSync(STILLS) ? fs.readdirSync(STILLS) : []) fs.rmSync(path.join(STILLS, f));
  fs.mkdirSync(STILLS, { recursive: true });
  const w = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  w.setContentSize(W, H);   // taller than the screen for the short: only possible after the window exists
  w.webContents.setFrameRate(FPS);
  let latest = null;
  w.webContents.on('paint', (_e, _dirty, image) => { latest = image; });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || String(e.message).startsWith('[stage]')) console.log('page:', e.message); });
  await w.loadURL(`http://127.0.0.1:${PORT}/office.html${SHORT ? '?short=1' : ''}`);
  w.webContents.setZoomFactor(SCALE);
  await w.webContents.executeJavaScript('stageReady()');
  await wait(2500);
  const LENGTH = Number(arg('len', 0)) || await w.webContents.executeJavaScript(`stageLength(${FROM})`);
  console.log('frame', latest && latest.getSize(), 'length', LENGTH);

  let ff = null, ffErr = '', done = Promise.resolve(0);
  if (!ONLY) {
    ff = spawn(FFMPEG, ['-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', W + 'x' + H, '-r', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (d) => { ffErr = (ffErr + d).slice(-3000); });
    done = new Promise((r) => ff.on('exit', r));
  }
  const bitmap = () => { let img = latest; const s = img.getSize(); if (s.width !== W || s.height !== H) img = img.resize({ width: W, height: H, quality: 'best' }); return img.toBitmap(); };
  w.webContents.executeJavaScript(`stageStart(${FROM})`);
  const t0 = Date.now();
  let written = 0, still = 0;
  while ((Date.now() - t0) / 1000 < LENGTH) {
    const t = (Date.now() - t0) / 1000;
    if (ff) {
      const due = Math.floor(t * FPS);
      while (written < due) { if (!ff.stdin.write(bitmap())) await new Promise((r) => ff.stdin.once('drain', r)); written++; }
    }
    if (t >= still * EVERY) { fs.writeFileSync(path.join(STILLS, String(Math.round(still * EVERY)).padStart(3, '0') + 's.png'), latest.toPNG()); still++; }
    await wait(4);
  }
  if (ff) ff.stdin.end();
  const code = await done;
  console.log('frames', written, 'ffmpeg exit', code, code ? ffErr : '');
  app.quit();
});
