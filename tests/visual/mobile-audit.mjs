// Mobile quality audit against the visual fixtures (see fixture-server.ts and
// shoot.mjs for the cookie and placeholder conventions). Not part of the e2e
// suite; read-only (page loads, axe and Tab key presses only).
//
//   node tests/visual/mobile-audit.mjs --base http://localhost:3200 \
//     --widths 320,360,390,768,1024,1280 --themes light,dark --out <dir>
//     [--routes <file or comma list>] [--budget <json file>]
//     [--concurrency 3] [--settle 600] [--height <px>] [--focus-steps 40]
//     [--combos 320:light,390:dark]
//
// --routes takes `[role:]path` specs (role defaults to owner), e.g.
// `/inbox,viewer:/inbox,anon:/sign-in`, or a file with one spec per line.
// Placeholders: {loc}, {loc2}, {client}, {review}. Default: every main route
// (DEFAULT_ROUTES in mobile-audit-lib.mjs). --combos replaces the
// widths x themes product with explicit width:theme pairs.
// Widths under 768 run as phones (isMobile + hasTouch).
//
// Writes <out>/mobile-audit.json (raw data), mobile-audit.md (summary) and
// mobile-audit-totals.json (compact, diffable). With --budget the process
// exits 1 when any metric exceeds its limit; see checkBudget for the shape.
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { chromium } from "@playwright/test"

import {
  AXE_TAGS,
  DEFAULT_ROUTES,
  IOS_ZOOM_MIN_FONT,
  aggregate,
  checkBudget,
  chromeBudget,
  compactTotals,
  evaluateTargetSize,
  focusVerdict,
  isTouchWidth,
  parseArgs,
  parseList,
  parseRouteFile,
  parseRouteSpec,
  renderMarkdown,
  resolvePath,
  textStats,
  touchTargetFailures,
  viewportHeight,
} from "./mobile-audit-lib.mjs"

const args = parseArgs(process.argv.slice(2))
// localhost, not 127.0.0.1: the Turbopack dev client only hydrates when its
// HMR websocket is accepted, and next dev accepts it from localhost only.
const base = String(args.base ?? "http://localhost:3200").replace(/\/$/, "")
const out = resolve(String(args.out ?? "test-results/mobile-audit"))
const widths = parseList(args.widths, [
  "320",
  "360",
  "390",
  "768",
  "1024",
  "1280",
]).map(Number)
const themes = parseList(args.themes, ["light"])
const concurrency = Number(args.concurrency ?? 3)
const settle = Number(args.settle ?? 600)
const focusSteps = Number(args["focus-steps"] ?? 40)
const fixedHeight = args.height ? Number(args.height) : null

// --routes is a file path when one exists, otherwise a comma list of specs.
const routeSpecs =
  typeof args.routes !== "string"
    ? DEFAULT_ROUTES
    : existsSync(resolve(args.routes))
      ? parseRouteFile(await readFile(resolve(args.routes), "utf8"))
      : parseList(args.routes, [])
const routes = routeSpecs.map(parseRouteSpec)
const combos =
  typeof args.combos === "string"
    ? parseList(args.combos, []).map((combo) => {
        const [width, theme = "light"] = combo.split(":")
        return { width: Number(width), theme }
      })
    : themes.flatMap((theme) => widths.map((width) => ({ width, theme })))
const budget =
  typeof args.budget === "string"
    ? JSON.parse(await readFile(resolve(args.budget), "utf8"))
    : null

const state = JSON.parse(
  await readFile(resolve("test-results/e2e-journey-state.json"), "utf8")
)
const cookies = {
  owner: state.cookie,
  viewer: state.viewerCookie,
  admin: state.adminCookie,
  member: state.memberAssignedCookie,
  "member-unassigned": state.memberUnassignedCookie,
  requester: state.approval.requesterCookie,
  approver: state.approval.approverCookie,
  anon: null,
}

// Refuse to run unless every cookie in use resolves to the fixture tenant:
// `next dev` signs any request without a valid session in as the local
// owner, and the audit must never act as the real organisation.
for (const role of new Set(routes.map((route) => route.role))) {
  const cookie = cookies[role]
  if (!cookie) continue
  const response = await fetch(`${base}/api/session`, { headers: { cookie } })
  const organisation = (await response.json())?.session?.organisationName
  if (organisation !== "Sprint 5 Journey tenant") {
    throw new Error(
      `Refusing to audit: cookie for ${role} resolves to "${organisation}", not the fixture tenant. Restart the visual-fixtures server.`
    )
  }
}

