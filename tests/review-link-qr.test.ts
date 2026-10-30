import { describe, expect, it } from "vitest"

import {
  encodeQr,
  QR_QUIET_ZONE,
  type QrMatrix,
  captionLines,
  reviewLinkQrSvg,
} from "@/lib/domain/review-link-qr"

/** Builds a matrix from rows of "#" (dark) and "." (light). */
function matrix(rows: string[]): QrMatrix {
  return {
    size: rows.length,
    dark: (row, col) => rows[row]?.[col] === "#",
  }
}

function moduleRects(svg: string) {
  const groups = [...svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g)]
  const inner = groups.map((group) => group[1]).join("")
  return [...inner.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => {
    const attribute = (name: string) => {
      const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
      return value === undefined ? undefined : Number(value)
    }
    return {
      x: attribute("x"),
      y: attribute("y"),
      width: attribute("width"),
      height: attribute("height"),
    }
  })
}

function viewBox(svg: string) {
  const value = /viewBox="([^"]*)"/.exec(svg)?.[1]
  expect(value).toBeDefined()
  return (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
}

function decode(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#34;|&#x22;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
}

const plain = { label: "Review The Old Crown on Google", caption: null }

describe("QR encoder", () => {
  it("uses a four-module quiet zone", () => {
    expect(QR_QUIET_ZONE).toBe(4)
  })

  it("encodes a review link as a square code with its finder patterns", () => {
    const qr = encodeQr("https://app.example.test/r/abcdefghjk?s=qr")
    expect(qr).not.toBeNull()
    const { size, dark } = qr!
    // Versions are 21 + 4n modules wide, with no border of their own.
    expect(size).toBeGreaterThanOrEqual(21)
    expect((size - 21) % 4).toBe(0)
    // Each finder pattern: a dark ring, a light ring, a dark 3x3 centre.
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      expect(dark(top, left)).toBe(true)
      expect(dark(top + 1, left + 1)).toBe(false)
      expect(dark(top + 3, left + 3)).toBe(true)
      expect(dark(top + 6, left + 6)).toBe(true)
    }
  })

  it("is deterministic for the same text", () => {
    const text = "https://app.example.test/r/abcdefghjk?s=qr"
    const a = encodeQr(text)!
    const b = encodeQr(text)!
    const cells = (qr: NonNullable<ReturnType<typeof encodeQr>>) =>
      Array.from({ length: qr.size * qr.size }, (_, i) =>
        qr.dark(Math.floor(i / qr.size), i % qr.size)
      )
    expect(cells(a)).toEqual(cells(b))
  })

  it("returns null for text no QR code can hold", () => {
    expect(encodeQr("x".repeat(10_000))).toBeNull()
  })
})

describe("reviewLinkQrSvg", () => {
  it("is a standalone, labelled SVG document on a white background", () => {
    const svg = reviewLinkQrSvg(matrix(["#.#", ".#.", "#.#"]), plain)
    expect(svg.startsWith("<svg")).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('role="img"')
    expect(svg).toContain(`aria-label="${plain.label}"`)
    expect(svg).toMatch(/<rect\b[^>]*fill="(#fff|#ffffff|white)"/i)
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
  })

  it("escapes the label in aria-label", () => {
    const svg = reviewLinkQrSvg(matrix(["#"]), {
      label: 'Fish & "chips" <today>',
      caption: null,
    })
    expect(svg).not.toContain('Fish & "chips" <today>')
    const ariaLabel = /aria-label="([^"]*)"/.exec(svg)?.[1]
    expect(ariaLabel).toBeDefined()
    expect(decode(ariaLabel ?? "")).toBe('Fish & "chips" <today>')
  })

  it("draws one rect per horizontal run, offset by the quiet zone", () => {
    const svg = reviewLinkQrSvg(matrix(["...", "###", "..."]), plain)
    expect(moduleRects(svg)).toEqual([
      {
        x: QR_QUIET_ZONE,
        y: QR_QUIET_ZONE + 1,
        width: 3,
        height: 1,
      },
    ])
  })

  it.each([
    [["...", "...", "..."], 0],
    [["###", "...", "..."], 1],
    [["#.#", ".#.", "#.#"], 5],
    [["##.##", "#...#", ".....", "#####", "#.#.#"], 8],
  ])("draws %j as %i runs", (rows, runs) => {
    expect(moduleRects(reviewLinkQrSvg(matrix(rows), plain))).toHaveLength(runs)
  })

  it("places each run at its own row and column", () => {
    const rects = moduleRects(
      reviewLinkQrSvg(matrix(["##.#", "....", ".##.", "#..."]), plain)
    )
    const cells = rects
      .map(({ x, y, width }) => [
        (y ?? NaN) - QR_QUIET_ZONE,
        (x ?? NaN) - QR_QUIET_ZONE,
        width,
      ])
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0))
    expect(cells).toEqual([
      [0, 0, 2],
      [0, 3, 1],
      [2, 1, 2],
      [3, 0, 1],
    ])
  })

  it.each([1, 3, 21, 25])(
    "uses a square %i-module viewBox plus quiet zone when there is no caption",
    (size) => {
      const rows = Array.from({ length: size }, () => "#".repeat(size))
      const svg = reviewLinkQrSvg(matrix(rows), plain)
      expect(svg).not.toMatch(/<text\b/)
      const n = size + 2 * QR_QUIET_ZONE
      expect(svg).toContain(`viewBox="0 0 ${n} ${n}"`)
    }
  )

  it("adds the caption in a text element and makes the viewBox taller", () => {
    const svg = reviewLinkQrSvg(matrix(["#.#", ".#.", "#.#"]), {
      label: plain.label,
      caption: "Leave us a review on Google",
    })
    expect(svg).toMatch(/<text\b/)
    expect(captionText(svg)).toBe("Leave us a review on Google")
    const [, , width, height] = viewBox(svg)
    expect(height).toBeGreaterThan(width)
  })

  it("escapes the caption", () => {
    const caption = 'Fish & "chips" <today>'
    const svg = reviewLinkQrSvg(matrix(["#"]), { label: plain.label, caption })
    expect(svg).not.toContain(caption)
    expect(svg).not.toContain("<today>")
    expect(svg).not.toContain('"chips"')
    expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i)
    expect(captionText(svg)).toBe(caption)
  })

  it("breaks a long caption between words onto at most two lines", () => {
    const caption =
      "Thanks for visiting The Old Crown. Leave us a review on Google"
    const svg = reviewLinkQrSvg(matrix(Array(33).fill(".".repeat(33))), {
      label: plain.label,
      caption,
    })
    const lines = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    expect(lines).toHaveLength(2)
    expect(captionText(svg)).toBe(caption)
  })

  it("never stretches a short caption", () => {
    const svg = reviewLinkQrSvg(matrix(Array(33).fill(".".repeat(33))), {
      label: plain.label,
      caption: "Scan me",
    })
    expect(svg).not.toContain("textLength")
  })
})

describe("captionLines", () => {
  it("keeps a caption that fits on one line whole", () => {
    expect(captionLines("Leave us a review", 41)).toEqual(["Leave us a review"])
  })

  it("splits at a word boundary and keeps every word", () => {
    const lines = captionLines(
      "Reviews help other guests find The Old Crown",
      41
    )
    expect(lines).toHaveLength(2)
    expect(lines.join(" ")).toBe("Reviews help other guests find The Old Crown")
  })
})

/** Every caption line, decoded and joined as it reads. */
function captionText(svg: string): string {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((found) => decode((found[1] ?? "").replace(/<[^>]*>/g, "")))
    .join(" ")
}
