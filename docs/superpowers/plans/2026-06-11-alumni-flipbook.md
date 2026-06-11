# Alumni Flipbook Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted, ad-free HTML5 flipbook viewer for two alumni yearbooks plus a tool that extracts page images from the user's existing FlipHTML5 books, deployable as a `/books/` subfolder on Firebase Hosting.

**Architecture:** A one-time Node + Playwright script opens each FlipHTML5 book in a real headless browser, intercepts the page-image network responses while preloading every page, and downloads them locally. Each book becomes a fully self-contained static folder: one `index.html` viewer built on StPageFlip (MIT) with a FlipHTML5-style toolbar, the bundled flip library, page images, and locally generated thumbnails. No runtime requests leave the user's own host.

**Tech Stack:** Node.js 24, Playwright (Chromium headless) for extraction, sharp for thumbnail generation, StPageFlip for the page-curl animation, vanilla HTML/CSS/JS for the viewer.

**Note on TDD:** This project is a browser viewer plus a network-scraping script — domains where classic unit-test-first offers little. Each task therefore ends in an explicit **verification step with expected output** instead of a unit test, and we commit after every working task. Where pure logic exists (filename padding, page-pairing), it is unit-tested.

---

## File Structure

```
E:\flipbook\
  package.json                       ← deps: playwright, sharp; scripts
  tools/
    extract.mjs                      ← Playwright extractor + thumbnail gen
    lib/
      naming.mjs                     ← pad(n) → "0001", pure + unit-tested
      naming.test.mjs                ← node:test unit tests
  books/
    Samsen45-M3-2540/
      index.html                     ← complete viewer (HTML+CSS+JS inline)
      book.js                        ← window.BOOK = { title, pageCount, w, h }
      vendor/page-flip.browser.js    ← StPageFlip UMD build, committed locally
      pages/0001.jpg … 0102.jpg
      thumbs/0001.jpg … 0102.jpg
    _template/
      index.html                     ← source of truth, copied per book
  docs/
    DEPLOY.md                        ← how to put books/ on Firebase Hosting
```

The viewer is identical across books, so `_template/index.html` is the single source; the extractor copies it into each book folder. `book.js` carries the only per-book differences (title, page count, dimensions).

---

## Task 1: Project scaffolding

**Files:**
- Create: `E:\flipbook\package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "alumni-flipbook",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "extract": "node tools/extract.mjs",
    "test": "node --test tools/lib/",
    "serve": "npx --yes serve books -l 5000"
  },
  "dependencies": {
    "playwright": "^1.49.0",
    "sharp": "^0.33.5"
  }
}
```

- [ ] **Step 2: Install dependencies and the Chromium browser**

Run:
```bash
cd /e/flipbook && npm install && npx playwright install chromium
```
Expected: npm reports packages added; Playwright prints "Chromium … downloaded".

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: scaffold project with playwright and sharp"
```

---

## Task 2: Page-name padding helper (pure logic, unit-tested)

**Files:**
- Create: `E:\flipbook\tools\lib\naming.mjs`
- Test: `E:\flipbook\tools\lib\naming.test.mjs`

- [ ] **Step 1: Write the failing test**

`tools/lib/naming.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pad, pageFilename } from './naming.mjs';

test('pad zero-fills to 4 digits', () => {
  assert.equal(pad(1), '0001');
  assert.equal(pad(42), '0042');
  assert.equal(pad(102), '0102');
});

test('pad widens past 4 digits when needed', () => {
  assert.equal(pad(12345), '12345');
});

