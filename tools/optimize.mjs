// Re-encode an existing book's page images to display size in place.
//
// Originals are tracked in git, so this is reversible with `git checkout` if a
// run is ever unsatisfactory. New books produced by extract.mjs are already
// encoded at these settings; this tool brings older books up to date.
//
// Usage: node tools/optimize.mjs <book-folder-name>
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePage, PAGE_MAX_WIDTH, PAGE_QUALITY } from './lib/encode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const [, , bookName] = process.argv;
if (!bookName) {
  console.error('Usage: node tools/optimize.mjs <book-folder-name>');
  process.exit(1);
}

const pagesDir = path.join(ROOT, 'books', bookName, 'pages');

async function main() {
  const files = (await readdir(pagesDir)).filter((f) => f.endsWith('.jpg')).sort();
  if (files.length === 0) { console.error('No page images found in', pagesDir); process.exit(1); }

  console.log(`Optimizing ${files.length} pages → max ${PAGE_MAX_WIDTH}px, quality ${PAGE_QUALITY}`);
  let before = 0, after = 0;
  for (const f of files) {
    const p = path.join(pagesDir, f);
    const orig = await readFile(p);
    const out = await encodePage(orig);
    before += orig.length;
    after += out.length;
    await writeFile(p, out);
  }
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  const pct = Math.round((1 - after / before) * 100);
  console.log(`Done. ${mb(before)} → ${mb(after)} (${pct}% smaller)`);
}

main().catch((e) => { console.error('OPTIMIZE FAILED:', e); process.exit(1); });
