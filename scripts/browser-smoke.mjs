import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const GAME_VERSION = (await readFile(new URL('../src/model.ts', import.meta.url), 'utf8')).match(/export const GAME_VERSION = '([^']+)'/)[1];

const root = resolve('public_html');
async function checkGuideLink(browser, base) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    let popupCount = 0;
    page.on('popup', () => popupCount++);
    await page.goto(base, { waitUntil: 'load' });
    await page.locator('#guide').click();
    await page.getByRole('link', { name: 'Read the user guide' }).click();
    await page.waitForURL(`${base}/user-guide.html`);
    assert.equal(popupCount, 0, 'The guide should open in the current tab');
    assert.equal(await page.locator('h1').textContent(), 'Player Guide', 'The guide page should contain the manual');
    assert.equal(await page.locator('#app').count(), 0, 'The guide URL must not serve the game');
  } finally {
    await context.close();
  }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/manifest+json', '.png': 'image/png', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
let workerOverride;
let workerUnavailable = false;
let versionReply;
let versionRequests = 0;
const server = createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/frameLab/')) pathname = pathname.slice('/frameLab'.length);
    if (pathname === '/version.json') {
      versionRequests++;
      if (versionReply) {
        const reply = versionReply;
        if (reply.delay) await new Promise(resolve => setTimeout(resolve, reply.delay));
        res.writeHead(reply.status || 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(reply.body);
        return;
      }
    }
    if (pathname === '/sw.js' && workerUnavailable) { res.writeHead(503).end(); return; }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const content = pathname.endsWith('/sw.js') && workerOverride ? workerOverride : await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', ...(pathname.endsWith('/sw.js') ? { 'Cache-Control': 'no-cache' } : {}) });
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({
    executablePath: process.env.FRAME_LAB_CHROMIUM || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  if (process.argv.includes('--sound-only')) {
    await testSoundControls(browser, base);
    await testTensionPlayback(browser, base);
  } else if (process.argv.includes('--solvers-only')) {
    await testSolvers(browser, base);
  } else {
  // Verify root and subdirectory deployments by opening each URL, collecting failed asset/page
  // requests and starting the worker simulation; assert stylesheet loading and correct asset paths.
  for (const mount of ['/', '/frameLab/']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('requestfailed', request => {
      if (request.url().startsWith(base + '/')) failures.push(request.url());
    });
    page.on('response', response => {
      if (response.url().startsWith(base + '/')) {
        if (!response.ok() || !new URL(response.url()).pathname.startsWith(mount)) failures.push(response.url());
      }
    });
    await page.goto(base + mount, { waitUntil: 'load' });
    await page.locator('#run').click();
    await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, { timeout: 10000 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.sheet !== null)), true, 'Built stylesheet must load');
    assert.deepEqual(failures, [], `Page, assets and simulation must load under ${mount}`);
    await context.close();
  }
  console.log('Deployment: page, styles and simulation work under / and /frameLab/.');
  await checkGuideLink(browser, base);
  // The dev server has its own history fallback, so verify its guide route separately.
  const vite = await createViteServer({ server: { host: '127.0.0.1', port: 0 } });
  try {
    await vite.listen();
    await checkGuideLink(browser, `http://127.0.0.1:${vite.httpServer.address().port}`);
  } finally {
    await vite.close();
  }
  console.log('Player guide: Info link opens the manual in the same tab in production and development.');
  // Emulate supported and unsupported browser identities, including desktop-style iPad user agents;
  // check Install visibility and open the browser-specific manual installation instructions.
  for (const { name, userAgent, platform, touchPoints, visible, help } of [
    { name: 'iPad Safari', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.7 Safari/605.1.15', platform: 'MacIntel', touchPoints: 5, visible: true, help: /Safari on your iPad.*Add to Home Screen/ },
    { name: 'iPhone Safari', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.7 Mobile/15E148 Safari/604.1', visible: true, help: /Safari on your iPhone.*Add to Home Screen/ },
    { name: 'iPad Chrome', userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1', visible: true, help: /In Chrome, tap Share.*Add to Home Screen/ },
    { name: 'iPad Chrome before 16.4', userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1', visible: false },
    { name: 'Windows Edge', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0', visible: true, help: /Microsoft Edge.*Install this site as an app/ },
    { name: 'Windows Firefox', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', visible: false },
  ]) {
    const context = await browser.newContext({ userAgent });
    if (platform) await context.addInitScript(({ platform, touchPoints }) => {
      Object.defineProperty(navigator, 'platform', { value: platform });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints });
    }, { platform, touchPoints });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#install-app').isVisible(), visible, `${name}: install button visibility`);
    if (help) {
      await page.locator('#install-app').click();
      assert.match(await page.locator('#install-help').textContent(), help, `${name}: installation instructions`);
    }
    await context.close();
  }
  console.log('Install: Safari and Chrome on iOS/iPadOS, Edge on Windows, and unsupported browsers verified.');
  await testInstallReminder(browser, base);
  await testVersionHighlight(browser, base);
  await testVersionInformation(browser, base);
  await testPeriodicUpdates(browser, base);
  await testSolvers(browser, base);
  await testSoundControls(browser, base);
  await testTensionPlayback(browser, base);
  // Run the editor integration suite in desktop, portrait touch and wide touch contexts. Inspect
  // startup layout, dialogs, simulation and real input gestures, collecting all unhandled page errors.
  for (const { name, viewport, mobile } of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, mobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'mobile-landscape-fhd-plus', viewport: { width: 2400, height: 1080 }, mobile: true },
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#run').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#canvas')?.width > 0);
    // Check startup by comparing the starter beam count and viewport width before any editing.
    assert.equal(await page.locator('#beam-count').textContent(), '31');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The interface must fit the viewport');
    // Hold Beam with the real mouse, then press Escape; verify that the profile picker opens and closes.
    if (!mobile) {
      const beamBounds = await page.locator('[data-tool="beam"]').boundingBox();
      await page.mouse.move(beamBounds.x + beamBounds.width / 2, beamBounds.y + beamBounds.height / 2);
      await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
      assert.equal(await page.locator('#profile-picker').isVisible(), true, 'Holding Beam with mouse opens profiles');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#profile-picker').isVisible(), false, 'Escape closes profiles');
    }
    assert.equal(await page.locator('#inspector').isVisible(), false, 'Selection panel starts hidden');
    assert.equal(await page.locator('#install-app').isVisible(), true, 'Install help is available in the browser tab');
    // Open manual installation help without a prompt, then inject beforeinstallprompt and
    // appinstalled events; inspect prompt calls, dialog visibility and Install button cleanup.
    if (!mobile) {
      await page.locator('#install-app').click();
      assert.equal(await page.locator('#install-dialog').evaluate(el => el.open), true, 'Manual install steps open when Chrome has no prompt');
      await page.locator('#dismiss-install').click();
      await page.evaluate(() => {
        window.installPromptCalls = 0;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => { window.installPromptCalls++; };
        event.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(event);
      });
      await page.locator('#install-app').click();
      assert.equal(await page.evaluate(() => window.installPromptCalls), 1, 'Install button invokes Chrome prompt when offered');
      assert.equal(await page.locator('#install-dialog').evaluate(el => el.open), false);
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      assert.equal(await page.locator('#install-app').isVisible(), false, 'Install button disappears after installation');
    }
    // Measure tool bounds and square icon buttons in each viewport; verify toolbar placement
    // and open the guide to check that primary controls remain visible and operable.
    for (const selector of ['[data-tool="select"]', '[data-tool="beam"]', '[data-tool="rope"]', '[data-tool="erase"]', '[data-joint="x"]', '[data-joint="o"]', '#settings', '#clear-canvas', '#examples', '#project-text', '#run', '#stress', ...(!mobile ? ['#zoom-in'] : []), '#fit']) {
      const bounds = await page.locator(selector).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, `${selector} must fit in the viewport`);
    }
    for (const selector of ['#guide', '#project-text', '#run', '#stress', '#settings', '#clear-canvas', '#undo', '#redo', '#examples', '[data-tool="select"]', '[data-tool="beam"]', '[data-tool="rope"]', '[data-tool="erase"]', '[data-joint="x"]', '[data-joint="o"]', ...(!mobile ? ['#zoom-in', '#zoom-out'] : []), '#fit']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(rect && Math.abs(rect.width - rect.height) < 0.1, `${selector} must be square: ${JSON.stringify(rect)}`);
    }
    for (const selector of ['#guide', '#undo', '#redo']) assert.equal(await page.locator(`.toolbar > ${selector}`).count(), 1, `${selector} is in toolbar`);
    assert.equal(await page.locator('.project-heading, .project-bar').count(), 0);
    assert.equal(await page.locator('.status-bar #total-cost').isVisible(), true);
    await page.locator('#guide').click();
    assert.equal(await page.locator('#guide-dialog').evaluate(el => el.open), true);
    await page.locator('#close-guide').click();
    assert.equal(await page.locator('#run').getAttribute('aria-label'), 'Run simulation');
    assert.equal(await page.locator('.toolbar > #examples').count(), 1, 'Load example is in toolbar');
    assert.equal(await page.locator('.toolbar > #project-text').count(), 1, 'Project text is in toolbar');
    assert.equal(await page.locator('.toolbar > #run').count(), 1, 'Run simulation is in toolbar');
    assert.equal(await page.locator('.toolbar > #settings').count(), 1, 'Settings is in toolbar');
    assert.equal(await page.locator('.toolbar > #clear-canvas').count(), 1, 'Clear canvas is in toolbar');
    assert.equal(await page.locator('.toolbar > #stress:last-child').count(), 1, 'Stress is last in the construction toolbar');
    assert.equal(await page.locator('#stress').evaluate(el => getComputedStyle(el).borderTopWidth), '0px', 'Stress has no border');
    // Toggle stress with a click and focused Space; inspect pressed state and legend visibility
    // and verify that keyboard activation does not start the simulation.
    assert.equal(await page.locator('#stress').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#stress-legend').isVisible(), false);
    await page.locator('#stress').click();
    assert.equal(await page.locator('#stress').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#stress-legend').isVisible(), true);
    assert.equal(await page.locator('#stress').evaluate(el => el.classList.contains('active')), true);
    await page.locator('#stress').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#stress').getAttribute('aria-pressed'), 'false', 'Space toggles stress, not the simulation');
    assert.equal(await page.locator('#stress-legend').isVisible(), false);
    assert.equal(await page.locator('#run').isVisible(), true);

    // Compare tool/status bounds with the canvas to detect covering controls, then inspect
    // exported metadata for the current release, format version and initial board size.
    const canvasBounds = await page.locator('#canvas').boundingBox();
    for (const selector of ['.workspace-controls', '.status-bar']) {
      const bounds = await page.locator(selector).boundingBox();
      assert.ok(bounds.x + bounds.width <= canvasBounds.x || bounds.y + bounds.height <= canvasBounds.y || bounds.y >= canvasBounds.y + canvasBounds.height, `${selector} must not cover the canvas`);
    }
    await page.screenshot({ path: join(tmpdir(), `frame-lab-${name}.png`) });
    await page.locator('#project-text').click();
    const original = await page.locator('#project-json').inputValue();
    assert.equal(JSON.parse(original).metadata.formatVersion, 3);
    assert.equal(JSON.parse(original).metadata.gameVersion, GAME_VERSION);
    assert.deepEqual(JSON.parse(original).metadata.size, [16, 10]);
    assert.match(await page.locator('#board-size').textContent(), /^16 . 10 GRID$/);
    await page.locator('#close-text').click();
    await testExamples(page, original);
    await testCanvasSize(page, original);
    await page.locator('#project-text').click();
    // Submit malformed JSON and inspect the error; reload the valid document and run the worker
    // to verify that import failure does not prevent subsequent simulation.
    await page.locator('#project-json').fill('{');
    await page.locator('#load').click();
    assert.match(await page.locator('#import-error').textContent(), /Invalid JSON/);
    await page.locator('#project-json').fill(original);
    await page.locator('#load').click();
    await page.locator('#run').click();
    assert.equal(await page.locator('#run').isVisible(), false, 'Run button is hidden during simulation');
    assert.equal(await page.locator('#back').isVisible(), true, 'A single stop button is available during simulation');
    assert.equal(await page.locator('#simulation-controls > #stress:last-child').isVisible(), true, 'Stress remains last in simulation controls');
    assert.equal(await page.locator('#project-text').isVisible(), false, 'Project text is hidden during simulation');
    assert.equal(await page.locator('#examples').isDisabled(), true, 'Examples are disabled during simulation');
    await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, { timeout: 10000 });
    // Measure simulation buttons and inspect accessible names, pulse animation and reduced-motion
    // behavior; pause/resume/stop, then compare project text to prove the design was preserved.
    for (const selector of ['#pause', '#back']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(rect && Math.abs(rect.width - rect.height) < 0.1, `${selector} must be square`);
      assert.equal((await page.locator(selector).textContent()).trim(), '', `${selector} has no visible label`);
    }
    assert.equal(await page.locator('#pause').getAttribute('aria-label'), 'Pause simulation');
    assert.equal(await page.locator('#back').getAttribute('aria-label'), 'Stop simulation and return to build');
    assert.equal(await page.locator('#back').evaluate(el => getComputedStyle(el).animationName), 'simulation-pulse');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#back').evaluate(el => getComputedStyle(el).animationName), 'none', 'Reduced motion disables pulse');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#pause').click();
    assert.equal(await page.locator('#pause').getAttribute('aria-label'), 'Resume simulation');
    assert.equal(await page.locator('#pause').getAttribute('aria-label'), 'Resume simulation');
    assert.equal(await page.locator('#back').evaluate(el => getComputedStyle(el).animationName), 'none', 'Paused simulation does not pulse');
    await page.locator('#pause').click();
    assert.equal(await page.locator('#back').evaluate(el => getComputedStyle(el).animationName), 'simulation-pulse', 'Resuming restores pulse');
    await page.locator('#pause').click();
    await page.locator('#back').click();
    assert.equal(await page.locator('#run').isVisible(), true, 'Run button returns in build mode');
    assert.equal(await page.locator('.toolbar > #stress').isVisible(), true, 'Stress returns to toolbar in build mode');
    assert.equal(await page.locator('#back').isVisible(), false, 'Stop button is hidden in build mode');
    await page.locator('#project-text').click();
    assert.equal(await page.locator('#project-json').inputValue(), original, 'Simulation must preserve the original design');
    await page.locator('#close-text').click();
    // Exercise editor gestures against the actual canvas, not synthetic DOM handlers.
    const point = async (x, y) => {
      const size = (await page.locator('#board-size').textContent()).match(/\d+/g).map(Number);
      return page.locator('#canvas').evaluate((canvas, [x, y, size]) => {
        const r = canvas.getBoundingClientRect(), margin = r.height < 400 ? 20 : r.width < 600 ? 30 : 58;
        const scale = Math.min((r.width - margin * 2) / size[0], (r.height - margin * 2) / size[1]);
        return { x: r.left + (r.width - size[0] * scale) / 2 + x * scale, y: r.top + (r.height - size[1] * scale) / 2 + y * scale };
      }, [x, y, size]);
    };
    const clickNode = async (x, y) => { const p = await point(x, y); if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); };
    const readProject = async () => { await page.locator('#project-text').click(); const p = JSON.parse(await page.locator('#project-json').inputValue()); await page.locator('#close-text').click(); return p; };
    // Zoom about the board center and middle-pan the view; read coordinates at the transformed
    // origin and use Fit to verify agreement between camera position and the displayed grid.
    const center = await page.locator('#canvas').evaluate(canvas => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (mobile) await pinchZoom(page, 1.25); else await page.locator('#zoom-in').click();
    await page.waitForFunction(() => document.querySelector('#zoom-value').textContent === '125%');
    if (mobile) assert.equal(await page.locator('#mobile-zoom').textContent(), '125%');
    await page.mouse.move(center.x, center.y);
    assert.equal(await page.locator('#coordinate').textContent(), 'X 0   Y 0', 'Zoom keeps the origin attached to the board center');
    if (!mobile) {
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(center.x + 48, center.y + 24, { steps: 5 });
      await page.mouse.up({ button: 'middle' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.mouse.move(center.x + 48, center.y + 24);
      assert.equal(await page.locator('#coordinate').textContent(), 'X 0   Y 0', 'Panning moves the origin with the board');
    }
    await page.locator('#fit').click();
    await page.waitForFunction(() => document.querySelector('#zoom-value').textContent === '100%');
    // Toggle a node using touch or a mouse double-click and inspect its exported joint;
    // clear the design and undo to verify restoration of the original geometry.
    await page.locator('[data-tool="select"]').click();
    if (mobile) await clickNode(7, 4); else { const p = await point(7, 4); await page.mouse.dblclick(p.x, p.y, { delay: 60 }); }
    assert.equal(await page.locator('#coordinate').textContent(), 'X -1   Y 1');
    assert.match(await page.locator('#inspector-copy').textContent(), /Grid point \(-1, 1\)/);
    assert.deepEqual((await readProject()).objects.j, [[-1, 1, 'o']], 'Clicking a node must toggle it to a hinge');
    if (mobile) await clickNode(7, 4); else { const p = await point(7, 4); await page.mouse.dblclick(p.x, p.y, { delay: 60 }); }
    assert.equal((await readProject()).objects.j, undefined, 'A second click must restore a rigid joint');
    if (!mobile) {
      const midpoint = await point(1, 7); await page.mouse.click(midpoint.x, midpoint.y, { button: 'right' });
      assert.equal(await page.locator('#beam-count').textContent(), '31', 'Right-click must not remove elements');
      await page.locator('#context-menu button').filter({ hasText: 'Delete selection' }).click();
      assert.equal(await page.locator('#beam-count').textContent(), '30', 'Menu removes exactly one element');
      await page.locator('#undo').click(); assert.equal(await page.locator('#beam-count').textContent(), '31');
      await page.locator('[data-tool="beam"]').click();
      await chooseProfile(page, 'h');
      const from = await point(7, 4), to = await point(7, 0);
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
      assert.equal(await page.locator('#beam-count').textContent(), '32', 'Dragging from an existing node builds a beam');
      assert.ok((await readProject()).objects.b.some(b => b[4] === 'h'));
      await page.locator('#undo').click();
      await chooseProfile(page, 's');
    }
    await page.locator('#clear-canvas').click();
    assert.equal(await page.locator('#beam-count').textContent(), '0'); assert.equal(await page.locator('#rope-count').textContent(), '0');
    assert.deepEqual((await readProject()).metadata.size, [16, 10]);
    await page.locator('#undo').click(); assert.equal(await page.locator('#beam-count').textContent(), '31', 'Clear canvas must be one undoable action');
    await page.screenshot({ path: join(tmpdir(), `frame-lab-${name}-updated.png`) });
    // Changing a selected beam profile updates price and can be undone.
    const beforeCost = await page.locator('#total-cost').textContent();
    await page.locator('[data-tool="select"]').click();
    const midpoint = await point(1, 7);
    if (mobile) await page.touchscreen.tap(midpoint.x, midpoint.y); else await page.mouse.click(midpoint.x, midpoint.y);
    await page.locator('[data-change-profile="l"]').click();
    assert.notEqual(await page.locator('#total-cost').textContent(), beforeCost);
    assert.ok((await readProject()).objects.b.some(b => b[4] === 'l'));
    await page.locator('#undo').click();
    assert.equal(await page.locator('#total-cost').textContent(), beforeCost);
    await page.locator('[data-tool="beam"]').click();
    if (!mobile) await testMouseControls(page, point, readProject);
    // Overlapping previews must not stop rendering or prevent subsequent additions.
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify({ metadata: { size: [32,18], gameVersion: '0.4.0', formatVersion: 3 }, objects: { b: [[-3,0,1,0,'s']] } }));
    await page.locator('#load').click();
    await clickNode(15, 9);
    const overlapEnd = await point(19, 9);
    if (!mobile) {
      await page.mouse.move(overlapEnd.x, overlapEnd.y);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(errors, [], 'An overlapping hover preview must not throw');
    }
    await clickNode(19, 9);
    assert.match(await page.locator('#toast').textContent(), /overlaps/);
    assert.equal(await page.locator('#beam-count').textContent(), '1');
    assert.deepEqual((await readProject()).objects.b, [[-3,0,1,0,'s']]);
    // Correct the endpoint and continue drawing without reloading the page.
    await clickNode(15, 12);
    assert.equal(await page.locator('#beam-count').textContent(), '3', 'A valid addition still splits and connects to the original beam');
    await page.locator('#run').click();
    await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, { timeout: 10000 });
    await page.locator('#back').click();
    // Old or invalid documents must leave the current project untouched.
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill('{"size":[32,18],"formatVersion":2}');
    await page.locator('#load').click();
    assert.match(await page.locator('#import-error').textContent(), /Older formats/);
    const next = { metadata: { size: [40,20], gameVersion: '0.4.0', formatVersion:3 }, objects: { b:[[-8,0,-4,0,'l'],[-4,0,0,0,'s'],[0,0,4,0,'h']], r:[[4,0,4,4]] } };
    await page.locator('#project-json').fill(JSON.stringify({...next,metadata:{...next.metadata,size:[39,20]}}));
    await page.locator('#load').click();
    assert.match(await page.locator('#import-error').textContent(), /even/);
    await page.locator('#project-json').fill(JSON.stringify(next)); await page.locator('#load').click();
    assert.deepEqual((await readProject()).metadata.size,[40,20]);
    assert.equal(await page.locator('#total-cost').textContent(),'Cost: 120 cr');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path:join(tmpdir(), `frame-lab-${name}-profiles.png`)});
    await page.locator('#run').click();
    await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, {timeout:10000});
    assert.equal(await page.locator('#total-cost').textContent(),'Cost: 120 cr');
    await page.locator('#back').click();
    await testContinuousDrawing(page, mobile, point, readProject);
    await testDrawingDrag(page, mobile, point, readProject);
    await testNodeMoves(page, mobile, point, readProject);
    await testBeamMoves(page, mobile, point, readProject);
    await testGroupSelection(page, mobile);
    await testClipboard(page, mobile);
    await testDrawingPreview(page, mobile, name);
    await testEdgePan(page, mobile, readProject, viewport.width >= 2000);
    assert.deepEqual(errors, [], 'Startup and interaction must not throw browser errors');
    console.log(`${mobile ? 'Mobile' : 'Desktop'}: renders, JSON validation and round trip, worker simulation, pause, reset, node toggles, context menus and group selection, node dragging, clear and Undo, centered coordinates, zoom/pan, profiles, costs, resize and new JSON validation; no page errors.`);
    await context.close();
  }
  // Verify compact-phone portrait and landscape layouts with native touch input: measure control
  // bounds and canvas space, exercise simulation/examples/profiles, then draw and undo a beam.
  // Galaxy S10e: 360 × 760 CSS screen, DPR 3; the shorter landscape
  // viewport also leaves room for Android/Chrome browser chrome.
  for (const { name, viewport } of [
    { name: 's10e-portrait', viewport: { width: 360, height: 760 } },
    { name: 's10e-landscape', viewport: { width: 760, height: 360 } },
    { name: 's10e-landscape-browser', viewport: { width: 760, height: 300 } },
  ]) {
    const context = await browser.newContext({ viewport, screen: { width: viewport.width, height: name === 's10e-portrait' ? 760 : 360 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.locator('#run').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#canvas')?.width > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits viewport`);
    assert.equal(await page.locator('#zoom-in').isVisible(), false, `${name}: zoom in hidden`);
    assert.equal(await page.locator('#zoom-out').isVisible(), false, `${name}: zoom out hidden`);
    assert.equal(await page.locator('#hint').isVisible(), false, `${name}: drawing hint hidden`);
    assert.equal(await page.locator('#mobile-zoom').isVisible(), true, `${name}: footer zoom visible`);
    await pinchZoom(page, 1.25);
    await page.waitForFunction(() => document.querySelector('#mobile-zoom').textContent === '125%');
    await page.locator('#fit').tap();
    await page.waitForFunction(() => document.querySelector('#mobile-zoom').textContent === '100%');
    const canvas = await page.locator('#canvas').boundingBox();
    if (name !== 's10e-portrait') {
      assert.equal(await page.locator('.header').isVisible(), false, `${name}: empty header hidden`);
      assert.ok(canvas.y <= 2, `${name}: canvas starts at the top, y=${canvas.y}`);
    }
    assert.ok(canvas.height >= (name === 's10e-landscape-browser' ? 250 : 200), `${name} canvas height: ${canvas.height}`);
    if (name === 's10e-portrait') {
      const rail = await page.locator('.workspace-controls').boundingBox();
      assert.ok(rail.width >= viewport.width - 10 && rail.y <= 2 && rail.y + rail.height <= canvas.y, `${name}: full-width toolbar above canvas`);
    }
    for (const selector of ['[data-tool="select"]', '[data-tool="beam"]', '[data-tool="rope"]', '[data-tool="erase"]', '[data-joint="x"]', '[data-joint="o"]', '#guide', '#undo', '#redo', '#settings', '#clear-canvas', '#examples', '#project-text', '#run', '#stress', '#fit']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= viewport.width && (name === 's10e-portrait' ? rect.y + rect.height <= canvas.y : (['#undo', '#redo', '#project-text', '#run', '#stress', '#fit'].includes(selector) ? rect.x >= canvas.x + canvas.width : rect.x + rect.width <= canvas.x) && rect.y >= canvas.y && rect.y + rect.height <= canvas.y + canvas.height), `${name} ${selector} must be accessible outside canvas`);
    }
    await page.screenshot({ path: join(tmpdir(), `frame-lab-${name}.png`) });
    await page.locator('#stress').tap();
    assert.equal(await page.locator('#stress').getAttribute('aria-pressed'), 'true', `${name}: touch enables stress`);
    assert.equal(await page.locator('#stress-legend').isVisible(), true);
    await page.locator('#stress').tap();
    assert.equal(await page.locator('#stress').getAttribute('aria-pressed'), 'false', `${name}: touch disables stress`);
    await page.locator('#run').tap();
    await page.locator('#stress').tap();
    assert.equal(await page.locator('#stress-legend').isVisible(), true, `${name}: stress works during simulation`);
    await page.locator('#stress').tap();
    assert.equal(await page.locator('#run').isVisible(), false, `${name}: no duplicate stop button`);
    assert.equal(await page.locator('#back').isVisible(), true, `${name}: stop button is visible`);
    assert.equal(await page.locator('#undo').isVisible(), false, `${name}: Undo hidden during simulation`);
    assert.equal(await page.locator('#redo').isVisible(), false, `${name}: Redo hidden during simulation`);
    const simCanvas = await page.locator('#canvas').boundingBox();
    assert.equal(await page.locator('#project-text').isVisible(), false, `${name}: Project text hidden during simulation`);
    for (const selector of ['#pause', '#back', '#stress', '#fit']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= viewport.width && (name === 's10e-portrait' ? rect.y + rect.height <= simCanvas.y : rect.x >= simCanvas.x + simCanvas.width && rect.y >= simCanvas.y && rect.y + rect.height <= simCanvas.y + simCanvas.height), `${name} ${selector} must fit outside canvas during simulation`);
    }
    await page.screenshot({ path: join(tmpdir(), `frame-lab-${name}-simulation.png`) });
    await page.locator('#back').tap();
    assert.equal(await page.locator('#run').isVisible(), true, `${name}: run button returns`);
    await page.locator('#examples').tap();
    const dialogBounds = await page.locator('#examples-dialog').boundingBox();
    assert.ok(dialogBounds.x >= 0 && dialogBounds.y >= 0 && dialogBounds.x + dialogBounds.width <= viewport.width && dialogBounds.y + dialogBounds.height <= viewport.height, `${name}: examples dialog fits viewport`);
    assert.equal(await page.locator('[data-example]').count(), 5);
    await page.screenshot({ path: join(tmpdir(), `frame-lab-${name}-examples.png`) });
    await page.locator('[data-example="blank"]').tap();
    assert.equal(await page.locator('#beam-count').textContent(), '0', `${name}: touch loads example`);
    await page.locator('#undo').tap();
    assert.equal(await page.locator('#beam-count').textContent(), '31', `${name}: undo restores design`);
    await page.locator('#redo').tap();
    assert.equal(await page.locator('#beam-count').textContent(), '0', `${name}: redo reapplies example`);
    await page.locator('#undo').tap();
    assert.equal(await page.locator('#beam-count').textContent(), '31', `${name}: undo restores design again`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const beamRect = await page.locator('[data-tool="beam"]').boundingBox();
    const touchSession = await context.newCDPSession(page);
    const touchPoint = { x: beamRect.x + beamRect.width / 2, y: beamRect.y + beamRect.height / 2 };
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
    await page.waitForTimeout(600);
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.locator('#profile-picker').isVisible(), true, `${name}: holding Beam opens profiles`);
    await page.locator('#profile-picker [data-profile="h"]').click();
    assert.equal(await page.locator('#beam-profile-indicator').textContent(), 'H');
    assert.equal(await page.locator('#profile-picker').isVisible(), false);
    const thicknesses = [];
    for (const profile of ['l', 's', 'h']) {
      await chooseProfile(page, profile);
      thicknesses.push(Number(await page.locator('[data-tool="beam"] svg').evaluate(el => getComputedStyle(el).strokeWidth.replace('px', ''))));
      assert.equal(await page.locator('#beam-profile-indicator').textContent(), profile.toUpperCase());
    }
    assert.ok(thicknesses[0] < thicknesses[1] && thicknesses[1] < thicknesses[2], `${name}: beam icon thickness follows profile`);
    await chooseProfile(page, 's');
    await touchSession.detach();
    await page.locator('#clear-canvas').click();
    const point = async (x, y) => page.locator('#canvas').evaluate((el, [x, y]) => {
      const r = el.getBoundingClientRect(), margin = r.height < 400 ? 20 : r.width < 600 ? 30 : 58;
      const scale = Math.min((r.width - 2 * margin) / 16, (r.height - 2 * margin) / 10);
      return { x: r.left + (r.width - 16 * scale) / 2 + x * scale, y: r.top + (r.height - 10 * scale) / 2 + y * scale };
    }, [x, y]);
    const a = await point(6, 5), b = await point(9, 5);
    await page.touchscreen.tap(a.x, a.y); await page.touchscreen.tap(b.x, b.y);
    assert.equal(await page.locator('#beam-count').textContent(), '1', `${name}: touch drawing works`);
    await page.locator('#undo').click();
    assert.equal(await page.locator('#beam-count').textContent(), '0', `${name}: undo works`);
    await context.close();
    console.log(`${name}: viewport, controls, canvas space and touch drawing verified.`);
  }
  await testOffline(browser, base);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

async function testSoundControls(browser, base) {
  for (const { name, viewport, mobile } of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });
    const button = page.locator('#sound');
    assert.equal(await button.isVisible(), true, `${name}: sound control is visible in build mode`);
    assert.equal(await button.getAttribute('aria-pressed'), 'true', 'Sound is enabled by default');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('bar-lab:sound-enabled:v1')), 'false');
    await page.reload();
    assert.equal(await button.getAttribute('aria-pressed'), 'false', 'Mute persists across reloads');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await page.locator('#run').click();
    assert.equal(await button.isVisible(), true, `${name}: sound control is visible during simulation`);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false', 'Simulation can be muted immediately');
    await page.locator('#back').click();
    assert.equal(await button.isVisible(), true, `${name}: sound control returns to build mode`);
    await context.close();
  }
  console.log('Sound: default, persistent mute and controls in both modes on desktop/mobile verified.');
}

