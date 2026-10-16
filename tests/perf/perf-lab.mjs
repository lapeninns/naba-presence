// Lab performance sweep against a production build (`pnpm build && pnpm start`)
// serving the visual fixtures (tests/visual/with-visual-db.sh). Not part of
// the e2e suite.
//
//   node tests/perf/perf-lab.mjs --base http://localhost:3300 --runs 3 \
//     --out <dir> [--routes /inbox,/listings/{loc}] [--profile mobile|desktop]
//     [--role owner] [--quiet 5000] [--budgets tests/perf/budgets.json]
//
// Profiles: mobile = 390x844, isMobile, hasTouch, DPR 3, CPU throttled 4x
// and "Slow 4G" (150 ms RTT, 1.6 Mbps down, 750 Kbps up) through CDP;
// desktop = 1280x800, unthrottled. Every run is a cold load in a fresh
// browser context (empty HTTP cache, only the session cookie). Runs are
// interleaved (run 1 of every route, then run 2, ...) so drift on the host
// spreads across routes; each metric is the median over runs.
//
// Per route: TTFB, FCP, LCP, CLS (largest session window of layout shifts
// without recent input), TBT (sum of long-task time over 50 ms from FCP to
// the end of a quiet window: load, then --quiet ms with no long task and no
// request in flight, capped at 30 s), JS transfer/decoded bytes and request
// count, total transfer bytes and requests, DOM nodes, and an interaction
// probe: one tap/click on a representative control, reported as the
// longest Event Timing entry with an interactionId (durationThreshold 16),
// i.e. an INP-like latency for that single interaction.
//
// Placeholders and roles match tests/visual/shoot.mjs. The script refuses
// to run unless the role's cookie resolves to the fixture tenant.
//
// With --budgets, every median is compared with the budget file (see
// tests/perf/budgets.json and budgets.mjs) and the process exits 1 on any
// breach. A saved result can be re-checked without measuring:
//   node tests/perf/budgets.mjs <out>/perf-mobile.json --budgets <file>
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { loadavg } from "node:os"

import { chromium } from "@playwright/test"

import { checkBudgets } from "./budgets.mjs"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = argv[index + 1]
  return next === undefined || next.startsWith("--") ? true : next
}

const base = String(arg("base", "http://localhost:3300"))
const runs = Number.parseInt(String(arg("runs", "3")), 10)
const profileName = String(arg("profile", "mobile"))
const out = resolve(String(arg("out", `test-results/perf/${profileName}`)))
const quiet = Number.parseInt(String(arg("quiet", "5000")), 10)
const role = String(arg("role", "owner"))
const budgetsPath = arg("budgets", null)

const PROFILES = {
  mobile: {
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    cpu: 4,
    network: {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    },
  },
  desktop: {
    context: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    cpu: 1,
    network: null,
  },
}
const profile = PROFILES[profileName]
if (!profile) throw new Error(`Unknown profile ${profileName}`)