test('pageFilename builds jpg name from 1-based index', () => {
  assert.equal(pageFilename(1), '0001.jpg');
  assert.equal(pageFilename(102), '0102.jpg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/flipbook && node --test tools/lib/naming.test.mjs`
Expected: FAIL — `Cannot find module './naming.mjs'`.

- [ ] **Step 3: Write minimal implementation**

`tools/lib/naming.mjs`:
```js
export function pad(n) {
  return String(n).padStart(4, '0');
}

export function pageFilename(n) {
  return `${pad(n)}.jpg`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /e/flipbook && node --test tools/lib/naming.test.mjs`
Expected: PASS — `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add tools/lib/naming.mjs tools/lib/naming.test.mjs
git commit -m "feat: add page-name padding helper with tests"
```

---

## Task 3: Extraction tool

**Files:**
- Create: `E:\flipbook\tools\extract.mjs`

**What it does:** Opens a FlipHTML5 book in headless Chromium, lets FlipHTML5's own (WASM-decrypted) viewer run, intercepts every page-image response, drives the viewer to preload all pages, downloads the highest-resolution rendition of each page in order, then generates thumbnails and writes `book.js`. We never execute FlipHTML5 code outside the browser sandbox — Chromium runs it exactly as a normal visitor would.

- [ ] **Step 1: Write the extractor**

`tools/extract.mjs`:
```js
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pad, pageFilename } from './lib/naming.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const [, , bookUrl, bookName] = process.argv;
if (!bookUrl || !bookName) {
  console.error('Usage: node tools/extract.mjs <fliphtml5-url> <book-folder-name>');
  process.exit(1);
}

const bookDir = path.join(ROOT, 'books', bookName);
const pagesDir = path.join(bookDir, 'pages');
const thumbsDir = path.join(bookDir, 'thumbs');
const vendorDir = path.join(bookDir, 'vendor');

// FlipHTML5 serves page images under .../files/<size>/<n>.(jpg|webp).
// We score by size keyword and pick the largest rendition per page index.
const SIZE_RANK = { large: 3, normal: 2, mobile: 1, thumb: 0 };
function classify(url) {
  const m = url.match(/\/files\/([a-z]+)\/(\d+)\.(jpg|jpeg|png|webp)(?:\?|$)/i);
  if (!m) return null;
  return { size: m[1].toLowerCase(), index: Number(m[2]), ext: m[3].toLowerCase() };
}

async function main() {
  await mkdir(pagesDir, { recursive: true });
  await mkdir(thumbsDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // best[index] = { url, rank, ext }
  const best = new Map();
  page.on('response', (resp) => {
    const info = classify(resp.url());
    if (!info) return;
    const rank = SIZE_RANK[info.size] ?? -1;
    if (rank < 0) return;
    const cur = best.get(info.index);
    if (!cur || rank > cur.rank) {
      best.set(info.index, { url: resp.url(), rank, ext: info.ext });
    }
  });

  console.log('Opening', bookUrl);
  await page.goto(bookUrl, { waitUntil: 'networkidle', timeout: 120000 });

  // Read page count + dimensions from FlipHTML5's decrypted runtime config.
  const meta = await page.evaluate(() => {
    const find = (obj, depth = 0) => {
      if (!obj || depth > 4 || typeof obj !== 'object') return null;
      if (typeof obj.pageCount === 'number' && obj.pageCount > 0) return obj;
      for (const k of Object.keys(obj)) {
        try { const r = find(obj[k], depth + 1); if (r) return r; } catch { /* cross-origin */ }
      }
      return null;
    };
    const cfg = find(window) || {};
    return {
      pageCount: cfg.pageCount || 0,
      pageWidth: cfg.pageWidth || 0,
      pageHeight: cfg.pageHeight || 0,
      title: (document.title || '').trim(),
    };
  });

  if (!meta.pageCount) throw new Error('Could not determine page count from book runtime.');
  console.log(`Book "${meta.title}" — ${meta.pageCount} pages`);

  // Drive the viewer through every page so each large image is requested.
  // FlipHTML5 exposes next-page via the on-screen control; we click it and
  // also nudge the URL hash, then wait for network to settle each time.
  for (let i = 1; i <= meta.pageCount; i++) {
    await page.evaluate((n) => { location.hash = `#p=${n}`; }, i);
    // Click a "next" control if present; ignore if not found.
    await page.keyboard.press('ArrowRight').catch(() => {});
    await page.waitForTimeout(250);
    if (i % 10 === 0 || i === meta.pageCount) {
      console.log(`  preloaded ~${best.size}/${meta.pageCount} page images`);
    }
  }
  // Give late responses a moment.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);

  if (best.size < meta.pageCount) {
    console.warn(`WARNING: only captured ${best.size}/${meta.pageCount} page URLs. Retrying gaps…`);
    for (let i = 1; i <= meta.pageCount; i++) {
      if (best.has(i)) continue;
      await page.evaluate((n) => { location.hash = `#p=${n}`; }, i);
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(1500);
  }

  // Download each page in order via the browser context (keeps cookies/referer).
  let downloaded = 0;
  for (let i = 1; i <= meta.pageCount; i++) {
    const hit = best.get(i);
    if (!hit) { console.warn(`  MISSING page ${i} — no URL captured`); continue; }
    const resp = await ctx.request.get(hit.url, { headers: { referer: bookUrl } });
    if (!resp.ok()) { console.warn(`  page ${i}: HTTP ${resp.status()}`); continue; }
    const buf = Buffer.from(await resp.body());
    // Normalize everything to JPEG for the viewer.
    const jpeg = await sharp(buf).jpeg({ quality: 88 }).toBuffer();
    await writeFile(path.join(pagesDir, pageFilename(i)), jpeg);
    // Thumbnail ~ 200px tall.
    const thumb = await sharp(buf).resize({ height: 200 }).jpeg({ quality: 72 }).toBuffer();
    await writeFile(path.join(thumbsDir, pageFilename(i)), thumb);
    downloaded++;
    if (i % 10 === 0 || i === meta.pageCount) console.log(`  downloaded ${downloaded}/${meta.pageCount}`);
  }

  await browser.close();

  // Write per-book metadata consumed by index.html.
  const bookJs =
    `window.BOOK = ${JSON.stringify({
      title: meta.title || bookName,
      pageCount: meta.pageCount,
      pageWidth: Math.round(meta.pageWidth) || 0,
      pageHeight: Math.round(meta.pageHeight) || 0,
    }, null, 2)};\n`;
  await writeFile(path.join(bookDir, 'book.js'), bookJs);

  // Copy the viewer template + vendored library into this book folder.
  const tplDir = path.join(ROOT, 'books', '_template');
  if (existsSync(tplDir)) {
    const tplIndex = await readFileSafe(path.join(tplDir, 'index.html'));
    if (tplIndex) await writeFile(path.join(bookDir, 'index.html'), tplIndex);
  }
  const vendorSrc = path.join(ROOT, 'books', '_template', 'vendor', 'page-flip.browser.js');
  if (existsSync(vendorSrc)) {
    const v = await readFileSafe(vendorSrc);
    if (v) await writeFile(path.join(vendorDir, 'page-flip.browser.js'), v);
  }

  const files = (await readdir(pagesDir)).filter((f) => f.endsWith('.jpg'));
  console.log(`\nDone. ${files.length}/${meta.pageCount} pages in ${pagesDir}`);
  if (files.length !== meta.pageCount) {
    console.error('VERIFY FAILED: page file count does not match page count.');
    process.exit(2);
  }
}

import { readFile } from 'node:fs/promises';
async function readFileSafe(p) { try { return await readFile(p); } catch { return null; } }

main().catch((e) => { console.error('EXTRACTION FAILED:', e); process.exit(1); });
```

- [ ] **Step 2: Syntax-check the script**

Run: `cd /e/flipbook && node --check tools/extract.mjs`
Expected: no output, exit code 0 (valid syntax). The classify/size-ranking logic is exercised for real in Task 5.

- [ ] **Step 3: Commit**

```bash
git add tools/extract.mjs
git commit -m "feat: add FlipHTML5 page extractor with thumbnail generation"
```

---

## Task 4: Vendor the StPageFlip library locally

**Files:**
- Create: `E:\flipbook\books\_template\vendor\page-flip.browser.js`

We bundle the library so the viewer makes zero external requests.

- [ ] **Step 1: Download the StPageFlip UMD browser build**

Run:
```bash
cd /e/flipbook && mkdir -p books/_template/vendor && \
curl -sL "https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js" \
  -o books/_template/vendor/page-flip.browser.js && \
wc -c books/_template/vendor/page-flip.browser.js
```
Expected: a non-trivial byte count (tens of KB), file present.

- [ ] **Step 2: Verify it exposes the global**

Run: `cd /e/flipbook && grep -o "PageFlip" books/_template/vendor/page-flip.browser.js | head -1`
Expected: prints `PageFlip` (the UMD global `St.PageFlip` / `window.St` is present).

- [ ] **Step 3: Commit**

```bash
git add books/_template/vendor/page-flip.browser.js
git commit -m "vendor: add StPageFlip browser build (MIT)"
```

---

## Task 5: Extract Book 1 (Samsen45-M3-2540)

**Files:**
- Creates: `E:\flipbook\books\Samsen45-M3-2540\pages\*.jpg`, `thumbs\*.jpg`, `book.js`

- [ ] **Step 1: Run the extractor**

Run:
```bash
cd /e/flipbook && node tools/extract.mjs "https://online.fliphtml5.com/qbymk/xbak/" "Samsen45-M3-2540"
```
Expected: logs "102 pages", preload/download progress, ends with `Done. 102/102 pages`. If it reports MISSING pages or a count mismatch, see Step 3.

- [ ] **Step 2: Verify the output**

Run:
```bash
cd /e/flipbook && \
echo "pages: $(ls books/Samsen45-M3-2540/pages/*.jpg | wc -l)" && \
echo "thumbs: $(ls books/Samsen45-M3-2540/thumbs/*.jpg | wc -l)" && \
echo "zero-byte: $(find books/Samsen45-M3-2540/pages -size 0 | wc -l)" && \
cat books/Samsen45-M3-2540/book.js
```
Expected: `pages: 102`, `thumbs: 102`, `zero-byte: 0`, and `book.js` showing the title and `pageCount: 102`.

- [ ] **Step 3: Visual spot-check** (only if Step 2 shows gaps, fix extractor selectors before continuing)

Open `books/Samsen45-M3-2540/pages/0001.jpg`, `0051.jpg`, `0102.jpg` in an image viewer. Confirm they are the cover, a middle page, and the back — readable and correctly oriented. If pages are missing or low-res, the page-advance mechanism in `extract.mjs` (the ArrowRight / hash nudge) needs adjusting to match this book's controls; iterate on that loop, re-run Step 1, and re-verify.

- [ ] **Step 4: Commit the extracted book**

```bash
git add books/Samsen45-M3-2540/pages books/Samsen45-M3-2540/thumbs books/Samsen45-M3-2540/book.js
git commit -m "data: extract Samsen45-M3-2540 (102 pages)"
```

---

## Task 6: Build the viewer template

**Files:**
- Create: `E:\flipbook\books\_template\index.html`

This is the complete viewer: dark stage, centered book, FlipHTML5-style toolbar (style A), thumbnail sidebar, page jump, zoom/pan, fullscreen, auto-flip, keyboard + touch. Pages lazy-load via `loadFromHTML` with `data-src` swapping so a 102-page book opens fast.

- [ ] **Step 1: Write the viewer**

`books/_template/index.html`:
```html
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Flipbook</title>
<script src="book.js"></script>
<style>
  :root { --bar: #1d1d22; --stage: #2b2b33; --ink: #cfd6e4; --accent: #c9a24a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--stage);
    font-family: "Segoe UI", "Sarabun", system-ui, sans-serif; color: var(--ink);
    overflow: hidden; -webkit-tap-highlight-color: transparent; }
  #stage { position: absolute; inset: 0 0 56px 0; display: flex;
    align-items: center; justify-content: center; overflow: hidden; }
  #flip { touch-action: none; }
  /* page cells used by StPageFlip loadFromHTML */
  .page { background: #fff; overflow: hidden; }
  .page img { width: 100%; height: 100%; object-fit: contain; display: block;
    background: #f4f1ea; }
  .page .ph { width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; color: #b9b2a3; font-size: 14px; background: #f4f1ea; }

  /* toolbar */
  #bar { position: absolute; left: 0; right: 0; bottom: 0; height: 56px;
    background: var(--bar); display: flex; align-items: center; gap: 4px;
    padding: 0 10px; z-index: 30; }
  #bar button { background: transparent; border: 0; color: var(--ink);
    font-size: 18px; width: 40px; height: 40px; border-radius: 6px; cursor: pointer; }
  #bar button:hover { background: rgba(255,255,255,.08); }
  #counter { display: flex; align-items: center; gap: 6px; font-size: 14px;
    margin: 0 6px; white-space: nowrap; }
  #counter input { width: 46px; background: #2b2b33; border: 1px solid #3a3a44;
    color: var(--ink); border-radius: 5px; text-align: center; padding: 4px; }
  #title { font-size: 14px; color: #9aa1b1; margin-left: auto;
    max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1 1 auto; }

  /* thumbnail sidebar */
  #thumbs { position: absolute; top: 0; bottom: 56px; left: 0; width: 150px;
    background: #16161a; overflow-y: auto; transform: translateX(-100%);
    transition: transform .2s ease; z-index: 25; padding: 8px; }
  #thumbs.open { transform: translateX(0); }
  #thumbs .t { display: block; width: 100%; margin: 0 0 8px; border: 2px solid transparent;
    border-radius: 3px; cursor: pointer; }
  #thumbs .t.active { border-color: var(--accent); }
  #thumbs .t img { width: 100%; display: block; border-radius: 2px; background: #333; }
  #thumbs .t span { font-size: 11px; color: #7c8294; display: block; text-align: center; }