async function testTensionPlayback(browser, base) {
  for (const side of ['left', 'right', 'rope']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.soundSources = []; window.soundPanners = []; window.soundLoopEnded = 0;
      const source = AudioContext.prototype.createBufferSource;
      const panner = AudioContext.prototype.createStereoPanner;
      AudioContext.prototype.createBufferSource = function () { const node = source.call(this); node.addEventListener('ended', () => { if (node.loop) window.soundLoopEnded++; }); window.soundSources.push(node); return node; };
      AudioContext.prototype.createStereoPanner = function () { const node = panner.call(this); window.soundPanners.push(node); return node; };
    });
    await page.goto(base, { waitUntil: 'load' });
    const objects = side === 'rope'
      ? { b: [[-4, -1, 0, -1, 's']], r: [[-4, 5, -4, -1], [0, 5, 0, -1]] }
      : { b: [side === 'left' ? [-8, 3, -2, 3, 'l'] : [2, 3, 8, 3, 'l']] };
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify({ metadata: { size: [16, 10], gameVersion: GAME_VERSION, formatVersion: 3 }, objects }));
    await page.locator('#load').click();
    await page.locator('#run').click();
    await page.waitForFunction(() => window.soundSources.some(source => source.loop), undefined, { timeout: 10000 });
    await page.waitForTimeout(250);
    const result = await page.evaluate(() => ({ loops: window.soundSources.filter(source => source.loop).length, pans: window.soundPanners.map(panner => panner.pan.value) }));
    assert.ok(result.loops >= 1 && result.loops <= 6, 'Loaded material plays a bounded WAV loop');
    if (side !== 'rope') assert.ok(result.pans.some(pan => side === 'left' ? pan < -.2 : pan > .2), `${side} steel pans toward its side`);
    await page.locator('#pause').click();
    await page.waitForFunction(() => window.soundLoopEnded >= window.soundSources.filter(source => source.loop).length);
    await context.close();
  }
  console.log('Tension WAV: loaded steel and cable loops, six-loop cap, left/right stereo and pause verified.');
}

