import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { captureClipboardAnimations } from './capture-doc-clipboard.mjs';

// Refresh documentation visuals: desktop and mobile app screenshots, a bridge-collapse simulation GIF,
// step-by-step construction and clipboard GIFs, and an optional live Android phone screenshot.
// The static views show responsive layouts; the animations demonstrate the core build-and-test workflow.
// A focused refresh leaves existing screenshots and other animations untouched.
const clipboardOnly = process.argv.includes('--clipboard-only');
const root = resolve('public_html');
const output = resolve('docs/images');
const chromeCandidates = [
  process.env.FRAME_LAB_CHROMIUM,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const browserExecutable = chromeCandidates.find(existsSync);
if (!existsSync(join(root, 'index.html'))) {
  throw new Error('Production files are missing. Run `npm run build` before capturing documentation screenshots.');
}

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let content = await readFile(file);
    if (extname(file) === '.html' && req.headers['user-agent']?.includes('Android')) {
      content = Buffer.from(content.toString('utf8').replace('</head>', '<style>#toast,#update-app,#install-reminder{display:none!important}</style></head>'));
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', ...(pathname.endsWith('/sw.js') ? { 'Cache-Control': 'no-cache' } : {}) });
    res.end(content);
  } catch { if (!res.headersSent && !res.destroyed) res.writeHead(404).end(); }
});

