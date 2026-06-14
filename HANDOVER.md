# Handover — flipbook project

Last updated: 2026-06-14. Written so a fresh Claude session (e.g. on macOS) can
continue without the prior conversation.

## What this project is

A standalone HTML5 flipbook viewer plus a tool that extracts books from
FlipHTML5. Books are plain static files deployed to Firebase Hosting. No build
step — the viewer is vanilla JS in a single `index.html` per book.

- `books/<name>/` — one deployed book: `index.html`, `book.js` (title/page
  count/dimensions), `vendor/page-flip.browser.js` (StPageFlip lib),
  `pages/NNNN.jpg` (full pages), `thumbs/NNNN.jpg` (sidebar thumbnails).
- `books/_template/index.html` — the canonical viewer; `extract.mjs` copies it
  into each new book. **Keep viewer changes in sync between `_template` and any
  existing book folders.**
- `tools/extract.mjs` — Playwright + sharp extractor. Reads
  `window.fliphtml5_pages`, downloads pages, encodes them, writes `book.js`, and
  installs the viewer. Idempotent (skips pages already on disk).
- `tools/optimize.mjs` — re-encodes an existing book's `pages/` in place to
  display size. Reversible via `git checkout` (pages are git-tracked).
- `tools/lib/encode.mjs` — shared image settings (1600px wide, JPEG q80
  mozjpeg) used by BOTH extract and optimize so they agree.
- `tools/smoketest.mjs` — headless E2E check of the viewer.

Only book so far: `books/Samsen45-M3-2540/` (102 pages).

## Most recent work (commit b6754e8) — performance pass

Problem: pages loaded slowly on fast forward-flipping on Firebase Hosting.
Three fixes shipped:

1. **Smaller images** — pages were ~963 KB each (95.9 MB total). Re-encoded to
   1600px / q80 → ~286 KB each (29.2 MB total, 70% smaller). Settings in
   `tools/lib/encode.mjs`; `extract.mjs` now uses them for new books.
   Re-run on a book with: `node tools/optimize.mjs <book-folder-name>`.
2. **Direction-aware prefetch + background preload** in the viewer
   (`books/Samsen45-M3-2540/index.html` AND `books/_template/index.html`):
   `loadNear` fans out further in the travel direction (BUFFER=3 each side,
   AHEAD=6 ahead); `preloadNext` sequentially caches the whole book when idle.
3. **`firebase.json`** at repo root — immutable 1-year cache for
   images/vendor/thumbs, short revalidate for HTML/JS.

Verified: `node tools/smoketest.mjs` passes, `npm test` passes.

## ⚠️ Open question to resolve with the user

There are two conflicting deploy descriptions — confirm which is real before
deploying:

- **`firebase.json` (new, repo root)** assumes THIS repo is deployed directly
  with `"public": "books"`.
- **`docs/DEPLOY.md` (older)** says books are copied into a SEPARATE existing
  alumni site's Hosting public dir, and no `firebase.json` is needed here.

The user said "I've deployed on firebase hosting" but the exact setup (this repo
vs. a separate site, and the real public directory) is unconfirmed. **Ask the
user** which deploy model is correct, then either keep `firebase.json` as-is or
move its `headers` block into the real site's config. If the separate-site model
is correct, `docs/DEPLOY.md` should be updated to include the cache headers.

Also: with `immutable` caching, re-extracting a book reuses the same filenames
(`0001.jpg`), so cached browsers keep old images. Fine for static yearbooks. If
content updates become a need, switch to content-hashed filenames or a
cache-busting query.

## Common commands

```bash
npm test                                   # unit tests (naming lib)
node tools/smoketest.mjs                    # headless viewer E2E
node tools/optimize.mjs <book-folder>       # re-encode a book's pages in place
node tools/extract.mjs "<fliphtml5-url>" "<book-folder-name>"   # add a book
npm run serve                               # local static server on :5000 (serves books/)
firebase deploy --only hosting              # deploy (see open question above)
```

## Environment notes

- Original dev env was Windows (PowerShell). On macOS the Bash tool / paths are
  native; nothing in the code is Windows-specific.
- `sharp` and `playwright` are installed via `npm install`. Playwright may need
  `npx playwright install chromium` on a fresh machine.
- Branch: work has been committed to `master` (not `main`). Remote:
  `github.com/KuAOT/flipbook`.

## Reference docs

- `docs/superpowers/specs/2026-06-11-alumni-flipbook-design.md` — design spec.
- `docs/superpowers/plans/2026-06-11-alumni-flipbook.md` — implementation plan.
- `docs/DEPLOY.md` — original deploy notes (see open question above).
