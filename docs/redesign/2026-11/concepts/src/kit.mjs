// Concept kit for docs/redesign/2026-11 (phase B, b-direction).
//
// One source per concept: an element tree with inline CSS (flexbox only, so
// it renders identically in a browser and in satori). `render.mjs` writes each
// concept as a static HTML file AND a PNG/WebP. Not application code: nothing
// here is imported by app/, components/ or lib/, and docs/ is outside the
// Tailwind @source list in app/globals.css.
//
// Token values are the PROPOSED values from SYSTEM.md, converted from the
// oklch in app/globals.css (or the SYSTEM.md change) to sRGB hex, because
// satori does not parse oklch.

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

// ---- oklch -> hex ---------------------------------------------------------
export function oklch(L, C, H, a = 1) {
  const h = (H * Math.PI) / 180
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const gam = lin.map((v) => {
    const c = Math.min(1, Math.max(0, v))
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  })
  const hex = gam
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")
  if (a >= 1) return `#${hex}`
  return `rgba(${gam.map((v) => Math.round(v * 255)).join(",")},${a})`
}

// ---- tokens (light), SYSTEM.md §2 ------------------------------------------
export const T = {
  canvas: oklch(0.98, 0.005, 250),
  surface: oklch(1, 0, 0),
  sunken: oklch(0.966, 0.006, 250),
  fill: oklch(0.938, 0.008, 250),
  fill2: oklch(0.966, 0.006, 250),
  charcoal: oklch(0.24, 0.02, 240),
  inkOnCharcoal: oklch(0.97, 0.004, 250),
  inkMutedOnCharcoal: oklch(0.78, 0.012, 240),
  ink: oklch(0.22, 0.02, 240),
  ink2: oklch(0.36, 0.02, 240),
  muted: oklch(0.5, 0.018, 240),
  quaternary: oklch(0.62, 0.014, 240),
  lineSubtle: oklch(0.938, 0.008, 250),
  line: oklch(0.9, 0.008, 240),
  lineStrong: oklch(0.62, 0.014, 240),
  accent: oklch(0.45, 0.105, 150),
  accentHover: oklch(0.38, 0.09, 150),
  accentTint: oklch(0.955, 0.035, 145),
  accentInk: oklch(0.4, 0.11, 150),
  focus: oklch(0.58, 0.16, 145),
  success: oklch(0.43, 0.11, 150),
  successTint: oklch(0.955, 0.035, 150),
  successSolid: oklch(0.58, 0.14, 150),
  warning: oklch(0.46, 0.1, 65),
  warningTint: oklch(0.965, 0.035, 85),
  warningSolid: oklch(0.79, 0.15, 78),
  danger: oklch(0.49, 0.17, 27),
  dangerTint: oklch(0.962, 0.018, 27),
  dangerSolid: oklch(0.53, 0.19, 27),
  info: oklch(0.46, 0.13, 250),
  infoTint: oklch(0.96, 0.018, 250),
  infoSolid: oklch(0.56, 0.15, 250),
  rating: oklch(0.63, 0.13, 75),
  chart1: oklch(0.52, 0.13, 150),
  chart2: oklch(0.64, 0.1, 150),
  chart3: oklch(0.6, 0.02, 240),
  chart4: oklch(0.56, 0.12, 250),
  scrim: oklch(0.22, 0.02, 240, 0.42),
  // radii: SYSTEM.md §7 (CHANGE: tight family)
  rTag: 4,
  rControl: 6,
  rCard: 8,
  rMenu: 10,
  rModal: 12,
  rSheet: 16,
  pill: 999,
  shadowPop: "0 1px 2px rgba(25,32,40,0.08), 0 8px 28px rgba(25,32,40,0.14)",
  shadowModal: "0 1px 2px rgba(25,32,40,0.08), 0 12px 40px rgba(25,32,40,0.2)",
}

