import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageFilename } from './lib/naming.mjs';

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

async function readFileSafe(p) { try { return await readFile(p); } catch { return null; } }

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
  for (let i = 1; i <= meta.pageCount; i++) {
    await page.evaluate((n) => { location.hash = `#p=${n}`; }, i);
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
  const tplIndex = await readFileSafe(path.join(ROOT, 'books', '_template', 'index.html'));
  if (tplIndex) await writeFile(path.join(bookDir, 'index.html'), tplIndex);
  const vendorLib = await readFileSafe(path.join(ROOT, 'books', '_template', 'vendor', 'page-flip.browser.js'));
  if (vendorLib) await writeFile(path.join(vendorDir, 'page-flip.browser.js'), vendorLib);

  const files = (await readdir(pagesDir)).filter((f) => f.endsWith('.jpg'));
  console.log(`\nDone. ${files.length}/${meta.pageCount} pages in ${pagesDir}`);
  if (files.length !== meta.pageCount) {
    console.error('VERIFY FAILED: page file count does not match page count.');
    process.exit(2);
  }
}

main().catch((e) => { console.error('EXTRACTION FAILED:', e); process.exit(1); });