// Use the settings dialog on desktop and touch layouts, then inspect worker
// starts to verify solver routing and independent Serpentine direction draws.
async function testSolvers(browser, base) {
  for (const { name, viewport, mobile } of [
    { name:'desktop', viewport:{width:1440,height:1000}, mobile:false },
    { name:'portrait', viewport:{width:390,height:844}, mobile:true },
    { name:'landscape', viewport:{width:780,height:360}, mobile:true },
  ]) {
    const context = await browser.newContext({ viewport, hasTouch:mobile, isMobile:mobile });
    await context.addInitScript(() => {
      window.solverStarts = [];
      // Controlled values cover both sides, the threshold, and repeated sides.
      window.solverDraws = []; window.solverDrawCount = 0;
      const nativeRandom = Math.random;
      Math.random = () => {
        if (!window.solverDraws.length) return nativeRandom();
        window.solverDrawCount++;
        return window.solverDraws.shift();
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...args) {
          if (message.type === 'start') window.solverStarts.push(structuredClone(message.options));
          return super.postMessage(message,...args);
        }
      };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base,{waitUntil:'load'});
    const run = page.locator('#run'), settings = page.locator('#settings'), dialog = page.locator('#settings-dialog');
    await run.waitFor();
    assert.equal(await run.getAttribute('data-solver'),'serpentine');
    assert.match(await run.getAttribute('title'),/Serpentine/);
    assert.equal(await run.getAttribute('aria-haspopup'),null,'Run has no solver menu');
    assert.equal(await page.locator('#solver-picker').count(),0,'The former picker is removed');
    await settings.click();
    assert.equal(await dialog.evaluate(el => el.open),true,`${name}: settings opens`);
    assert.equal(await page.locator('input[name="solver"][value="serpentine"]').isChecked(),true);
    const box = await dialog.boundingBox();
    assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width && box.y+box.height<=viewport.height,`${name}: settings fits viewport`);
    await mkdir('screenshots',{recursive:true});
    await page.screenshot({path:resolve('screenshots',`settings-${name}.png`)});
    // Native radio activation inside the modal must not trigger Space-to-run.
    await page.locator('input[name="solver"][value="original"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('input[name="solver"][value="original"]').isChecked(),true);
    assert.equal(await page.evaluate(() => window.solverStarts.length),0);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(el => el.open),false);
    assert.equal(await settings.evaluate(el => document.activeElement === el),true,'Closing settings restores focus');
    assert.equal(await run.getAttribute('data-solver'),'original');
    // Pending dimensions are discarded on close, invalid sizes do not mutate
    // the project, and a valid resize remains a single Undo step.
    await settings.click();
    await page.locator('#canvas-width').fill('18');
    await page.keyboard.press('Escape');
    await settings.click();
    assert.equal(await page.locator('#canvas-width').inputValue(),'16');
    await page.locator('#canvas-width').fill('10');
    await page.locator('#canvas-height').fill('14');
    await page.locator('#canvas-size-form button[type="submit"]').click();
    assert.match(await page.locator('#canvas-size-error').textContent(),/even/);
    assert.match(await page.locator('#board-size').textContent(),/^16 . 10 GRID$/);
    await page.locator('#canvas-width').fill('20');
    await page.locator('#canvas-height').fill('12');
    await page.locator('#canvas-size-form button[type="submit"]').click();
    assert.equal(await dialog.evaluate(el => el.open),false);
    assert.match(await page.locator('#board-size').textContent(),/^20 . 12 GRID$/);
    await page.locator('#undo').click();
    assert.match(await page.locator('#board-size').textContent(),/^16 . 10 GRID$/);
    const choose = async selected => {
      await settings.click();
      await page.locator(`input[name="solver"][value="${selected}"]`).check();
      await page.locator('#close-settings').click();
      assert.equal(await run.getAttribute('data-solver'),selected);
    };
    const start = async () => {
      await run.click();
      await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance').textContent),undefined,{timeout:10000});
    };
    await choose('serpentine');
    await page.evaluate(() => { window.solverDraws = [0.75,0.75,0.25,0.5,0]; });
    await start();
    assert.deepEqual(await page.evaluate(() => window.solverStarts.at(-1)),{solver:'serpentine',serpentineFromRight:false});
    await page.locator('#pause').click(); await page.locator('#pause').click();
    assert.equal(await page.evaluate(() => window.solverDrawCount),1,'Pause/resume does not redraw the direction');
    // Settings are disabled during simulation; return to editing before choosing another solver.
    await page.locator('#back').click();
    await choose('original'); await start();
    assert.equal(await page.evaluate(() => window.solverStarts.at(-1).solver),'original');
    await page.locator('#back').click();
    await choose('serpentine');
    await page.locator('#clear-canvas').click();
    const count = await page.evaluate(() => window.solverStarts.length);
    await run.click();
    assert.equal(await page.evaluate(() => window.solverStarts.length),count,'Empty starts do not create a worker');
    assert.equal(await page.evaluate(() => window.solverDrawCount),1,'Other solvers and empty starts do not draw a direction');
    await page.locator('#undo').click(); await start();
    assert.deepEqual(await page.evaluate(() => window.solverStarts.at(-1)),{solver:'serpentine',serpentineFromRight:false},'Two successive draws may select the same side');
    await page.locator('#back').click(); await start();
    assert.deepEqual(await page.evaluate(() => window.solverStarts.at(-1)),{solver:'serpentine',serpentineFromRight:true});
    await page.locator('#back').click(); await start();
    assert.equal(await page.evaluate(() => window.solverStarts.at(-1).serpentineFromRight),false,'Exactly 0.5 belongs to the left half');
    await page.locator('#back').click(); await start();
    assert.equal(await page.evaluate(() => window.solverStarts.at(-1).serpentineFromRight),true,'Zero belongs to the right half');
    assert.equal(await page.evaluate(() => window.solverDrawCount),5,'Each Serpentine start draws exactly once');
    await page.locator('#back').click();
    await page.reload(); await run.waitFor();
    assert.equal(await run.getAttribute('data-solver'),'serpentine','A new page session starts with Serpentine');
    await settings.click();
    assert.equal(await page.locator('input[name="solver"][value="serpentine"]').isChecked(),true);
    await page.locator('#close-settings').click();
    assert.deepEqual(errors,[],`${name}: both solvers run without page errors`);
    await context.close();
  }
  console.log('Solvers: settings and keyboard access, Serpentine default, direct Run, real workers, independent direction draws and reload reset verified.');
}

// Verify installation reminders by clearing and undoing repeatedly to cross each threshold,
// then reload, emulate standalone mode and mock installed-app detection; inspect counters and visibility.
async function testInstallReminder(browser, base) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, './', 'The PWA identity stays unchanged');
  assert.deepEqual(manifest.related_applications, [{ platform: 'webapp', url: './manifest.json', id: 'https://barlab.jakubreiter.pl/' }]);
  assert.equal(manifest.prefer_related_applications, undefined);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const count = key => page.evaluate(key => Number(localStorage.getItem(key)), key);
  const clear = async () => {
    await page.locator('#clear-canvas').click();
    await page.locator('#undo').click();
  };
  // Clear and undo repeatedly, checking the browser counter and reminder visibility around
  // the sixth clear and later three-clear thresholds.
  for (let n = 1; n <= 5; n++) {
    await clear();
    assert.equal(await count('bar-lab:clear-in-browser:v1'), n);
    assert.equal(await page.locator('#install-reminder').isVisible(), false, `No reminder after ${n} clears`);
  }
  await clear();
  assert.equal(await page.locator('#install-reminder').isVisible(), true, 'The sixth clear shows the reminder');
  assert.match(await page.locator('#install-reminder').textContent(), /full-screen.*offline/);
  const button = await page.locator('#install-app').boundingBox();
  const reminder = await page.locator('#install-reminder').boundingBox();
  assert.ok(reminder.y + reminder.height <= button.y, 'Reminder sits above Install app');
  // Dismiss the reminder, cross the next threshold and reload; compare stored counts and
  // visibility to verify dismissal duration and that reload does not revive an old reminder.
  await page.locator('#dismiss-install-reminder').click();
  for (let n = 7; n <= 8; n++) {
    await clear();
    assert.equal(await page.locator('#install-reminder').isVisible(), false, `Dismissal lasts through clear ${n}`);
  }
  await clear();
  assert.equal(await page.locator('#install-reminder').isVisible(), true, 'The ninth clear shows the reminder again');
  await page.reload();
  assert.equal(await count('bar-lab:clear-in-browser:v1'), 9, 'Browser count survives reload');
  assert.equal(await page.locator('#install-reminder').isVisible(), false, 'Reload does not restore an old reminder');
  for (let n = 10; n <= 12; n++) await clear();
  assert.equal(await page.locator('#install-reminder').isVisible(), true, 'The twelfth clear shows the reminder');

  // Emulate standalone display mode in a second page; clear there and inspect its separate
  // PWA counter, hidden Install UI and suppression of later browser reminders.
  const pwaPage = await context.newPage();
  await pwaPage.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)'
      ? { matches: true, addEventListener() {}, removeEventListener() {} }
      : original(query);
  });
  await pwaPage.goto(base, { waitUntil: 'domcontentloaded' });
  assert.equal(await pwaPage.locator('#install-app').isVisible(), false, 'Install button is hidden in standalone mode');
  await pwaPage.locator('#clear-canvas').click();
  assert.equal(await pwaPage.evaluate(() => localStorage.getItem('bar-lab:clear-in-app:v1')), '1', 'PWA clears use a separate count');
  await pwaPage.locator('#undo').click();
  await page.locator('#install-reminder').waitFor({ state: 'hidden' });
  await page.reload();
  for (let n = 13; n <= 15; n++) await clear();
  assert.equal(await page.locator('#install-reminder').isVisible(), false, 'PWA use suppresses further reminders');
  await context.close();

  // Mock an installed related web app before startup and cross the reminder threshold;
  // verify that installation detection suppresses the Install button and reminder.
  const installedContext = await browser.newContext();
  await installedContext.addInitScript(() => {
    localStorage.setItem('bar-lab:clear-in-browser:v1', '5');
    navigator.getInstalledRelatedApps = async () => [{ platform: 'webapp', id: 'https://barlab.jakubreiter.pl/' }];
  });
  const installedPage = await installedContext.newPage();
  await installedPage.goto(base, { waitUntil: 'domcontentloaded' });
  await installedPage.locator('#install-app').waitFor({ state: 'hidden' });
  await installedPage.locator('#clear-canvas').click();
  assert.equal(await installedPage.locator('#install-reminder').isVisible(), false, 'A detected installation suppresses the reminder');
  await installedContext.close();
  console.log('Install reminder: counters, thresholds, dismissal, standalone mode, layout, and installed-app detection verified.');
}

// Verify upgrade highlighting using stored old versions, an installed worker and a second tab;
// wait out the five-second highlight and inspect mobile bounds and reduced-motion styling.
async function testVersionHighlight(browser, base) {
  const key = 'bar-lab:seen-version:v1';
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'load' });
  const version = page.locator('.status-bar .version');
  assert.equal(await version.textContent(), `v${GAME_VERSION}`);
  assert.equal(await version.evaluate(el => el.classList.contains('version-highlight')), false, 'First visit has no previous version');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Remove remembered versions after installing a worker to simulate an older release;
  // reload, wait five seconds and reload again to verify one-time upgrade highlighting.
  await page.evaluate(key => { sessionStorage.removeItem(key); localStorage.removeItem(key); }, key);
  await page.reload();
  assert.equal(await version.evaluate(el => el.classList.contains('version-highlight')), true, 'Existing service worker identifies first update from an earlier release');
  await page.waitForTimeout(5100);
  assert.equal(await version.evaluate(el => el.classList.contains('version-highlight')), false, 'Highlight ends after five seconds');
  await page.reload();
  assert.equal(await version.evaluate(el => el.classList.contains('version-highlight')), false, 'Refreshing the same release does not highlight it');
  // Seed an old release in one tab and open another on the current release; reload the old
  // tab to verify that shared storage changes do not hide an upgrade it has not yet seen.
  await page.evaluate(key => { sessionStorage.setItem(key, '0.4.37'); localStorage.setItem(key, '0.4.37'); }, key);
  const secondTab = await context.newPage();
  await secondTab.goto(base, { waitUntil: 'load' });
  assert.equal(await secondTab.evaluate(key => localStorage.getItem(key), key), GAME_VERSION, 'Another tab records the new release');
  await page.reload();
  assert.equal(await version.evaluate(el => el.classList.contains('version-highlight')), true, 'An old tab notices an update activated elsewhere');
  await context.close();

  // Repeat highlighting on portrait/landscape phones, including reduced motion; measure
  // version and Install bounds to check visibility and absence of overlap.
  for (const viewport of [{ width: 390, height: 844 }, { width: 900, height: 400 }]) {
    const mobileContext = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(base, { waitUntil: 'load' });
    if (viewport.width === 390) await mobilePage.emulateMedia({ reducedMotion: 'reduce' });
    await mobilePage.evaluate(key => sessionStorage.setItem(key, '0.4.37'), key);
    await mobilePage.reload();
    const highlighted = mobilePage.locator('.status-bar .version');
    if (viewport.width === 390) assert.equal(await highlighted.evaluate(el => getComputedStyle(el).animationName), 'none', 'Reduced motion keeps a static highlight');
    const bounds = await highlighted.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `Highlighted version fits ${viewport.width}×${viewport.height}`);
    const installButton = await mobilePage.locator('#install-app').boundingBox();
    if (installButton) assert.ok(bounds.x >= installButton.x + installButton.width || bounds.x + bounds.width <= installButton.x, 'Highlight does not overlap Install app');
    await mobileContext.close();
  }
  console.log('Version highlight: first upgrade, same-version reload, second tab, five-second timeout, and mobile layouts verified.');
}

