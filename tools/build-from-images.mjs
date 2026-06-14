// Build a book from a local folder of page images (e.g. photos pulled from a
// Google Drive folder), as opposed to extract.mjs which scrapes FlipHTML5.
//
// Pages are taken in filename order — for camera/scan exports whose names are
// timestamps (YYYYMMDD_HHMMSSmmm.jpg) this is shooting order, i.e. page order.
// Each image is normalized to display size (see lib/encode.mjs) and given a
// matching thumbnail, then book.js + the viewer template are written, mirroring
// the output layout of extract.mjs so the viewer is identical.
//
// Idempotent: pages already on disk are skipped, so a rerun resumes.
//
// Usage: node tools/build-from-images.mjs <source-dir> <book-folder-name> "<title>"
import sharp from 'sharp';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageFilename } from './lib/naming.mjs';
import { encodePage } from './lib/encode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const [, , srcDir, bookName, titleArg] = process.argv;
if (!srcDir || !bookName) {
  console.error('Usage: node tools/build-from-images.mjs <source-dir> <book-folder-name> "<title>"');
  process.exit(1);
}

const bookDir = path.join(ROOT, 'books', bookName);
const pagesDir = path.join(bookDir, 'pages');
const thumbsDir = path.join(bookDir, 'thumbs');
const vendorDir = path.join(bookDir, 'vendor');

async function readFileSafe(p) { try { return await readFile(p); } catch { return null; } }

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  await mkdir(pagesDir, { recursive: true });
  await mkdir(thumbsDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });

  const sources = (await readdir(srcDir))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  if (sources.length === 0) { console.error('No images found in', srcDir); process.exit(1); }
  const pageCount = sources.length;
  console.log(`Building "${titleArg || bookName}" — ${pageCount} pages from ${srcDir}`);

  const widths = [], heights = [];
  for (let i = 0; i < pageCount; i++) {
    const num = i + 1;
    const src = path.join(srcDir, sources[i]);
    const pagePath = path.join(pagesDir, pageFilename(num));
    const thumbPath = path.join(thumbsDir, pageFilename(num));

    // .rotate() with no args bakes in any EXIF orientation so the stored JPEG
    // is upright (the viewer ignores EXIF). encodePage downscales to display size.
    const upright = await sharp(await readFile(src)).rotate().toBuffer();

    if (!(existsSync(pagePath) && existsSync(thumbPath))) {
      const jpeg = await encodePage(upright);
      await writeFile(pagePath, jpeg);
      const thumb = await sharp(upright).resize({ height: 200 }).jpeg({ quality: 72 }).toBuffer();
      await writeFile(thumbPath, thumb);
    }

    const m = await sharp(pagePath).metadata();
    widths.push(m.width); heights.push(m.height);
    if (num % 10 === 0 || num === pageCount) console.log(`  processed ${num}/${pageCount}`);
  }

  // Representative page-cell shape: median width, and height from the median
  // aspect ratio. Individual pages vary slightly; the viewer letterboxes them
  // (object-fit: contain) so the cell shape only needs to be typical.
  const pageWidth = median(widths);
  const ratios = widths.map((w, i) => w / heights[i]);
  const pageHeight = Math.round(pageWidth / median(ratios));

  const bookJs =
    `window.BOOK = ${JSON.stringify({ title: titleArg || bookName, pageCount, pageWidth, pageHeight }, null, 2)};\n`;
  await writeFile(path.join(bookDir, 'book.js'), bookJs);

  // Install the canonical viewer + vendored flip library into this book.
  const tplIndex = await readFileSafe(path.join(ROOT, 'books', '_template', 'index.html'));
  if (tplIndex) await writeFile(path.join(bookDir, 'index.html'), tplIndex);
  const vendorLib = await readFileSafe(path.join(ROOT, 'books', '_template', 'vendor', 'page-flip.browser.js'));
  if (vendorLib) await writeFile(path.join(vendorDir, 'page-flip.browser.js'), vendorLib);

  const files = (await readdir(pagesDir)).filter((f) => f.endsWith('.jpg'));
  console.log(`\nDone. ${files.length}/${pageCount} pages in ${pagesDir}`);
  console.log(`book.js: ${pageCount} pages, ${pageWidth}x${pageHeight}`);
  if (files.length !== pageCount) {
    console.error('VERIFY FAILED: page file count does not match page count.');
    process.exit(2);
  }
}

main().catch((e) => { console.error('BUILD FAILED:', e); process.exit(1); });