</style>
</head>
<body>
  <div id="thumbs" aria-label="Thumbnails"></div>
  <div id="stage"><div id="flip"></div></div>

  <div id="bar">
    <button id="btnThumbs" title="Thumbnails / สารบัญ">☰</button>
    <button id="btnPrev" title="Previous / ก่อนหน้า">◀</button>
    <span id="counter">
      <input id="pageInput" type="text" inputmode="numeric" value="1" />
      <span id="pageTotal">/ 1</span>
    </span>
    <button id="btnNext" title="Next / ถัดไป">▶</button>
    <div class="spacer"></div>
    <button id="btnAuto" title="Auto-flip / เล่นอัตโนมัติ">▶︎❙</button>
    <button id="btnZoomOut" title="Zoom out / ย่อ">−</button>
    <button id="btnZoomIn" title="Zoom in / ขยาย">＋</button>
    <button id="btnFull" title="Fullscreen / เต็มจอ">⤢</button>
    <span id="title"></span>
  </div>

  <script src="vendor/page-flip.browser.js"></script>
  <script>
  (function () {
    var BOOK = window.BOOK || { title: 'Flipbook', pageCount: 0, pageWidth: 0, pageHeight: 0 };
    document.title = BOOK.title;
    document.getElementById('title').textContent = BOOK.title;
    var total = BOOK.pageCount;
    var ratio = (BOOK.pageWidth && BOOK.pageHeight) ? (BOOK.pageWidth / BOOK.pageHeight) : (2652 / 2800);

    var stage = document.getElementById('stage');
    var flipEl = document.getElementById('flip');
    var BUFFER = 3; // pages each side to keep loaded

    // Build page cells with lazy data-src.
    var cells = [];
    for (var i = 1; i <= total; i++) {
      var d = document.createElement('div');
      d.className = 'page';
      d.setAttribute('data-density', i === 1 || i === total ? 'hard' : 'soft');
      var img = document.createElement('img');
      img.setAttribute('data-src', 'pages/' + String(i).padStart(4, '0') + '.jpg');
      img.alt = 'Page ' + i;
      var ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = i;
      img.style.display = 'none';
      d.appendChild(ph); d.appendChild(img);
      flipEl.appendChild(d);
      cells.push(d);
    }

    function computeSize() {
      var maxH = stage.clientHeight - 24;
      var maxW = stage.clientWidth - 24;
      var portrait = stage.clientWidth < 760;
      var spreadRatio = portrait ? ratio : ratio * 2;
      var w = maxW, h = w / spreadRatio;
      if (h > maxH) { h = maxH; w = h * spreadRatio; }
      var pageW = portrait ? w : w / 2;
      return { pageW: Math.floor(pageW), pageH: Math.floor(h), portrait: portrait };
    }

    var St = window.St || window;
    var sz = computeSize();
    var pageFlip = new St.PageFlip(flipEl, {
      width: sz.pageW, height: sz.pageH,
      size: 'fixed',
      minWidth: 200, maxWidth: 3000, minHeight: 200, maxHeight: 3000,
      drawShadow: true, flippingTime: 700,
      usePortrait: true, showCover: true,
      mobileScrollSupport: false
    });
    pageFlip.loadFromHTML(document.querySelectorAll('#flip .page'));

    document.getElementById('pageTotal').textContent = '/ ' + total;

    function loadNear(idx) { // idx is 0-based page index
      for (var k = 0; k < cells.length; k++) {
        var img = cells[k].querySelector('img');
        var ph = cells[k].querySelector('.ph');
        var near = Math.abs(k - idx) <= BUFFER;
        if (near && img.getAttribute('data-src')) {
          img.src = img.getAttribute('data-src');
          img.removeAttribute('data-src');
          img.onload = function () { this.style.display = 'block'; var p = this.parentNode.querySelector('.ph'); if (p) p.style.display = 'none'; };
          img.onerror = function () { var p = this.parentNode.querySelector('.ph'); if (p) p.textContent = '—'; };
        }
      }
    }

    function current() { return pageFlip.getCurrentPageIndex() || 0; }
    function syncUI() {
      var idx = current();
      document.getElementById('pageInput').value = (idx + 1);
      loadNear(idx);
      var ts = document.querySelectorAll('#thumbs .t');
      for (var j = 0; j < ts.length; j++) ts[j].classList.toggle('active', j === idx);
    }

    pageFlip.on('flip', syncUI);
    pageFlip.on('changeState', syncUI);
    loadNear(0);

    // ---- thumbnails ----
    var tWrap = document.getElementById('thumbs');
    for (var t = 1; t <= total; t++) {
      (function (n) {
        var a = document.createElement('div'); a.className = 't';
        var im = document.createElement('img');
        im.loading = 'lazy';
        im.src = 'thumbs/' + String(n).padStart(4, '0') + '.jpg';
        var s = document.createElement('span'); s.textContent = n;
        a.appendChild(im); a.appendChild(s);
        a.addEventListener('click', function () { pageFlip.flip(n - 1); });
        tWrap.appendChild(a);
      })(t);
    }
    document.getElementById('btnThumbs').addEventListener('click', function () {
      tWrap.classList.toggle('open');
    });

    // ---- nav buttons ----
    document.getElementById('btnPrev').addEventListener('click', function () { pageFlip.flipPrev(); });
    document.getElementById('btnNext').addEventListener('click', function () { pageFlip.flipNext(); });
    var pageInput = document.getElementById('pageInput');
    function jump() {
      var n = parseInt(pageInput.value, 10);
      if (!isNaN(n) && n >= 1 && n <= total) pageFlip.flip(n - 1);
      else pageInput.value = current() + 1;
    }
    pageInput.addEventListener('change', jump);
    pageInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') jump(); });

    document.addEventListener('keydown', function (e) {
      if (e.target === pageInput) return;
      if (e.key === 'ArrowLeft') pageFlip.flipPrev();
      if (e.key === 'ArrowRight') pageFlip.flipNext();
    });

    // ---- auto-flip ----
    var autoTimer = null;
    document.getElementById('btnAuto').addEventListener('click', function () {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; return; }
      autoTimer = setInterval(function () {
        if (current() >= total - 1) { clearInterval(autoTimer); autoTimer = null; return; }
        pageFlip.flipNext();
      }, 2500);
    });

    // ---- zoom + pan ----
    var zoom = 1, panX = 0, panY = 0;
    function applyZoom() {
      flipEl.style.transformOrigin = 'center center';
      flipEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
      flipEl.style.cursor = zoom > 1 ? 'grab' : 'default';
    }
    document.getElementById('btnZoomIn').addEventListener('click', function () {
      zoom = Math.min(3, zoom + 0.25); applyZoom();
    });
    document.getElementById('btnZoomOut').addEventListener('click', function () {
      zoom = Math.max(1, zoom - 0.25); if (zoom === 1) { panX = panY = 0; } applyZoom();
    });
    var dragging = false, sx = 0, sy = 0;
    stage.addEventListener('pointerdown', function (e) {
      if (zoom <= 1) return; dragging = true; sx = e.clientX - panX; sy = e.clientY - panY;
      flipEl.style.cursor = 'grabbing';
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return; panX = e.clientX - sx; panY = e.clientY - sy; applyZoom();
    });
    window.addEventListener('pointerup', function () { dragging = false; if (zoom > 1) flipEl.style.cursor = 'grab'; });

    // ---- fullscreen ----
    document.getElementById('btnFull').addEventListener('click', function () {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    });

    // ---- responsive resize ----
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var s = computeSize();
        pageFlip.update({ width: s.pageW, height: s.pageH });
        syncUI();
      }, 150);
    });
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Copy template into the extracted book**