// ------------------------------------------------------- in-page probes
// These run inside the page, so they must be self-contained.

function collectPage({ touch }) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const styleOf = (element) => getComputedStyle(element)
  const isDevtools = (element) => !!element.closest("nextjs-portal")
  const visible = (element) =>
    element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      checkOpacity: true,
      checkVisibilityCSS: true,
    })
  // Screen-reader-only content: a 1px box or a clipped box near the element.
  const srOnlyCache = new Map()
  const srOnly = (element) => {
    if (srOnlyCache.has(element)) return srOnlyCache.get(element)
    let result = false
    let node = element
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const rect = node.getBoundingClientRect()
      const style = styleOf(node)
      if (
        ((rect.width <= 1 || rect.height <= 1) &&
          style.overflow !== "visible") ||
        (style.clip && style.clip !== "auto") ||
        /inset\(50%\)/.test(style.clipPath)
      ) {
        result = true
        break
      }
    }
    srOnlyCache.set(element, result)
    return result
  }
  const describe = (element) => {
    let slot = element.getAttribute("data-slot")
    let slotDepth = 0
    if (!slot) {
      let node = element.parentElement
      for (
        let depth = 1;
        node && depth < 12;
        depth++, node = node.parentElement
      ) {
        if (node.hasAttribute("data-slot")) {
          slot = node.getAttribute("data-slot")
          slotDepth = depth
          break
        }
      }
    }
    const cls = typeof element.className === "string" ? element.className : ""
    const tag = element.tagName.toLowerCase()
    const role = element.getAttribute("role")
    const firstClasses = cls.split(/\s+/).filter(Boolean).slice(0, 2)
    const sel =
      tag +
      (element.id ? `#${element.id}` : "") +
      (element.getAttribute("data-slot")
        ? `[data-slot=${element.getAttribute("data-slot")}]`
        : "") +
      (role ? `[role=${role}]` : "") +
      (firstClasses.length ? `.${firstClasses.join(".")}` : "")
    const name = (
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent ||
      element.getAttribute("placeholder") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50)
    return { tag, role, slot, slotDepth, cls: cls.slice(0, 120), sel, name }
  }

  // 1. Horizontal overflow: the outermost elements past the right edge that
  // are not inside their own horizontal scroller.
  const doc = document.scrollingElement ?? document.documentElement
  const overflowPx = Math.max(0, doc.scrollWidth - vw)
  const offenders = []
  if (overflowPx > 1) {
    const scrolls = (element) => {
      for (
        let node = element.parentElement;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const value = styleOf(node).overflowX
        if (value !== "visible") return true
      }
      return false
    }
    const reported = []
    for (const element of document.body.querySelectorAll("*")) {
      if (isDevtools(element)) continue
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.right <= vw + 1) continue
      if (reported.some((parent) => parent.contains(element))) continue
      if (scrolls(element)) continue
      reported.push(element)
      offenders.push({
        ...describe(element),
        right: Math.round(rect.right + scrollX),
        w: Math.round(rect.width),
      })
      if (offenders.length >= 8) break
    }
  }

  // 1b. Truncated text without a title or accessible full value.
  const clipped = []
  const textElements = new Set()
  {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    )
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim() && node.parentElement)
        textElements.add(node.parentElement)
    }
  }
  for (const element of textElements) {
    if (clipped.length >= 40) break
    if (isDevtools(element) || !visible(element) || srOnly(element)) continue
    const tag = element.tagName
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue
    const style = styleOf(element)
    const ownClip =
      (["hidden", "clip"].includes(style.overflowX) ||
        style.textOverflow === "ellipsis") &&
      element.scrollWidth > element.clientWidth + 1
    const clamp =
      style.webkitLineClamp &&
      style.webkitLineClamp !== "none" &&
      element.scrollHeight > element.clientHeight + 1
    let ancestorClip = false
    if (!ownClip && !clamp) {
      const rect = element.getBoundingClientRect()
      let node = element.parentElement
      for (
        let depth = 0;
        node && depth < 8;
        depth++, node = node.parentElement
      ) {
        const ancestorStyle = styleOf(node)
        if (["hidden", "clip"].includes(ancestorStyle.overflowX)) {
          const box = node.getBoundingClientRect()
          ancestorClip = rect.right > box.right + 1 || rect.left < box.left - 1
          break
        }
        if (ancestorStyle.overflowX !== "visible") break
      }
    }
    if (!ownClip && !clamp && !ancestorClip) continue
    const text = element.textContent.replace(/\s+/g, " ").trim()
    const labelled = element.closest("[title],[aria-label]")
    if (labelled) {
      const value =
        labelled.getAttribute("title") ||
        labelled.getAttribute("aria-label") ||
        ""
      if (value.replace(/\s+/g, " ").trim().length >= text.length - 1) continue
    }
    clipped.push({
      ...describe(element),
      text: text.slice(0, 60),
      mode: clamp ? "line-clamp" : ownClip ? "ellipsis" : "ancestor",
    })
  }

  // 2. Interactive targets.
  const targetSelector = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    ...[
      "button",
      "link",
      "tab",
      "checkbox",
      "radio",
      "switch",
      "menuitem",
      "option",
      "combobox",
    ].map((role) => `[role=${role}]`),
    '[tabindex]:not([tabindex="-1"])',
  ].join(",")
  const targetElements = []
  for (const element of document.querySelectorAll(targetSelector)) {
    if (isDevtools(element)) continue
    if (element.matches("input[type=hidden]")) continue
    if (element.matches(":disabled,[aria-disabled=true]")) continue
    if (element.closest("[aria-hidden=true],[inert]")) continue
    if (!visible(element) || srOnly(element)) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) continue
    // Off-canvas: past either side, or above the document (skip links).
    if (rect.right <= 0 || rect.left >= vw || rect.bottom + scrollY <= 0) continue
    targetElements.push(element)
  }
  const blockText = (element) => {
    let node = element.parentElement
    while (node && /^inline/.test(styleOf(node).display))
      node = node.parentElement
    return node ? node.textContent.replace(/\s+/g, " ").trim() : ""
  }
  const targets = targetElements.map((element, id) => {
    let rect = element.getBoundingClientRect()
    let box = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    }
    // A wrapping <label> is part of a checkbox/radio's click target.
    const label = element.matches("input") ? element.closest("label") : null
    if (label) {
      rect = label.getBoundingClientRect()
      box = {
        left: Math.min(box.left, rect.left),
        top: Math.min(box.top, rect.top),
        right: Math.max(box.right, rect.right),
        bottom: Math.max(box.bottom, rect.bottom),
      }
    }
    const inline =
      element.matches("a[href]") &&
      styleOf(element).display === "inline" &&
      blockText(element).length - element.textContent.trim().length > 10
    const related = []
    targetElements.forEach((other, otherId) => {
      if (
        other !== element &&
        (other.contains(element) || element.contains(other))
      )
        related.push(otherId)
    })
    return {
      id,
      x: Math.round((box.left + scrollX) * 10) / 10,
      y: Math.round((box.top + scrollY) * 10) / 10,
      w: Math.round((box.right - box.left) * 10) / 10,
      h: Math.round((box.bottom - box.top) * 10) / 10,
      inline,
      related,
      ...describe(element),
    }
  })

  // 3. Text-entry controls that trigger iOS focus zoom.
  const iosZoom = []
  if (touch) {
    const entry =
      "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=color]),textarea,select,[contenteditable]:not([contenteditable=false])"
    for (const element of document.querySelectorAll(entry)) {
      if (isDevtools(element) || !visible(element) || srOnly(element)) continue
      if (element.closest("[aria-hidden=true],[inert]")) continue
      const fontSize = parseFloat(styleOf(element).fontSize)
      if (fontSize < 16) {
        const rect = element.getBoundingClientRect()
        iosZoom.push({
          ...describe(element),
          fontSize,
          type: element.getAttribute("type") ?? element.tagName.toLowerCase(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        })
      }
    }
  }

  // 4. Typography histogram of visible text nodes by computed font size.
  const histogram = {}
  // Elements rendering sub-12px text, for attributing small type to components.
  const smallText = []
  const smallSeen = new Set()
  {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    )
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || !node.textContent.trim()) continue
      if (
        /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName) ||
        isDevtools(parent)
      )
        continue
      if (!visible(parent) || srOnly(parent)) continue
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.right <= 0 ||
        rect.left >= vw
      )
        continue
      const size = Math.round(parseFloat(styleOf(parent).fontSize) * 2) / 2
      histogram[size] = (histogram[size] ?? 0) + 1
      if (size < 12 && smallText.length < 60 && !smallSeen.has(parent)) {
        smallSeen.add(parent)
        smallText.push({ ...describe(parent), fontSize: size })
      }
    }
  }

  // 7. Fixed/sticky chrome currently pinned to an edge.
  const pinned = () => {
    const boxes = []
    for (const element of document.body.querySelectorAll("*")) {
      if (isDevtools(element)) continue
      const style = styleOf(element)
      if (style.position !== "fixed" && style.position !== "sticky") continue
      if (!visible(element)) continue
      const rect = element.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) continue
      if (style.position === "sticky") {
        const stuckTop =
          style.top !== "auto" && Math.abs(rect.top - parseFloat(style.top)) < 2
        const stuckBottom =
          style.bottom !== "auto" &&
          Math.abs(rect.bottom - (vh - parseFloat(style.bottom))) < 2
        if (!stuckTop && !stuckBottom) continue
      }
      boxes.push({
        top: rect.top,
        bottom: rect.bottom,
        position: style.position,
        ...describe(element),
      })
    }
    return boxes
  }
  const chromeLoad = pinned()

  // 8. Landmarks, headings and skip link.
  const firstLinks = [...document.querySelectorAll("a[href^='#']")].slice(0, 5)
  const landmarks = {
    main: document.querySelectorAll("main,[role=main]").length,
    h1: [...document.querySelectorAll("h1")].filter(
      (heading) => !heading.closest("[hidden]")
    ).length,
    skipLink: firstLinks.some((link) => /skip/i.test(link.textContent)),
  }

  return {
    url: location.pathname + location.search,
    dark: document.documentElement.classList.contains("dark"),
    viewport: { w: vw, h: vh },
    overflow: { scrollWidth: doc.scrollWidth, overflowPx, offenders },
    clipped,
    targets,
    iosZoom,
    histogram,
    smallText,
    chromeLoad,
    landmarks,
  }
}