// Size sets: touch (phone/tablet, coarse pointer) and desk (fine pointer >= 48rem).
export const SIZE = {
  touch: {
    caption: 13,
    captionLh: 18,
    ui: 15,
    uiLh: 20,
    body: 16,
    bodyLh: 24,
    title: 17,
    section: 20,
    page: 26,
    figure: 24,
    reading: 17,
    readingLh: 28,
    control: 44,
    controlSm: 36,
    row: 52,
    chip: 28,
    pad: 16,
    cardPad: 16,
  },
  desk: {
    caption: 12,
    captionLh: 16,
    ui: 13,
    uiLh: 20,
    body: 14,
    bodyLh: 22,
    title: 16,
    section: 18,
    page: 26,
    figure: 22,
    reading: 17,
    readingLh: 28,
    control: 36,
    controlSm: 30,
    row: 44,
    chip: 24,
    pad: 24,
    cardPad: 20,
  },
}

// ---- element helper ----------------------------------------------------------
export function h(type, style, ...children) {
  const flat = children
    .flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false)
  const props = {
    style: Object.fromEntries(
      Object.entries(style || {}).filter(
        ([, v]) => v !== undefined && v !== null
      )
    ),
  }
  if (flat.length === 1) props.children = flat[0]
  else if (flat.length > 1) props.children = flat
  // A growing flex item starts from zero so long text wraps instead of
  // pushing its siblings off the frame (same in browsers and satori).
  if (props.style.flexGrow === 1 && props.style.flexBasis === undefined) {
    props.style.flexBasis = 0
    if (props.style.minWidth === undefined) props.style.minWidth = 0
    if (
      props.style.flexDirection === "column" &&
      props.style.minHeight === undefined
    )
      props.style.minHeight = 0
  }
  // satori: a div with several children must be flex.
  if (type === "div" && flat.length > 1 && !props.style.display)
    props.style.display = "flex"
  if (
    type === "div" &&
    flat.length === 1 &&
    typeof flat[0] !== "string" &&
    !props.style.display
  )
    props.style.display = "flex"
  return { type, props }
}
export const row = (style, ...c) =>
  h(
    "div",
    { display: "flex", flexDirection: "row", alignItems: "center", ...style },
    ...c
  )
// Items in a vertical stack never shrink below their content (they clip in
// the parent's overflow instead of overlapping each other).
const noShrink = (c) =>
  c &&
  typeof c === "object" &&
  !Array.isArray(c) &&
  c.props?.style &&
  c.props.style.flexShrink === undefined &&
  !(c.props.style.flexGrow > 0)
    ? {
        ...c,
        props: { ...c.props, style: { ...c.props.style, flexShrink: 0 } },
      }
    : c
export const col = (style, ...c) =>
  h(
    "div",
    { display: "flex", flexDirection: "column", ...style },
    ...c.flat(Infinity).map(noShrink)
  )
export const text = (style, s) =>
  h("div", { display: "flex", ...style }, String(s))
export const spacer = () => h("div", { display: "flex", flexGrow: 1 })

// ---- icons: real lucide-react geometry (the app's icon library) --------------
const require = createRequire(import.meta.url)
const lucideDir = require
  .resolve("lucide-react/package.json")
  .replace(/package\.json$/, "dist/esm/icons/")
const iconCache = new Map()
function iconNode(name) {
  if (iconCache.has(name)) return iconCache.get(name)
  let src = readFileSync(`${lucideDir}${name}.mjs`, "utf8")
  const alias = /export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/.exec(src)
  if (alias) src = readFileSync(`${lucideDir}${alias[1]}.mjs`, "utf8")
  const body = src.slice(
    src.indexOf("const __iconNode = ") + 19,
    src.indexOf("];\nconst") + 1
  )
  const node = Function(`return ${body}`)()
  iconCache.set(name, node)
  return node
}
export function icon(name, size = 18, color = T.ink2, strokeWidth = 1.75) {
  const kids = iconNode(name).map(([tag, attrs]) => {
    const rest = { ...attrs }
    delete rest.key
    return { type: tag, props: rest }
  })
  return {
    type: "svg",
    props: {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flexShrink: 0 },
      children: kids,
    },
  }
}

