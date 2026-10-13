// Route screenshot capture for the redesign's before/after evidence. Not part
// of any suite and asserts nothing about design: it records what each page
// route (notion-mail-ledger INVENTORY.md §1) looks like, plus a few cheap
// interactive states, at desktop and phone sizes.
//
// Needs a running app seeded with the e2e fixture tenants and its state file
// (test-results/e2e-journey-state.json). nm-serve.mjs provides both:
//
//   with-e2e-db.sh node tests/visual/nm-serve.mjs -- \
//     node tests/visual/nm-capture.mjs --out <dir>
//
// Options:
//   --base <url>          app URL (default $APP_URL)
//   --out <dir>           output root (default test-results/nm-capture)
//   --viewports <list>    desktop,mobile (default both)
//   --dark                also capture dark theme (into <viewport>-dark/)
//   --only <regex>        keep routes/states whose name or path matches
//   --routes <list|file>  replace the route list: `[role:]path` specs, comma
//                         separated or one per line (# comments allowed)
//   --states <all|none|names>  interactive states (default all)
//   --concurrency <n>     pages in flight (default 3)
//   --settle <ms>         wait after load (default 700)
//   --mobile-dpr <n>      phone device scale factor (default 3)
//   --desktop-dpr <n>     desktop device scale factor (default 1)
//   --merge               merge into an existing <out>/manifest.json
//
// Placeholders: {loc} primary location, {loc2} approval location, {client}
// seeded client, {review} direct review, {areview} approval review.
// Roles: owner (default), viewer, admin, member, member-unassigned,
// requester, approver, anon.
//
// Writes <out>/<viewport>/<name>.png and <out>/manifest.json (one entry per
// shot: route, viewport, status, HTTP code, final URL, console error count).
// Exit code is 0 even when shots fail; read the manifest.
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { chromium } from "@playwright/test"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = argv[index + 1]
  return next === undefined || next.startsWith("--") ? true : next
}

const base = String(arg("base", process.env.APP_URL ?? "")).replace(/\/$/, "")
if (!base) throw new Error("--base or APP_URL is required")
const out = resolve(String(arg("out", "test-results/nm-capture")))
const viewportNames = String(arg("viewports", "desktop,mobile")).split(",")
const themes = arg("dark", false) ? ["light", "dark"] : ["light"]
const only = arg("only", null) ? new RegExp(String(arg("only"))) : null
const statesArg = String(arg("states", "all"))
const concurrency = Number(arg("concurrency", 3))
const settle = Number(arg("settle", 700))

const VIEWPORTS = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: Number(arg("desktop-dpr", 1)),
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: Number(arg("mobile-dpr", 3)),
    isMobile: true,
    hasTouch: true,
  },
}

const AREAS = [
  "profile",
  "hours",
  "booking",
  "photos",
  "posts",
  "menu",
  "people",
  "verification",
  "suggestions",
  "changes",
]
const SETTINGS = [
  "policy",
  "notifications",
  "security",
  "connections",
  "operations",
  "privacy",
  "usage",
  "billing",
  "billing/confirming",
]
// INVENTORY.md §1, every page route. Dynamic segments that need a real token
// use an invalid one on purpose: that is the page's not-found/expired state.
export const DEFAULT_ROUTES = [
  "/",
  "anon:/",
  "/profile",
  "/design-system",
  "/nm-capture-missing-route",
  "anon:/sign-in",
  "anon:/sign-in?mode=create-account",
  "anon:/sign-in/verify",
  "anon:/forgot-password",
  "anon:/reset-password",
  "anon:/invite/nm-capture-invalid-token",
  "/inbox",
  "/listings",
  "/listings/{loc}",
  ...AREAS.map((area) => `/listings/{loc}/${area}`),
  "/listings/bulk",
  "/listings/bulk/00000000-0000-4000-8000-000000000000",
  "/calendar",
  "/clients",
  "/clients/new",
  "/clients/{client}",
  "/clients/{client}/settings",
  "/reports",
  "/notifications",
  "/team",
  "/setup",
  "/settings",
  ...SETTINGS.map((page) => `/settings/${page}`),
  "anon:/privacy",
  "anon:/terms",
  "anon:/share/report/nm-capture-invalid-token",
  // Permission-restricted states (INVENTORY.md §2 page-level restrictions).
  "viewer:/inbox",
  "viewer:/listings/{loc}/profile",
  "viewer:/listings/bulk",
  "viewer:/team",
  "viewer:/settings/connections",
  "member:/clients/new",
  "admin:/settings/billing",
]

