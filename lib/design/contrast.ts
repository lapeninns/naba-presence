/**
 * Colour maths for the design-token contrast gate.
 *
 * Dependency-free and browser-safe on purpose: `scripts/check-contrast.mjs`,
 * `tests/design-tokens-contrast.test.ts` and the `/design-system` proof page
 * all measure with THIS module, so a ratio printed on the page and a ratio
 * asserted in CI can never disagree.
 *
 * The pipeline is the one a browser actually performs: oklch -> OKLab ->
 * LMS -> linear sRGB -> gamma-encoded sRGB (clamped, because that is what
 * gets painted) -> WCAG relative luminance.
 */

export type Rgb = { r: number; g: number; b: number; a: number }

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** Linear-light channel -> gamma-encoded sRGB (IEC 61966-2-1). */
function encodeGamma(channel: number): number {
  const c = clamp01(channel)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** Gamma-encoded sRGB -> linear-light channel. */
function decodeGamma(channel: number): number {
  const c = clamp01(channel)
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * True when the oklch triplet lands outside the sRGB gamut. The clamp in
 * `encodeGamma` silently rescues such a colour, so the pair manifest reports
 * it separately: a token nobody can paint as specified is a token bug even
 * when its clamped form happens to pass.
 */
export function isOutOfGamut(l: number, c: number, h: number): boolean {
  const linear = oklchToLinear(l, c, h)
  const epsilon = 1e-4
  return (
    linear.r < -epsilon ||
    linear.r > 1 + epsilon ||
    linear.g < -epsilon ||
    linear.g > 1 + epsilon ||
    linear.b < -epsilon ||
    linear.b > 1 + epsilon
  )
}

function oklchToLinear(l: number, c: number, hDegrees: number) {
  const h = (hDegrees * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const lCube = l + 0.3963377774 * a + 0.2158037573 * b
  const mCube = l - 0.1055613458 * a - 0.0638541728 * b
  const sCube = l - 0.0894841775 * a - 1.291485548 * b

  const lms = { l: lCube ** 3, m: mCube ** 3, s: sCube ** 3 }

  return {
    r: 4.0767416621 * lms.l - 3.3077115913 * lms.m + 0.2309699292 * lms.s,
    g: -1.2684380046 * lms.l + 2.6097574011 * lms.m - 0.3413193965 * lms.s,
    b: -0.0041960863 * lms.l - 0.7034186147 * lms.m + 1.707614701 * lms.s,
  }
}

/** `oklch(L C H)` / `oklch(L C H / A)` -> gamma-encoded sRGB in 0..1. */
export function oklchToRgb(l: number, c: number, h: number, alpha = 1): Rgb {
  const linear = oklchToLinear(l, c, h)
  return {
    r: encodeGamma(linear.r),
    g: encodeGamma(linear.g),
    b: encodeGamma(linear.b),
    a: alpha,
  }
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function parseHex(value: string): Rgb | null {
  if (!HEX_RE.test(value)) return null
  let hex = value.slice(1)
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("")
  }
  const int = Number.parseInt(hex, 16)
  const hasAlpha = hex.length === 8
  return {
    r: ((int >> (hasAlpha ? 24 : 16)) & 0xff) / 255,
    g: ((int >> (hasAlpha ? 16 : 8)) & 0xff) / 255,
    b: ((int >> (hasAlpha ? 8 : 0)) & 0xff) / 255,
    a: hasAlpha ? (int & 0xff) / 255 : 1,
  }
}

/**
 * A number that may carry a unit the CSS colour grammar allows in this slot:
 * a bare number, a percentage (of `scale`), or `none` (which is 0).
 */
function parseComponent(raw: string, scale: number): number | null {
  const token = raw.trim()
  if (token === "" || token === "none") return 0
  if (token.endsWith("%")) {
    const percent = Number.parseFloat(token.slice(0, -1))
    return Number.isFinite(percent) ? (percent / 100) * scale : null
  }
  const value = Number.parseFloat(token)
  return Number.isFinite(value) ? value : null
}

/** Hue accepts deg/rad/grad/turn, because the token file may use any of them. */
function parseHue(raw: string): number | null {
  const token = raw.trim()
  if (token === "" || token === "none") return 0
  const value = Number.parseFloat(token)
  if (!Number.isFinite(value)) return null
  if (token.endsWith("rad")) return (value * 180) / Math.PI
  if (token.endsWith("grad")) return value * 0.9
  if (token.endsWith("turn")) return value * 360
  return value
}

export type ParsedColor = Rgb & {
  /** Present when the source was oklch, so hints can move lightness. */
  oklch?: { l: number; c: number; h: number }
  outOfGamut?: boolean
}

/**
 * Parses the colour syntaxes the token file is allowed to use: `oklch(...)`,
 * hex, `white`/`black`/`transparent`. Anything else (notably `color-mix()`)
 * returns null, and `contrast-pairs.ts` turns that into a failure rather than
 * guessing — a state whose colour is computed at paint time cannot be gated.
 */
export function parseColor(input: string): ParsedColor | null {
  const value = input.trim().toLowerCase()
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
  if (value === "white") return { r: 1, g: 1, b: 1, a: 1 }
  if (value === "black") return { r: 0, g: 0, b: 0, a: 1 }

  const hex = parseHex(value)
  if (hex) return hex

  const match = /^oklch\(\s*([^)]+)\)$/.exec(value)
  if (!match) return null

  const [coords, alphaPart] = match[1].split("/")
  const parts = coords.trim().split(/\s+/)
  if (parts.length < 3) return null

  const l = parseComponent(parts[0], 1)
  // Chroma percentages are relative to 0.4 per CSS Color 4.
  const c = parseComponent(parts[1], 0.4)
  const h = parseHue(parts[2])
  if (l === null || c === null || h === null) return null

  const alpha = alphaPart === undefined ? 1 : parseComponent(alphaPart, 1)
  if (alpha === null) return null

  const rgb = oklchToRgb(l, c, h, clamp01(alpha))
  return { ...rgb, oklch: { l, c, h }, outOfGamut: isOutOfGamut(l, c, h) }
}

/** Composites a possibly-translucent colour over an opaque backdrop. */
export function composite(foreground: Rgb, backdrop: Rgb): Rgb {
  const a = clamp01(foreground.a)
  if (a >= 1) return { ...foreground, a: 1 }
  return {
    r: foreground.r * a + backdrop.r * (1 - a),
    g: foreground.g * a + backdrop.g * (1 - a),
    b: foreground.b * a + backdrop.b * (1 - a),
    a: 1,
  }
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(colour: Rgb): number {
  return (
    0.2126 * decodeGamma(colour.r) +
    0.7152 * decodeGamma(colour.g) +
    0.0722 * decodeGamma(colour.b)
  )
}

/**
 * WCAG contrast ratio. A translucent foreground is composited over the
 * backdrop first, which is the only reading that matches what a viewer sees
 * (several tokens here are `oklch(1 0 0 / 12%)` borders).
 */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const bg = background.a >= 1 ? background : composite(background, { r: 1, g: 1, b: 1, a: 1 })
  const fg = composite(foreground, bg)
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export const roundRatio = (ratio: number) => Math.round(ratio * 100) / 100

/**
 * The fix hint: the nearest lightness (chroma and hue held) at which
 * `colour` clears `target` against `background`. Returns null when no
 * lightness works, which means the hue or chroma has to move instead.
 *
 * Both directions are searched because the answer differs by theme: on a
 * light canvas the fix is darker, on a dark canvas lighter.
 */
export function nearestPassingLightness(
  colour: { l: number; c: number; h: number },
  background: Rgb,
  target: number
): number | null {
  const ratioAt = (l: number) =>
    contrastRatio(oklchToRgb(l, colour.c, colour.h, 1), background)

  const search = (direction: -1 | 1): number | null => {
    let lo = colour.l
    let hi = direction === -1 ? 0 : 1
    if (ratioAt(hi) < target) return null
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2
      if (ratioAt(mid) >= target) hi = mid
      else lo = mid
    }
    // Round toward the passing side. Rounding to the nearest thousandth can
    // land a hair under the target, and a hint that does not itself pass is
    // worse than no hint.
    const step = direction === -1 ? -0.001 : 0.001
    let rounded = Math.round(hi * 1000) / 1000
    for (let i = 0; i < 5 && ratioAt(rounded) < target; i += 1) {
      rounded = Math.round((rounded + step) * 1000) / 1000
    }
    return ratioAt(rounded) >= target ? rounded : null
  }

  const darker = search(-1)
  const lighter = search(1)
  if (darker === null) return lighter
  if (lighter === null) return darker
  return Math.abs(darker - colour.l) <= Math.abs(lighter - colour.l) ? darker : lighter
}