// Exercise metadata discovery through the controlling worker and both download policies.
async function testVersionInformation(browser, base) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const panel = page.locator('#version-panel');
  const guide = page.locator('#guide-dialog');
  const latest = panel.locator('[data-latest]');
  const reopen = async () => { await page.locator('.status-bar .version').click(); };
  const waitLatest = text => page.waitForFunction(text => document.querySelector('#version-panel [data-latest]').textContent.includes(text), text);
  try {
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Game files are ready offline.');
    assert.equal(await page.evaluate(async () => (await caches.match(new URL('version.json', location.href))) === undefined), true, 'Version metadata is never precached');
    await reopen();
    await waitLatest('You are up to date');
    assert.match(await panel.textContent(), new RegExp(`Current versionv${GAME_VERSION}`));
    assert.equal(await panel.locator('[data-version-action]').isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.locator('.status-bar .version').evaluate(el => el === document.activeElement), true);

    // Delay a real network reply through the controlling worker and open Info
    // during the request: both entry points must share one metadata fetch.
    versionReply = { body: JSON.stringify({ version: GAME_VERSION }), delay: 700 };
    const before = versionRequests;
    await reopen();
    assert.match(await latest.textContent(), /Checking/);
    await page.locator('#clear-canvas').click();
    assert.equal(await page.locator('#beam-count').textContent(), '0', 'Editing remains responsive during version discovery');
    await page.locator('#undo').click();
    await page.locator('#guide').click();
    await page.waitForFunction(() => document.querySelector('#guide-dialog [data-latest]').textContent.includes('up to date'));
    assert.equal(versionRequests - before, 1, 'Two entry points join the pending metadata check');
    await page.locator('#close-guide').click();

    for (const reply of [{ status: 503, body: 'Unavailable' }, { body: '{invalid' }, { body: '{"version":"wrong"}' }]) {
      versionReply = reply;
      await reopen();
      await waitLatest('Could not check');
    }
    // Shorten only the application's metadata deadline, leaving browser/test
    // timeouts and worker installation clocks untouched.
    await page.evaluate(() => {
      const nativeTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 10000 ? 100 : delay, ...args);
    });
    versionReply = { body: JSON.stringify({ version: GAME_VERSION }), delay: 500 };
    await reopen();
    await waitLatest('Could not check');
    await context.setOffline(true);
    versionReply = undefined;
    await reopen();
    await waitLatest('Could not check');
    await page.locator('#run').click();
    await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance').textContent));
    await page.locator('#back').click();
    await context.setOffline(false);

    versionReply = { body: '{"version":"99.0.0"}' };
    await page.evaluate(() => {
      const nativeUpdate = ServiceWorkerRegistration.prototype.update;
      window.explicitUpdateCalls = 0;
      ServiceWorkerRegistration.prototype.update = function () { window.explicitUpdateCalls++; return nativeUpdate.call(this); };
      window.beforeVersionReload = true;
    });
    await reopen();
    await waitLatest('99.0.0');
    assert.equal(await page.evaluate(() => window.explicitUpdateCalls), 0, 'Status panel discovery does not start downloading');
    workerUnavailable = true;
    await panel.locator('[data-version-action]').click();
    await page.waitForFunction(() => document.querySelector('#version-panel [data-download]').textContent.includes('could not be downloaded'));
    assert.match(await latest.textContent(), /99\.0\.0/, 'Download failure preserves the discovered version');
    workerUnavailable = false;
    const originalWorker = await readFile(join(root, 'sw.js'), 'utf8');
    workerOverride = originalWorker.replace(/bar-lab-static-[a-f0-9]{16}/, 'bar-lab-static-0000000000000020')
      .replace('await cache.addAll', "throw new Error('Simulated precache failure'); await cache.addAll");
    await panel.locator('[data-version-action]').click();
    await page.waitForFunction(() => document.querySelector('#version-panel [data-download]').textContent.includes('could not be downloaded'));
    assert.equal(await panel.locator('[data-version-action]').textContent(), 'Retry download', 'Failed worker installation can be retried');
    workerOverride = originalWorker.replace(/bar-lab-static-[a-f0-9]{16}/, 'bar-lab-static-0000000000000021');
    await panel.locator('[data-version-action]').click();
    await page.waitForFunction(() => document.querySelector('#version-panel [data-version-action]').textContent === 'Reload');
    assert.equal(await page.evaluate(() => window.beforeVersionReload), true, 'Download does not reload automatically');
    const beamCount = await page.locator('#beam-count').textContent();
    await Promise.all([page.waitForEvent('load'), panel.locator('[data-version-action]').click()]);
    assert.equal(await page.locator('#beam-count').textContent(), beamCount, 'Manual update preserves the project');
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Game files are ready offline.');

    workerOverride = originalWorker.replace(/bar-lab-static-[a-f0-9]{16}/, 'bar-lab-static-0000000000000022');
    await page.evaluate(() => { window.beforeInfoReload = true; });
    await page.locator('#guide').click();
    await page.waitForFunction(() => document.querySelector('#guide-dialog [data-version-action]').textContent === 'Reload');
    assert.match(await guide.locator('[data-latest]').textContent(), /99\.0\.0/);
    assert.equal(await page.evaluate(() => window.beforeInfoReload), true, 'Info automatically downloads but waits for Reload');
    await mkdir(resolve('screenshots'), { recursive: true });
    await page.screenshot({ path: resolve('screenshots/version-info.png') });
    await Promise.all([page.waitForEvent('load'), guide.locator('[data-version-action]').click()]);
    assert.equal(await page.locator('#beam-count').textContent(), beamCount);
    assert.deepEqual(errors, []);
    console.log('Version information: fresh metadata, shared checks, failures, timeout, offline editing, manual download, automatic Info download and explicit reload verified.');
  } finally {
    versionReply = undefined;
    workerUnavailable = false;
    workerOverride = undefined;
    await context.close();
  }
  // The same relative metadata URL must work from a subdirectory deployment;
  // use the narrowest portrait and short landscape viewports to bound the panel.
  for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
    const mobile = await browser.newContext({ viewport });
    try {
      const tab = await mobile.newPage();
      await tab.goto(`${base}/frameLab/`);
      await tab.locator('.status-bar .version').focus();
      await tab.keyboard.press('Enter');
      await tab.waitForFunction(() => document.querySelector('#version-panel [data-latest]').textContent.includes('up to date'));
      const bounds = await tab.locator('#version-panel').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
      await tab.screenshot({ path: resolve(`screenshots/version-panel-${viewport.width}.png`) });
      await tab.locator('#version-panel button[aria-label="Close version information"]').click();
      assert.equal(await tab.locator('#version-panel').isVisible(), false);
    } finally { await mobile.close(); }
  }
}

// Intercept only the update polling timer and count worker update calls while advancing ten-minute
// intervals; force failures and pending requests, then serve a changed worker and activate it by click.
async function testPeriodicUpdates(browser, base) {
  const context = await browser.newContext();
  try {
    // Advance only the ten-minute update interval; rendering and simulation use real time.
    await context.addInitScript(() => {
      const poll = window.updatePoll = { elapsed: 0, calls: 0, completed: 0, failures: 0, hold: false };
      const nativeInterval = window.setInterval;
      window.setInterval = function (callback, delay, ...args) {
        if (delay !== 600000) return nativeInterval.call(this, callback, delay, ...args);
        let next = delay;
        poll.advance = milliseconds => {
          poll.elapsed += milliseconds;
          while (next <= poll.elapsed) {
            next += delay;
            void callback(...args);
          }
        };
        return -1;
      };
      const nativeUpdate = ServiceWorkerRegistration.prototype.update;
      ServiceWorkerRegistration.prototype.update = async function () {
        poll.calls++;
        try {
          if (poll.hold) await new Promise((resolve, reject) => { poll.release = () => reject(new Error('Delayed update failed')); });
          return await nativeUpdate.call(this);
        } catch (error) {
          poll.failures++;
          throw error;
        } finally { poll.completed++; }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    // Start with an already installed worker, as on a normal return visit.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null && !!window.updatePoll.advance);
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Game files are ready offline.');
    const messages = () => page.evaluate(() => ['#toast', '#status'].map(selector => document.querySelector(selector).textContent));
    const before = await messages();
    // Chromium's browser-level worker updates can bypass context.setOffline().
    workerUnavailable = true;
    await context.setOffline(true);
    await page.evaluate(() => window.updatePoll.advance(599999));
    assert.equal(await page.evaluate(() => window.updatePoll.calls), 0, 'No periodic check before ten minutes');
    await page.evaluate(() => window.updatePoll.advance(1));
    await page.waitForFunction(() => window.updatePoll.completed === 1);
    assert.equal(await page.evaluate(() => window.updatePoll.failures), 1, 'Offline update check rejects');
    assert.deepEqual(await messages(), before, 'Failed check does not change toast or status');
    assert.equal(await page.locator('#update-app').isVisible(), false);
    // After a failed offline update, clear/undo the project and run the physics worker;
    // verify that editing and simulation remain functional despite the silent failure.
    const beamCount = await page.locator('#beam-count').textContent();
    await page.locator('#clear-canvas').click();
    assert.equal(await page.locator('#beam-count').textContent(), '0', 'Editing works after a failed check');
    await page.locator('#undo').click();
    assert.equal(await page.locator('#beam-count').textContent(), beamCount);
    await page.locator('#run').click();
    await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, { timeout: 10000 });
    await page.locator('#back').click();

    // Hold an update request while advancing another interval and compare call counts to
    // verify non-overlap; reject the held request so a later interval can retry.
    await context.setOffline(false);
    workerUnavailable = false;
    await page.evaluate(() => { window.updatePoll.hold = true; window.updatePoll.advance(600000); });
    assert.equal(await page.evaluate(() => window.updatePoll.calls), 2);
    await page.evaluate(() => window.updatePoll.advance(600000));
    assert.equal(await page.evaluate(() => window.updatePoll.calls), 2, 'Pending update prevents overlapping checks');
    await page.evaluate(() => { window.updatePoll.hold = false; window.updatePoll.release(); });
    await page.waitForFunction(() => window.updatePoll.completed === 2);

    // Serve a worker with a new cache identity and advance the next interval; inspect waiting
    // state and no automatic reload, then activate by click and compare the restored project.
    const originalWorker = await readFile(join(root, 'sw.js'), 'utf8');
    workerOverride = originalWorker.replace(/bar-lab-static-[a-f0-9]{16}/, 'bar-lab-static-0000000000000010');
    await page.evaluate(() => { window.beforeUpdateClick = true; window.updatePoll.advance(600000); });
    await page.locator('#update-app').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.evaluate(() => window.updatePoll.calls), 3, 'Next interval retries after failures');
    assert.equal(await page.evaluate(() => window.beforeUpdateClick), true, 'Discovery does not reload the page');
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true, 'New worker waits for a click');
    assert.deepEqual(errors, [], 'Failed checks produce no unhandled errors');
    await Promise.all([page.waitForEvent('load'), page.locator('#update-app').click()]);
    assert.equal(await page.evaluate(() => window.beforeUpdateClick), undefined, 'Click reloads the application');
    assert.equal(await page.locator('#update-app').isVisible(), false);
    assert.equal(await page.locator('#beam-count').textContent(), beamCount, 'Project survives the update');
    console.log('Periodic updates: ten-minute interval, silent offline failure, editing/simulation, no overlap, retry and activation by click verified.');
  } finally {
    workerUnavailable = false;
    workerOverride = undefined;
    await context.close();
  }
}

// Install and inspect the complete asset cache, save a design, then restart pages with networking
// disabled; fetch document/error cases, run simulation, and activate worker updates across two tabs.
async function testOffline(browser, base) {
  const context = await browser.newContext();
  let page = await context.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Inspect Cache Storage after worker installation and verify precached document, manifest,
  // icons, styles, scripts and fonts rather than relying on the HTTP browser cache.
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find(name => name.startsWith('bar-lab-static-')));
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  for (const suffix of ['/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '.css', '.js', '.woff2', '.wav']) {
    assert.ok(cached.some(path => path.endsWith(suffix)), `Offline cache contains ${suffix}`);
  }
  await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith('bar-lab-static-'));
    await (await caches.open(name)).put(new URL('assets/legacy.css', location.href), new Response('/* legacy */', { headers: { 'Content-Type': 'text/css' } }));
  });
  const design = { metadata: { size: [32, 18], gameVersion: '0.4.0', formatVersion: 3 }, objects: { b: [[-3, 0, 1, 0, 's']] } };
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify(design));
  await page.locator('#load').click();
  assert.equal(await page.evaluate(() => !!localStorage.getItem('bar-lab:last-project:v1')), true);
  // Save a known design, disable networking and reopen the page; compare the restored beam
  // count to verify that both the application and the saved project survive an offline restart.
  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  await page.goto(base, { waitUntil: 'load' });
  assert.equal(await page.locator('#beam-count').textContent(), '1', 'Last project is restored offline');
  const offlineSound = await page.evaluate(async () => {
    const response = await fetch('sounds/ropeTensionLoop.wav');
    const context = new AudioContext();
    try { const buffer = await context.decodeAudioData(await response.arrayBuffer()); return { status: response.status, seconds: buffer.duration }; }
    finally { await context.close(); }
  });
  assert.equal(offlineSound.status, 200, 'The rope WAV is precached for offline play');
  assert.ok(offlineSound.seconds > 2, 'An offline browser can decode the tension loop');
  // Fetch root/index URLs with query strings, an uncached script and a temporarily uncached
  // document; inspect cached HTML and controlled plain-text 503 responses instead of rejected fetches.
  const offlineDocuments = await page.evaluate(async () => {
    const results = [];
    for (const path of ['./', './?probe=1', 'index.html?probe=1']) {
      const response = await fetch(path);
      results.push({ status: response.status, html: (await response.text()).includes('<!doctype html>') });
    }
    const missing = await fetch('assets/uncached-offline-probe.js');
    const index = new URL('index.html', location.href);
    const saved = [];
    let missingDocument;
    try {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name), response = await cache.match(index);
        if (response) { saved.push([cache, response]); await cache.delete(index); }
      }
      missingDocument = (await fetch('./')).status;
    } finally {
      for (const [cache, response] of saved) await cache.put(index, response);
    }
    return { results, missingDocument, missing: { status: missing.status, type: missing.headers.get('content-type') } };
  });
  assert.deepEqual(offlineDocuments.results, Array(3).fill({ status: 200, html: true }), 'Offline fetches of / and index.html share the document cache, including query strings');
  assert.equal(offlineDocuments.missing.status, 503, 'Uncached offline resources return HTTP 503 instead of a rejected FetchEvent');
  assert.match(offlineDocuments.missing.type, /text\/plain/, 'Missing scripts do not receive an HTML fallback');
  assert.equal(offlineDocuments.missingDocument, 503, 'A missing document cache and failed network produce a controlled response');
  // Run the physics worker offline, then clear and undo the design; compare durable storage
  // after each edit to verify that local persistence does not require networking.
  await page.locator('#run').click();
  await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, { timeout: 10000 });
  await page.locator('#back').click();
  await page.locator('#clear-canvas').click();
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('bar-lab:last-project:v1'))).objects, {}, 'Clear persists');
  await page.locator('#undo').click();
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('bar-lab:last-project:v1'))).objects, design.objects, 'Undo persists');
  // Restore networking and serve a new worker identity; activate through the UI and verify
  // project preservation, version highlighting and continued access to an older cached asset.
  await context.setOffline(false);
  const originalWorker = await readFile(join(root, 'sw.js'), 'utf8');
  workerOverride = originalWorker.replace(/bar-lab-static-[a-f0-9]{16}/, 'bar-lab-static-0000000000000001');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.locator('#update-app').waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => sessionStorage.setItem('bar-lab:seen-version:v1', '0.4.37'));
  await Promise.all([page.waitForEvent('load'), page.locator('#update-app').click()]);
  assert.equal(await page.locator('.status-bar .version').evaluate(el => el.classList.contains('version-highlight')), true, 'Updated release highlights its version');
  assert.equal(await page.locator('#beam-count').textContent(), '1', 'Project survives an app update');
  assert.equal(await page.locator('#update-app').isVisible(), false, 'Update button disappears after reload');
  assert.equal(await page.evaluate(async () => (await fetch('assets/legacy.css')).text()), '/* legacy */', 'Older cached assets remain available after activation');
  // Activate another update in a second tab; inspect the first tab's Update active prompt
  // and explicitly reload it to verify cross-tab activation and upgrade highlighting.
  const secondTab = await context.newPage();
  await secondTab.goto(base, { waitUntil: 'load' });
  workerOverride = originalWorker.replace(/bar-lab-static-[a-f0-9]{16}/, 'bar-lab-static-0000000000000002');
  await secondTab.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await secondTab.locator('#update-app').waitFor({ state: 'visible', timeout: 10000 });
  await Promise.all([secondTab.waitForEvent('load'), secondTab.locator('#update-app').click()]);
  await page.locator('#update-app').waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await page.locator('#update-app').textContent(), /Update active/, 'Another tab can activate the update');
  await page.evaluate(() => sessionStorage.setItem('bar-lab:seen-version:v1', '0.4.37'));
  await Promise.all([page.waitForEvent('load'), page.locator('#update-app').click()]);
  assert.equal(await page.locator('.status-bar .version').evaluate(el => el.classList.contains('version-highlight')), true, 'Reload after another tab updates highlights the version');
  assert.equal(await page.locator('#update-app').isVisible(), false, 'Reload button disappears after another tab updates');
  await secondTab.close();
  workerOverride = undefined;
  // Corrupt saved project text and reload; check the restoration warning and starter-design fallback.
  await page.evaluate(() => localStorage.setItem('bar-lab:last-project:v1', '{'));
  await page.reload();
  assert.match(await page.locator('#status').textContent(), /could not be restored/);
  assert.equal(await page.locator('#beam-count').textContent(), '31', 'Invalid local storage falls back to the starter project');
  await context.close();
  // Install under /frameLab/ and restart offline there; fetch its document and run the
  // simulation to verify subpath-scoped cache and worker asset URLs.
  const subContext = await browser.newContext();
  page = await subContext.newPage();
  await page.goto(base + '/frameLab/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await subContext.setOffline(true);
  await page.close();
  page = await subContext.newPage();
  await page.goto(base + '/frameLab/');
  assert.equal(await page.evaluate(async () => (await fetch('./?probe=1')).status), 200, 'Non-navigation document fetch also works offline under a subpath');
  await page.locator('#run').click();
  await page.waitForFunction(() => /[1-9]\d*\.\d S/.test(document.querySelector('#performance')?.textContent || ''), undefined, { timeout: 10000 });
  await subContext.close();
  console.log('Offline: full precache, restart, project restore, simulation and update verified.');
}

async function pinchZoom(page, factor, existingSession = null) {
  const session = existingSession || await page.context().newCDPSession(page);
  const rect = await page.locator('#canvas').boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const points = distance => [{ x: x - distance, y, id: 0 }, { x: x + distance, y, id: 1 }];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(20) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(20 * factor) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (!existingSession) await session.detach();
}