// One representative control per route. `selectors` are tried in order and
// the first visible match is tapped (mobile) or clicked (desktop).
const PROBES = {
  inbox: ['[data-slot="queue-tab"] >> nth=1'],
  // On a phone the selected review replaces the list, so tap a reply tone.
  inboxDetail: [
    'main button:text-is("Concise")',
    '[aria-label="Back to reviews"]',
  ],
  listings: ['[data-slot="segmented-control-item"] >> nth=1'],
  // The H1 is the area switcher on every area (L03); the overview's title
  // is the sibling switcher only with two or more listings.
  listing: [
    '[data-slot="listing-area-selector"]',
    'nav[aria-label="Listing areas"] a >> nth=1',
  ],
  reports: ['[data-slot="tabs-tab"] >> nth=1'],
  calendar: ['[data-slot="segmented-control-item"] >> nth=1'],
  clients: ['[data-slot="segmented-control-item"] >> nth=1'],
  settings: [
    'main a[href="/settings/notifications"]',
    'a[href="/settings/notifications"]',
  ],
  billing: ['main a[href="/settings/usage"]', 'a[href="/settings/usage"]'],
  // Opens the invite dialog; never changes the fixture.
  team: ['main button:has-text("Invite a teammate")'],
  // A settings tab, not a switch: a switch would save a preference.
  notifications: [
    'main a[href="/settings/policy"]',
    'main a[href="/settings"]',
  ],
  setup: ['button[aria-label="Open navigation"]', "main a >> nth=0"],
  signIn: ['input[type="email"]', "main button"],
}
const DEFAULT_ROUTES = [
  ["/inbox", "inbox"],
  ["/inbox?selected={review}", "inboxDetail"],
  ["/listings", "listings"],
  ["/listings/{loc}", "listing"],
  ["/listings/{loc}/hours", "listing"],
  ["/listings/{loc}/photos", "listing"],
  ["/listings/{loc}/posts", "listing"],
  // The listing areas perf-lab skipped until L16 (LST-14): six now stream
  // their first read; Review & publish still reads in the browser.
  ["/listings/{loc}/profile", "listing"],
  ["/listings/{loc}/menu", "listing"],
  ["/listings/{loc}/booking", "listing"],
  ["/listings/{loc}/people", "listing"],
  ["/listings/{loc}/verification", "listing"],
  ["/listings/{loc}/suggestions", "listing"],
  ["/listings/{loc}/changes", "listing"],
  ["/reports", "reports"],
  ["/calendar", "calendar"],
  ["/clients", "clients"],
  ["/settings", "settings"],
  // Read on the server since P20 (SET-22).
  ["/settings/notifications", "notifications"],
  ["/team", "team"],
  ["/settings/billing", "billing"],
  ["/setup", "setup"],
  ["/sign-in", "signIn", "anon"],
]

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
if (!(role in cookies)) throw new Error(`Unknown role ${role}`)
const fill = (route) =>
  route
    .replaceAll("{loc}", state.primaryLocationId)
    .replaceAll("{loc2}", state.approvalReview.locationId)
    .replaceAll("{client}", state.clientId)
    .replaceAll("{review}", state.directReview.id)

const requested = arg("routes", null)
const routes = requested
  ? String(requested)
      .split(",")
      .map((route) => {
        const known = DEFAULT_ROUTES.find(([r]) => r === route)
        return known ?? [route, null]
      })
  : DEFAULT_ROUTES

// Same guard as tests/visual/shoot.mjs: never measure as the real tenant.
for (const r of new Set(routes.map(([, , who]) => who ?? role))) {
  const cookie = cookies[r]
  if (!cookie) continue
  const response = await fetch(`${base}/api/session`, { headers: { cookie } })
  const organisation = (await response.json())?.session?.organisationName
  if (organisation !== "Sprint 5 Journey tenant") {
    throw new Error(
      `Refusing to measure: cookie for ${r} resolves to "${organisation}", not the fixture tenant.`
    )
  }
}

// Installed before any page script so nothing is missed (long tasks are
// not buffered by the browser).
const INIT = () => {
  const perf = (window.__perf = {
    lcp: [],
    shifts: [],
    longtasks: [],
    events: [],
    lastInput: -1,
  })
  const watch = (type, push, options = {}) => {
    try {
      new PerformanceObserver((list) =>
        list.getEntries().forEach(push)
      ).observe({ type, buffered: true, ...options })
    } catch {}
  }
  watch("largest-contentful-paint", (e) =>
    perf.lcp.push({
      t: e.startTime,
      size: e.size,
      el: e.element
        ? e.element.tagName + "." + String(e.element.className).slice(0, 60)
        : e.url,
    })
  )
  watch("layout-shift", (e) =>
    perf.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput })
  )
  watch("longtask", (e) =>
    perf.longtasks.push({ t: e.startTime, d: e.duration })
  )
  watch(
    "event",
    (e) =>
      perf.events.push({
        name: e.name,
        t: e.startTime,
        d: e.duration,
        id: e.interactionId,
        input: e.processingStart - e.startTime,
        proc: e.processingEnd - e.processingStart,
      }),
    { durationThreshold: 16 }
  )
  watch("first-input", (e) =>
    perf.events.push({
      name: e.name,
      t: e.startTime,
      d: e.duration,
      id: e.interactionId ?? 1,
      first: true,
    })
  )
}

