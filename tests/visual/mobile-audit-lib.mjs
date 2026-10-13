// Pure scoring, aggregation and reporting helpers for mobile-audit.mjs.
// Nothing here touches the browser or the file system, so the logic is
// unit-tested in tests/visual/mobile-audit-lib.test.ts.

export const TOUCH_BREAKPOINT = 768
export const WCAG_TARGET_MIN = 24
export const PROJECT_TOUCH_MIN = 44
export const IOS_ZOOM_MIN_FONT = 16
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

const AREAS = [
  "hours",
  "profile",
  "photos",
  "posts",
  "menu",
  "booking",
  "people",
  "suggestions",
  "verification",
  "changes",
]
const SETTINGS_PAGES = [
  "connections",
  "notifications",
  "security",
  "privacy",
  "operations",
  "billing",
  "usage",
]

// Route specs are `[role:]path`; role defaults to owner.
export const DEFAULT_ROUTES = [
  "/inbox",
  "/inbox?selected={review}",
  "/listings",
  "/listings/{loc}",
  ...AREAS.map((area) => `/listings/{loc}/${area}`),
  "/listings/bulk",
  "/clients",
  "/clients/{client}",
  "/clients/{client}/settings",
  "/clients/new",
  "/calendar",
  "/reports",
  "/notifications",
  "/team",
  "/settings",
  ...SETTINGS_PAGES.map((name) => `/settings/${name}`),
  "/setup",
  "anon:/sign-in",
  "anon:/forgot-password",
  "anon:/privacy",
  "viewer:/inbox",
]

export const ROLES = [
  "owner",
  "viewer",
  "admin",
  "member",
  "member-unassigned",
  "requester",
  "approver",
  "anon",
]

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith("--")) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) {
      options[token.slice(2)] = true
    } else {
      options[token.slice(2)] = next
      index++
    }
  }
  return options
}

export function parseList(value, fallback) {
  if (value === undefined || value === true || value === "") return fallback
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseRouteSpec(spec) {
  const trimmed = spec.trim()
  const match = /^([a-z-]+):(\/.*)$/.exec(trimmed)
  const role = match ? match[1] : "owner"
  const path = match ? match[2] : trimmed
  if (!path.startsWith("/"))
    throw new Error(`Route must start with "/": ${spec}`)
  if (!ROLES.includes(role)) throw new Error(`Unknown role ${role} in ${spec}`)
  const label = role === "owner" ? path : `${role}:${path}`
  return { label, role, path }
}

// Route files hold one spec per line; blank lines and # comments are ignored.
export function parseRouteFile(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
}

export function resolvePath(path, state) {
  return path
    .replaceAll("{loc}", state.primaryLocationId)
    .replaceAll("{loc2}", state.approvalReview.locationId)
    .replaceAll("{client}", state.clientId)
    .replaceAll("{review}", state.directReview.id)
}

export const isTouchWidth = (width) => width < TOUCH_BREAKPOINT

// Representative device heights so the chrome budget reflects real phones.
export function viewportHeight(width) {
  if (width <= 320) return 568
  if (width <= 360) return 800
  if (width < 768) return 844
  if (width < 1024) return 1024
  if (width < 1280) return 768
  return 800
}

// ---------------------------------------------------------------- geometry

const center = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })

export function circleIntersectsRect(circle, rect) {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w))
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h))
  const dx = circle.x - nearestX
  const dy = circle.y - nearestY
  return dx * dx + dy * dy < circle.r * circle.r
}

export function circlesIntersect(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const radii = a.r + b.r
  return dx * dx + dy * dy < radii * radii
}

/**
 * WCAG 2.5.8 Target Size (Minimum). Targets are `{ id, x, y, w, h, inline,
 * related? }` in page coordinates; `related` lists ids of nested targets
 * (ancestors/descendants), which are not treated as spacing conflicts.
 * An undersized target passes when a 24px-diameter circle centred on it
 * intersects neither another target nor another undersized target's circle.
 * Inline targets (links inside sentences) are exempt.
 */
