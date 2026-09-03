/**
 * Reads the design tokens back out of `app/globals.css` so the contrast gate
 * measures the SHIPPING values, not a copy of them. A second table of colours
 * maintained by hand is a table that drifts; this parser is deliberately
 * narrow instead, and fails loudly on anything it cannot resolve.
 */

export type ThemeName = "light" | "dark"

export type TokenSet = Record<string, string>

export type ParsedTokens = {
  light: TokenSet
  dark: TokenSet
}

/**
 * Strips comments, then pulls `--name: value;` declarations out of the FIRST
 * block whose selector matches. Nested blocks (`@media`, `@supports`) are
 * skipped by brace counting: the reduced-motion and no-backdrop-filter
 * overrides in globals.css must not be mistaken for the base values.
 */
function readBlock(css: string, selector: string): TokenSet {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const tokens: TokenSet = {}

  // Match a top-level `selector {` that is not preceded by an at-rule on the
  // same line, then take text up to its matching close brace.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const opener = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{`, "m")
  let cursor = 0
  while (cursor < withoutComments.length) {
    const slice = withoutComments.slice(cursor)
    const match = opener.exec(slice)
    if (!match) break
    const start = cursor + match.index + match[0].length
    let depth = 1
    let end = start
    while (end < withoutComments.length && depth > 0) {
      const ch = withoutComments[end]
      if (ch === "{") depth += 1
      else if (ch === "}") depth -= 1
      end += 1
    }
    const body = withoutComments.slice(start, end - 1)
    // Only take declarations at this block's own depth.
    let inner = 0
    let declaration = ""
    for (const ch of body) {
      if (ch === "{") inner += 1
      else if (ch === "}") inner -= 1
      if (inner === 0) declaration += ch
    }
    for (const [, name, value] of declaration.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      // First writer wins so an @media override later in the file cannot
      // replace a base value we already captured.
      if (!(name in tokens)) tokens[name] = value.trim()
    }
    cursor = end
  }
  return tokens
}

export function parseTokens(css: string): ParsedTokens {
  const light = readBlock(css, ":root")
  const dark = { ...light, ...readBlock(css, ".dark") }
  return { light, dark }
}

export class TokenResolutionError extends Error {
  // Plain fields rather than constructor parameter properties: this module is
  // loaded by scripts/check-contrast.mjs through Node's type stripping, which
  // only erases syntax and cannot emit the assignments a parameter property
  // implies.
  token: string
  theme: ThemeName

  constructor(message: string, token: string, theme: ThemeName) {
    super(message)
    this.name = "TokenResolutionError"
    this.token = token
    this.theme = theme
  }
}

/**
 * Follows `var(--a, fallback)` chains to a literal colour.
 *
 * `color-mix()` is refused on purpose. A pair whose colour is computed at
 * paint time cannot be gated here, so any role that must clear a ratio (a
 * hover state, a tint) has to be a literal token. That rule is why the new
 * accent ladder spells out `--np-accent-hover` instead of mixing it.
 */
export function resolveToken(
  tokens: TokenSet,
  name: string,
  theme: ThemeName,
  seen: string[] = []
): string {
  if (seen.includes(name)) {
    throw new TokenResolutionError(`Circular var() chain: ${[...seen, name].join(" -> ")}`, name, theme)
  }
  const raw = tokens[name]
  if (raw === undefined) {
    throw new TokenResolutionError(`Token ${name} is not defined in the ${theme} theme`, name, theme)
  }
  const value = raw.trim()

  if (/color-mix\(/i.test(value)) {
    throw new TokenResolutionError(
      `Token ${name} uses color-mix(), which cannot be measured. Spell the value out as its own token.`,
      name,
      theme
    )
  }

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value)
  if (varMatch) {
    const [, referenced, fallback] = varMatch
    if (referenced in tokens) return resolveToken(tokens, referenced, theme, [...seen, name])
    if (fallback) return fallback.trim()
    throw new TokenResolutionError(
      `Token ${name} points at ${referenced}, which is not defined in the ${theme} theme`,
      name,
      theme
    )
  }

  return value
}

/** Every `--np-*` role, for the structural light/dark parity check. */
export function semanticTokenNames(tokens: TokenSet): string[] {
  return Object.keys(tokens)
    .filter((name) => name.startsWith("--np-"))
    .sort()
}