// Open and dismiss the example chooser without changing the project, then load every card and
// compare counts and thumbnails; use Undo and keyboard activation to verify reversible accessible loading.
async function testExamples(page, original) {
  const open = async () => { await page.locator('#examples').click(); assert.equal(await page.locator('#examples-dialog').evaluate(el => el.open), true); };
  const read = async () => { await page.locator('#project-text').click(); const value = await page.locator('#project-json').inputValue(); await page.locator('#close-text').click(); return value; };
  await open();
  assert.equal(await page.locator('[data-example]').count(), 5);
  assert.equal(await page.locator('[data-example="suspension"], [data-example="cantilever"]').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#examples-dialog').evaluate(el => el.open), false);
  assert.equal(await read(), original, 'Closing the examples dialog preserves the project');
  await open(); await page.locator('#close-examples').click();
  assert.equal(await read(), original);
  const expected = {
    bridge: { beams: 31, ropes: 0, size: [32, 18], title: 'Warren bridge' },
    eiffel: { beams: 38, ropes: 0, size: [18, 32], title: 'Eiffel Tower' },
    goldenGate: { beams: 36, ropes: 15, size: [32, 18], title: 'Golden Gate Bridge' },
    sydneyHarbour: { beams: 46, ropes: 0, size: [32, 18], title: 'Sydney Harbour Bridge' },
    blank: { beams: 0, ropes: 0, size: [16, 10], title: 'Blank canvas' },
  };
  // Load each card and check its drawn geometry, then undo both example loading and
  // a project-text round trip before moving to the next landmark.
  for (const [name, { beams, ropes, size, title }] of Object.entries(expected)) {
    await open();
    const card = page.locator(`[data-example="${name}"]`);
    assert.equal(await card.locator('svg').count(), 1);
    assert.equal(await card.locator('span').textContent(), title);
    assert.equal(await card.locator('.example-beams polyline').count() > 0, beams > 0, `${name}: thumbnail geometry`);
    if (name === 'eiffel') {
      const board = await card.locator('.example-board').evaluate(el => ({ width: Number(el.getAttribute('width')), height: Number(el.getAttribute('height')) }));
      assert.ok(board.height > board.width, 'Eiffel thumbnail uses a portrait board');
      assert.ok(board.height <= 76 && board.width <= 136, 'Portrait board fits the thumbnail');
    }
    await card.click();
    assert.equal(await page.locator('#examples-dialog').evaluate(el => el.open), false);
    assert.equal(Number(await page.locator('#beam-count').textContent()), beams, `${name}: beam count`);
    assert.equal(Number(await page.locator('#rope-count').textContent()), ropes, `${name}: rope count`);
    const exported = await read();
    assert.deepEqual(JSON.parse(exported).metadata.size, size, `${name}: board size`);
    assert.equal(JSON.parse(exported).metadata.gameVersion, GAME_VERSION, `${name}: export version`);
    if (name === 'goldenGate') assert.equal(JSON.parse(exported).checksum, 'fnv1a32:3fbdc70d', 'Golden Gate matches the supplied design');
    if (name === 'eiffel' || name === 'goldenGate' || name === 'sydneyHarbour') {
      await page.locator('#run').click();
      await page.locator('#back').click();
      assert.equal(await read(), exported, `${name}: simulation leaves the design intact`);
    }
    assert.equal(await page.locator('#project-name').count(), 0, 'Project heading is removed');
    await page.locator('#undo').click();
    assert.equal(await read(), original, `${name}: Undo restores previous project`);
    if (name === 'eiffel' || name === 'goldenGate' || name === 'sydneyHarbour') {
      await page.locator('#project-text').click();
      await page.locator('#project-json').fill(exported);
      await page.locator('#load').click();
      assert.equal(await read(), exported, `${name}: export imports without changes`);
      await page.locator('#undo').click();
      assert.equal(await read(), original, `${name}: Undo restores after import`);
    }
  }
  // Use Enter to open the chooser and load Blank canvas; inspect its empty design, then
  // undo and compare project text to cover accessible keyboard loading.
  await page.locator('#examples').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#examples-dialog').evaluate(el => el.open), true, 'Keyboard opens examples');
  await page.locator('[data-example="blank"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#beam-count').textContent(), '0', 'Keyboard loads an example');
  await page.locator('#undo').click();
  assert.equal(await read(), original, 'Undo restores project after keyboard selection');
}

async function chooseProfile(page, profile) {
  await page.locator('[data-tool="beam"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.locator(`#profile-picker [data-profile="${profile}"]`).click();
}

// Submit invalid and valid board dimensions through Settings; compare errors, exported sizes
// and support removal, then exercise Undo/Redo and restore the original document.
async function testCanvasSize(page, original) {
  const read = async () => { await page.locator('#project-text').click(); const p = JSON.parse(await page.locator('#project-json').inputValue()); await page.locator('#close-text').click(); return p; };
  const open = async (width, height) => {
    await page.evaluate(() => { const dialog = document.querySelector('#text-dialog'); if (dialog?.open) dialog.close(); });
    await page.locator('#settings').click();
    await page.locator('#canvas-width').fill(String(width));
    await page.locator('#canvas-height').fill(String(height));
    await page.locator('#canvas-size-form button[type="submit"]').click();
  };
  await page.locator('#settings').click();
  assert.equal(await page.locator('#canvas-width').inputValue(), '16');
  assert.equal(await page.locator('#canvas-height').inputValue(), '10');
  await page.locator('#canvas-width').fill('10'); await page.locator('#canvas-height').fill('14');
  await page.locator('#canvas-size-form button[type="submit"]').click();
  assert.match(await page.locator('#canvas-size-error').textContent(), /even/);
  assert.match(await page.locator('#board-size').textContent(), /^16 . 10 GRID$/);
  await page.locator('#canvas-width').fill('12'); await page.locator('#canvas-height').fill('8');
  await page.locator('#canvas-size-form button[type="submit"]').click();
  assert.match(await page.locator('#canvas-size-error').textContent(), /cut off/);
  assert.match(await page.locator('#board-size').textContent(), /^16 . 10 GRID$/);
  await page.locator('#close-settings').click();

  // Load a boundary support and enlarge the board; inspect size/support exports and Undo/Redo,
  // then allow a safe shrink and reject a size that would cut off existing geometry.
  const withAnchor = JSON.parse(original); withAnchor.objects.a = [[8, 2, 'o']];
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify(withAnchor));
  await page.locator('#load').click();
  await open(24, 14);
  assert.match(await page.locator('#board-size').textContent(), /^24 . 14 GRID$/);
  let project = await read();
  assert.deepEqual(project.metadata.size, [24, 14]);
  assert.equal(project.objects.a, undefined, 'A boundary support becomes a regular node when its boundary is extended');
  await page.locator('#undo').click();
  assert.match(await page.locator('#board-size').textContent(), /^16 . 10 GRID$/);
  await page.locator('#redo').click();
  assert.match(await page.locator('#board-size').textContent(), /^24 . 14 GRID$/);
  await open(20, 12);
  assert.match(await page.locator('#board-size').textContent(), /^20 . 12 GRID$/, 'A smaller size that contains the design is allowed');
  await page.locator('#undo').click();
  await open(12, 8);
  assert.match(await page.locator('#canvas-size-error').textContent(), /cut off/);
  assert.match(await page.locator('#board-size').textContent(), /^24 . 14 GRID$/);
  await page.locator('#close-settings').click();
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(original);
  await page.locator('#load').click();
  assert.match(await page.locator('#board-size').textContent(), /^16 . 10 GRID$/);
}

// Drive real mouse and keyboard selection gestures, context menus and profile/node edits against
// known fixtures; compare selection counts, exported geometry, history and navigation precedence.
async function testMouseControls(page, point, readProject) {
  const load = async objects => {
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify({ metadata: {size:[32,18], gameVersion:'0.4.0', formatVersion:3}, objects }));
    await page.locator('#load').click();
  };
  const fixture = { b:[[-6,0,-2,0,'s'],[-2,0,2,0,'h']], r:[[2,0,6,0]] };
  const click = async (x,y,button='left') => { const p=await point(x,y); await page.mouse.click(p.x,p.y,{button}); };
  const ctrlClick = async (x,y) => { await page.keyboard.down('Control'); await click(x,y); await page.keyboard.up('Control'); };
  const box = async (a,b,add=false,zoom=1,pan=[0,0]) => {
    const center=await point(16,9);
    const transform=async xy => { const p=await point(...xy); return {x:center.x+(p.x-center.x)*zoom+pan[0],y:center.y+(p.y-center.y)*zoom+pan[1]}; };
    const p=await transform(a),q=await transform(b);
    if(add) await page.keyboard.down('Control'); await page.keyboard.down('Shift');
    await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(q.x,q.y,{steps:8}); await page.mouse.up();
    await page.keyboard.up('Shift'); if(add) await page.keyboard.up('Control');
  };
  await load(fixture);
  await click(10,9);
  assert.equal((await readProject()).objects.j,undefined,'Single click starts drawing without toggling');
  await page.keyboard.press('Escape');
  // Ctrl-select two beam profiles and edit them through the context menu; compare inspector
  // state, exported profiles and keyboard Undo/Redo for one reversible group change.
  await ctrlClick(12,9); await ctrlClick(16,9);
  assert.match(await page.locator('#inspector-title').textContent(),/2 selected/);
  assert.match(await page.locator('#inspector-copy').textContent(),/Mixed/);
  await click(12,9,'right');
  assert.equal(await page.locator('#context-menu button').count(),4,'Beam group menu');
  await page.locator('#context-menu button').filter({hasText:'Light beam'}).click();
  assert.deepEqual((await readProject()).objects.b.map(b=>b[4]),['l','l']);
  assert.match(await page.locator('#inspector-title').textContent(),/2 selected/);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await readProject()).objects.b.map(b=>b[4]),['s','h'],'One undo restores whole group');
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual((await readProject()).objects.b.map(b=>b[4]),['l','l']);
  await ctrlClick(12,9); await ctrlClick(12,9);
  assert.equal(await page.locator('#delete-selection').isVisible(),false,'Ctrl click deselects');
  await ctrlClick(12,9); await ctrlClick(20,9);
  await click(12,9,'right');
  assert.equal(await page.locator('#context-menu button').count(),1,'Mixed group has deletion only');
  await page.keyboard.press('Escape');
  assert.match(await page.locator('#inspector-title').textContent(),/2 selected/,'Escape first closes menu');
  await page.keyboard.press('Escape');
  // Draw replacing, additive and reversed rectangles; compare selected counts, then delete
  // a selected node and inspect the remaining members through Undo/Redo.
  await box([9,8],[15,10]);
  assert.match(await page.locator('#inspector-title').textContent(),/3 selected/,'Box includes one whole beam and its two nodes');
  await box([15,8],[19,10],true);
  assert.match(await page.locator('#inspector-title').textContent(),/4 selected/,'Additive box adds node, not partially enclosed members');
  await box([15,10],[13,8]);
  assert.match(await page.locator('#inspector-title').textContent(),/1 selected/,'Reverse box replaces selection');
  assert.match(await page.locator('#delete-selection').textContent(),/Delete selection/);
  await page.keyboard.press('Delete');
  assert.equal((await readProject()).objects.b,undefined,'Deleting node removes both attached beams');
  assert.equal((await readProject()).objects.r.length,1);
  await page.keyboard.press('Control+z');
  assert.equal((await readProject()).objects.b.length,2);
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await readProject()).objects.b,undefined);
  // Delete an eligible straight-chain midpoint through Delete and Erase; compare the merged
  // span and release metadata, and undo to restore the original two segments.
  const straight = { b:[[-2,0,0,0,'s'],[0,0,2,0,'s']] };
  await load(straight);
  await ctrlClick(16,9);
  await page.keyboard.press('Delete');
  const joined = await readProject();
  assert.deepEqual(joined.objects.b,[[-2,0,2,0,'s']]);
  assert.equal(await page.locator('.status-bar .version').textContent(),`v${joined.metadata.gameVersion}`);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await readProject()).objects,straight);
  await page.locator('[data-tool="erase"]').click();
  await click(16,9);
  assert.deepEqual((await readProject()).objects,joined.objects);
  await page.locator('[data-tool="beam"]').click();
  await load(fixture);
  // Zoom and middle-pan before drawing a rectangle to verify transformed selection; then
  // cancel a pending rectangle with Escape and inspect the empty selection.
  await page.locator('#zoom-in').click();
  await page.waitForFunction(()=>document.querySelector('#zoom-value').textContent==='125%');
  const center=await point(16,9);
  await page.mouse.move(center.x,center.y); await page.mouse.down({button:'middle'});
  await page.mouse.move(center.x+35,center.y+20,{steps:5}); await page.mouse.up({button:'middle'});
  await box([9,8],[15,10],false,1.25,[35,20]);
  assert.match(await page.locator('#inspector-title').textContent(),/3 selected/,'Box works after zoom and pan');
  await page.locator('#fit').click();
  await page.keyboard.press('Escape');
  const a=await point(9,8),b=await point(15,10);
  await page.keyboard.down('Shift'); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Shift');
  assert.equal(await page.locator('#delete-selection').isVisible(),false,'Escape cancels active rectangle');
  // Operate the menu with End/Enter, right-click empty space and a rope, and attempt editing
  // during simulation; compare geometry and menu visibility to check input routing.
  await click(12,9,'right');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal((await readProject()).objects.b.length,1,'Keyboard operates menu');
  await page.keyboard.press('Control+z');
  await ctrlClick(12,9);
  await click(16,5,'right');
  assert.equal(await page.locator('#context-menu').isVisible(),false);
  assert.match(await page.locator('#inspector-title').textContent(),/1 selected/,'Empty right click preserves selection');
  await click(20,9,'right');
  assert.equal(await page.locator('#context-menu button').count(),1,'Rope menu');
  await page.keyboard.press('Escape');
  await page.locator('#run').click();
  await click(14,9,'right'); await ctrlClick(14,9);
  assert.equal(await page.locator('#context-menu').isVisible(),false,'Simulation blocks editing');
  await page.locator('#back').click();
  assert.equal((await readProject()).objects.b.length,2);
  // Node groups may contain different current connection values.
  await load({...fixture,j:[[-2,0,'o']]});
  await ctrlClick(10,9); await ctrlClick(14,9);
  assert.match(await page.locator('#inspector-copy').textContent(),/Mixed/);
  await click(14,9,'right');
  await page.locator('#context-menu button').filter({hasText:'Hinge connection'}).click();
  assert.deepEqual((await readProject()).objects.j,[[-6,0,'o'],[-2,0,'o']]);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await readProject()).objects.j,[[-2,0,'o']]);
  // Modifiers override Erase, and a tool change clears pending gestures.
  await page.locator('[data-tool="erase"]').click(); await ctrlClick(12,9);
  assert.equal((await readProject()).objects.b.length,2);
  assert.match(await page.locator('#inspector-title').textContent(),/1 selected/);
  await page.locator('[data-tool="beam"]').click();
  await click(14,9); await page.keyboard.press('Escape');
  const cancel=await point(16,6); await page.mouse.move(cancel.x,cancel.y); await page.mouse.down();
  await page.locator('#canvas').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse'});
  await page.mouse.up();
  assert.equal((await readProject()).objects.b.length,2,'Pointer cancellation cannot create a member');
  // Space activates a menu item instead of starting the simulation.
  await click(12,9,'right'); await page.keyboard.press('Space');
  assert.equal(await page.locator('#run').isVisible(), true, 'Build mode shows the run button');
  assert.equal((await readProject()).objects.b[0][4],'l');
  // Boundary double click and separate support settings.
  await load({b:[[12,0,16,0,'s']]});
  await page.locator('[data-tool="select"]').click();
  const node=await point(32,9); await page.mouse.dblclick(node.x,node.y,{delay:50});
  let project=await readProject(); assert.deepEqual(project.objects.a,[[16,0,'o']]); assert.deepEqual(project.objects.j,[[16,0,'o']]);
  await click(32,9,'right');
  const menuBounds=await page.locator('#context-menu').boundingBox();
  assert.ok(menuBounds.x>=0 && menuBounds.x+menuBounds.width<=1440 && menuBounds.y>=0 && menuBounds.y+menuBounds.height<=1000);
  await page.screenshot({path:join(tmpdir(), 'frame-lab-context-menu.png')});
  await page.locator('#context-menu button').filter({hasText:'Fixed support'}).click();
  project=await readProject(); assert.equal(project.objects.a,undefined); assert.deepEqual(project.objects.j,[[16,0,'o']]);
  await page.locator('[data-tool="beam"]').click();
}