const fill = async (page, locator, text) => {
  await locator.first().waitFor({ state: "visible", timeout: 10_000 })
  await locator.first().fill(text)
}
// Interactive states: [name, role, path, viewports, action]. Each action
// uses today's accessible names (tests/e2e specs); a state the UI no longer
// reaches is recorded as `state-not-reached`, never a crash.
export const STATES = [
  ["inbox-selected", "owner", "/inbox?selected={review}", null, null],
  [
    "inbox-reply-composer",
    "owner",
    "/inbox?selected={review}",
    null,
    async (page) => {
      const box = page.getByRole("textbox", { name: /reply/i })
      await fill(
        page,
        box,
        "Thank you for the kind words - we look forward to welcoming you back soon."
      )
    },
  ],
  [
    "inbox-filters-dialog",
    "owner",
    "/inbox",
    null,
    async (page) => {
      await page
        .getByRole("button", { name: /^Filters?/ })
        .first()
        .click()
      await page.getByRole("dialog").first().waitFor({ timeout: 10_000 })
    },
  ],
  [
    "command-palette",
    "owner",
    "/inbox",
    ["desktop"],
    async (page) => {
      await page
        .locator("body")
        .click({ position: { x: 5, y: 5 } })
        .catch(() => {})
      await page.keyboard.press("ControlOrMeta+k")
      await page.getByRole("dialog").first().waitFor({ timeout: 10_000 })
    },
  ],
  [
    "more-sheet",
    "owner",
    "/inbox",
    ["mobile"],
    async (page) => {
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "More", exact: true })
        .click()
      await page
        .getByRole("dialog", { name: "More" })
        .waitFor({ timeout: 10_000 })
    },
  ],
  [
    "client-switcher-open",
    "owner",
    "/inbox",
    null,
    async (page) => {
      await page
        .getByRole("button", { name: /^(Client:|Switch client)/ })
        .first()
        .click({ timeout: 5_000 })
      await page
        .locator('[role="dialog"],[role="menu"],[role="listbox"]')
        .first()
        .waitFor({ timeout: 10_000 })
    },
  ],
]

