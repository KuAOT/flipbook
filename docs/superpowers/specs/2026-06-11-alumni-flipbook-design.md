# Alumni Flipbook Viewer — Design Spec

**Date:** 2026-06-11
**Status:** Approved by user

## Goal

Replace ad-supported FlipHTML5 hosting with self-hosted, ad-free HTML5 flipbooks for two alumni yearbooks, deployed as a subfolder of the user's existing Firebase Hosting site.

## Books

| # | Folder name | Source | Status |
|---|-------------|--------|--------|
| 1 | `Samsen45-M3-2540` | https://online.fliphtml5.com/qbymk/xbak/ (102 pages, ~2652×2800 px/page) | Build now |
| 2 | `Samsen45-M6-2543` | URL to be provided later | Structure ready; extract when URL arrives |

The books are the user's own content, uploaded by them to FlipHTML5; extraction recovers their own files.

## Decisions (from brainstorming)

- **Viewer style:** Full toolbar, FlipHTML5-style (option A) — dark stage, centered book, toolbar with thumbnails, zoom, fullscreen, page jump, auto-flip.
- **Navigation to books:** Direct links only (option B) — no bookshelf landing page. The alumni site links straight to each book folder.
- **Flip engine:** StPageFlip (MIT license), bundled locally. No CDN, no external requests at runtime.
- **Deployment:** Subfolder (`/books/`) of the existing alumni Firebase Hosting site. User runs `firebase deploy` from their existing site config; we deliver the static folder.

## Components

### 1. Extraction tool — `tools/extract.mjs`

One-time Node script using Playwright (Chromium headless):

1. Opens the FlipHTML5 book URL.
2. FlipHTML5's own viewer code runs in the browser sandbox and decrypts its config (config is WASM-encrypted; we deliberately do NOT run their code outside the browser).
3. Captures page-image URLs via network response interception while programmatically flipping/preloading all pages.
4. Downloads the largest available rendition of each page to `books/<name>/pages/0001.jpg` … zero-padded, ordered.
5. Generates thumbnails (`thumbs/0001.jpg`, ~200 px tall, via sharp) from the downloaded pages.
6. Writes `book.js` with `{ title, pageCount, pageWidth, pageHeight }`.

Usage: `node tools/extract.mjs <fliphtml5-url> <book-folder-name>`

**Verification:** file count equals page count, all files non-zero, visual spot-check of first/middle/last pages.

### 2. Viewer — per-book static app

```
books/<name>/
  index.html              ← full viewer: HTML + inline CSS + inline JS
  book.js                 ← book metadata (title, pageCount, dimensions)
  vendor/page-flip.min.js ← StPageFlip, bundled locally
  pages/NNNN.jpg          ← full-size page images
  thumbs/NNNN.jpg         ← sidebar thumbnails
```

Each folder is fully self-contained; copying the folder anywhere preserves function.

**Toolbar features (style A):**

- Thumbnail sidebar (toggle button; lazy-loaded thumbs; click to jump)
- Prev / next page buttons
- Page counter `N–M / total` with click-to-edit jump-to-page input
- Zoom in / out (CSS transform) with drag-to-pan when zoomed; pinch-zoom on touch
- Fullscreen toggle (Fullscreen API)
- Auto-flip play/pause (fixed interval, stops at last page)
- UI labels in Thai with English tooltips

**Behavior:**

- Two-page spread on desktop; single page below a narrow-width breakpoint (StPageFlip portrait mode)
- Lazy loading: only pages near the current spread are fetched
- Keyboard: ←/→ arrows flip pages
- Touch: swipe/drag to flip (StPageFlip native)
- Book title in `<title>` and toolbar
- Dark stage background per style A mockup

### 3. Deployment

Deliverable is the `books/` folder. User copies it into their existing Firebase Hosting `public/` directory and runs `firebase deploy`. Books are reachable at `https://<site>/books/Samsen45-M3-2540/`. No changes to the user's `firebase.json` are required (static files only).

## Error handling

- **Extraction:** retries failed image downloads; aborts with a clear message if page count can't be determined or images stop loading; never writes a partial book silently.
- **Viewer:** failed page image shows a neutral placeholder with page number; viewer remains navigable. No console-error spam on missing thumbs.

## Testing

- Extraction verified by count/size checks plus visual spot-check.
- Viewer tested locally via a static file server (e.g., `npx serve`): flip, jump, zoom, fullscreen, thumbnails, auto-flip, keyboard, mobile-width layout.
- Final check after `firebase deploy` on the live URL (user-side).

## Out of scope

- Bookshelf/landing page (direct links only)
- Search inside the book, text layer / OCR, download-PDF button
- Analytics, sharing widgets
- Changes to the alumni website itself