// ---- status vocabulary (DIRECTION.md §6) -------------------------------------
// tone -> [ink, tint, glyph icon]. Words first; the glyph shape differs per
// tone so status never depends on hue alone.
export const STATUS = {
  // Tone answers "who acts next": neutral = nobody, amber = a person,
  // blue = Google or our system, green = confirmed on Google, red = broken.
  unsaved: {
    label: "Unsaved changes",
    ink: T.ink2,
    tint: T.fill2,
    line: T.line,
    glyph: "circle-dashed",
  },
  draft: {
    label: "Draft saved",
    ink: T.ink2,
    tint: T.fill,
    line: T.line,
    glyph: "hard-drive",
  },
  needsReply: {
    label: "Needs reply",
    ink: T.ink,
    tint: T.fill,
    line: T.line,
    glyph: "message-circle",
  },
  approval: {
    label: "Awaiting approval",
    ink: T.warning,
    tint: T.warningTint,
    line: T.warningSolid,
    glyph: "user-check",
  },
  changes: {
    label: "Sent back",
    ink: T.warning,
    tint: T.warningTint,
    line: T.warningSolid,
    glyph: "undo-2",
  },
  approved: {
    label: "Approved, ready to send",
    ink: T.warning,
    tint: T.warningTint,
    line: T.warningSolid,
    glyph: "circle-check",
  },
  uncertain: {
    label: "Not confirmed: check Google",
    ink: T.warning,
    tint: T.warningTint,
    line: T.warningSolid,
    glyph: "circle-help",
  },
  conflict: {
    label: "Changed on Google",
    ink: T.warning,
    tint: T.warningTint,
    line: T.warningSolid,
    glyph: "git-compare",
  },
  sending: {
    label: "Sending to Google",
    ink: T.info,
    tint: T.infoTint,
    line: T.infoSolid,
    glyph: "send",
  },
  retrying: {
    label: "Will retry at 10:42",
    ink: T.info,
    tint: T.infoTint,
    line: T.infoSolid,
    glyph: "refresh-cw",
  },
  waiting: {
    label: "Sent, waiting for Google",
    ink: T.info,
    tint: T.infoTint,
    line: T.infoSolid,
    glyph: "hourglass",
  },
  live: {
    label: "On Google",
    ink: T.success,
    tint: T.successTint,
    line: T.successSolid,
    glyph: "badge-check",
  },
  rejected: {
    label: "Rejected by Google",
    ink: T.danger,
    tint: T.dangerTint,
    line: T.dangerSolid,
    glyph: "ban",
  },
  failed: {
    label: "Failed: retry",
    ink: T.danger,
    tint: T.dangerTint,
    line: T.dangerSolid,
    glyph: "triangle-alert",
  },
  withdrawn: {
    label: "Withdrawn",
    ink: T.ink2,
    tint: T.fill,
    line: T.line,
    glyph: "circle-minus",
  },
  blocked: {
    label: "Blocked by checks",
    ink: T.danger,
    tint: T.dangerTint,
    line: T.dangerSolid,
    glyph: "octagon-x",
  },
}

export function statusPill(key, s, opts = {}) {
  const st = STATUS[key]
  const label = opts.label ?? st.label
  return row(
    {
      gap: 5,
      height: s.chip - 4,
      padding: "0 8px 0 6px",
      borderRadius: T.pill,
      background: opts.quiet ? "transparent" : st.tint,
      flexShrink: 0,
    },
    icon(st.glyph, s.caption + 1, st.ink, 2),
    text(
      { fontSize: s.caption, fontWeight: 600, color: st.ink, lineHeight: 1 },
      label
    )
  )
}