function pinnedAfterScroll() {
  const vh = window.innerHeight
  window.scrollTo(0, Math.round(vh * 0.6))
  const boxes = []
  for (const element of document.body.querySelectorAll("*")) {
    if (element.closest("nextjs-portal")) continue
    const style = getComputedStyle(element)
    if (style.position !== "fixed" && style.position !== "sticky") continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) continue
    if (
      !element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      })
    )
      continue
    if (style.position === "sticky") {
      const stuckTop =
        style.top !== "auto" && Math.abs(rect.top - parseFloat(style.top)) < 2
      const stuckBottom =
        style.bottom !== "auto" &&
        Math.abs(rect.bottom - (vh - parseFloat(style.bottom))) < 2
      if (!stuckTop && !stuckBottom) continue
    }
    boxes.push({ top: rect.top, bottom: rect.bottom })
  }
  window.scrollTo(0, 0)
  return boxes
}

// 6. Probe the focused element after a Tab press: sample a 5x5 grid over its
// in-viewport rect and record which fixed/sticky ancestor (if any) paints on
// top at each point.
async function probeFocus() {
  await new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done))
  )
  let element = document.activeElement
  if (!element || element === document.body) return { none: true }
  if (element.tagName === "NEXTJS-PORTAL") return { devtools: true }
  while (element.shadowRoot?.activeElement)
    element = element.shadowRoot.activeElement
  const rect = element.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const describe = (node) => {
    const slotted = node.closest("[data-slot]")
    const cls = typeof node.className === "string" ? node.className : ""
    return {
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute("role"),
      slot: slotted?.getAttribute("data-slot") ?? null,
      slotDepth: slotted === node ? 0 : slotted ? 1 : null,
      cls: cls.slice(0, 120),
      sel:
        node.tagName.toLowerCase() +
        (node.getAttribute("data-slot")
          ? `[data-slot=${node.getAttribute("data-slot")}]`
          : "") +
        (cls
          ? `.${cls.split(/\s+/).filter(Boolean).slice(0, 2).join(".")}`
          : ""),
      name: (node.getAttribute("aria-label") || node.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50),
    }
  }
  // Identity for cycle detection without touching the DOM.
  window.__auditFocus ??= { ids: new WeakMap(), next: 0 }
  if (!window.__auditFocus.ids.has(element))
    window.__auditFocus.ids.set(element, window.__auditFocus.next++)
  const info = {
    element: describe(element),
    key: window.__auditFocus.ids.get(element),
    samples: [],
  }
  if (rect.width <= 0 || rect.height <= 0) return { ...info, empty: true }
  const left = Math.max(0, rect.left)
  const right = Math.min(vw, rect.right)
  const top = Math.max(0, rect.top)
  const bottom = Math.min(vh, rect.bottom)
  if (right <= left || bottom <= top) return info
  const pinnedAncestor = (node) => {
    for (let current = node; current; current = current.parentElement) {
      const position = getComputedStyle(current).position
      if (position === "fixed" || position === "sticky") return current
    }
    return null
  }
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = left + ((right - left) * (i + 0.5)) / 5
      const y = top + ((bottom - top) * (j + 0.5)) / 5
      const topmost = document.elementsFromPoint(x, y)[0]
      let obscuredBy = null
      if (
        topmost &&
        topmost !== element &&
        !element.contains(topmost) &&
        !topmost.contains(element)
      ) {
        const pinned = pinnedAncestor(topmost)
        if (
          pinned &&
          !pinned.contains(element) &&
          pinned.tagName !== "NEXTJS-PORTAL"
        ) {
          obscuredBy = describe(pinned).sel
        }
      }
      info.samples.push({ obscuredBy })
    }
  }
  return info
}

