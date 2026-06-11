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

// No external network requests
console.log('external requests:', external.length);
if (external.length) { console.error(external.slice(0, 10).join('\n')); fail('viewer made external requests'); }

await browser.close();
console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