// The change track: the product's signature element. Four stops, the same
// everywhere a change can travel to Google.
export function changeTrack(s, current, opts = {}) {
  const stops = opts.stops ?? [
    ["Saved here", "draft"],
    ["Approved", "approval"],
    ["Sent", "sending"],
    ["On Google", "live"],
  ]
  const failedAt = opts.failedAt ?? -1
  const compact = opts.compact
  return row(
    { gap: 0, width: "100%", alignItems: "flex-start" },
    ...stops.map(([label, kind], i) => {
      const skipped = kind === "skip"
      // current === stops.length means every stop is done (On Google).
      // Done stops are ink, not green: green is spent only on the reached
      // On Google stop (SYSTEM §10, change track tones).
      const done = i < current
      const here = i === current
      const failed = i === failedAt
      const reachedGoogle = done && i === stops.length - 1
      const dot = skipped
        ? icon("circle-minus", 16, T.muted, 2)
        : failed
          ? icon("triangle-alert", 16, T.danger, 2.25)
          : reachedGoogle
            ? icon("badge-check", 16, T.success, 2.25)
            : done
              ? icon("circle-check", 16, T.ink2, 2.25)
              : here
                ? icon("circle-dot", 16, T.ink, 2.25)
                : icon("circle", 16, T.quaternary, 2)
      return col(
        { flexGrow: 1, flexBasis: 0, gap: 6 },
        row(
          { gap: 0, width: "100%" },
          dot,
          i < stops.length - 1
            ? h("div", {
                display: "flex",
                flexGrow: 1,
                height: 2,
                marginLeft: 4,
                marginRight: 4,
                background:
                  done && i + 1 < current ? T.ink2 : done ? T.ink2 : T.line,
              })
            : null
        ),
        compact
          ? null
          : text(
              {
                fontSize: s.caption,
                fontWeight: here || failed || reachedGoogle ? 600 : 500,
                color: failed
                  ? T.danger
                  : reachedGoogle
                    ? T.success
                    : skipped
                      ? T.muted
                      : here
                        ? T.ink
                        : done
                          ? T.ink2
                          : T.muted,
              },
              failed ? (opts.failedLabel ?? "Failed") : label
            )
      )
    })
  )
}

// ---- controls ------------------------------------------------------------------
export function button(s, label, opts = {}) {
  const kind = opts.kind ?? "secondary"
  const size = opts.size === "sm" ? s.controlSm : s.control
  const base = {
    height: size,
    padding: `0 ${opts.iconOnly ? 0 : size >= 40 ? 16 : 12}px`,
    width: opts.iconOnly ? size : undefined,
    justifyContent: "center",
    borderRadius: T.rControl,
    gap: 6,
    fontSize: s.ui,
    fontWeight: 600,
    flexShrink: 0,
  }
  const kinds = {
    // "Ink saves, green sends": green fill only for an action that reaches
    // Google (publish, approve-and-publish, retry); every other primary is ink.
    send: {
      background: T.accent,
      color: "#fff",
      border: `1px solid ${T.accent}`,
    },
    primary: { background: T.ink, color: "#fff", border: `1px solid ${T.ink}` },
    secondary: {
      background: T.surface,
      color: T.ink,
      border: `1px solid ${T.lineStrong}`,
    },
    ghost: {
      background: "transparent",
      color: T.ink,
      border: "1px solid transparent",
    },
    danger: {
      background: T.surface,
      color: T.danger,
      border: `1px solid ${T.danger}`,
    },
    onCharcoal: {
      background: "transparent",
      color: T.inkOnCharcoal,
      border: `1px solid ${T.inkMutedOnCharcoal}`,
    },
    disabled: {
      background: T.fill2,
      color: T.muted,
      border: `1px solid ${T.line}`,
    },
    disabledOnCharcoal: {
      background: "#3a434d",
      color: T.inkMutedOnCharcoal,
      border: "1px solid #4a535d",
    },
  }
  const k = kinds[kind]
  return row(
    { ...base, ...k, ...(opts.style || {}) },
    opts.icon ? icon(opts.icon, s.ui + 3, k.color, 2) : null,
    opts.iconOnly ? null : text({ color: k.color }, label)
  )
}

