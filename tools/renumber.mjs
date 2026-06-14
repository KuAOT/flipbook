// Re-number a book's pages to be gap-free after some page files were deleted.
//
// Workflow: delete the unwanted pages/NNNN.jpg by hand (e.g. duplicates), then
// run this. It renames the surviving pages to 0001..NNNN in their existing
// sorted order, rebuilds thumbs/ from the renumbered pages so they always match,
// and updates pageCount in book.js (title/dimensions are preserved).
//
// Two-phase rename (via .tmp) avoids clobbering when shifting numbers down.
//
// Usage: node tools/renumber.mjs <book-folder-name>
import sharp from 'sharp';
import { readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageFilename } from './lib/naming.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const [, , bookName] = process.argv;
if (!bookName) {
  console.error('Usage: node tools/renumber.mjs <book-folder-name>');
  process.exit(1);
}

const bookDir = path.join(ROOT, 'books', bookName);
const pagesDir = path.join(bookDir, 'pages');
const thumbsDir = path.join(bookDir, 'thumbs');

async function main() {
  const pages = (await readdir(pagesDir)).filter((f) => /\.jpg$/i.test(f)).sort();
  if (pages.length === 0) { console.error('No page images in', pagesDir); process.exit(1); }
  console.log(`Renumbering ${pages.length} pages in ${bookName}`);

  // Phase 1: move every page to a temp name so final names can't collide.
  for (let i = 0; i < pages.length; i++) {
    await rename(path.join(pagesDir, pages[i]), path.join(pagesDir, `r${i}.tmp`));
  }
  // Phase 2: temp -> final sequential name, rebuilding the matching thumbnail.
  for (let i = 0; i < pages.length; i++) {
    const finalName = pageFilename(i + 1);
    const pagePath = path.join(pagesDir, finalName);
    await rename(path.join(pagesDir, `r${i}.tmp`), pagePath);
    const thumb = await sharp(await readFile(pagePath)).resize({ height: 200 }).jpeg({ quality: 72 }).toBuffer();
    await writeFile(path.join(thumbsDir, finalName), thumb);
  }

  // Drop any thumbs left over from the old (higher) numbering.
  const keep = new Set(pages.map((_, i) => pageFilename(i + 1)));
  for (const t of (await readdir(thumbsDir)).filter((f) => /\.jpg$/i.test(f))) {
    if (!keep.has(t)) await rm(path.join(thumbsDir, t));
  }

  // Update pageCount in book.js, preserving title and dimensions.
  const bookJsPath = path.join(bookDir, 'book.js');
  const src = await readFile(bookJsPath, 'utf8');
  const obj = JSON.parse(src.match(/=\s*(\{[\s\S]*\})\s*;/)[1]);
  obj.pageCount = pages.length;
  await writeFile(bookJsPath, `window.BOOK = ${JSON.stringify(obj, null, 2)};\n`);

  console.log(`Done. ${pages.length} pages, thumbs rebuilt, book.js pageCount=${pages.length}`);
}

main().catch((e) => { console.error('RENUMBER FAILED:', e); process.exit(1); });