await mkdir(output, { recursive: true });
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  const deviceBase = `http://localhost:${port}/`;

  // Capture clean desktop and touch-sized app layouts for the user guide.
  browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  for (const { name, viewport, mobile } of (clipboardOnly ? [] : [
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, mobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
  ])) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#canvas').waitFor();
    await page.addStyleTag({ content: '#toast, #update-app, #install-reminder { display: none !important; }' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(output, `frame-lab-${name}.png`) });
    console.log(`Captured ${join(output, `frame-lab-${name}.png`)}.`);
    // Show the opt-in control in use, then restore zero prestrain before the
    // normal gallery and build animations. Screenshots never change a project.
    await page.locator('#settings').click();
    await page.locator('#rope-prestrain-enabled').check();
    await page.locator('#rope-prestrain-value').selectOption('0.005');
    await page.screenshot({ path: join(output, `frame-lab-settings-${name}.png`) });
    console.log(`Captured ${join(output, `frame-lab-settings-${name}.png`)}.`);
    await page.locator('#rope-prestrain-enabled').uncheck();
    await page.locator('#close-settings').click();
    if (name === 'desktop') {
      // Run the bridge example and record its collapse so the guide can show what simulation does.
      const framesDir = await mkdtemp(join(tmpdir(), 'frame-lab-simulation-'));
      try {
        await page.locator('#examples').click();
        await page.locator('[data-example="bridge"]').click();
        await page.locator('#run').click();
        await page.locator('#simulation-controls').waitFor({ state: 'visible' });
        for (let frame = 0; frame < 12; frame++) {
          await page.waitForTimeout(350);
          await page.screenshot({ path: join(framesDir, `frame-${String(frame).padStart(2, '0')}.png`) });
        }
        const ffmpeg = process.env.FFMPEG || 'ffmpeg';
        const palette = join(framesDir, 'palette.png');
        const pattern = join(framesDir, 'frame-%02d.png');
        const paletteResult = spawnSync(ffmpeg, ['-y', '-framerate', '3', '-i', pattern, '-vf', 'palettegen=stats_mode=diff', palette], { stdio: 'ignore' });
        const gifResult = paletteResult.status === 0
          ? spawnSync(ffmpeg, ['-y', '-framerate', '3', '-i', pattern, '-i', palette, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', join(output, 'frame-lab-simulation.gif')], { stdio: 'ignore' })
          : paletteResult;
        if (gifResult.status === 0) console.log(`Captured ${join(output, 'frame-lab-simulation.gif')}.`);
        else console.log(`FFmpeg is unavailable; skipped the optional simulation animation (${gifResult.error?.message || `exit ${gifResult.status}`}).`);
      } finally {
        await rm(framesDir, { recursive: true, force: true });
      }

      await page.locator('#back').click();
      await page.locator('#clear-canvas').click();
      const canvas = page.locator('#canvas');
      const rect = await canvas.boundingBox();
      const board = await page.evaluate(({ x, y, width, height }) => {
        const margin = width < 600 ? 30 : 58;
        const scale = Math.min((width - margin * 2) / 32, (height - margin * 2) / 18);
        return { left: x + (width - 32 * scale) / 2, top: y + (height - 18 * scale) / 2, scale };
      }, rect);
      // Record the user actions that build a triangular beam frame, teaching the drawing sequence.
      const buildFramesDir = await mkdtemp(join(tmpdir(), 'frame-lab-build-'));
      try {
        await page.evaluate(() => {
          const label = document.createElement('div');
          label.id = 'doc-build-caption';
          Object.assign(label.style, {
            position: 'fixed', top: '68px', left: '50%', transform: 'translateX(-50%)', zIndex: '99999',
            width: 'min(460px, calc(100vw - 32px))', boxSizing: 'border-box', padding: '11px 16px',
            borderRadius: '9px', background: '#183d3e', color: '#fff', boxShadow: '0 5px 20px #183d3e44',
            font: '600 15px/1.35 "DM Sans", sans-serif', textAlign: 'center', pointerEvents: 'none',
          });
          const title = document.createElement('div');
          const detail = document.createElement('div');
          detail.style.cssText = 'margin-top:3px;font-size:12px;font-weight:400;color:#dce9df';
          label.append(title, detail);
          document.body.append(label);
          const cursor = document.createElement('div');
          cursor.id = 'doc-build-cursor';
          Object.assign(cursor.style, {
            position: 'fixed', width: '34px', height: '34px', border: '3px solid #d56537', borderRadius: '50%',
            background: '#fff8', boxShadow: '0 1px 7px #1d303855', transform: 'translate(-50%,-50%)',
            zIndex: '100000', pointerEvents: 'none', display: 'none',
          });
          document.body.append(cursor);
        });
        const showStep = async (heading, detail) => {
          await page.evaluate(({ heading, detail }) => {
            const label = document.getElementById('doc-build-caption');
            const title = label?.firstElementChild;
            const copy = title?.nextElementSibling;
            if (title) title.textContent = heading;
            if (copy) copy.textContent = detail;
          }, { heading, detail });
        };
        let buildFrame = 0;
        const captureBuild = async () => {
          await page.waitForTimeout(250);
          await page.screenshot({ path: join(buildFramesDir, `frame-${String(buildFrame++).padStart(2, '0')}.png`) });
        };
        const moveCursor = async (x, y) => {
          await page.mouse.move(x, y);
          await page.evaluate(({ x, y }) => {
            const cursor = document.getElementById('doc-build-cursor');
            if (cursor) { cursor.style.left = `${x}px`; cursor.style.top = `${y}px`; cursor.style.display = 'block'; }
          }, { x, y });
        };
        const tap = async (x, y) => {
          await moveCursor(x, y);
          await page.mouse.down();
          await page.waitForTimeout(120);
          await page.mouse.up();
          await page.waitForTimeout(180);
        };
        const gridPoint = (x, y) => [board.left + x * board.scale, board.top + y * board.scale];
        const beamButton = await page.locator('[data-tool="beam"]').boundingBox();
        await showStep('1 · Choose Beam', 'Select the beam tool before adding members.');
        await tap(beamButton.x + beamButton.width / 2, beamButton.y + beamButton.height / 2);
        await captureBuild();

        const startPoint = gridPoint(14, 18);
        await showStep('2 · Tap a starting point', 'Begin at an orange boundary support.');
        await moveCursor(...startPoint);
        await captureBuild();
        await tap(...startPoint);
        await captureBuild();

        const baseEnd = gridPoint(18, 18);
        await showStep('3 · Tap an endpoint', 'The first beam appears; the drawing chain continues.');
        await moveCursor(...baseEnd);
        await captureBuild();
        await tap(...baseEnd);
        await captureBuild();

        const apex = gridPoint(16, 14);
        await showStep('4 · Continue with the next endpoint', 'Tap another grid point to add a diagonal beam.');
        await moveCursor(...apex);
        await captureBuild();
        await tap(...apex);
        await captureBuild();

        await showStep('5 · Close the triangle', 'Tap the other bottom point to place the third beam.');
        await tap(...startPoint);
        await captureBuild();

        await page.keyboard.press('Escape');
        const runButton = await page.locator('#run').boundingBox();
        await showStep('6 · Finish and test', 'Press Esc or Cancel to end the chain, then choose Run.');
        await moveCursor(runButton.x + runButton.width / 2, runButton.y + runButton.height / 2);
        await captureBuild();

        const ffmpeg = process.env.FFMPEG || 'ffmpeg';
        const pattern = join(buildFramesDir, 'frame-%02d.png');
        const palette = join(buildFramesDir, 'palette.png');
        const paletteResult = spawnSync(ffmpeg, ['-y', '-framerate', '1.2', '-i', pattern, '-vf', 'palettegen=stats_mode=diff', palette], { stdio: 'ignore' });
        const gifResult = paletteResult.status === 0
          ? spawnSync(ffmpeg, ['-y', '-framerate', '1.2', '-i', pattern, '-i', palette, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', join(output, 'frame-lab-build-basics.gif')], { stdio: 'ignore' })
          : paletteResult;
        if (gifResult.status === 0) console.log(`Captured ${join(output, 'frame-lab-build-basics.gif')}.`);
        else console.log(`FFmpeg is unavailable; skipped the optional build animation (${gifResult.error?.message || `exit ${gifResult.status}`}).`);
      } finally {
        await rm(buildFramesDir, { recursive: true, force: true });
      }
    }
    await context.close();
  }
  await captureClipboardAnimations(browser, base, output);
  await browser.close();
  browser = undefined;

  if (!clipboardOnly) {
    const adb = process.env.ADB || [
      join(process.env.ANDROID_HOME || '', 'platform-tools', 'adb.exe'),
      join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb.exe'),
      join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      'adb',
    ].find(candidate => candidate && (candidate === 'adb' || existsSync(candidate)));
    const androidScreenshot = join(output, 'frame-lab-android.png');
    // If a device is connected, capture the app on a real phone to document its mobile presentation.
    // Never leave an old device capture in place when this refresh cannot produce a new one.
    try { await rm(androidScreenshot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let devices;
    try {
      if (!adb) throw new Error('ADB executable not found');
      devices = execFileSync(adb, ['devices'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        .split(/\r?\n/).slice(1)
        .map(line => line.trim().split(/\s+/))
        .filter(parts => parts.length >= 2 && parts[1] === 'device')
        .map(parts => parts[0]);
      if (!devices.length) {
        console.log('No authorized Android device found through ADB; skipping the optional phone screenshot.');
      }
    } catch (error) {
      console.log(`ADB is unavailable (${error.message}); skipping the optional phone screenshot. It will be retried on the next documentation update.`);
    }

    if (devices?.length) {
      const serial = devices[0];
      const reverse = `tcp:${port}`;
      try {
        execFileSync(adb, ['-s', serial, 'reverse', reverse, reverse], { stdio: 'ignore' });
        execFileSync(adb, ['-s', serial, 'shell', 'input', 'keyevent', '224'], { stdio: 'ignore' });
        try { execFileSync(adb, ['-s', serial, 'shell', 'wm', 'dismiss-keyguard'], { stdio: 'ignore' }); } catch { /* Some Android versions do not support dismiss-keyguard. */ }
        execFileSync(adb, ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', deviceBase], { stdio: 'ignore' });
        await new Promise(resolve => setTimeout(resolve, 8000));
        const image = execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 20 * 1024 * 1024 });
        if (image.length < 8 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new Error('ADB did not return a valid PNG screenshot.');
        }
        if (image.length < 50 * 1024) {
          throw new Error(`Android screenshot is only ${image.length} bytes and may be a blank display.`);
        }
        await writeFile(androidScreenshot, image);
        console.log(`Captured ${androidScreenshot} from Android device ${serial}.`);
      } catch (error) {
        console.warn(`Android screenshot failed (${error.message}); browser screenshots are ready. Retry at the next documentation update.`);
      } finally {
        try { execFileSync(adb, ['-s', serial, 'reverse', '--remove', reverse], { stdio: 'ignore' }); } catch { /* Device may have disconnected. */ }
      }
    }
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