const median = (values) => {
  const list = values
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (list.length === 0) return null
  const mid = Math.floor(list.length / 2)
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2
}
const clsOf = (shifts) => {
  let best = 0
  let window = 0
  let first = -1
  let last = -1
  for (const s of shifts.filter((s) => !s.input)) {
    if (first < 0 || s.t - last > 1000 || s.t - first > 5000) {
      window = 0
      first = s.t
    }
    window += s.v
    last = s.t
    best = Math.max(best, window)
  }
  return best
}

async function measure(browser, route, probeKey, who) {
  const context = await browser.newContext({
    ...profile.context,
    reducedMotion: "no-preference",
  })
  const cookie = cookies[who]
  if (cookie) {
    const [cookieName, ...rest] = cookie.split("=")
    await context.addCookies([
      {
        name: cookieName,
        value: rest.join("="),
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ])
  }
  await context.addInitScript(INIT)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false })
  if (profile.network)
    await cdp.send("Network.emulateNetworkConditions", profile.network)
  if (profile.cpu > 1)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu })

  const requests = new Map()
  let inflight = 0
  let lastNetwork = Date.now()
  let counting = true
  cdp.on("Network.requestWillBeSent", (e) => {
    if (!counting || e.request.url.startsWith("data:")) return
    if (!requests.has(e.requestId)) inflight++
    requests.set(e.requestId, {
      url: e.request.url,
      type: e.type,
      encoded: 0,
      decoded: 0,
      done: false,
    })
    lastNetwork = Date.now()
  })
  cdp.on("Network.dataReceived", (e) => {
    const r = requests.get(e.requestId)
    if (r) r.decoded += e.dataLength
  })
  const finish = (e, failed) => {
    const r = requests.get(e.requestId)
    if (!r || r.done) return
    r.done = true
    r.failed = failed
    if (!failed) r.encoded = e.encodedDataLength
    inflight = Math.max(0, inflight - 1)
    lastNetwork = Date.now()
  }
  cdp.on("Network.loadingFinished", (e) => finish(e, false))
  cdp.on("Network.loadingFailed", (e) => finish(e, true))
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)))
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(m.text().slice(0, 200))
  )

  const started = Date.now()
  const response = await page.goto(base + route, {
    waitUntil: "load",
    timeout: 120_000,
  })
  // First-load JS = the chunks the server HTML names (script tags plus the
  // client references in the inline RSC payload). Anything else is a
  // <Link> prefetch of another route or a lazy import.
  const html = (await response?.text().catch(() => "")) ?? ""
  const htmlChunks = new Set(
    [...html.matchAll(/static\/chunks\/[^"'\\\s]+?\.js/g)].map((m) =>
      decodeURIComponent(m[0])
    )
  )
  // Quiet window: no long task and nothing in flight for `quiet` ms.
  for (;;) {
    await page.waitForTimeout(250)
    const lastTask = await page.evaluate(() => {
      const t = window.__perf.longtasks.at(-1)
      return t ? performance.timeOrigin + t.t + t.d : 0
    })
    const now = Date.now()
    const calm = Math.min(now - lastNetwork, now - Math.max(lastTask, started))
    if ((inflight === 0 && calm >= quiet) || now - started > 30_000) break
  }
  counting = false
  const landedUrl = page.url().replace(base, "")

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0]
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]
    const p = window.__perf
    return {
      ttfb: nav ? nav.responseStart : null,
      redirect: nav ? nav.redirectEnd : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      load: nav ? nav.loadEventEnd : null,
      fcp: fcp ? fcp.startTime : null,
      lcpEntry: p.lcp.at(-1) ?? null,
      shifts: p.shifts,
      longtasks: p.longtasks,
      domNodes: document.getElementsByTagName("*").length,
      fonts: performance
        .getEntriesByType("resource")
        .filter(
          (r) => r.initiatorType === "css" && /\.(woff2?|ttf)/.test(r.name)
        ).length,
    }
  })
  const tbt = metrics.longtasks
    .filter((t) => metrics.fcp !== null && t.t + t.d > metrics.fcp)
    .reduce(
      (sum, t) =>
        sum + Math.max(0, t.t + t.d - Math.max(t.t, metrics.fcp) - 50),
      0
    )

  // Interaction probe.
  let probe = { selector: null, inp: null }
  const selectors = probeKey ? PROBES[probeKey] : ["main button"]
  for (const selector of selectors) {
    const target = page.locator(selector).first()
    if ((await target.count()) && (await target.isVisible())) {
      await page.evaluate(() => (window.__perf.events.length = 0))
      if (profile.context.hasTouch) await target.tap({ timeout: 10_000 })
      else await target.click({ timeout: 10_000 })
      await page.waitForTimeout(1500)
      const events = await page.evaluate(() => window.__perf.events)
      const interactive = events.filter((e) => e.id > 0)
      const worst = interactive.sort((a, b) => b.d - a.d)[0]
      probe = {
        selector,
        inp: worst ? worst.d : 0,
        event: worst?.name ?? null,
        input: worst?.input ?? null,
        processing: worst?.proc ?? null,
      }
      break
    }
  }

  const list = [...requests.values()]
  const js = list.filter((r) => r.type === "Script")
  const isFirstLoad = (r) => {
    const path = decodeURIComponent(new URL(r.url).pathname)
    return [...htmlChunks].some((chunk) => path.endsWith(chunk))
  }
  const firstLoad = js.filter(isFirstLoad)
  const sum = (items, key) => items.reduce((s, r) => s + (r[key] || 0), 0)
  const result = {
    route,
    finalUrl: landedUrl,
    status: response?.status() ?? null,
    ttfb: metrics.ttfb,
    redirect: metrics.redirect,
    fcp: metrics.fcp,
    lcp: metrics.lcpEntry ? metrics.lcpEntry.t : null,
    lcpElement: metrics.lcpEntry?.el ?? null,
    cls: clsOf(metrics.shifts),
    tbt,
    longTasks: metrics.longtasks.length,
    longestTask: Math.max(0, ...metrics.longtasks.map((t) => t.d)),
    domContentLoaded: metrics.domContentLoaded,
    load: metrics.load,
    jsRequests: js.length,
    firstLoadJsRequests: firstLoad.length,
    firstLoadJsTransfer: sum(firstLoad, "encoded"),
    firstLoadJsDecoded: sum(firstLoad, "decoded"),
    otherJsTransfer: sum(js, "encoded") - sum(firstLoad, "encoded"),
    jsTransfer: sum(js, "encoded"),
    jsDecoded: sum(js, "decoded"),
    requests: list.length,
    transfer: sum(list, "encoded"),
    fetchRequests: list.filter((r) => r.type === "Fetch" || r.type === "XHR")
      .length,
    fetchUrls: list
      .filter((r) => r.type === "Fetch" || r.type === "XHR")
      .map((r) => r.url.replace(base, "").slice(0, 120)),
    rscRequests: list.filter((r) => r.url.includes("_rsc=")).length,
    rscTransfer: sum(
      list.filter((r) => r.url.includes("_rsc=")),
      "encoded"
    ),
    cssTransfer: sum(
      list.filter((r) => r.type === "Stylesheet"),
      "encoded"
    ),
    fontTransfer: sum(
      list.filter((r) => r.type === "Font"),
      "encoded"
    ),
    documentTransfer: sum(
      list.filter((r) => r.type === "Document"),
      "encoded"
    ),
    apiRequests: list.filter((r) => r.url.startsWith(base + "/api/")).length,
    fontRequests: list.filter((r) => r.type === "Font").length,
    imageRequests: list.filter((r) => r.type === "Image").length,
    domNodes: metrics.domNodes,
    probe,
    errors,
    hostLoad: loadavg()[0],
  }
  await context.close()
  return result
}