export function field(s, label, value, opts = {}) {
  return col(
    { gap: 6, width: opts.width ?? "100%" },
    label
      ? text({ fontSize: s.ui, fontWeight: 600, color: T.ink }, label)
      : null,
    row(
      {
        height: s.control,
        padding: "0 12px",
        border: `1px solid ${opts.invalid ? T.danger : T.lineStrong}`,
        borderRadius: T.rControl,
        background: T.surface,
        fontSize: s.body,
        color: opts.placeholder ? T.muted : T.ink,
        gap: 8,
        boxShadow: opts.focus
          ? `0 0 0 2px ${T.surface}, 0 0 0 4px ${opts.invalid ? T.dangerSolid : T.focus}`
          : undefined,
      },
      opts.icon ? icon(opts.icon, 16, T.muted) : null,
      text({ flexGrow: 1 }, value),
      opts.trailing ?? null
    ),
    opts.hint
      ? text(
          {
            fontSize: s.caption,
            color: opts.invalid ? T.danger : T.muted,
            lineHeight: `${s.captionLh}px`,
          },
          opts.hint
        )
      : null
  )
}

export function chip(s, label, opts = {}) {
  return row(
    {
      height: s.chip,
      padding: "0 10px",
      borderRadius: T.pill,
      gap: 6,
      background: opts.on ? T.ink : T.surface,
      border: `1px solid ${opts.on ? T.ink : T.line}`,
      flexShrink: 0,
    },
    opts.icon ? icon(opts.icon, 14, opts.on ? "#fff" : T.ink2, 2) : null,
    text(
      {
        fontSize: s.caption + 1,
        fontWeight: 500,
        color: opts.on ? "#fff" : T.ink,
      },
      label
    ),
    opts.count != null
      ? text(
          { fontSize: s.caption, color: opts.on ? T.fill : T.muted },
          opts.count
        )
      : null
  )
}

export function countBadge(s, n, opts = {}) {
  return text(
    {
      minWidth: 20,
      height: 20,
      padding: "0 6px",
      borderRadius: T.pill,
      background: opts.strong ? T.ink : T.fill,
      color: opts.strong ? "#fff" : T.ink2,
      fontSize: 12,
      fontWeight: 600,
      justifyContent: "center",
      alignItems: "center",
    },
    n
  )
}

export function avatar(initials, size = 32) {
  return text(
    {
      width: size,
      height: size,
      borderRadius: T.pill,
      background: T.fill,
      color: T.ink2,
      fontSize: Math.round(size * 0.38),
      fontWeight: 600,
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0,
    },
    initials
  )
}

export function stars(n, size = 13) {
  return row(
    { gap: 1 },
    ...[1, 2, 3, 4, 5].map((i) =>
      icon("star", size, i <= n ? T.rating : T.line, 2)
    )
  )
}

export function card(style, ...c) {
  return col(
    {
      background: T.surface,
      border: `1px solid ${T.line}`,
      borderRadius: T.rCard,
      ...style,
    },
    ...c
  )
}

export function divider(style = {}) {
  return h("div", {
    display: "flex",
    height: 1,
    background: T.line,
    width: "100%",
    flexShrink: 0,
    ...style,
  })
}

export function sectionLabel(s, label, trailing) {
  return row(
    { width: "100%", justifyContent: "space-between" },
    text(
      {
        fontSize: s.caption,
        fontWeight: 600,
        color: T.muted,
        letterSpacing: 0.2,
      },
      label
    ),
    trailing ?? null
  )
}

