// Shared page-image encode settings, used by both the extractor (for new books)
// and the optimizer (for existing ones) so they always agree.
//
// Pages are displayed at roughly one page-width on screen (~1000px) with zoom up
// to 3x available. 1600px keeps text crisp at normal size and tolerable when
// zoomed, while cutting file size ~5x versus the 2652px source originals.
export const PAGE_MAX_WIDTH = 1600;
export const PAGE_QUALITY = 80;

import sharp from 'sharp';

// Re-encode a page image buffer to the shared display size/quality as JPEG.
export function encodePage(buf) {
  return sharp(buf)
    .resize({ width: PAGE_MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: PAGE_QUALITY, mozjpeg: true })
    .toBuffer();
}
