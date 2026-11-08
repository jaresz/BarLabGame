import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Record real editor gestures; captions and pointer rings are documentation overlays only. */
export async function captureClipboardAnimations(browser, base, output) {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const available = spawnSync(ffmpeg,['-version'],{stdio:'ignore'});
  if (available.status!==0) {
    console.log('FFmpeg is unavailable; skipping the optional clipboard animations.');
    return;
  }
  const context = await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // An asymmetric six-unit frame makes reflections visible. The rope splits its
  // base at the apex's vertical projection, yielding four beams and four nodes.
  // Export coordinates are centered, with positive Y up; pointer-grid Y goes down.
  const fixture = {metadata:{size:[32,18],gameVersion:'0.4.53',formatVersion:3},objects:{
    b:[[-12,-2,-6,-2,'s'],[-12,-2,-10,1,'h'],[-10,1,-6,-2,'l']],
    r:[[-10,1,-10,-2]],j:[[-10,1,'o'],[-10,-2,'o']],
  }};
  const point = (x,y) => page.locator('#canvas').evaluate((canvas,{x,y}) => {
    const r = canvas.getBoundingClientRect(), margin = r.height<400 ? 20 : r.width<600 ? 30 : 58;
    const scale = Math.min((r.width-2*margin)/32,(r.height-2*margin)/18);
    return {x:r.left+r.width/2+(x-16)*scale,y:r.top+r.height/2+(y-9)*scale};
  },{x,y});
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('bar-lab:last-project:v1')).objects);
  const show = async (title,detail) => page.evaluate(({title,detail}) => {
    const caption = document.querySelector('#doc-clipboard-caption');
    caption.firstElementChild.textContent = title;
    caption.lastElementChild.textContent = detail;
  },{title,detail});
  const move = async p => {
    await page.mouse.move(p.x,p.y);
    await page.evaluate(({x,y}) => {
      const cursor = document.querySelector('#doc-clipboard-cursor');
      cursor.style.left = `${x}px`; cursor.style.top = `${y}px`;
    },p);
  };
  const setup = async () => {
    await page.goto(base,{waitUntil:'networkidle'});
    await page.addStyleTag({content:'#toast,#update-app,#install-reminder{display:none!important}'});
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#project-text').click();
    await page.locator('#project-json').fill(JSON.stringify(fixture));
    await page.locator('#load').click();
    await page.locator('[data-tool="select"]').click();
    await page.evaluate(() => {
      const caption = document.createElement('div'); caption.id = 'doc-clipboard-caption';
      Object.assign(caption.style,{position:'fixed',bottom:'58px',left:'50%',transform:'translateX(-50%)',
        zIndex:'99999',width:'620px',padding:'13px 18px',borderRadius:'10px',background:'#183d3e',
        color:'#fff',font:'600 18px/1.35 "DM Sans",sans-serif',textAlign:'center',pointerEvents:'none',boxShadow:'0 5px 20px #183d3e33'});
      caption.append(document.createElement('div'),document.createElement('div'));
      caption.lastElementChild.style.cssText='margin-top:4px;font-size:14px;font-weight:400;color:#dce9df';
      const cursor = document.createElement('div'); cursor.id = 'doc-clipboard-cursor';
      Object.assign(cursor.style,{position:'fixed',width:'28px',height:'28px',border:'3px solid #d56537',
        borderRadius:'50%',background:'#ffffff44',boxShadow:'0 1px 5px #1d303844',
        transform:'translate(-50%,-50%)',zIndex:'100000',pointerEvents:'none'});
      document.body.append(caption,cursor);
    });
  };
  // Endpoint order can reverse after reflection. Compare undirected spans together
  // with their material/profile so the recording verifies geometry, not JSON order.
  const signatures = objects => [...(objects.b ?? []).map(m => ['b',m[4],m.slice(0,2),m.slice(2,4)]),
    ...(objects.r ?? []).map(m => ['r','',m.slice(0,2),m.slice(2,4)])]
    .map(([material,profile,a,b]) => JSON.stringify([material,profile,[a,b].sort((p,q)=>p[0]-q[0] || p[1]-q[1])])).sort();
  const transformed = (objects,xTransform) => Object.fromEntries(['b','r'].map(material => [material,
    (objects[material] ?? []).map(m => [xTransform(m[0]),m[1],xTransform(m[2]),m[3],...m.slice(4)])]));
  const markSharedNodes = async gridPoints => {
    const positions = await Promise.all(gridPoints.map(p => point(...p)));
    await page.evaluate(positions => {
      for (const p of positions) {
        const ring = document.createElement('div');
        Object.assign(ring.style,{position:'fixed',left:`${p.x}px`,top:`${p.y}px`,width:'26px',height:'26px',
          border:'3px solid #d56537',borderRadius:'50%',transform:'translate(-50%,-50%)',pointerEvents:'none',zIndex:'99998'});
        const label = document.createElement('div'); label.textContent='Shared node';
        Object.assign(label.style,{position:'absolute',top:'28px',left:'50%',transform:'translateX(-50%)',
          whiteSpace:'nowrap',font:'600 12px "DM Sans",sans-serif',color:'#9d421e'});
        ring.append(label); document.body.append(ring);
      }
    },positions);
  };

  try {
    for (const mirrored of [false,true]) {
      const frames = await mkdtemp(join(tmpdir(),'frame-lab-clipboard-'));
      let index = 0;
      try {
        await setup();
        const original = await read();
        // One captured PNG can be repeated to hold an instructional step without
        // re-running its gesture. Four frames per second keeps the GIF readable.
        const capture = async (hold=4) => {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const file = join(frames,`frame-${String(index++).padStart(3,'0')}.png`);
          await page.screenshot({path:file});
          for (let n=1;n<hold;n++) await copyFile(file,join(frames,`frame-${String(index++).padStart(3,'0')}.png`));
        };
        const control = async (selector,title,detail) => {
          await show(title,detail);
          const r = await page.locator(selector).boundingBox();
          await move({x:r.x+r.width/2,y:r.y+r.height/2}); await capture(3);
          await page.mouse.down(); await page.mouse.up(); await capture(4);
        };
        await show('1 · Select the complete frame','Drag a rectangle from empty space around its beams, rope and nodes.');
        // The source occupies grid x=4..10, y=8..11. These empty corners leave a
        // one-unit margin and include all four nodes and all five members.
        const a = await point(3,7), b = await point(11,12);
        await move(a); await capture(3); await page.mouse.down();
        for (let step=1;step<=4;step++) {
          await move({x:a.x+(b.x-a.x)*step/4,y:a.y+(b.y-a.y)*step/4}); await capture(1);
        }
        await page.mouse.up(); await capture(4);
        assert.match(await page.locator('#inspector-title').textContent(),/^9 selected/);
        await control('#copy-selection','2 · Copy once','The clipboard keeps this frame for every later paste.');
        await control('#paste-selection','3 · Start Paste','Move the preview; the original frame stays in place.');
        await show('4 · Align the two ends','Place the copy’s left end on the original’s right end.');
        await move(await point(10,8)); await capture(6);
        assert.equal(await page.locator('#paste-place').isEnabled(),true);
        assert.deepEqual(await read(),original,'Preview must not save any geometry.');
        if (mirrored) {
          await control('#paste-flip-x','5 · Flip left–right','The apex and vertical rope switch sides inside the preview.');
          assert.equal(await page.locator('#paste-flip-x').getAttribute('aria-pressed'),'true');
          await control('#paste-place','6 · Place the mirrored copy','Both frames meet at one shared endpoint.');
          const actual = await read(), reflection = transformed(original,x=>-12-x);
          assert.deepEqual(signatures(actual),signatures({b:[...original.b,...reflection.b],r:[...original.r,...reflection.r]}));
          await markSharedNodes([[10,11]]);
          await show('Original + mirrored copy','The rope is on opposite sides; the touching ends share one node.');
        } else {
          await control('#paste-place','5 · Place the first copy','The touching ends merge into a shared node.');
          await control('#paste-selection','6 · Paste again — no new Copy','Reuse the same clipboard for the second copy.');
          await show('7 · Align the next pair of ends','Move the second copy to the first copy’s free right end.');
          await move(await point(16,8)); await capture(6);
          await control('#paste-place','8 · Place the second copy','One Copy and two Pastes create three connected frames.');
          const actual = await read(), first = transformed(original,x=>x+6), second = transformed(original,x=>x+12);
          assert.deepEqual(signatures(actual),signatures({b:[...original.b,...first.b,...second.b],r:[...original.r,...first.r,...second.r]}));
          await markSharedNodes([[10,11],[16,11]]);
          await show('Three frames, two shared nodes','Each copy joins the previous frame at its free endpoint.');
        }
        // Each marked endpoint must actually join the adjacent frames in the
        // saved project: four beam ends meet there, not two merely nearby nodes.
        const result = await read();
        for (const x of mirrored ? [-6] : [-6,0]) {
          assert.equal(result.b.flatMap(m=>[m.slice(0,2),m.slice(2,4)]).filter(p=>p[0]===x && p[1]===-2).length,4);
        }
        await move({x:1220,y:730}); await capture(12);
        assert.deepEqual(errors,[]);
        const palette = join(frames,'palette.png');
        const input = ['-y','-framerate','4','-i',join(frames,'frame-%03d.png')];
        const paletteResult = spawnSync(ffmpeg,[...input,'-vf','palettegen=stats_mode=diff',palette],{encoding:'utf8'});
        if (paletteResult.status!==0) throw new Error(`Clipboard GIF palette failed: ${paletteResult.error?.message ?? paletteResult.stderr}`);
        const filename = mirrored ? 'frame-lab-paste-mirrored.gif' : 'frame-lab-copy-repeat.gif';
        await mkdir(output,{recursive:true});
        const gifResult = spawnSync(ffmpeg,[...input,'-i',palette,'-lavfi','paletteuse=dither=bayer:bayer_scale=3','-loop','0',join(output,filename)],{encoding:'utf8'});
        if (gifResult.status!==0) throw new Error(`Clipboard GIF encoding failed: ${gifResult.error?.message ?? gifResult.stderr}`);
        console.log(`Captured ${join(output,filename)} (${index} frames; saved geometry and shared nodes verified).`);
      } finally {
        await rm(frames,{recursive:true,force:true});
      }
    }
  } finally {
    await context.close();
  }
}