Run:
```bash
cd /e/flipbook && \
cp books/_template/index.html books/Samsen45-M3-2540/index.html && \
mkdir -p books/Samsen45-M3-2540/vendor && \
cp books/_template/vendor/page-flip.browser.js books/Samsen45-M3-2540/vendor/page-flip.browser.js && \
ls books/Samsen45-M3-2540
```
Expected: lists `index.html book.js vendor pages thumbs`.

- [ ] **Step 3: Commit**

```bash
git add books/_template/index.html books/Samsen45-M3-2540/index.html books/Samsen45-M3-2540/vendor
git commit -m "feat: add flipbook viewer template and install into book 1"
```

---

## Task 7: Local end-to-end test

**Files:** none (verification only)

- [ ] **Step 1: Serve the books folder**

Run (background): `cd /e/flipbook && npx --yes serve books -l 5000`
Expected: prints `Serving … http://localhost:5000`.

- [ ] **Step 2: Open and verify the viewer**

Open `http://localhost:5000/Samsen45-M3-2540/` in a browser. Confirm each of these works and note any failure:
- Book renders centered on the dark stage; cover shows as a single page.
- Next/prev buttons flip with the page-curl animation; spread shows two pages on a wide window.
- Page counter updates; typing a number + Enter jumps to that page.
- Thumbnail sidebar (☰) opens, thumbnails load, clicking one jumps; active thumb is highlighted.
- Zoom in/out works; when zoomed, dragging pans; zoom-out resets pan.
- Fullscreen toggles. Auto-flip plays and stops at the last page. Arrow keys flip.
- Narrowing the window below ~760px switches to single-page layout without breaking.

