// Records youtube.html (served by yt-demo.js) to an MP4: 1920×1080, 30 fps, H.264 — the YouTube walkthrough.
// Frames come from Electron's offscreen rendering and go straight to ffmpeg; a still every few seconds for checking.
//   npm run record:youtube                      →  out/youtube.mp4, out/yt-stills/
//   npm run record:youtube -- --thumb            →  out/youtube-thumb.png (1280×720)
//   npm run record:youtube -- --lang=en          →  out/youtube-en.mp4, the English walkthrough (also with --thumb)
//   npm run record:youtube -- --from=4 --len=30 --stills-only   (start at scene 4, 30 s, stills only: for checking)
const { app, BrowserWindow, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(__dirname, 'out', 'yt-profile'));
nativeTheme.themeSource = 'dark';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
// --lang=en: the English walkthrough (the demo's data and the captions in English), its own files
const LANG = arg('lang', 'ko') === 'en' ? 'en' : 'ko', SUFFIX = LANG === 'en' ? '-en' : '';
process.env.YT_LANG = LANG;
const { PORT } = require('./yt-demo.js');

const OUT = path.join(__dirname, 'out', 'youtube' + SUFFIX + '.mp4'), STILLS = path.join(__dirname, 'out', 'yt-stills' + SUFFIX);
const W = 1920, H = 1080, FPS = 30, FROM = Number(arg('from', 0)), ONLY = process.argv.includes('--stills-only'), EVERY = Number(arg('every', 3));
const FFMPEG = require('ffmpeg-static');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  for (const f of fs.existsSync(STILLS) ? fs.readdirSync(STILLS) : []) fs.rmSync(path.join(STILLS, f));
  fs.mkdirSync(STILLS, { recursive: true });
  const w = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  w.setBounds({ x: 0, y: 0, width: W, height: H });
  w.webContents.setFrameRate(FPS);
  let latest = null;
  w.webContents.on('paint', (_e, _dirty, image) => { latest = image; });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || String(e.message).startsWith('[stage]')) console.log('page:', e.message); });
  await w.loadURL(`http://127.0.0.1:${PORT}/youtube.html?lang=${LANG}`);
  w.webContents.setZoomFactor(1);
  await w.webContents.executeJavaScript('stageReady()');
  await wait(1500);
  if (process.argv.includes('--thumb')) {
    await w.webContents.executeJavaScript('stageThumb()');
    await wait(1500);
    fs.writeFileSync(path.join(__dirname, 'out', 'youtube-thumb' + SUFFIX + '.png'), latest.resize({ width: 1280, height: 720, quality: 'best' }).toPNG());
    console.log('thumbnail out/youtube-thumb' + SUFFIX + '.png');
    return app.quit();
  }
  const LENGTH = Number(arg('len', 0)) || await w.webContents.executeJavaScript(`stageLength(${FROM})`);
  console.log('frame', latest && latest.getSize(), 'length', LENGTH);

  let ff = null, ffErr = '', done = Promise.resolve(0);
  if (!ONLY) {
    ff = spawn(FFMPEG, ['-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', W + 'x' + H, '-r', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (d) => { ffErr = (ffErr + d).slice(-3000); });
    done = new Promise((r) => ff.on('exit', r));
  }
  const bitmap = () => { let img = latest; const s = img.getSize(); if (s.width !== W || s.height !== H) img = img.resize({ width: W, height: H }); return img.toBitmap(); };
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
