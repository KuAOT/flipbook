import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageFilename } from './lib/naming.mjs';
import { encodePage } from './lib/encode.mjs';

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

async function readFileSafe(p) { try { return await readFile(p); } catch { return null; } }

// Resolve a page-relative asset reference (e.g. "files/large/x.webp?t" or
// "./files/thumb/y.webp") against the book's base URL.
function resolveAsset(ref, base) {
  if (!ref) return null;
  return new URL(ref.replace(/^\.\//, ''), base.endsWith('/') ? base : base + '/').toString();
}

// Fetch a URL with retries; CloudFront occasionally stalls a single request.
async function fetchBuffer(ctx, url, referer, attempts = 4) {
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      const resp = await ctx.request.get(url, { headers: { referer }, timeout: 60000 });
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
      return Buffer.from(await resp.body());
    } catch (e) {
      lastErr = e;
      if (a < attempts) await new Promise((r) => setTimeout(r, 1500 * a));
    }
  }
  throw lastErr;
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

  console.log('Opening', bookUrl);
  // 'networkidle' never fires on FlipHTML5 (constant analytics traffic), so
  // wait for DOM load, then poll for the decrypted page list the viewer
  // exposes at window.fliphtml5_pages once its WASM config decryption runs.
  await page.goto(bookUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  let pages = [];
  for (let tries = 0; tries < 45 && pages.length === 0; tries++) {
    await page.waitForTimeout(2000);
    pages = await page.evaluate(() => {
      const list = window.fliphtml5_pages;
      if (!Array.isArray(list) || list.length === 0) return [];
      // n = full-size image, t/p = thumbnail, w/h = page dimensions
      return list.map((p) => ({ n: p.n || p.l || '', t: p.t || p.p || '', w: p.w || 0, h: p.h || 0 }));
    });
  }
  if (pages.length === 0) throw new Error('Could not read window.fliphtml5_pages — book did not initialize.');

  const meta = await page.evaluate(() => ({
    title: (document.title || '').trim(),
    pageWidth: (window.htmlConfig && window.htmlConfig.pageWidth) || 0,
    pageHeight: (window.htmlConfig && window.htmlConfig.pageHeight) || 0,
  }));
  const sized = pages.find((p) => p.w && p.h);
  const pageWidth = Math.round(meta.pageWidth || (sized && sized.w) || 0);
  const pageHeight = Math.round(meta.pageHeight || (sized && sized.h) || 0);
  const pageCount = pages.length;
  console.log(`Book "${meta.title}" — ${pageCount} pages`);

  // Download each page in order via the browser context (keeps cookies/referer).
  // Idempotent: skip pages already on disk so a rerun resumes where it stopped.
  let downloaded = 0;
  for (let i = 0; i < pageCount; i++) {
    const num = i + 1;
    const pagePath = path.join(pagesDir, pageFilename(num));
    const thumbPath = path.join(thumbsDir, pageFilename(num));
    if (existsSync(pagePath) && existsSync(thumbPath)) { downloaded++; continue; }

    const fullUrl = resolveAsset(pages[i].n, bookUrl);
    const thumbUrl = resolveAsset(pages[i].t, bookUrl);
    if (!fullUrl) { console.warn(`  MISSING page ${num} — no image reference`); continue; }

    const buf = await fetchBuffer(ctx, fullUrl, bookUrl);
    // Normalize to JPEG and downscale to display size for the viewer
    // (source pages are full-resolution webp). See lib/encode.mjs.
    const jpeg = await encodePage(buf);
    await writeFile(pagePath, jpeg);

    // Prefer the served thumbnail; fall back to downscaling the full image.
    let thumbBuf = buf;
    if (thumbUrl) {
      try { thumbBuf = await fetchBuffer(ctx, thumbUrl, bookUrl, 2); } catch { /* fall back to full image */ }
    }
    const thumb = await sharp(thumbBuf).resize({ height: 200 }).jpeg({ quality: 72 }).toBuffer();
    await writeFile(thumbPath, thumb);

    downloaded++;
    if (num % 10 === 0 || num === pageCount) console.log(`  downloaded ${downloaded}/${pageCount}`);
  }

  await browser.close();

  // Write per-book metadata consumed by index.html.
  const bookJs =
    `window.BOOK = ${JSON.stringify({
      title: meta.title || bookName,
      pageCount,
      pageWidth,
      pageHeight,
    }, null, 2)};\n`;
  await writeFile(path.join(bookDir, 'book.js'), bookJs);

  // Copy the viewer template + vendored library into this book folder.
  const tplIndex = await readFileSafe(path.join(ROOT, 'books', '_template', 'index.html'));
  if (tplIndex) await writeFile(path.join(bookDir, 'index.html'), tplIndex);
  const vendorLib = await readFileSafe(path.join(ROOT, 'books', '_template', 'vendor', 'page-flip.browser.js'));
  if (vendorLib) await writeFile(path.join(vendorDir, 'page-flip.browser.js'), vendorLib);

  const files = (await readdir(pagesDir)).filter((f) => f.endsWith('.jpg'));
  console.log(`\nDone. ${files.length}/${pageCount} pages in ${pagesDir}`);
  if (files.length !== pageCount) {
    console.error('VERIFY FAILED: page file count does not match page count.');
    process.exit(2);
  }
}

main().catch((e) => { console.error('EXTRACTION FAILED:', e); process.exit(1); });