// Drag a shared beam/rope node with mouse or native touch events; compare live cost, stable canvas
// bounds and unsaved previews, then verify limits, cancellation, merges, history and reload persistence.
async function testNodeMoves(page, mobile, point, readProject) {
  const session = mobile ? await page.context().newCDPSession(page) : null;
  const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  const down = async p => {
    if (mobile) await touch('touchStart', { ...p, id: 0 });
    else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
  };
  const move = p => mobile ? touch('touchMove', { ...p, id: 0 }) : page.mouse.move(p.x, p.y);
  const up = () => mobile ? touch('touchEnd') : page.mouse.up();
  const fixture = { b: [[-4,0,0,0,'s']], r: [[0,0,3,0]], j: [[0,0,'o']] };
  const load = async objects => {
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify({ metadata:{size:[32,18],gameVersion:GAME_VERSION,formatVersion:3}, objects }));
    await page.locator('#load').click();
    await page.locator('[data-tool="select"]').click();
    await page.waitForTimeout(60);
  };
  const drag = async (a,b) => { await down(await point(...a)); await move(await point(...b)); await up(); };
  await load(fixture);
  const originalCost = await page.locator('#total-cost').textContent();
  const canvasBefore = await page.locator('#canvas').boundingBox();
  await down(await point(16,9)); await move(await point(16,7));
  assert.match(await page.locator('#total-cost').textContent(), /\([+-]\d+\)/, 'Drag previews the cost delta');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bar-lab:last-project:v1')).objects.j[0][1]), 0, 'Preview does not save the project');
  assert.deepEqual(await page.locator('#canvas').boundingBox(), canvasBefore, 'Preview keeps the canvas stationary');
  await mkdir('screenshots', { recursive: true });
  await page.screenshot({path:resolve('screenshots', `node-move-${mobile ? 'touch' : 'mouse'}.png`)});
  await up();
  const moved = (await readProject()).objects;
  assert.deepEqual(moved, {b:[[-4,0,0,2,'s']],r:[[0,2,3,0]],j:[[0,2,'o']]});
  assert.notEqual(await page.locator('#total-cost').textContent(), originalCost);
  await page.locator('#undo').click(); assert.deepEqual((await readProject()).objects, fixture, 'One undo restores the entire drag');
  await page.locator('#redo').click(); assert.deepEqual((await readProject()).objects, moved);

  // Release an overlength move, cancel another, return to zero displacement and drop outside
  // the board; compare exports and cost to check that each unsuccessful move rolls back completely.
  await load(fixture);
  await down(await point(16,9)); await move(await point(23,9));
  await page.screenshot({path:resolve('screenshots', `node-move-invalid-${mobile ? 'touch' : 'mouse'}.png`)});
  await up();
  assert.deepEqual((await readProject()).objects, fixture, 'Invalid release discards the whole move');
  assert.match(await page.locator('#toast').textContent(), /Maximum beam/);
  await down(await point(16,9)); await move(await point(16,7));
  if (mobile) await touch('touchCancel'); else { await page.keyboard.press('Escape'); await up(); }
  assert.deepEqual((await readProject()).objects, fixture, 'Cancellation restores geometry and joint type');
  assert.equal(await page.locator('#total-cost').textContent(), originalCost);
  await down(await point(16,9)); await move(await point(16,7)); await move(await point(16,9)); await up();
  assert.deepEqual((await readProject()).objects, fixture, 'Returning to the source is a no-op');
  await drag([16,9],[33,9]);
  assert.deepEqual((await readProject()).objects, fixture, 'Dropping outside the board cancels the move');
  if (mobile) {
    await down(await point(16,9)); await move(await point(16,7));
    const a = await point(16,7), b = await point(20,7);
    await touch('touchStart', {...a,id:0}, {...b,id:1}); await up();
    assert.deepEqual((await readProject()).objects, fixture, 'A second finger cancels the node move');
  }

  // Drop onto an occupied node with duplicate beams and a collapsing rope; compare the
  // normalized export, exercise Undo/Redo and reload to verify the durable merged result.
  const merging = { b:[[-4,0,0,0,'h'],[-4,2,0,0,'l']], r:[[-4,0,-4,2]], j:[[-4,0,'o']] };
  await load(merging);
  const beforeMerge = (await readProject()).objects;
  await drag([12,9],[12,7]);
  assert.deepEqual((await readProject()).objects, {b:[[-4,2,0,0,'l']]}, 'Merge removes zero-length and duplicate members and keeps stationary types/profile');
  await page.locator('#undo').click(); assert.deepEqual((await readProject()).objects, beforeMerge);
  await page.locator('#redo').click();
  const saved = (await readProject()).objects;
  await page.reload(); await page.locator('#canvas').waitFor();
  assert.deepEqual((await readProject()).objects, saved, 'Committed move survives reload');
  await session?.detach();
  console.log(`${mobile ? 'Touch' : 'Mouse'} node moves: preview, limits, cancellation, merge, costs, Undo/Redo and persistence verified.`);
}

// Grab a beam off-center and translate it with mouse or native touch events; inspect exact exported
// geometry and connected members, then test rejection, endpoint merges, orientations and persistence.
async function testBeamMoves(page, mobile, point, readProject) {
  const session = mobile ? await page.context().newCDPSession(page) : null;
  const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent', {type,touchPoints});
  const down = async p => {
    if (mobile) await touch('touchStart', {...p,id:0});
    else { await page.mouse.move(p.x,p.y); await page.mouse.down(); }
  };
  const move = p => mobile ? touch('touchMove',{...p,id:0}) : page.mouse.move(p.x,p.y);
  const up = () => mobile ? touch('touchEnd') : page.mouse.up();
  const load = async objects => {
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify({metadata:{size:[32,18],gameVersion:GAME_VERSION,formatVersion:3},objects}));
    await page.locator('#load').click(); await page.locator('[data-tool="select"]').click(); await page.waitForTimeout(60);
  };
  const drag = async (a,b) => { await down(await point(...a)); await move(await point(...b)); await up(); };
  const fixture = {b:[[-8,0,-4,0,'l'],[-4,0,0,0,'h']],r:[[0,0,4,0]],j:[[-4,0,'o']]};
  await load(fixture);
  const before = (await readProject()).objects;
  const bounds = await page.locator('#canvas').boundingBox();
  // Grab away from the exact midpoint: the beam must not jump to the cursor.
  await down(await point(14.2,9)); await move(await point(15.2,7));
  assert.match(await page.locator('#total-cost').textContent(),/\([+-]\d+\)/);
  assert.deepEqual(await page.locator('#canvas').boundingBox(),bounds);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('bar-lab:last-project:v1')).objects),before,'Beam preview does not save');
  await mkdir('screenshots',{recursive:true});
  await page.screenshot({path:resolve('screenshots',`beam-move-${mobile ? 'touch' : 'mouse'}.png`)});
  await up();
  const moved = (await readProject()).objects;
  assert.deepEqual(moved,{b:[[-8,0,-3,2,'l'],[-3,2,1,2,'h']],r:[[1,2,4,0]],j:[[-3,2,'o']]},'Beam translates while connected members stretch');
  assert.equal(await page.locator('[data-change-profile="h"]').getAttribute('class'),'active','Moved beam remains selected');
  await page.locator('#undo').click(); assert.deepEqual((await readProject()).objects,before,'One Undo restores both endpoints and attached elements');
  await page.locator('#redo').click(); assert.deepEqual((await readProject()).objects,moved);
  await page.reload(); await page.locator('#canvas').waitFor();
  assert.deepEqual((await readProject()).objects,moved,'Beam move persists after reload');

  // Try an overlength neighbor, cancellation, zero displacement and an off-board drop;
  // compare exports to verify that failure commits neither beam endpoint.
  await load(fixture);
  await drag([14,9],[14,4]);
  assert.deepEqual((await readProject()).objects,before,'An adjacent beam length limit rejects the entire move');
  assert.match(await page.locator('#toast').textContent(),/Maximum beam/);
  await down(await point(14,9)); await move(await point(15,7));
  if (mobile) await touch('touchCancel'); else { await page.keyboard.press('Escape'); await up(); }
  assert.deepEqual((await readProject()).objects,before,'Cancellation restores both endpoints');
  await down(await point(14,9)); await move(await point(15,7)); await move(await point(14,9)); await up();
  assert.deepEqual((await readProject()).objects,before,'Zero final displacement is a no-op');
  await drag([14,9],[31,9]);
  assert.deepEqual((await readProject()).objects,before,'Both endpoints must stay within the board');
  if (mobile) {
    await down(await point(14,9)); await move(await point(15,7));
    const a=await point(15,7),b=await point(20,7);
    await touch('touchStart',{...a,id:0},{...b,id:1}); await up();
    assert.deepEqual((await readProject()).objects,before,'Second finger cancels a beam move');
  }

  // Drop both ends onto stationary nodes and a duplicate beam; compare the export to verify
  // collapsed-rope removal and precedence of the stationary beam profile.
  await load({b:[[-4,0,0,0,'h'],[-4,2,0,2,'l']],r:[[-4,0,-4,2],[0,0,0,2]],j:[[-4,0,'o']]});
  await drag([14,9],[14,7]);
  assert.deepEqual((await readProject()).objects,{b:[[-4,2,0,2,'l']]},'Both ends merge and stationary profile wins');
  // Repeat translation for diagonal and vertical beams and compare exact endpoint exports
  // to verify preservation of length and orientation beyond the horizontal fixture.
  for (const {beam,from,to,expected} of [
    {beam:[-4,0,0,4,'h'],from:[14,7],to:[15,6],expected:[-3,1,1,5,'h']},
    {beam:[-4,0,-4,4,'h'],from:[12,7],to:[13,6],expected:[-3,5,-3,1,'h']},
  ]) {
    await load({b:[beam]}); await drag(from,to);
    assert.deepEqual((await readProject()).objects.b,[expected],'Diagonal/vertical orientation and length stay constant');
  }
  await session?.detach();
  console.log(`${mobile ? 'Touch' : 'Mouse'} beam moves: translation, connected members, limits, merging, cancellation, Undo/Redo and persistence verified.`);
}

// Draw selection rectangles in every direction, then grab a mixed group by different handles;
// compare selection, geometry and write counts through cancellation, outside grabs and camera transforms.
async function testGroupSelection(page, mobile) {
  await mkdir('screenshots',{recursive:true});
  const session = mobile ? await page.context().newCDPSession(page) : null;
  const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent',{type,touchPoints});
  const down = async p => {
    if (mobile) await touch('touchStart',{...p,id:0});
    else { await page.mouse.move(p.x,p.y); await page.mouse.down(); }
  };
  const move = p => mobile ? touch('touchMove',{...p,id:0}) : page.mouse.move(p.x,p.y);
  const up = () => mobile ? touch('touchEnd') : page.mouse.up();
  const cancel = async () => {
    if (mobile) await touch('touchCancel'); else { await page.keyboard.press('Escape'); await up(); }
  };
  let view = {zoom:1,pan:[0,0]};
  // Convert fixture grid coordinates through the current camera and canvas size.
  // The inspector may change layout after a gesture, so read its bounds each time.
  const point = (x,y) => page.locator('#canvas').evaluate((canvas,{x,y,view}) => {
    const r=canvas.getBoundingClientRect(),margin=r.height<400?20:r.width<600?30:58;
    const scale=Math.min((r.width-margin*2)/32,(r.height-margin*2)/18)*view.zoom;
    return {x:r.left+r.width/2+(x-16)*scale+view.pan[0],y:r.top+r.height/2+(y-9)*scale+view.pan[1]};
  },{x,y,view});
  const read = async () => {
    await page.locator('#project-text').click();const result=JSON.parse(await page.locator('#project-json').inputValue()).objects;
    await page.locator('#close-text').click();return result;
  };
  // These format-v3 objects use grid units relative to the center of the 32 x 18 board:
  // exported (x, y) becomes pointer-grid (x + 16, 9 - y), because exported y points up.
  // b stores [x1, y1, x2, y2, profile] (s = Standard, h = Heavy, l = Light),
  // r stores rope endpoints, and j stores [x, y, joint type] (o = hinged).
  // The first two beams and the rope form a horizontal chain from (-8, 0) to (4, 0).
  // The rectangle below selects that chain's four nodes and three members (7 entries).
  // The third beam connects the group to the stationary node (8, 0), so it must stretch;
  // the fourth beam at y = 4 stays separate, providing an object outside the group to grab.
  const fixture={b:[[-8,0,-4,0,'s'],[-4,0,0,0,'h'],[4,0,8,0,'l'],[8,4,12,4,'s']],r:[[0,0,4,0]],j:[[-4,0,'o']]};
  // Expected export after dragging the group one grid unit right and two units up:
  // add (1, 2) to its four nodes (pointer-grid delta is (1, -2)). The hinged joint
  // follows its node, the third beam's stationary end stays at (8, 0), and the
  // separate fourth beam is unchanged. Thus only the external connection changes length.
  const moved={b:[[-7,2,-3,2,'s'],[-3,2,1,2,'h'],[5,2,8,0,'l'],[8,4,12,4,'s']],r:[[1,2,5,2]],j:[[-3,2,'o']]};
  const load = async () => {
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify({metadata:{size:[32,18],gameVersion:GAME_VERSION,formatVersion:3},objects:fixture}));
    await page.locator('#load').click();await page.locator('[data-tool="select"]').click();
    view={zoom:1,pan:[0,0]};await page.waitForTimeout(50);
    await page.evaluate(() => {
      if (!window.originalGroupSetItem) {
        window.originalGroupSetItem=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key==='bar-lab:last-project:v1')window.groupWrites++;return window.originalGroupSetItem.call(this,key,value);};
      }
      window.groupWrites=0;
    });
  };
  const count = async n => {
    if (n) assert.match(await page.locator('#inspector-title').textContent(),new RegExp(`^${n} selected`));
    else assert.equal(await page.locator('#delete-selection').isVisible(),false);
  };
  const drag = async (a,b) => {await down(await point(...a));await move(await point(...b));await up();};
  const box = async (a=[5,2],b=[22,14]) => drag(a,b);
  const writes = () => page.evaluate(()=>window.groupWrites);

  await load();
  // Each pair is a start/end corner in pointer-grid units, not pixels. The same
  // rectangle (x = 5..22, y = 2..14) is drawn down-right, up-left, down-left and up-right.
  // Its bounds enclose the chain at x = 8, 12, 16, 20 and y = 9, but exclude the
  // stationary nodes at x = 24 and 28. All four starting corners are empty, with
  // enough clearance from nodes/members to avoid touch hit targets even on narrow canvases.
  // Iterating over all directions checks that selection normalizes the rectangle bounds.
  for (const [a,b] of [[[5,2],[22,14]],[[22,14],[5,2]],[[22,2],[5,14]],[[5,14],[22,2]]]) {
    await box(a,b);await count(7);
  }
  assert.deepEqual(await read(),fixture);assert.equal(await writes(),0,'Selecting never saves the project');
  // Move just three CSS pixels before releasing on empty space; inspect selection before
  // and after release to distinguish a pending rectangle from a short deselecting click/tap.
  const small=await point(6,6);await down(small);await move({x:small.x+3,y:small.y});await count(7);await up();await count(0);
  await box();await count(7);
  await down(await point(23,12));await move(await point(30,3));await cancel();await count(7);
  assert.deepEqual(await read(),fixture,'Cancelling a replacement rectangle preserves the previous selection');

  // Drag the same mixed group using a beam, an explicitly selected node and a rope.
  for (const from of [[10,9],[12,9],[18,9]]) {
    await load();await box();await count(7);
    const bounds=await page.locator('#canvas').boundingBox();
    await down(await point(...from));await move(await point(from[0]+1,from[1]-2));
    assert.match(await page.locator('#total-cost').textContent(),/\([+-]\d+\)/);
    assert.deepEqual(await page.locator('#canvas').boundingBox(),bounds);
    assert.equal(await writes(),0,'Group preview is not saved');
    if (from[0]===10) await page.screenshot({path:resolve('screenshots',`group-move-${mobile ? 'touch' : 'mouse'}.png`)});
    await up();await count(7);assert.equal(await writes(),1,'Commit saves the complete group once');
    assert.deepEqual(await read(),moved,'Every selected endpoint shares the same displacement');
    await page.locator('#undo').click();assert.deepEqual(await read(),fixture);
    await page.locator('#redo').click();assert.deepEqual(await read(),moved);
  }
  await page.reload();await page.locator('#canvas').waitFor();assert.deepEqual(await read(),moved,'Group edits persist after reload');

  // Cancel a group move, release an invalid stretch and return to zero displacement; compare
  // selection, exports and storage-write counts to verify rollback without saving.
  await load();await box();
  await down(await point(10,9));await move(await point(11,7));await cancel();await count(7);
  await down(await point(10,9));await move(await point(10,2));await up();await count(7);
  assert.match(await page.locator('#toast').textContent(),/Maximum beam/);
  await down(await point(10,9));await move(await point(11,7));await move(await point(10,9));await up();await count(7);
  assert.equal(await writes(),0,'Cancelled, invalid and zero-displacement groups do not save');
  assert.deepEqual(await read(),fixture);

  // An unselected object's grab clears the group immediately, even before moving.
  const bounds=await page.locator('#canvas').boundingBox();
  await down(await point(26,5));await count(0);
  assert.equal(await page.locator('#inspector-title').textContent(),'No selection');
  assert.deepEqual(await page.locator('#canvas').boundingBox(),bounds,'Clearing a group must not move the canvas under the pointer');
  await move(await point(27,6));await cancel();await count(0);
  await box();await down(await point(24,5));await count(0);await move(await point(31,12));await up();await count(0);
  assert.deepEqual(await read(),fixture,'Invalid outside-object movement cannot restore the former group');
  assert.equal(await writes(),0);

  // A beam-only selection has implicit endpoint handles, including on touch.
  await load();const beam=await point(10,9);
  if (mobile) await page.touchscreen.tap(beam.x,beam.y); else await page.mouse.click(beam.x,beam.y);
  await count(1);await drag([8,9],[9,7]);await count(1);
  const implicit=await read();assert.deepEqual(implicit.b.slice(0,2),[[-7,2,-3,2,'s'],[-3,2,0,0,'h']]);

  await load();await box();
  if (mobile) {
    // Two fingers cancel both kinds of pending gesture without losing the group.
    for (const rectangle of [false,true]) {
      const a=await point(...(rectangle?[23,12]:[10,9])),b=await point(...(rectangle?[30,3]:[11,7]));
      await down(a);await move(b);await touch('touchStart',{...b,id:0},{x:b.x+40,y:b.y+20,id:1});await up();await count(7);
    }
    await pinchZoom(page,1.25,session);
  } else {
    await page.keyboard.down('Control');await box([23,12],[30,3]);await page.keyboard.up('Control');await count(11);
    await box();await count(7);
    await page.keyboard.down('Shift');await down(await point(8,9));await count(7);await move(await point(17,11));await up();await page.keyboard.up('Shift');await count(5);
    await page.keyboard.down('Control');await page.keyboard.down('Shift');await box([23,12],[30,3]);await page.keyboard.up('Shift');await page.keyboard.up('Control');await count(9);
    await box();await count(7);
    await page.keyboard.down('Control');const toggle=await point(10,9);await page.mouse.click(toggle.x,toggle.y);await page.keyboard.up('Control');await count(6);
    await box();await count(7);
    // Alt-drag is navigation, not a replacement selection box.
    const panStart=await point(16,12);await page.keyboard.down('Alt');await down(panStart);await move({x:panStart.x+25,y:panStart.y+15});await up();await page.keyboard.up('Alt');await count(7);
    await page.locator('#fit').click();await page.locator('#zoom-in').click();
  }
  view.zoom=1.25;
  await page.waitForFunction(()=>document.querySelector('#zoom-value').textContent==='125%');
  const panStart=await point(16,12),pan=[23,17];
  if (mobile) {
    const a={x:panStart.x-30,y:panStart.y,id:0},b={x:panStart.x+30,y:panStart.y,id:1};
    await touch('touchStart',a,b);await touch('touchMove',{...a,x:a.x+pan[0],y:a.y+pan[1]},{...b,x:b.x+pan[0],y:b.y+pan[1]});await up();
  } else {
    await page.mouse.move(panStart.x,panStart.y);await page.mouse.down({button:'middle'});
    await page.mouse.move(panStart.x+pan[0],panStart.y+pan[1]);await page.mouse.up({button:'middle'});
  }
  view.pan=pan;await box([22,14],[5,2]);await count(7);
  assert.deepEqual(await read(),fixture,'Selection and navigation never modify geometry');
  await page.locator('#fit').click();view={zoom:1,pan:[0,0]};
  await session?.detach();
  console.log(`${mobile ? 'Touch' : 'Mouse'} groups: plain rectangles, mixed translation, implicit handles, outside grabs, cancellation, history, persistence and transformed selection verified.`);
}