Expected: all pass. If any fail, fix `_template/index.html`, re-copy to the book folder (Task 6 Step 2), and re-test. Commit fixes with `fix:` messages.

- [ ] **Step 3: Confirm no external network calls**

In the browser devtools Network tab, reload `http://localhost:5000/Samsen45-M3-2540/` and filter by domain. Expected: every request is to `localhost:5000` — nothing to fliphtml5.com, jsdelivr, or any third party.

---

## Task 8: Deployment documentation

**Files:**
- Create: `E:\flipbook\docs\DEPLOY.md`

- [ ] **Step 1: Write the deploy guide**

`docs/DEPLOY.md`:
```markdown
# Deploying the flipbooks to Firebase Hosting

The flipbooks are plain static files. They go into your existing alumni site's
Hosting `public` directory as a `books/` subfolder — no `firebase.json` changes
needed.

## One-time

1. In your existing alumni-site project (the one with `firebase.json`), find the
   Hosting `public` directory (often `public/` or `dist/`).
2. Copy the book folders into a `books/` subfolder there. Each book folder must
   contain `index.html`, `book.js`, `vendor/`, `pages/`, `thumbs/`:

       <public>/books/Samsen45-M3-2540/

   Do NOT copy `books/_template/`.

## Deploy

    firebase deploy --only hosting

## Result

Your book is live at:

    https://<your-site>/books/Samsen45-M3-2540/

Link to that URL from anywhere on your alumni website.

## Adding the second book later

    node tools/extract.mjs "<fliphtml5-url-of-book-2>" "Samsen45-M6-2543"
    cp books/_template/index.html books/Samsen45-M6-2543/index.html
    mkdir -p books/Samsen45-M6-2543/vendor
    cp books/_template/vendor/page-flip.browser.js books/Samsen45-M6-2543/vendor/

Then copy `books/Samsen45-M6-2543/` into `<public>/books/` and `firebase deploy`
again.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add Firebase Hosting deployment guide"
```

