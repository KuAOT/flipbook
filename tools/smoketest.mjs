// E2E smoke test: drive the viewer headlessly and assert core behavior.
import { chromium } from 'playwright';

const base = 'http://localhost:5000/Samsen45-M3-2540/';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

const external = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('http://localhost:5000') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// Title from book.js
const title = await page.title();
console.log('title:', title);
if (!title.includes('Samsen')) fail('title not applied from book.js');

// Page counter total
const totalText = await page.textContent('#pageTotal');
console.log('counter total:', totalText);
if (!/102/.test(totalText)) fail('page total not 102');

// Cover image actually loaded (naturalWidth > 0)
const coverOk = await page.evaluate(() => {
  const img = document.querySelector('#flip img');
  return img && img.naturalWidth > 0;
});
if (!coverOk) fail('cover image did not load'); else console.log('cover image loaded: ok');

// Next button advances current page index
const idxBefore = await page.evaluate(() => window.__pf ? 0 : 0);
await page.click('#btnNext');
await page.waitForTimeout(1200);
const inputVal = await page.inputValue('#pageInput');
console.log('page input after next:', inputVal);
if (Number(inputVal) < 2) fail('next did not advance page');

// Jump to page 50
await page.fill('#pageInput', '50');
await page.press('#pageInput', 'Enter');
await page.waitForTimeout(1200);
const afterJump = await page.inputValue('#pageInput');
console.log('page input after jump:', afterJump);
if (Number(afterJump) < 49) fail('jump-to-page failed');

// Thumbnails toggle + count
await page.click('#btnThumbs');
await page.waitForTimeout(400);
const thumbCount = await page.evaluate(() => document.querySelectorAll('#thumbs .t').length);
const thumbsOpen = await page.evaluate(() => document.getElementById('thumbs').classList.contains('open'));
console.log('thumbs:', thumbCount, 'open:', thumbsOpen);
if (thumbCount !== 102) fail('thumbnail count != 102');
if (!thumbsOpen) fail('thumbnail panel did not open');

// A thumbnail image loaded
const thumbOk = await page.evaluate(() => {
  const im = document.querySelector('#thumbs .t img');
  return im && im.complete && im.naturalWidth > 0;
});
if (!thumbOk) fail('thumbnail image did not load'); else console.log('thumbnail image loaded: ok');

// Zoomed drag pans without flipping pages (regression: drag used to trigger a flip)
await page.click('#btnThumbs'); // close thumbs so they don't cover the stage
await page.waitForTimeout(400);
const pageBeforeDrag = await page.inputValue('#pageInput');
await page.click('#btnZoomIn');
await page.click('#btnZoomIn'); // zoom = 1.5
const box = await page.locator('#stage').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx + 200, cy);
await page.mouse.down();
await page.mouse.move(cx - 200, cy, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1200);
const pageAfterDrag = await page.inputValue('#pageInput');
const transform = await page.evaluate(() => document.getElementById('flip').style.transform);
console.log('zoomed drag: page', pageBeforeDrag, '->', pageAfterDrag, 'transform:', transform);
if (pageAfterDrag !== pageBeforeDrag) fail('zoomed drag flipped the page');
const panX = Number((transform.match(/translate\((-?\d+(?:\.\d+)?)px/) || [])[1] || 0);
if (panX > -300) fail('zoomed drag did not pan the full drag distance (panX=' + panX + ')');
await page.click('#btnZoomOut');
await page.click('#btnZoomOut');

// Zoom indicator shows current level; clicking it resets to 100%
let pct = (await page.textContent('#zoomPct')).trim();
if (pct !== '100%') fail('zoom indicator should start at 100%, got ' + pct);
await page.click('#btnZoomIn');
pct = (await page.textContent('#zoomPct')).trim();
if (pct !== '125%') fail('zoom indicator should show 125% after zoom in, got ' + pct);
await page.click('#zoomPct');
pct = (await page.textContent('#zoomPct')).trim();
let tf = await page.evaluate(() => document.getElementById('flip').style.transform);
console.log('zoom indicator reset:', pct, tf);
if (pct !== '100%' || !/scale\(1\)/.test(tf)) fail('clicking zoom % did not reset zoom');

// Double-click toggles zoom: 100% -> 200% into the clicked spot, then back to 100%
const pageBeforeDbl = await page.inputValue('#pageInput');
await page.mouse.dblclick(cx + 100, cy);
await page.waitForTimeout(300);
pct = (await page.textContent('#zoomPct')).trim();
tf = await page.evaluate(() => document.getElementById('flip').style.transform);
console.log('after dblclick:', pct, tf);
if (pct !== '200%' || !/scale\(2\)/.test(tf)) fail('double-click did not zoom to 200%');
if (!/translate\(-\d/.test(tf)) fail('double-click zoom did not pan toward clicked spot');
await page.mouse.dblclick(cx + 100, cy);
await page.waitForTimeout(300);
pct = (await page.textContent('#zoomPct')).trim();
tf = await page.evaluate(() => document.getElementById('flip').style.transform);
console.log('after second dblclick:', pct, tf);
if (pct !== '100%' || !/scale\(1\)/.test(tf)) fail('double-click did not reset zoom to 100%');
const pageAfterDbl = await page.inputValue('#pageInput');
if (pageAfterDbl !== pageBeforeDbl) fail('double-click zoom toggle changed the page (' + pageBeforeDbl + ' -> ' + pageAfterDbl + ')');

// Click on a page corner still flips (disableFlipByClick keeps corners active)
const fbox = await page.locator('#flip').boundingBox();
await page.mouse.click(fbox.x + fbox.width - 15, fbox.y + fbox.height - 15);
await page.waitForTimeout(1200);
const pageAfterCorner = await page.inputValue('#pageInput');
console.log('after corner click:', pageBeforeDbl, '->', pageAfterCorner);
if (Number(pageAfterCorner) <= Number(pageBeforeDbl)) fail('corner click did not flip the page');

// Keyboard +/- zooms in and out
await page.keyboard.press('+');
await page.keyboard.press('+');
pct = (await page.textContent('#zoomPct')).trim();
console.log('after keyboard ++:', pct);
if (pct !== '150%') fail('keyboard + did not zoom in (got ' + pct + ')');
await page.keyboard.press('-');
await page.keyboard.press('-');
pct = (await page.textContent('#zoomPct')).trim();
tf = await page.evaluate(() => document.getElementById('flip').style.transform);
console.log('after keyboard --:', pct, tf);
if (pct !== '100%' || !/scale\(1\)/.test(tf)) fail('keyboard - did not zoom back out');

// No external network requests
console.log('external requests:', external.length);
if (external.length) { console.error(external.slice(0, 10).join('\n')); fail('viewer made external requests'); }

await browser.close();
console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