// Use mouse/native-touch drags from empty points, nodes and the board edge with both materials;
// compare committed geometry and unchanged projects after invalid starts, cancellation or capture loss.
async function testDrawingDrag(page, mobile, point, readProject) {
  const original = { b: [[-4, 0, 2, 0, 's']] };
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify({
    metadata: { size: [32, 18], gameVersion: '0.4.0', formatVersion: 3 },
    objects: original,
  }));
  await page.locator('#load').click();
  const session = mobile ? await page.context().newCDPSession(page) : null;
  const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  const down = async p => {
    if (mobile) await touch('touchStart', p);
    else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
  };
  const move = p => mobile ? touch('touchMove', p) : page.mouse.move(p.x, p.y);
  const up = () => mobile ? touch('touchEnd') : page.mouse.up();
  const drag = async (from, to) => {
    await down(from);
    await move(to);
    assert.match(await page.locator('#hint').textContent(), /Release to place/);
    assert.equal(await page.locator('#cancel-draw').isVisible(), false);
    await up();
  };
  const middle = await point(15, 9), end = await point(15, 6);
  const edge = await point(32, 9), edgeEnd = await point(29, 9);
  const outside = { x: Math.ceil(edge.x) + 2, y: edge.y };
  const onEdge = { x: Math.floor(edge.x), y: edge.y };
  const junction = [[-4, 0, -1, 0, 's'], [-1, 0, 2, 0, 's']];
  for (const tool of ['beam', 'rope']) {
    await page.locator(`[data-tool="${tool}"]`).click();
    await down(outside);
    await up();
    assert.match(await page.locator('#hint').textContent(), /Choose two points/, `${tool} tap outside cannot snap to a start`);
    await down(outside);
    await move(edgeEnd);
    await up();
    assert.match(await page.locator('#hint').textContent(), /Choose two points/, `${tool} drag from outside cannot start`);
    assert.deepEqual((await readProject()).objects, original);
    if (mobile) await page.locator('#fit').click();

    await drag(onEdge, edgeEnd);
    const fromEdge = (await readProject()).objects;
    assert.deepEqual(fromEdge, tool === 'beam'
      ? { b: [...original.b, [13, 0, 16, 0, 's']] }
      : { ...original, r: [[13, 0, 16, 0]] });
    await page.locator('#undo').click();

    for (const x of [12, 15, 20]) {
      await drag(await point(x, 9), await point(x, 6));
      const project = (await readProject()).objects;
      const added = [x - 16, 3, x - 16, 0];
      const base = x === 15 ? junction : original.b;
      const beams = tool === 'beam' ? [...base, [...added, 's']].sort((a, b) => a[0] - b[0] || b[1] - a[1]) : base;
      assert.deepEqual(project.b, beams, `${tool} from grid column ${x}`);
      assert.deepEqual(project.r, tool === 'rope' ? [added] : undefined);
      if(x===20) {
        const next=await point(22,6);
        if(mobile) await page.touchscreen.tap(next.x,next.y); else await page.mouse.click(next.x,next.y);
        const continued=(await readProject()).objects;
        assert.equal((tool==='beam'?continued.b:continued.r).length,(tool==='beam'?project.b:project.r).length+1,'A drag release leaves its endpoint ready for another tap or click');
        await page.locator('#undo').click();
        assert.deepEqual((await readProject()).objects,project);
      }
      await page.locator('#undo').click();
      assert.deepEqual((await readProject()).objects, original, 'Undo restores the entire beam before the split');
    }
  }

  await page.locator('[data-tool="beam"]').click();
  await drag(middle, await point(17, 9));
  assert.match(await page.locator('#toast').textContent(), /overlaps/);
  assert.match(await page.locator('#hint').textContent(), /Choose an endpoint/);
  await page.keyboard.press('Escape');
  const bounds = await page.locator('#canvas').boundingBox();
  await drag(middle, { x: middle.x, y: bounds.y - 5 });
  assert.match(await page.locator('#hint').textContent(), /Choose an endpoint/);
  await page.keyboard.press('Escape');
  assert.deepEqual((await readProject()).objects, original);

  if (mobile) {
    const panEnd = await point(15, 12);
    await page.touchscreen.tap(middle.x, middle.y);
    await page.touchscreen.tap(outside.x, outside.y);
    await page.mouse.move(panEnd.x, panEnd.y);
    assert.match(await page.locator('#coordinate').textContent(), /X -1\s+Y -3/, 'Tapping the margin leaves the view in place');

    await down(outside);
    await move(edgeEnd);
    await up();
    assert.equal(await page.locator('#cancel-draw').isVisible(), true, 'Panning from the margin preserves a pending start');
    assert.deepEqual((await readProject()).objects, original, 'Panning across the board adds no member');
    await page.mouse.move(panEnd.x, panEnd.y);
    assert.doesNotMatch(await page.locator('#coordinate').textContent(), /X -1\s+Y -3/, 'The margin drag moves the board');
    await page.touchscreen.tap(panEnd.x + edgeEnd.x - outside.x, panEnd.y);
    assert.match(await page.locator('#coordinate').textContent(), /X -1\s+Y -3/);
    assert.deepEqual((await readProject()).objects.b, [junction[0], [-1, 0, -1, -3, 's'], junction[1]],
      'The pending start remains on its original node after panning');
    await page.locator('#undo').click();
    await page.locator('#fit').click();

    const node = await point(12, 9);
    await down(node);
    await move({ x: node.x, y: node.y + 8 });
    await up();
    assert.deepEqual((await readProject()).objects, original, 'Small touch movement starts drawing without toggling');
    await page.locator('#cancel-draw').click();

    for (const pending of [false, true]) {
      if (pending) await page.touchscreen.tap(middle.x, middle.y);
      await down({ ...middle, id: 0 });
      await move({ ...end, id: 0 });
      assert.match(await page.locator('#hint').textContent(), /Release to place/);
      const second = { x: end.x + 40, y: end.y, id: 1 };
      await touch('touchStart', { ...end, id: 0 }, second);
      assert.match(await page.locator('#hint').textContent(), pending ? /Choose an endpoint/ : /Choose two points/);
      await touch('touchMove', { ...end, id: 0 }, { ...second, x: second.x + 25 });
      await up();
      assert.deepEqual((await readProject()).objects, original, 'Pinching must not place a member');
      await page.locator('#fit').click();
    }
    assert.equal(await page.locator('#cancel-draw').isVisible(), true);
    await drag(await point(21, 9), end);
    assert.deepEqual((await readProject()).objects.b, [junction[0], [-1, 3, -1, 0, 's'], junction[1]],
      'Dragging after the pinch preserves the previously tapped start');
    await session.detach();
  } else {
    await down(middle);
    await move(end);
    await page.keyboard.press('Escape');
    await up();
    assert.deepEqual((await readProject()).objects, original);
    await down(middle);
    await move(end);
    await page.locator('#canvas').evaluate(canvas => canvas.releasePointerCapture(1));
    await move(await point(15, 5));
    await up();
    assert.deepEqual((await readProject()).objects, original, 'Lost pointer capture cancels the drag');
  }
}

// Hold a drawing pointer in edge/corner bands on fitted and zoomed boards, advance the page clock
// and read cursor coordinates; verify dwell, boundary stops, release and gesture interruption.
async function testEdgePan(page, mobile, readProject, wideLandscape = false) {
  await page.locator('#clear-canvas').click();
  await page.locator('[data-tool="rope"]').click();
  const session = mobile ? await page.context().newCDPSession(page) : null;
  const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
  const down = async p => {
    if (mobile) await touch('touchStart', { ...p, id: 0 });
    else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
  };
  const move = p => mobile ? touch('touchMove', { ...p, id: 0 }) : page.mouse.move(p.x, p.y);
  const up = () => mobile ? touch('touchEnd') : page.mouse.up();
  const coords = async () => (await page.locator('#coordinate').textContent()).match(/-?\d+/g).map(Number);
  const tick = ms => page.clock.runFor(ms);
  const fit = async () => { await page.locator('#fit').click(); await tick(32); };
  const zoom = async clicks => {
    if (mobile) await pinchZoom(page, 1.25 ** clicks, session);
    else for (let i = 0; i < clicks; i++) await page.locator('#zoom-in').click();
    await tick(32);
  };
  await fit();
  const bounds = await page.locator('#canvas').boundingBox();
  const edge = { x: Math.floor(bounds.x + bounds.width - 4), y: Math.round(bounds.y + bounds.height / 2) };
  const from = { ...edge, x: edge.x - 65 };
  const cancel = async () => { await page.keyboard.press('Escape'); await up(); };

  // Hold a drawing pointer near the edge of a fitted board and advance time; unchanged
  // grid coordinates verify that a board already fully in view does not pan.
  await down({ x: Math.round(bounds.x + bounds.width / 2), y: edge.y });
  await move(edge);
  assert.match(await page.locator('#hint').textContent(), /Release to place/);
  const fitted = await coords();
  await tick(400);
  assert.deepEqual(await coords(), fitted, 'A fitted board stays still');
  await cancel();

  // Zoom beyond the viewport and hold at its edge; compare coordinates around the dwell
  // threshold and the released rope export to verify delayed pan and the final endpoint.
  await zoom(3);
  await down(from);
  const start = await coords();
  await move(edge);
  assert.match(await page.locator('#hint').textContent(), /Release to place/);
  const before = await coords();
  await tick(100);
  assert.deepEqual(await coords(), before, 'A brief visit to the edge does not move the board');
  await tick(440);
  const end = await coords();
  assert.ok(end[0] > before[0], 'Holding still at the edge exposes additional nodes');
  const beforeReleaseBounds = await page.locator('#canvas').boundingBox();
  await up();
  await tick(300);
  const afterReleaseBounds = await page.locator('#canvas').boundingBox();
  assert.deepEqual(await coords(), end, `Releasing the pointer stops edge pan; canvas ${JSON.stringify(beforeReleaseBounds)} -> ${JSON.stringify(afterReleaseBounds)}`);
  assert.deepEqual((await readProject()).objects.r, [[...start, ...end]], 'Release uses the displayed endpoint exactly once');
  await page.locator('#undo').click();

  await fit();
  await zoom(3);
  await down({ x: Math.round(bounds.x + bounds.width / 2), y: edge.y });
  await move(edge);
  // Hold long enough to expose the final column, then advance more time; compare coordinates
  // to verify boundary clamping and check the committed rope for material-limit shortening.
  await tick(3000);
  assert.equal((await coords())[0], 16, 'Edge pan exposes the last column');
  await tick(500);
  assert.equal((await coords())[0], 16, 'Edge pan stops at the board boundary');
  await up();
  assert.deepEqual((await readProject()).objects.r, [[0,0,10,0]], 'A long rope is shortened after edge pan');
  await page.locator('#undo').click();

  await fit();
  // Hold near a corner at higher zoom and compare both axes; interrupt with another finger
  // or leave the edge band, then compare the project to verify that interruption adds no element.
  await zoom(8);
  const corner = { ...edge, y: Math.ceil(bounds.y + 4) };
  await down({ x: corner.x - 45, y: corner.y + 45 });
  await move(corner);
  const cornerBefore = await coords();
  await tick(2200);
  const cornerAfter = await coords();
  if (wideLandscape) assert.ok(cornerAfter[0] > cornerBefore[0] || cornerAfter[1] > cornerBefore[1], 'A corner pan moves the board in the available direction');
  else assert.ok(cornerAfter[0] > cornerBefore[0] && cornerAfter[1] > cornerBefore[1], `Both axes pan in a corner: ${cornerBefore} -> ${cornerAfter}`);
  if (mobile) {
    await touch('touchStart', { ...corner, id: 0 }, { x: corner.x - 70, y: corner.y + 70, id: 1 });
    // Capture after dispatch: a final animation frame may run between reading
    // cornerAfter and delivering the second finger. No further pan is allowed
    // once that finger's pointerdown has actually cancelled the drawing gesture.
    const stopped = await coords();
    await tick(500);
    assert.deepEqual(await coords(), stopped, 'A second finger stops edge pan');
    await up();
  } else {
    await move({ ...corner, x: corner.x - 80, y: corner.y + 80 });
    const interior = await coords();
    await tick(500);
    assert.deepEqual(await coords(), interior, 'Leaving the edge band stops edge pan');
    await cancel();
  }
  assert.deepEqual((await readProject()).objects, {}, 'Interrupting edge pan does not add an element');

  if (mobile) {
    // Move an active touch drag over Fit and advance time; unchanged coordinates verify
    // that pointer positions covered by UI controls cannot continue edge panning.
    const controls = await page.locator('#fit').boundingBox();
    await down({ ...from, y: edge.y + 60 });
    await move({ x: Math.round(controls.x + controls.width / 2), y: Math.round(controls.y + controls.height / 2) });
    const covered = await coords();
    await tick(500);
    assert.deepEqual(await coords(), covered, 'Dragging over bottom controls does not pan');
    await cancel();
    await session.detach();
  }
  console.log(`${mobile ? 'Touch' : 'Mouse'} edge pan: dwell, stationary input, boundary, corners and interruption.`);
}