export function annotation(n, label) {
  // Numbered design notes overlaid on concepts (callouts), drawn in info ink.
  return row(
    {
      gap: 6,
      padding: "3px 8px 3px 4px",
      borderRadius: T.pill,
      background: T.info,
      flexShrink: 0,
    },
    text(
      {
        width: 18,
        height: 18,
        borderRadius: T.pill,
        background: "#fff",
        color: T.info,
        fontSize: 11,
        fontWeight: 700,
        justifyContent: "center",
        alignItems: "center",
      },
      n
    ),
    label ? text({ fontSize: 11, fontWeight: 600, color: "#fff" }, label) : null
  )
}

// The dispatch bar: the one charcoal surface per screen, holding the action
// that reaches Google. Left: what is true now (status word + one line).
// Right: secondaries, then the one primary. Docked edge to edge on a phone.
export function dispatchBar(s, opts = {}) {
  const {
    status,
    sub,
    actions = [],
    docked = false,
    tone = "charcoal",
    stack = false,
  } = opts
  const st = status ? STATUS[status] : null
  const onCharcoal = tone === "charcoal"
  const glyphInk = st
    ? onCharcoal
      ? ({
          draft: T.inkMutedOnCharcoal,
          live: oklch(0.8, 0.12, 150),
          failed: oklch(0.8, 0.1, 25),
          blocked: oklch(0.8, 0.1, 25),
          approval: oklch(0.85, 0.12, 80),
          changes: oklch(0.85, 0.12, 80),
          approved: oklch(0.85, 0.12, 80),
          uncertain: oklch(0.85, 0.12, 80),
          conflict: oklch(0.85, 0.12, 80),
          rejected: oklch(0.8, 0.1, 25),
        }[status] ?? oklch(0.8, 0.09, 250))
      : st.ink
    : null
  const statusBlock = st
    ? row(
        {
          gap: 10,
          flexGrow: stack ? 0 : 1,
          minWidth: 0,
          alignItems: "flex-start",
        },
        icon(st.glyph, 18, glyphInk, 2.25),
        col(
          { gap: 2, flexGrow: 1, minWidth: 0 },
          text(
            {
              fontSize: s.ui,
              fontWeight: 600,
              color: onCharcoal ? T.inkOnCharcoal : T.ink,
            },
            opts.label ?? st.label
          ),
          sub
            ? text(
                {
                  fontSize: s.caption,
                  color: onCharcoal ? T.inkMutedOnCharcoal : T.muted,
                  lineHeight: `${s.captionLh}px`,
                },
                sub
              )
            : null
        )
      )
    : spacer()
  return (stack ? col : row)(
    {
      width: "100%",
      gap: stack ? 12 : 16,
      padding: docked ? "12px 16px 10px" : "12px 14px 12px 16px",
      background: onCharcoal ? T.charcoal : T.surface,
      border: onCharcoal ? undefined : `1px solid ${T.line}`,
      borderRadius: docked ? 0 : T.rCard,
      boxShadow: docked ? undefined : T.shadowPop,
      alignItems: stack ? "stretch" : "center",
      flexShrink: 0,
    },
    statusBlock,
    row({ gap: 8, justifyContent: "flex-end" }, ...actions)
  )
}

// A small honest label on every concept: these are mockups with sample data.
export function conceptTag(
  label = "Concept · sample data",
  pos = { right: 12, top: 64 }
) {
  return row(
    {
      position: "absolute",
      ...pos,
      gap: 6,
      padding: "3px 8px",
      borderRadius: T.pill,
      background: "rgba(25,32,40,0.78)",
    },
    text({ fontSize: 11, fontWeight: 600, color: "#fff" }, label)
  )
}

export function homeIndicatorDark() {
  return h(
    "div",
    {
      display: "flex",
      height: 34,
      background: T.charcoal,
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0,
    },
    h("div", {
      display: "flex",
      width: 134,
      height: 5,
      borderRadius: 3,
      background: "#fff",
    })
  )
}
