// reviewLinkQrSvg adapted from OpenGMB packages/core/src/review-links/qr.ts (qrSvg).
// Adapted from OpenGMB (MIT, © 2026 Synectus Private Limited).

import { encode } from "uqr"

/**
 * The QR code for a review link, as a module matrix and a print-safe SVG.
 * Pure and client-safe: the area page draws the preview and builds the
 * SVG and PNG downloads in the browser.
 */

/** A QR code's modules: `dark(row, col)` for each of `size` × `size`. */
export type QrMatrix = {
  size: number
  dark: (row: number, col: number) => boolean
}

/** White modules around the code: the QR standard's minimum. */
export const QR_QUIET_ZONE = 4

/**
 * The code's modules for `text` at error correction level M (15% of the
 * code may be damaged and it still scans: table talkers get wet), with no
 * border of its own (QR_QUIET_ZONE is added when drawing). Null when the
 * text doesn't fit a QR code, which a review link never comes close to.
 */
export function encodeQr(text: string): QrMatrix | null {
  try {
    const { size, data } = encode(text, { ecc: "M", border: 0 })
    return { size, dark: (row, col) => data[row]?.[col] === true }
  } catch {
    return null
  }
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

/** Caption type size and line height, in modules. */
const CAPTION_FONT = 3
const CAPTION_LINE = 3.6
/** Roughly how wide a character of Helvetica is, as a share of the type size. */
const CHAR_WIDTH = 0.55

/**
 * The caption as at most two lines, broken between words, for a code
 * `width` modules wide. A line too long for the space is condensed to fit
 * when drawn; a short one is never stretched.
 */
export function captionLines(caption: string, width: number): string[] {
  const perLine = Math.max(
    8,
    Math.floor((width - 4) / (CAPTION_FONT * CHAR_WIDTH))
  )
  if (caption.length <= perLine) return [caption]
  const words = caption.split(" ")
  let first = ""
  for (const word of words) {
    const next = first ? `${first} ${word}` : word
    if (next.length > perLine && first) break
    first = next
  }
  const second = caption.slice(first.length).trim()
  return second ? [first, second] : [first]
}

/**
 * A standalone SVG: white background, black modules (one rect per
 * horizontal run, so it stays small and scales to any print size), the
 * quiet zone around them and, when given, the caption underneath on up to
 * two lines.
 */
export function reviewLinkQrSvg(
  matrix: QrMatrix,
  options: { label: string; caption: string | null }
): string {
  const { size, dark } = matrix
  const width = size + QR_QUIET_ZONE * 2
  const lines = options.caption ? captionLines(options.caption, width) : []
  const height =
    width + (lines.length ? lines.length * CAPTION_LINE + QR_QUIET_ZONE / 2 : 0)
  const rects: string[] = []
  for (let row = 0; row < size; row += 1) {
    let col = 0
    while (col < size) {
      if (!dark(row, col)) {
        col += 1
        continue
      }
      const start = col
      while (col < size && dark(row, col)) col += 1
      rects.push(
        `<rect x="${start + QR_QUIET_ZONE}" y="${row + QR_QUIET_ZONE}" width="${col - start}" height="1"/>`
      )
    }
  }
  const room = width - 4
  const text = lines
    .map((line, index) => {
      const natural = line.length * CAPTION_FONT * CHAR_WIDTH
      const fit =
        natural > room
          ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"`
          : ""
      // The quiet zone stays clear: the first baseline sits below it.
      const y = width + CAPTION_LINE * (index + 0.8)
      return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${CAPTION_FONT}"${fit}>${escapeXml(line)}</text>`
    })
    .join("")
  // design-exempt-start R2: a printed QR code must be pure black on white,
  // whatever the app's theme; these colours never reach the UI's palette.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * 8}" height="${height * 8}" role="img" aria-label="${escapeXml(options.label)}" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="#ffffff"/><g fill="#000000">${rects.join("")}${text}</g></svg>`
  // design-exempt-end
}