function slotsForSelectors(selectors) {
  return selectors.map((selector) => {
    try {
      const node = document.querySelector(selector)
      return node?.closest("[data-slot]")?.getAttribute("data-slot") ?? null
    } catch {
      return null
    }
  })
}

// ------------------------------------------------------------- runner

const NOISE = /webpack-hmr|\[HMR\]|\[Fast Refresh\]|Download the React DevTools/

async function auditPage(context, route, combo) {
  const touch = isTouchWidth(combo.width)
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on("console", (message) => {
    if (message.type() === "error" && !NOISE.test(message.text()))
      consoleErrors.push(message.text().slice(0, 300))
  })
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)))
  const record = {
    route: route.label,
    role: route.role,
    width: combo.width,
    theme: combo.theme,
    touch,
  }
  const started = Date.now()
  try {
    const response = await page.goto(base + resolvePath(route.path, state), {
      waitUntil: "load",
      timeout: 120_000,
    })
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {})
    await page.waitForTimeout(settle)
    record.status = response?.status() ?? null
    const data = await page.evaluate(collectPage, { touch })
    record.url = data.url
    record.dark = data.dark
    record.viewport = data.viewport
    record.overflow = data.overflow
    record.clipped = data.clipped
    const verdicts = evaluateTargetSize(data.targets)
    const byId = new Map(data.targets.map((target) => [target.id, target]))
    const strip = (target) => {
      const copy = { ...target }
      delete copy.related
      delete copy.id
      return copy
    }
    record.targetCount = data.targets.length
    record.targetSize = verdicts
      .filter((verdict) => verdict.status === "fail")
      .map((verdict) => ({
        ...strip(byId.get(verdict.id)),
        conflictWith: byId.get(verdict.conflictWith)?.sel,
      }))
    record.targetSizeSpacingPass = verdicts.filter(
      (verdict) => verdict.status === "pass-spacing"
    ).length
    record.touchTargets = touch
      ? touchTargetFailures(data.targets).map(strip)
      : []
    record.iosZoom = data.iosZoom.filter(
      (input) => input.fontSize < IOS_ZOOM_MIN_FONT
    )
    record.text = { ...textStats(data.histogram), histogram: data.histogram }
    record.smallText = data.smallText
    const scrolled = await page.evaluate(pinnedAfterScroll)
    record.chrome = {
      load: chromeBudget(data.chromeLoad, data.viewport.h),
      scrolled: chromeBudget(scrolled, data.viewport.h),
      elements: data.chromeLoad.map(({ top, bottom, position, sel, slot }) => ({
        top: Math.round(top),
        bottom: Math.round(bottom),
        position,
        sel,
        slot,
      })),
    }
    record.landmarks = data.landmarks

    const axe = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .exclude("nextjs-portal")
      .analyze()
    // Pass/incomplete counts show axe ran; incomplete rules need manual review.
    record.axeRuns = {
      passes: axe.passes.length,
      incomplete: axe.incomplete.map((rule) => `${rule.id}:${rule.nodes.length}`),
    }
    record.axe = []
    for (const violation of axe.violations) {
      const targets = violation.nodes
        .slice(0, 20)
        .map((node) => node.target.map(String).join(" >>> "))
      const slots = await page.evaluate(slotsForSelectors, targets)
      record.axe.push({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        targets: targets.map((target, index) => ({
          target,
          slot: slots[index],
        })),
      })
    }

    // Focus sweep last: it scrolls the page.
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      document.activeElement?.blur?.()
    })
    const seen = new Set()
    const obscured = []
    let offscreen = 0
    let steps = 0
    for (; steps < focusSteps; steps++) {
      await page.keyboard.press("Tab")
      const probe = await page.evaluate(probeFocus)
      if (probe.none || probe.devtools || probe.empty) continue
      if (seen.has(probe.key)) break
      seen.add(probe.key)
      const verdict = focusVerdict(probe.samples)
      if (verdict.offscreen) offscreen++
      if (verdict.obscured)
        obscured.push({
          step: steps + 1,
          element: probe.element,
          by: verdict.by,
        })
    }
    record.focus = { steps, checked: seen.size, offscreen, obscured }
  } catch (error) {
    record.error = String(error?.message ?? error)
      .split("\n")[0]
      .slice(0, 300)
  } finally {
    record.consoleErrors = consoleErrors
    record.pageErrors = pageErrors
    record.ms = Date.now() - started
    await page.close().catch(() => {})
  }
  return record
}