/**
 * @typedef {{ id: number, x: number, y: number, w: number, h: number, inline?: boolean, related?: number[] }} Target
 * @typedef {{ id: number, status: "pass" | "pass-spacing" | "fail" | "exempt-inline", conflictWith?: number }} TargetVerdict
 * @template {Target} T
 * @param {T[]} targets
 * @returns {TargetVerdict[]}
 */
export function evaluateTargetSize(targets, min = WCAG_TARGET_MIN) {
  const radius = min / 2
  const undersized = new Set(
    targets
      .filter((target) => !target.inline && (target.w < min || target.h < min))
      .map((target) => target.id)
  )
  const circles = new Map(
    targets.map((target) => [target.id, { ...center(target), r: radius }])
  )
  return targets.map((target) => {
    if (target.inline) return { id: target.id, status: "exempt-inline" }
    if (!undersized.has(target.id)) return { id: target.id, status: "pass" }
    const circle = circles.get(target.id)
    const related = new Set(target.related ?? [])
    const conflict = targets.find((other) => {
      if (other.id === target.id || related.has(other.id)) return false
      if ((other.related ?? []).includes(target.id)) return false
      if (circleIntersectsRect(circle, other)) return true
      return (
        undersized.has(other.id) &&
        circlesIntersect(circle, circles.get(other.id))
      )
    })
    return conflict
      ? { id: target.id, status: "fail", conflictWith: conflict.id }
      : { id: target.id, status: "pass-spacing" }
  })
}

/**
 * @template {Target} T
 * @param {T[]} targets
 * @returns {T[]}
 */
export function touchTargetFailures(targets, min = PROJECT_TOUCH_MIN) {
  return targets.filter(
    (target) => !target.inline && (target.w < min || target.h < min)
  )
}

/** Length of the union of [start, end] intervals clipped to [lo, hi]. */
export function unionLength(intervals, lo, hi) {
  const clipped = intervals
    .map(([start, end]) => [Math.max(lo, start), Math.min(hi, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  let total = 0
  let current = null
  for (const [start, end] of clipped) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0]
      current = [start, end]
    } else {
      current[1] = Math.max(current[1], end)
    }
  }
  if (current) total += current[1] - current[0]
  return total
}

/**
 * Chrome budget: `elements` are fixed/sticky boxes `{ top, bottom }` in
 * viewport coordinates. Boxes taller than 90% of the viewport (sidebars,
 * full-screen overlays) are ignored; the rest are assigned to the top or
 * bottom edge by their centre.
 */
export function chromeBudget(elements, viewportH) {
  const top = []
  const bottom = []
  for (const element of elements) {
    const height = element.bottom - element.top
    if (height <= 0 || height > viewportH * 0.9) continue
    if (element.bottom <= 0 || element.top >= viewportH) continue
    const middle = (element.top + element.bottom) / 2
    ;(middle < viewportH / 2 ? top : bottom).push([element.top, element.bottom])
  }
  const topPx = Math.round(unionLength(top, 0, viewportH))
  const bottomPx = Math.round(unionLength(bottom, 0, viewportH))
  const pct = (value) => Math.round((value / viewportH) * 1000) / 10
  return {
    topPx,
    bottomPx,
    totalPx: topPx + bottomPx,
    topPct: pct(topPx),
    bottomPct: pct(bottomPx),
    totalPct: pct(topPx + bottomPx),
  }
}

/** `histogram` maps font-size (px, as a string key) to visible text-node count. */
export function textStats(histogram) {
  let total = 0
  let under12 = 0
  let under14 = 0
  let smallest = null
  for (const [key, count] of Object.entries(histogram)) {
    const size = Number(key)
    if (!count) continue
    total += count
    if (size < 12) under12 += count
    if (size < 14) under14 += count
    if (smallest === null || size < smallest) smallest = size
  }
  const pct = (value) => (total ? Math.round((value / total) * 1000) / 10 : 0)
  return {
    nodes: total,
    smallest,
    under12,
    under14,
    under12Pct: pct(under12),
    under14Pct: pct(under14),
  }
}