---

## Self-Review

**Spec coverage:**
- Ad-free self-hosted viewer → Tasks 6, 7 (zero external calls verified in 7.3). ✓
- Extraction from FlipHTML5 without running their code outside the browser → Task 3 (headless Chromium intercepts responses). ✓
- 102-page Book 1 `Samsen45-M3-2540` → Task 5. ✓
- Book 2 `Samsen45-M6-2543` structure ready → DEPLOY.md "Adding the second book later"; same template/extractor. ✓
- Full toolbar style A (thumbnails, prev/next, page jump, zoom/pan, fullscreen, auto-flip, keyboard, touch, Thai labels) → Task 6. ✓
- Direct-link deployment as `/books/` subfolder, no landing page → Task 8. ✓
- Self-contained folder, local thumbnails, lazy loading, two-page/single-page responsive → Tasks 3, 6. ✓
- Error handling: download retries + placeholder on failed page → Task 3 (gap retry, count check) + Task 6 (`onerror` placeholder). ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; every referenced symbol (`pad`, `pageFilename`, `window.BOOK`, `St.PageFlip`) is defined in a task.

**Type consistency:** `book.js` writes `{title,pageCount,pageWidth,pageHeight}`; viewer reads exactly those keys. Page filenames use `pad(i)`/`String(i).padStart(4,'0')` consistently (4-digit zero-pad) in both extractor and viewer.

**Known risk flagged for execution:** Task 3's page-advance loop (ArrowRight + `location.hash`) is the one part that depends on this specific FlipHTML5 template's controls. Task 5 Step 3 is the checkpoint to catch and iterate if some pages don't preload. This is called out so the executor watches for it rather than assuming first-run success.
```