// Track canvas drawing calls while aiming within and beyond material limits, using mouse or touch;
// check solid/dashed geometry, length/cost labels, profile variants and blinking validation errors.
async function testDrawingPreview(page, mobile, name) {
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify({metadata:{size:[32,18],gameVersion:'0.4.0',formatVersion:3},objects:{}}));
  await page.locator('#load').click();
  await page.locator('[data-tool="beam"]').click();
  await page.evaluate(() => {
    const proto=CanvasRenderingContext2D.prototype;
    window.previewFrame={strokes:[],texts:[],fills:[],lens:false,count:0};
    for(const method of ['clearRect','stroke','fillText','fillRect','drawImage']) {
      const original=proto[method];
      proto[method]=function(...args) {
        if(this.canvas.id==='canvas') {
          if(method==='clearRect') window.previewFrame={strokes:[],texts:[],fills:[],lens:false,count:window.previewFrame.count+1};
          if(method==='stroke') window.previewFrame.strokes.push({color:this.strokeStyle,alpha:this.globalAlpha,width:this.lineWidth,dash:this.getLineDash()});
          if(method==='fillText') window.previewFrame.texts.push({text:args[0],color:this.fillStyle});
          if(method==='fillRect') window.previewFrame.fills.push(this.fillStyle);
          if(method==='drawImage' && args[0]===this.canvas) window.previewFrame.lens=true;
        }
        return original.apply(this,args);
      };
    }
  });
  await page.clock.install();
  await page.clock.pauseAt(Date.now()+1000);
  const point=async(x,y)=>page.locator('#canvas').evaluate((canvas,[x,y])=>{
    const r=canvas.getBoundingClientRect(),margin=r.height<400?20:r.width<600?30:58,scale=Math.min((r.width-2*margin)/32,(r.height-2*margin)/18);
    return {x:r.left+(r.width-32*scale)/2+x*scale,y:r.top+(r.height-18*scale)/2+y*scale};
  },[x,y]);

  const session = mobile ? await page.context().newCDPSession(page) : null;
  const down = async (x,y) => { const p=await point(x,y); if(mobile) await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]}); else {await page.mouse.move(p.x,p.y); await page.mouse.down();} };
  const move = async (x,y) => { const p=await point(x,y); if(mobile) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p]}); else await page.mouse.move(p.x,p.y); if(mobile) await page.waitForTimeout(50); await page.clock.runFor(32); };
  const cancel = async () => { if(mobile) await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}); else {await page.keyboard.press('Escape');await page.mouse.up();} await page.clock.runFor(32); };
  const snapshot = () => page.evaluate(()=>window.previewFrame);
  const solid = f => f.strokes.find(s=>s.color==='#3979b7' && s.dash.length===0 && Math.abs(s.alpha-0.9)<0.001);
  const errorLine = f => f.strokes.find(s=>s.color==='#ce5c49' && s.dash.join(',')==='8,5');
  // For each beam profile, aim at the limit and beyond it; inspect captured strokes/labels
  // and advance time to distinguish a stable shortened preview from a blinking validation failure.
  for(const profile of ['l','s','h']) {
    await chooseProfile(page, profile);
    await down(2,11); await move(8,11);
    let f=await snapshot(); assert.ok(solid(f));
    assert.ok(f.texts.some(t=>t.text.includes('6.00 / 6 units') && t.text.includes('+')));
    await move(30,11); f=await snapshot();
    assert.ok(solid(f)); assert.equal(errorLine(f),undefined);
    assert.ok(f.strokes.some(s=>s.color==='#879ba8' && s.dash.join(',')==='4,6'),JSON.stringify(f));
    assert.ok(f.texts.some(t=>t.text.includes('Shortened')));
    const count=f.count; await page.clock.runFor(1100);
    assert.equal((await snapshot()).count,count,'Shortened preview remains stable without blinking');
    if(profile==='s') await page.screenshot({path:join(tmpdir(),'frame-lab-'+name+'-shortened-preview.png')});
    await cancel();
  }
  // Aim a rope beyond its limit; inspect solid stroke width and the ten-unit label to verify
  // material-specific preview styling and limits.
  await page.locator('[data-tool="rope"]').click();
  await down(2,11); await move(30,11);
  let f=await snapshot(); assert.equal(solid(f).width,2);
  assert.ok(f.texts.some(t=>t.text.includes('10.00 / 10 units')));
  await cancel();
  // Real validation failures still blink and never change the project.
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify({metadata:{size:[32,18],gameVersion:'0.4.6',formatVersion:3},objects:{b:[[-4,-2,0,-2,'s']]}}));
  await page.locator('#load').click();
  await page.locator('[data-tool="beam"]').click();
  await down(14,11); await move(17,11);
  f=await snapshot(); assert.ok(errorLine(f));
  assert.ok(f.texts.some(t=>t.text.includes('overlaps')));
  await page.clock.runFor(580); assert.ok(errorLine(await snapshot()));
  await page.clock.runFor(100); assert.equal(errorLine(await snapshot()),undefined);
  await page.clock.runFor(320); assert.ok(errorLine(await snapshot()));
  await cancel();
  if(session) await session.detach();
  await page.clock.resume();
  console.log((mobile?'Touch':'Mouse')+' preview: stable solid candidate, dashed remainder, actual length/cost, profiles and blinking overlap errors.');
}

// Build beam and rope chains through mouse clicks/drags and touch taps/drags, comparing saved
// endpoints after each step; test limit shortening, short spans, no-ops, Undo, cancellation and recovery.
async function testContinuousDrawing(page, mobile, point, readProject) {
 const click = async(x,y) => {const p=await point(x,y); if(mobile) await page.touchscreen.tap(p.x,p.y); else await page.mouse.click(p.x,p.y);};
 const load = async(objects={}) => {
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify({metadata:{size:[32,18],gameVersion:'0.4.6',formatVersion:3},objects}));
  await page.locator('#load').click();
 };
 // Repeat a distant target with each material to build three limit-length segments from
 // four inputs; reject a reverse duplicate, undo each segment, then test short spans and no-op clicks.
 for(const [tool,limit] of [['beam',6],['rope',10]]) {
  await load(); await page.locator('[data-tool="'+tool+'"]').click();
  await click(1,9); await click(31,9); await click(31,9); await click(31,9);
  let project=(await readProject()).objects;
  const expected=[0,1,2].map(i=>[i*limit-15,0,(i+1)*limit-15,0,...(tool==='beam'?['s']:[])]);
  assert.deepEqual(project[tool==='beam'?'b':'r'],expected,'Four inputs add three maximum-length connected elements');
  await click(1+2*limit,9);
  assert.match(await page.locator('#toast').textContent(),/exists/,'Reversing the last element rejects a duplicate');
  assert.deepEqual((await readProject()).objects,project,'Duplicate errors preserve the project');
  for(let remaining=2;remaining>=0;remaining--) {
   await page.locator('#undo').click();
   assert.equal(((await readProject()).objects[tool==='beam'?'b':'r']||[]).length,remaining,'Each member is a separate Undo');
  }
  await click(2,9); await click(4,9); await click(4,9); await click(6,9);
  project=(await readProject()).objects;
  assert.equal(project[tool==='beam'?'b':'r'].length,2,'Short members continue; clicking the start is a no-op');
  assert.equal(project.j,undefined,'Repeated clicks never toggle construction nodes');
  if(mobile) await page.locator('#cancel-draw').click(); else await page.keyboard.press('Escape');
  await click(8,9);
  assert.deepEqual((await readProject()).objects,project,'Cancel ends the previous chain');
  await page.locator('[data-tool="select"]').click(); await page.locator('[data-tool="'+tool+'"]').click();
  await click(10,9);
  assert.deepEqual((await readProject()).objects,project,'Changing tools ends the chain');
 }
 // Start inside an existing beam and provoke an overlap with a distant target; correct the
 // endpoint and compare the split export to verify that failure preserves the chain start.
 await load({b:[[-4,0,0,0,'s']]}); await page.locator('[data-tool="beam"]').click();
 await click(14,9); await click(30,9);
 assert.match(await page.locator('#toast').textContent(),/overlaps/,'Shortening does not bypass overlap validation');
 await click(14,6);
 assert.deepEqual((await readProject()).objects.b,[[-4,0,-2,0,'s'],[-2,3,-2,0,'s'],[-2,0,0,0,'s']],'An error keeps the original start');
 console.log((mobile?'Touch':'Mouse')+' chains: four inputs, both limits, short segments, no-op, undo, cancel, tool changes and overlap recovery.');
}


// Copy an asymmetric mixed group, place it with mouse/touch under every reflection combination
// and inspect exports and storage writes; verify repeated use, cancellation, camera transforms and reload.
async function testClipboard(page, mobile) {
  await page.evaluate(() => {
    window.soundSamples = 0;
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () { window.soundSamples++; return original.call(this); };
  });
  const samples = () => page.evaluate(() => window.soundSamples);
  const session=mobile ? await page.context().newCDPSession(page) : null;
  const touch=(type,...touchPoints)=>session.send('Input.dispatchTouchEvent',{type,touchPoints});
  let view={zoom:1,pan:[0,0]};
  const point=(x,y)=>page.locator('#canvas').evaluate((canvas,{x,y,view})=>{
    const r=canvas.getBoundingClientRect(),margin=r.height<400?20:r.width<600?30:58;
    const scale=Math.min((r.width-margin*2)/32,(r.height-margin*2)/18)*view.zoom;
    return {x:r.left+r.width/2+(x-16)*scale+view.pan[0],y:r.top+r.height/2+(y-9)*scale+view.pan[1]};
  },{x,y,view});
  const down=async p=>{if(mobile)await touch('touchStart',{...p,id:0});else{await page.mouse.move(p.x,p.y);await page.mouse.down();}};
  const move=p=>mobile?touch('touchMove',{...p,id:0}):page.mouse.move(p.x,p.y);
  const up=()=>mobile?touch('touchEnd'):page.mouse.up();
  const drag=async(a,b)=>{await down(await point(...a));await move(await point(...b));await up();};
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bar-lab:last-project:v1')).objects);
  const count=async n=>assert.match(await page.locator('#inspector-title').textContent(),new RegExp(`^${n} selected`));
  // Centered export coordinates describe a four-unit heavy beam and a three-unit
  // vertical rope: pointer-grid (8,6)-(12,6)-(12,9). The distant beam is not copied.
  const fixture={b:[[-8,3,-4,3,'h'],[9,0,13,0,'l']],r:[[-4,3,-4,0]],j:[[-8,3,'o'],[-4,3,'o']]};
  await page.locator('#project-text').click();
  await page.locator('#project-json').fill(JSON.stringify({metadata:{size:[32,18],gameVersion:GAME_VERSION,formatVersion:3},objects:fixture}));
  await page.locator('#load').click();await page.locator('[data-tool="select"]').click();await page.locator('#fit').click();
  await drag([4,2],[15,12]);await count(5);
  const original=await read();
  // Count durable writes to distinguish previews/no-op merges from one-step commits.
  await page.evaluate(()=>{
    const old=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='bar-lab:last-project:v1')window.clipboardWrites++;return old.call(this,key,value);};
    window.clipboardWrites=0;
  });
  const writes=()=>page.evaluate(()=>window.clipboardWrites);
  if(mobile)await page.locator('#copy-selection').click();else await page.keyboard.press('Control+c');
  await page.waitForFunction(() => window.soundSamples > 0);
  assert.ok(await samples() > 0, 'A successful copy plays its WAV confirmation');
  await page.waitForTimeout(300);
  const beforeBurst=await samples();
  await page.evaluate(() => { for (let i = 0; i < 12; i++) document.querySelector('#copy-selection').click(); });
  await page.waitForTimeout(50);
  assert.ok((await samples()) - beforeBurst <= 4, 'A rapid burst never starts more than four short effects');
  await page.waitForTimeout(300);
  assert.deepEqual(await read(),original);assert.equal(await writes(),0);
  assert.equal(await page.locator('#paste-selection').isEnabled(),true);

  // All four combinations have integer endpoints; only the rope side and beam
  // height change when reflecting this asymmetric L-shaped clipboard fragment.
  for(const [flipX,flipY] of [[false,false],[true,false],[false,true],[true,true]]) {
    if(mobile)await page.locator('#paste-selection').click();else await page.keyboard.press('Control+v');
    const bounds=await page.locator('#canvas').boundingBox();
    if(flipX)await page.locator('#paste-flip-x').click();
    if(flipY)await page.locator('#paste-flip-y').click();
    assert.equal(await page.locator('#paste-flip-x').getAttribute('aria-pressed'),String(flipX));
    assert.equal(await page.locator('#paste-flip-y').getAttribute('aria-pressed'),String(flipY));
    const beforeWrites=await writes();
    if(mobile){await down(await point(17,10));await move(await point(18,10));await up();}
    else await move(await point(18,10));
    assert.deepEqual(await read(),original,'Positioning and reflection do not save');
    assert.equal(await writes(),beforeWrites);
    assert.deepEqual(await page.locator('#canvas').boundingBox(),bounds,'Paste controls do not resize the canvas');
    assert.match(await page.locator('#total-cost').textContent(),/\(\+\d+\)/);
    if(!flipX && !flipY) {
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await mkdir('screenshots',{recursive:true});
      await page.screenshot({path:resolve('screenshots',`clipboard-preview-${mobile?'touch':'mouse'}.png`)});
    }
    if(mobile)await page.locator('#paste-place').click();else{await down(await point(18,10));await up();}
    await page.waitForFunction(() => window.soundSamples > 1);
    assert.ok(await samples() > 1, 'A changed paste plays its WAV placement');
    assert.equal(await writes(),beforeWrites+1);await count(5);
    const result=await read(),beamY=flipY?-4:-1,ropeX=flipX?2:6;
    assert.ok(result.b.some(b=>JSON.stringify(b)===JSON.stringify([2,beamY,6,beamY,'h'])));
    assert.ok(result.r.some(r=>JSON.stringify(r)===JSON.stringify([ropeX,-1,ropeX,-4])));
    assert.equal(await page.locator('#paste-actions').isVisible(),false);
    await page.locator('#undo').click();assert.deepEqual(await read(),original);
    await page.locator('#redo').click();assert.deepEqual(await read(),result);
    await page.locator('#undo').click();assert.deepEqual(await read(),original);
  }
  // The original snapshot survives edits and each new placement resets its flips.
  await page.locator('#paste-selection').click();
  assert.equal(await page.locator('#paste-flip-x').getAttribute('aria-pressed'),'false');
  if(mobile){await down(await point(8,6));await up();}else await move(await point(8,6));
  const noOpWrites=await writes();
  const noOpSamples=await samples();
  await page.locator('#paste-place').click();assert.equal(await writes(),noOpWrites);await count(5);
  assert.equal(await samples(), noOpSamples, 'A paste that adds nothing stays silent');
  await page.locator('#paste-selection').click();
  if(mobile){await down(await point(30,16));await up();}else await move(await point(30,16));
  assert.equal(await page.locator('#paste-place').isEnabled(),false);
  assert.match(await page.locator('#status').textContent(),/inside/);
  if(!mobile){await down(await point(30,16));await up();assert.equal(await page.locator('#paste-actions').isVisible(),true);}
  await page.locator('#paste-cancel').click();await count(5);assert.deepEqual(await read(),original);
  assert.equal(await writes(),noOpWrites);

  await page.locator('#paste-selection').click();
  if(mobile){
    const a=await point(16,9),b=await point(20,9);
    await down(a);await touch('touchStart',{...a,id:0},{...b,id:1});await up();
  }else await page.keyboard.press('Escape');
  assert.equal(await page.locator('#paste-actions').isVisible(),false);await count(5);
  assert.deepEqual(await read(),original);
  await page.locator('#paste-selection').click();
  await page.locator('[data-tool="beam"]').click();
  assert.equal(await page.locator('#paste-actions').isVisible(),false);

  // Project-text keyboard operations must keep their native text-editing behavior.
  await page.locator('#project-text').click();await page.locator('#project-json').focus();
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
  assert.equal(await page.locator('#paste-actions').isVisible(),false);await page.locator('#close-text').click();
  // Zoom and pan before the last placement. Camera changes affect screen pixels,
  // while the pasted geometry must still land at the same whole-grid coordinates.
  const center=await point(16,9);
  if(mobile){
    const a={x:center.x-20,y:center.y},b={x:center.x+20,y:center.y};
    await touch('touchStart',{...a,id:0},{...b,id:1});
    await touch('touchMove',{x:center.x-25,y:center.y,id:0},{x:center.x+25,y:center.y,id:1});await up();
  }else{
    await page.mouse.move(center.x,center.y);await page.mouse.wheel(0,-Math.log(1.25)/0.0015);await page.waitForTimeout(50);
  }
  view.zoom=1.25;
  if(mobile){
    const a={x:center.x-20,y:center.y},b={x:center.x+20,y:center.y};
    await touch('touchStart',{...a,id:0},{...b,id:1});
    await touch('touchMove',{x:a.x+11,y:a.y+7,id:0},{x:b.x+11,y:b.y+7,id:1});await up();
  }else{
    await page.mouse.move(center.x,center.y);await page.mouse.down({button:'middle'});
    await page.mouse.move(center.x+11,center.y+7);await page.mouse.up({button:'middle'});
  }
  view.pan=[11,7];
  await page.locator('#paste-selection').click();
  if(mobile){await down(await point(8,12));await up();}else await move(await point(8,12));
  await page.locator('#paste-place').click();
  const saved=await read();assert.equal(saved.b.length,3);assert.equal(saved.r.length,2);
  await mkdir('screenshots',{recursive:true});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:resolve('screenshots',`clipboard-${mobile?'touch':'mouse'}.png`)});
  await page.reload();await page.locator('#canvas').waitFor();
  assert.deepEqual(await read(),saved,'Placed copies survive reload');
  assert.equal(await page.locator('#paste-selection').isEnabled(),false,'Clipboard is scoped to this tab session');
  console.log(`${mobile?'Touch':'Mouse'} clipboard: repeated paste, both mirrors, no-op merge, preview, cancellation, history and persistence.`);
}