const browser = await chromium.launch()
const samples = new Map(routes.map(([route]) => [route, []]))
try {
  for (let run = 1; run <= runs; run++) {
    for (const [template, probeKey, who] of routes) {
      const route = fill(template)
      try {
        const sample = await measure(browser, route, probeKey, who ?? role)
        samples.get(template).push(sample)
        console.error(
          `[${profileName} run ${run}] ${template} lcp=${Math.round(sample.lcp)} tbt=${Math.round(sample.tbt)} js=${Math.round(sample.jsTransfer / 1024)}KB inp=${sample.probe.inp}`
        )
      } catch (error) {
        console.error(
          `[${profileName} run ${run}] ${template} FAILED ${String(error).slice(0, 200)}`
        )
        samples
          .get(template)
          .push({ route, error: String(error).slice(0, 400) })
      }
    }
  }
} finally {
  await browser.close()
}

const KEYS = [
  "ttfb",
  "fcp",
  "lcp",
  "cls",
  "tbt",
  "longestTask",
  "load",
  "jsRequests",
  "firstLoadJsRequests",
  "firstLoadJsTransfer",
  "firstLoadJsDecoded",
  "otherJsTransfer",
  "jsTransfer",
  "jsDecoded",
  "requests",
  "transfer",
  "fetchRequests",
  "rscRequests",
  "rscTransfer",
  "cssTransfer",
  "fontTransfer",
  "documentTransfer",
  "apiRequests",
  "fontRequests",
  "imageRequests",
  "redirect",
  "domNodes",
]
const summary = routes.map(([template]) => {
  const ok = samples.get(template).filter((s) => !s.error)
  const row = {
    route: template,
    runs: ok.length,
    finalUrl: ok[0]?.finalUrl,
    status: ok[0]?.status,
    lcpElement: ok.at(-1)?.lcpElement,
  }
  for (const key of KEYS) row[key] = median(ok.map((s) => s[key]))
  row.inp = median(ok.map((s) => s.probe?.inp))
  row.probe = ok[0]?.probe?.selector ?? null
  row.fetchUrls = ok[0]?.fetchUrls ?? []
  row.errors = [...new Set(ok.flatMap((s) => s.errors))].slice(0, 5)
  return row
})