const state = JSON.parse(
  await readFile(
    process.env.NM_STATE_FILE ?? resolve("test-results/e2e-journey-state.json"),
    "utf8"
  )
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
const fillPath = (path) =>
  path
    .replaceAll("{loc}", state.primaryLocationId)
    .replaceAll("{loc2}", state.approvalReview.locationId)
    .replaceAll("{client}", state.clientId)
    .replaceAll("{review}", state.directReview.id)
    .replaceAll("{areview}", state.approvalReview.id)
const nameOf = (role, path) =>
  (role === "owner" ? "" : `${role}--`) +
  (path
    .replace(/^\//, "")
    .replace(/[{}]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "root")

function parseSpec(spec) {
  const match = /^([a-z-]+):(\/.*)$/.exec(spec.trim())
  return match
    ? { role: match[1], path: match[2] }
    : { role: "owner", path: spec.trim() }
}
const routesArg = arg("routes", null)
const specs =
  typeof routesArg !== "string"
    ? DEFAULT_ROUTES
    : existsSync(resolve(routesArg))
      ? (await readFile(resolve(routesArg), "utf8"))
          .split("\n")
          .map((line) => line.replace(/#.*/, "").trim())
          .filter(Boolean)
      : routesArg.split(",").filter(Boolean)

const jobs = []
for (const theme of themes) {
  for (const viewport of viewportNames) {
    if (!VIEWPORTS[viewport]) throw new Error(`Unknown viewport ${viewport}`)
    for (const spec of specs) {
      const { role, path } = parseSpec(spec)
      if (!(role in cookies)) throw new Error(`Unknown role ${role}`)
      jobs.push({
        theme,
        viewport,
        role,
        route: path,
        name: nameOf(role, path),
      })
    }
    if (statesArg !== "none") {
      const wanted = statesArg === "all" ? null : new Set(statesArg.split(","))
      for (const [name, role, path, only_, action] of STATES) {
        if (wanted && !wanted.has(name)) continue
        if (only_ && !only_.includes(viewport)) continue
        jobs.push({
          theme,
          viewport,
          role,
          route: path,
          name: `state--${name}`,
          state: name,
          action,
        })
      }
    }
  }
}
const selected = only
  ? jobs.filter((job) => only.test(job.name) || only.test(job.route))
  : jobs

// Refuse unless the cookies resolve to the fixture tenant (as shoot.mjs).
for (const role of new Set(selected.map((job) => job.role))) {
  const cookie = cookies[role]
  if (!cookie) continue
  const response = await fetch(`${base}/api/session`, { headers: { cookie } })
  const organisation = (await response.json().catch(() => null))?.session
    ?.organisationName
  if (organisation !== "Sprint 5 Journey tenant") {
    throw new Error(
      `Refusing to capture: ${role} cookie resolves to "${organisation}", not the fixture tenant.`
    )
  }
}

const started = Date.now()
const browser = await chromium.launch()
const contexts = new Map()
async function contextFor(job) {
  const key = `${job.viewport}|${job.theme}|${job.role}`
  if (!contexts.has(key)) {
    contexts.set(
      key,
      (async () => {
        const context = await browser.newContext({
          ...VIEWPORTS[job.viewport],
          colorScheme: job.theme === "dark" ? "dark" : "light",
          reducedMotion: "reduce",
        })
        const cookie = cookies[job.role]
        if (cookie) {
          const [name, value] = cookie.split("=", 2)
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

async function shoot(job) {
  const dir = resolve(
    out,
    job.theme === "light" ? job.viewport : `${job.viewport}-${job.theme}`
  )
  await mkdir(dir, { recursive: true })
  const file = resolve(dir, `${job.name}.png`)
  const entry = {
    name: job.name,
    route: job.route,
    path: fillPath(job.route),
    role: job.role,
    viewport: job.viewport,
    size: VIEWPORTS[job.viewport].viewport,
    theme: job.theme,
    state: job.state ?? null,
    status: "ok",
    httpStatus: null,
    finalUrl: null,
    redirected: false,
    consoleErrors: 0,
    consoleErrorSamples: [],
    error: null,
    file: file.replace(`${out}/`, ""),
    ms: 0,
  }
  const t0 = Date.now()
  const page = await (await contextFor(job)).newPage()
  const errors = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 240))
  })
  page.on("pageerror", (error) =>
    errors.push(`pageerror: ${String(error).slice(0, 240)}`)
  )
  try {
    const response = await page.goto(base + entry.path, {
      waitUntil: "load",
      timeout: 45_000,
    })
    entry.httpStatus = response?.status() ?? null
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {})
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
    await page.waitForTimeout(settle)
    if (job.action) {
      try {
        await job.action(page)
        await page.waitForTimeout(settle)
      } catch (error) {
        entry.status = "state-not-reached"
        entry.error = String(error?.message ?? error)
          .split("\n")[0]
          .slice(0, 300)
      }
    }
    if (entry.httpStatus && entry.httpStatus >= 500) entry.status = "http-error"
    await page.screenshot({ path: file, fullPage: true, timeout: 30_000 })
  } catch (error) {
    entry.status = "error"
    entry.error = String(error?.message ?? error)
      .split("\n")[0]
      .slice(0, 300)
    await page
      .screenshot({ path: file, fullPage: false })
      .catch(() => (entry.file = null))
  }
  entry.finalUrl = page.url().replace(base, "")
  entry.redirected = entry.finalUrl !== entry.path
  entry.consoleErrors = errors.length
  entry.consoleErrorSamples = errors.slice(0, 3)
  entry.ms = Date.now() - t0
  await page.close().catch(() => {})
  console.log(
    `${entry.status.padEnd(17)} ${String(entry.httpStatus ?? "-").padEnd(4)} ${job.viewport.padEnd(7)} ${job.name}${entry.redirected ? ` -> ${entry.finalUrl}` : ""}${entry.consoleErrors ? ` (${entry.consoleErrors} console errors)` : ""}`
  )
  return entry
}

const results = new Array(selected.length)
let next = 0
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < selected.length) {
      const index = next++
      results[index] = await shoot(selected[index])
    }
  })
)
await browser.close()

const commit = await import("node:child_process").then(({ execFileSync }) => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
})
// --merge keeps entries of an earlier run in the same --out that this run
// did not re-shoot (e.g. a later `--only` pass over a few routes).
const manifestPath = resolve(out, "manifest.json")
const key = (r) => `${r.viewport}|${r.theme}|${r.name}`
let entries = results
let runs = []
if (arg("merge", false) && existsSync(manifestPath)) {
  const previous = JSON.parse(await readFile(manifestPath, "utf8"))
  const fresh = new Set(results.map(key))
  entries = [
    ...previous.entries.filter((entry) => !fresh.has(key(entry))),
    ...results,
  ]
  runs = previous.runs ?? []
}
const bucket = (r) => r.viewport + (r.theme === "light" ? "" : `-${r.theme}`)
const totals = {}
for (const entry of entries) {
  const total = (totals[bucket(entry)] ??= { shots: 0, ok: 0, notOk: 0 })
  if (entry.file) total.shots++
  if (entry.status === "ok") total.ok++
  else total.notOk++
}
const manifest = {
  generatedAt: new Date().toISOString(),
  commit,
  base,
  durationMs: Date.now() - started,
  runs: [
    ...runs,
    {
      at: new Date().toISOString(),
      commit,
      shots: results.length,
      durationMs: Date.now() - started,
      argv,
    },
  ],
  totals,
  entries,
}
await mkdir(out, { recursive: true })
await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
console.log(
  `[nm-capture] ${results.length} shots in ${Math.round(manifest.durationMs / 1000)}s -> ${out}/manifest.json`
)
