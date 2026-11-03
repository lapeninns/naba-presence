// Pure helpers for nm-capture.mjs (no browser, no I/O), so the viewport and
// route-spec parsing can be unit tested: tests/visual/nm-capture-lib.test.ts.

// Named presets. `desktop` and `mobile` are the original two (unchanged:
// output dirs, sizes and DPR flags); `phone` and `tablet` are the redesign's
// phone/tablet/desktop matrix. `layouts` says which layout-specific
// interactive states run there: "mobile" states need the phone shell (tab
// bar, More sheet), "desktop" states the keyboard/rail shell. A tablet gets
// both and records `state-not-reached` for whichever its width does not show.
export const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900, input: "mouse", layouts: ["desktop"] },
  mobile: { width: 390, height: 844, input: "touch", layouts: ["mobile"] },
  phone: { width: 390, height: 844, input: "touch", layouts: ["mobile"] },
  tablet: {
    width: 834,
    height: 1194,
    input: "touch",
    layouts: ["mobile", "desktop"],
  },
}

// Below this width a `--sizes` entry without an explicit input is a touch
// device; at or above it, a mouse one. Matches the presets (834 touch,
// 1440 mouse) and the usual tablet/laptop split.
export const TOUCH_BELOW = 1024

/**
 * `WxH` with an optional `:touch` or `:mouse` suffix, e.g. `320x568`,
 * `1024x768:touch`. The name is `w<W>x<H>` plus `-touch`/`-mouse` only when
 * the input was given explicitly, so each size gets its own output dir.
 */
export function parseSize(spec) {
  const match = /^(\d{2,5})x(\d{2,5})(?::(touch|mouse))?$/.exec(spec.trim())
  if (!match) {
    throw new Error(
      `Bad size "${spec}": expected WxH, WxH:touch or WxH:mouse (e.g. 320x568)`
    )
  }
  const width = Number(match[1])
  const height = Number(match[2])
  const input = match[3] ?? (width < TOUCH_BELOW ? "touch" : "mouse")
  return {
    name: `w${width}x${height}${match[3] ? `-${match[3]}` : ""}`,
    width,
    height,
    input,
    layouts: input === "touch" ? ["mobile"] : ["desktop"],
  }
}

const list = (value) =>
  typeof value === "string"
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : []

/**
 * Resolve `--viewports` (preset names) and `--sizes` (WxH specs) into one
 * ordered, de-duplicated list. With neither flag the default is the
 * original `desktop,mobile`. `dpr` gives the device scale factors:
 * { desktop, mobile } from the existing flags; touch viewports use the
 * mobile one, mouse viewports the desktop one.
 *
 * @param {{ viewports?: string | boolean | null, sizes?: string | boolean | null, dpr?: { desktop?: number | string, mobile?: number | string } }} [options]
 */
export function resolveViewports({ viewports, sizes, dpr = {} } = {}) {
  const names = list(viewports)
  const sizeSpecs = list(sizes)
  const wanted =
    names.length || sizeSpecs.length ? names : ["desktop", "mobile"]
  const resolved = []
  const seen = new Set()
  const push = (viewport) => {
    if (seen.has(viewport.name)) return
    seen.add(viewport.name)
    resolved.push(viewport)
  }
  for (const name of wanted) {
    const preset = VIEWPORT_PRESETS[name]
    if (!preset) {
      throw new Error(
        `Unknown viewport "${name}" (presets: ${Object.keys(VIEWPORT_PRESETS).join(", ")}; use --sizes WxH for others)`
      )
    }
    push({ name, ...preset })
  }
  for (const spec of sizeSpecs) push(parseSize(spec))
  return resolved.map((viewport) => ({
    ...viewport,
    context: contextOptions(viewport, dpr),
  }))
}

/**
 * Playwright browser.newContext() options for a resolved viewport.
 *
 * @param {{ width: number, height: number, input: string }} viewport
 * @param {{ desktop?: number | string, mobile?: number | string }} [dpr]
 */
export function contextOptions(viewport, dpr = {}) {
  const touch = viewport.input === "touch"
  return {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: Number(touch ? (dpr.mobile ?? 3) : (dpr.desktop ?? 1)),
    ...(touch ? { isMobile: true, hasTouch: true } : {}),
  }
}

/**
 * Whether an interactive state restricted to `only` layouts runs here.
 *
 * @param {string[] | null} only
 * @param {{ layouts: string[] }} viewport
 */
export function stateRunsOn(only, viewport) {
  return !only || only.some((layout) => viewport.layouts.includes(layout))
}

/**
 * `--themes light,dark`; `--dark` alone (the original flag) means both.
 *
 * @param {{ themes?: string | boolean | null, dark?: unknown }} [options]
 */
export function resolveThemes({ themes, dark } = {}) {
  const wanted = list(themes)
  if (!wanted.length) return dark ? ["light", "dark"] : ["light"]
  for (const theme of wanted) {
    if (theme !== "light" && theme !== "dark") {
      throw new Error(`Unknown theme "${theme}" (light, dark)`)
    }
  }
  return [...new Set(wanted)]
}

/** Output directory for a shot: `<viewport>` in light, `<viewport>-<theme>` otherwise. */
export const dirFor = (viewport, theme) =>
  theme === "light" ? viewport : `${viewport}-${theme}`

/** `[role:]path` route spec. */
export function parseSpec(spec) {
  const match = /^([a-z-]+):(\/.*)$/.exec(spec.trim())
  return match
    ? { role: match[1], path: match[2] }
    : { role: "owner", path: spec.trim() }
}

/** Shot name: the path with `/` and other separators as `-`, role-prefixed. */
export const nameOf = (role, path) =>
  (role === "owner" ? "" : `${role}--`) +
  (path
    .replace(/^\//, "")
    .replace(/[{}]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "root")