const ms = (v) => (v === null ? "–" : Math.round(v).toString())
const kb = (v) => (v === null ? "–" : (v / 1024).toFixed(0))
const table = [
  `Profile **${profileName}**, ${runs} cold runs per route, medians. ${new Date().toISOString()} against ${base}.`,
  "",
  "| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...summary.map(
    (r) =>
      `| ${r.route} | ${ms(r.ttfb)} | ${ms(r.fcp)} | ${ms(r.lcp)} | ${r.cls === null ? "–" : r.cls.toFixed(3)} | ${ms(r.tbt)} | ${ms(r.longestTask)} | ${ms(r.inp)} | ${ms(r.jsRequests)} | ${kb(r.jsTransfer)} | ${kb(r.jsDecoded)} | ${kb(r.firstLoadJsTransfer)} | ${kb(r.otherJsTransfer)} | ${ms(r.requests)} | ${kb(r.transfer)} | ${ms(r.fetchRequests)} | ${ms(r.rscRequests)} | ${ms(r.apiRequests)} | ${ms(r.domNodes)} |`
  ),
  "",
  "Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.",
]

let breaches = []
if (budgetsPath) {
  const budgets = JSON.parse(
    await readFile(resolve(String(budgetsPath)), "utf8")
  )
  breaches = checkBudgets(summary, budgets, profileName)
  table.push(
    "",
    breaches.length
      ? `**Budget breaches (${breaches.length})**\n\n${breaches.map((b) => `- ${b}`).join("\n")}`
      : "All budgets met."
  )
}

await mkdir(out, { recursive: true })
await writeFile(
  join(out, `perf-${profileName}.json`),
  JSON.stringify(
    {
      profile: profileName,
      base,
      runs,
      summary,
      samples: Object.fromEntries(samples),
    },
    null,
    2
  )
)
await writeFile(join(out, `perf-${profileName}.md`), table.join("\n") + "\n")
console.log(table.join("\n"))
if (breaches.length) process.exitCode = 1