await mkdir(out, { recursive: true })
const startedAt = Date.now()
const browser = await chromium.launch()
const contexts = new Map()
const contextFor = async (combo, role) => {
  const key = `${combo.width}:${combo.theme}:${role}`
  if (!contexts.has(key)) {
    contexts.set(
      key,
      (async () => {
        const touch = isTouchWidth(combo.width)
        const context = await browser.newContext({
          viewport: {
            width: combo.width,
            height: fixedHeight ?? viewportHeight(combo.width),
          },
          colorScheme: combo.theme === "dark" ? "dark" : "light",
          reducedMotion: "reduce",
          hasTouch: touch,
          isMobile: touch,
        })
        const cookie = cookies[role]
        if (cookie) {
          const [name, value] = cookie.split("=")
          await context.addCookies([
            { name, value, url: base, httpOnly: true, sameSite: "Lax" },
          ])
        }
        return context
      })()
    )
  }
  return contexts.get(key)
}

// Jobs run route-major so each route compiles once in `next dev` before the
// other widths hit it; results are re-sorted into a deterministic order.
const jobs = routes.flatMap((route, routeIndex) =>
  combos.map((combo, comboIndex) => ({
    route,
    combo,
    order: routeIndex * combos.length + comboIndex,
  }))
)
const results = new Array(jobs.length)
let next = 0
let done = 0
try {
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]
        const context = await contextFor(job.combo, job.route.role)
        results[job.order] = await auditPage(context, job.route, job.combo)
        done++
        const record = results[job.order]
        process.stderr.write(
          `[${done}/${jobs.length}] ${job.route.label} @${job.combo.width} ${job.combo.theme} ${record.error ? `ERROR ${record.error}` : `${record.ms}ms`}\n`
        )
      }
    })
  )
} finally {
  for (const context of contexts.values())
    await (await context).close().catch(() => {})
  await browser.close()
}

const durationS = Math.round((Date.now() - startedAt) / 1000)
const summary = aggregate(results)
const config = {
  base,
  widths: [...new Set(combos.map((combo) => combo.width))],
  themes: [...new Set(combos.map((combo) => combo.theme))],
  combos,
  routes: routes.map((route) => route.label),
  concurrency,
  settle,
  focusSteps,
  durationS,
  generatedAt: new Date(startedAt).toISOString(),
}
const report = { config, summary, pages: results }
await writeFile(
  resolve(out, "mobile-audit.json"),
  JSON.stringify(report, null, 2)
)
await writeFile(resolve(out, "mobile-audit.md"), renderMarkdown(report) + "\n")
await writeFile(
  resolve(out, "mobile-audit-totals.json"),
  JSON.stringify(compactTotals(summary, config), null, 2) + "\n"
)
console.log(
  JSON.stringify({
    out,
    durationS,
    totals: summary.totals,
    extremes: summary.extremes,
  })
)

if (budget) {
  const failures = checkBudget(summary, budget)
  for (const failure of failures)
    console.error(
      `Budget exceeded: ${failure.scope} ${failure.metric} ${failure.value} > ${failure.max}`
    )
  if (failures.length) process.exitCode = 1
}