/**
 * Focus Not Obscured (Minimum): `samples` are points over the focused
 * element's in-viewport rect, each `{ obscuredBy: string | null }`. The
 * element is obscured only when every sample is covered by fixed/sticky
 * content. No samples means the element is entirely outside the viewport,
 * which is reported separately rather than as an obstruction.
 */
export function focusVerdict(samples) {
  if (!samples.length) return { obscured: false, offscreen: true, by: null }
  const covered = samples.filter((sample) => sample.obscuredBy)
  if (covered.length !== samples.length)
    return { obscured: false, offscreen: false, by: null }
  const counts = new Map()
  for (const sample of covered)
    counts.set(sample.obscuredBy, (counts.get(sample.obscuredBy) ?? 0) + 1)
  const by = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return { obscured: true, offscreen: false, by }
}

// ---------------------------------------------------------- aggregation

/**
 * Stable component key for grouping offenders: the element's own data-slot,
 * else `<tag> in [data-slot=x]` from the closest slotted ancestor, else the
 * tag with its role and first classes.
 */
export function componentKey(info) {
  if (info.slot && info.slotDepth === 0) return `[data-slot=${info.slot}]`
  const tag = info.role ? `${info.tag}[role=${info.role}]` : info.tag
  if (info.slot) return `${tag} in [data-slot=${info.slot}]`
  const classes = String(info.cls ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
  return classes.length ? `${tag}.${classes.join(".")}` : tag
}

export const METRICS = [
  "pages",
  "loadErrors",
  "horizontalOverflow",
  "clippedText",
  "targetSize",
  "touchTargetBelow44",
  "iosZoomInputs",
  "textUnder12",
  "textUnder14Phone",
  "axeViolations",
  "axeNodes",
  "axeCritical",
  "axeSerious",
  "focusObscured",
  "chromeOver25Pct",
  "mainLandmarkNot1",
  "h1Not1",
  "missingSkipLink",
  "consoleErrors",
  "pageErrors",
]

export function pageMetrics(page) {
  const zero = Object.fromEntries(METRICS.map((metric) => [metric, 0]))
  zero.pages = 1
  if (page.error) return { ...zero, loadErrors: 1 }
  const touch = isTouchWidth(page.width)
  const axe = page.axe ?? []
  const nodesBy = (impact) =>
    axe
      .filter((violation) => violation.impact === impact)
      .reduce((sum, v) => sum + v.nodes, 0)
  return {
    ...zero,
    horizontalOverflow: page.overflow?.overflowPx > 0 ? 1 : 0,
    clippedText: page.clipped?.length ?? 0,
    targetSize: page.targetSize?.length ?? 0,
    touchTargetBelow44: touch ? (page.touchTargets?.length ?? 0) : 0,
    iosZoomInputs: touch ? (page.iosZoom?.length ?? 0) : 0,
    textUnder12: page.text?.under12 ?? 0,
    textUnder14Phone: touch ? (page.text?.under14 ?? 0) : 0,
    axeViolations: axe.length,
    axeNodes: axe.reduce((sum, violation) => sum + violation.nodes, 0),
    axeCritical: nodesBy("critical"),
    axeSerious: nodesBy("serious"),
    focusObscured: page.focus?.obscured?.length ?? 0,
    chromeOver25Pct: touch && (page.chrome?.load?.totalPct ?? 0) > 25 ? 1 : 0,
    mainLandmarkNot1: page.landmarks && page.landmarks.main !== 1 ? 1 : 0,
    h1Not1: page.landmarks && page.landmarks.h1 !== 1 ? 1 : 0,
    missingSkipLink: page.landmarks && !page.landmarks.skipLink ? 1 : 0,
    consoleErrors: page.consoleErrors?.length ?? 0,
    pageErrors: page.pageErrors?.length ?? 0,
  }
}

const addInto = (target, source) => {
  for (const metric of METRICS)
    target[metric] = (target[metric] ?? 0) + (source[metric] ?? 0)
  return target
}

/**
 * Totals across all pages and per route label, in route-list order.
 * @returns {{ totals: Record<string, number>, perRoute: Record<string, Record<string, number>>, extremes: { phoneChromeMaxPct: number, smallestTextPx: number | null, maxOverflowPx: number } }}
 */
export function aggregate(pages) {
  const totals = addInto({}, {})
  const perRoute = {}
  for (const page of pages) {
    const metrics = pageMetrics(page)
    addInto(totals, metrics)
    perRoute[page.route] = addInto(
      perRoute[page.route] ?? addInto({}, {}),
      metrics
    )
  }
  const phones = pages.filter((page) => !page.error && isTouchWidth(page.width))
  const chromeMax = Math.max(
    0,
    ...phones.map((page) => page.chrome?.load?.totalPct ?? 0)
  )
  const smallest = pages
    .map((page) => page.text?.smallest)
    .filter((value) => typeof value === "number")
  return {
    totals,
    perRoute,
    extremes: {
      phoneChromeMaxPct: chromeMax,
      smallestTextPx: smallest.length ? Math.min(...smallest) : null,
      maxOverflowPx: Math.max(
        0,
        ...pages.map((page) => page.overflow?.overflowPx ?? 0)
      ),
    },
  }
}

/** Offender lists per kind, flattened with the page they came from. */
const OFFENDER_KINDS = {
  targetSize: (page) => page.targetSize ?? [],
  touchTargetBelow44: (page) =>
    isTouchWidth(page.width) ? (page.touchTargets ?? []) : [],
  iosZoomInputs: (page) =>
    isTouchWidth(page.width) ? (page.iosZoom ?? []) : [],
  focusObscured: (page) =>
    (page.focus?.obscured ?? []).map((item) => ({
      ...item.element,
      by: item.by,
    })),
  overflow: (page) => page.overflow?.offenders ?? [],
  clippedText: (page) => page.clipped ?? [],
}

export function topOffenders(pages, kind, limit = 15) {
  const groups = new Map()
  for (const page of pages) {
    if (page.error) continue
    for (const item of OFFENDER_KINDS[kind](page)) {
      const key = componentKey(item)
      const group = groups.get(key) ?? {
        key,
        count: 0,
        routes: new Set(),
        example: item,
      }
      group.count++
      group.routes.add(page.route)
      groups.set(key, group)
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((group) => ({
      key: group.key,
      count: group.count,
      routes: group.routes.size,
      slot: group.example.slot ?? null,
      example: group.example.sel ?? null,
      size:
        group.example.w !== undefined
          ? `${group.example.w}x${group.example.h}`
          : undefined,
      by: group.example.by,
    }))
}

export function topAxeRules(pages, limit = 15) {
  const rules = new Map()
  for (const page of pages) {
    for (const violation of page.axe ?? []) {
      const rule = rules.get(violation.id) ?? {
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: 0,
        pages: 0,
        slots: new Map(),
        targets: new Set(),
      }
      rule.nodes += violation.nodes
      rule.pages++
      for (const node of violation.targets) {
        if (rule.targets.size < 5) rule.targets.add(node.target)
        const key = node.slot ? `[data-slot=${node.slot}]` : "(no data-slot)"
        rule.slots.set(key, (rule.slots.get(key) ?? 0) + 1)
      }
      rules.set(violation.id, rule)
    }
  }
  return [...rules.values()]
    .sort((a, b) => b.nodes - a.nodes || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((rule) => ({
      id: rule.id,
      impact: rule.impact,
      help: rule.help,
      nodes: rule.nodes,
      pages: rule.pages,
      slots: [...rule.slots.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([slot, count]) => `${slot} (${count})`),
      targets: [...rule.targets],
    }))
}

// -------------------------------------------------------------- budgets

/**
 * Budget shape: `{ "global": { metric: max }, "routes": { label: { metric:
 * max } } }`. Returns every exceeded limit; an empty list means pass.
 */
export function checkBudget(summary, budget) {
  const failures = []
  const compare = (scope, actual, limits) => {
    for (const [metric, max] of Object.entries(limits ?? {})) {
      const value =
        metric in (summary.extremes ?? {}) && scope === "global"
          ? summary.extremes[metric]
          : (actual?.[metric] ?? 0)
      if (typeof max === "number" && value > max)
        failures.push({ scope, metric, value, max })
    }
  }
  compare("global", summary.totals, budget.global)
  for (const [route, limits] of Object.entries(budget.routes ?? {})) {
    compare(route, summary.perRoute[route], limits)
  }
  return failures
}

// -------------------------------------------------------------- markdown

const escapeCell = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")

export function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ]
  return lines.join("\n")
}

const ROUTE_COLUMNS = [
  "horizontalOverflow",
  "targetSize",
  "touchTargetBelow44",
  "iosZoomInputs",
  "textUnder12",
  "axeNodes",
  "focusObscured",
  "chromeOver25Pct",
  "consoleErrors",
]

export function renderMarkdown(report) {
  const { summary, pages, config } = report
  const out = []
  out.push("# Mobile quality audit")
  out.push("")
  out.push(
    `Base ${config.base} · widths ${config.widths.join(", ")} · themes ${config.themes.join(", ")} · ${summary.totals.pages} page loads · ${config.durationS}s`
  )
  out.push("")
  out.push("## Totals")
  out.push("")
  out.push(
    markdownTable(
      ["Metric", "Count"],
      [
        ...METRICS.map((metric) => [metric, summary.totals[metric]]),
        ["phoneChromeMaxPct", summary.extremes.phoneChromeMaxPct],
        ["smallestTextPx", summary.extremes.smallestTextPx],
        ["maxOverflowPx", summary.extremes.maxOverflowPx],
      ]
    )
  )
  out.push("")
  out.push("## Per route (summed over widths and themes)")
  out.push("")
  out.push(
    markdownTable(
      ["Route", ...ROUTE_COLUMNS],
      Object.entries(summary.perRoute).map(([route, metrics]) => [
        route,
        ...ROUTE_COLUMNS.map((metric) => metrics[metric]),
      ])
    )
  )
  out.push("")
  const offenderSection = (title, kind) => {
    const rows = topOffenders(pages, kind)
    if (!rows.length) return
    out.push(`## Top offenders: ${title}`)
    out.push("")
    out.push(
      markdownTable(
        ["Component", "Count", "Routes", "Example", "Size/By"],
        rows.map((row) => [
          row.key,
          row.count,
          row.routes,
          row.example,
          row.by ?? row.size ?? "",
        ])
      )
    )
    out.push("")
  }
  offenderSection("WCAG 2.5.8 target size", "targetSize")
  offenderSection("touch targets below 44px (phones)", "touchTargetBelow44")
  offenderSection("iOS focus zoom inputs (<16px)", "iosZoomInputs")
  offenderSection("focus obscured (2.4.11)", "focusObscured")
  offenderSection("horizontal overflow", "overflow")
  offenderSection("clipped text without full value", "clippedText")
  const axeRules = topAxeRules(pages)
  if (axeRules.length) {
    out.push("## Top axe rules")
    out.push("")
    out.push(
      markdownTable(
        ["Rule", "Impact", "Nodes", "Pages", "Slots", "Example targets"],
        axeRules.map((rule) => [
          rule.id,
          rule.impact,
          rule.nodes,
          rule.pages,
          rule.slots.join(", "),
          rule.targets.slice(0, 2).join(" ; "),
        ])
      )
    )
    out.push("")
  }
  const failed = pages.filter((page) => page.error)
  if (failed.length) {
    out.push("## Load errors")
    out.push("")
    for (const page of failed)
      out.push(`- ${page.route} @${page.width} ${page.theme}: ${page.error}`)
    out.push("")
  }
  return out.join("\n")
}

/** Compact, key-sorted totals for diffing between runs (no timestamps). */
export function compactTotals(summary, config) {
  const sortKeys = (object) =>
    Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, object[key]])
    )
  return {
    config: {
      widths: config.widths,
      themes: config.themes,
      routes: config.routes.length,
    },
    totals: sortKeys(summary.totals),
    extremes: sortKeys(summary.extremes),
    perRoute: Object.fromEntries(
      Object.entries(summary.perRoute).map(([route, metrics]) => [
        route,
        sortKeys(metrics),
      ])
    ),
  }
}
