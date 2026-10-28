// p6 capture harness: Settings, Team, Billing and Design system states at
// 390 light, 390 dark and 1280 light, against the visual fixtures
// (tests/visual/fixture-server.ts). Same script for BEFORE and AFTER.
//
//   node docs/audits/2026-10-28-all-flows/p6/capture/shots.mjs \
//     --base http://localhost:3562 \
//     --state <checkout>/test-results/e2e-journey-state.json \
//     --config A|B --out <dir> [--only id,id] [--variants 390-light,...] [--webp]
//
// --config names the app configuration the server under test was started
// with (README.md): A = billing off, MFA off; B = BILLING_ENABLED=true and
// MFA_ENABLED=true. Only states for that config run; the script probes the
// server first and refuses when the probe disagrees with --config.
//
// Conventions from tests/visual/shoot.mjs: it refuses unless every cookie it
// uses resolves (GET /api/session) to the fixture tenant "Sprint 5 Journey
// tenant"; chromium; reducedMotion reduce; waitUntil networkidle then a
// settle; requests to any host other than localhost/127.0.0.1 are aborted.
//
// Setups only open sheets, dialogs and menus, pick options and type. They
// never press a final confirm (Save, Send invite, Change role, Remove,
// Disconnect, Subscribe, Enable).
//
// One JSON line per shot goes to <out>/shots.jsonl (status, url, overflow,
// console errors, setup note). --webp converts each PNG with cwebp (q 80)
// when cwebp is on PATH, and keeps the PNG otherwise.
import { execFileSync } from "node:child_process"
import { appendFile, mkdir, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { chromium } from "@playwright/test"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = argv[index + 1]
  return next === undefined || next.startsWith("--") ? true : next
}

const FIXTURE_ORG = "Sprint 5 Journey tenant"
const base = String(arg("base", "http://localhost:3562"))
const statePath = resolve(
  String(arg("state", "test-results/e2e-journey-state.json"))
)
const out = resolve(String(arg("out", "test-results/p6-shots")))
const config = String(arg("config", ""))
const only = arg("only", null)
const onlyIds = typeof only === "string" ? new Set(only.split(",")) : null
const settle = Number.parseInt(String(arg("wait", "1200")), 10)
const webp = Boolean(arg("webp", false))
const VARIANTS = [
  { key: "390-light", width: 390, height: 844, scheme: "light" },
  { key: "390-dark", width: 390, height: 844, scheme: "dark" },
  { key: "1280-light", width: 1280, height: 800, scheme: "light" },
]
const variantArg = arg("variants", null)
const variants =
  typeof variantArg === "string"
    ? VARIANTS.filter((v) => variantArg.split(",").includes(v.key))
    : VARIANTS

if (config !== "A" && config !== "B") {
  throw new Error("--config A|B is required (see README.md).")
}

// Never print this: it holds session cookies.
const state = JSON.parse(await readFile(statePath, "utf8"))
const cookies = {
  owner: state.cookie,
  viewer: state.viewerCookie,
  admin: state.adminCookie,
  member: state.memberAssignedCookie,
  "member-unassigned": state.memberUnassignedCookie,
  anon: null,
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function firstVisible(locator) {
  for (const candidate of await locator.all()) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

// Polls for up to 8 s: menus and sheets open with a short transition, and a
// cold `next dev` route may still be hydrating.
async function must(locator, what) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const found = await firstVisible(locator)
    if (found) return found
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`setup: ${what} not found`)
}

async function scrollTo(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
}

const dialog = (page) =>
  page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last()

// ---------------------------------------------------------------------------
// States. config: "A" (billing off, MFA off) or "B" (billing on, MFA on).
// full: full-page screenshot (fixed overlays are shot at the viewport).
// ---------------------------------------------------------------------------

const STATES = [
  // F01
  {
    id: "settings-index",
    flow: "F01",
    route: "/settings",
    role: "owner",
    config: "A",
    full: true,
  },
  {
    id: "settings-index-viewer",
    flow: "F01",
    route: "/settings",
    role: "viewer",
    config: "A",
    full: true,
  },
  {
    id: "billing-off-404",
    flow: "F01",
    route: "/settings/billing",
    role: "owner",
    config: "A",
  },
  // F02
  {
    id: "policy",
    flow: "F02",
    route: "/settings/policy",
    role: "owner",
    config: "A",
    full: true,
  },
  {
    id: "policy-dirty",
    flow: "F02",
    route: "/settings/policy",
    role: "owner",
    config: "A",
    interaction:
      "type a new agency/business name (save bar shows); Save not pressed",
    async setup(page) {
      const field = await must(
        page.getByLabel(/^(Agency|Business|Workspace) name/i),
        "workspace name field"
      )
      await field.click()
      await field.fill("Sprint 5 Journey tenant renamed")
      await page.waitForTimeout(400)
      return "name field filled"
    },
  },
  {
    id: "policy-viewer",
    flow: "F02",
    route: "/settings/policy",
    role: "viewer",
    config: "A",
    full: true,
  },
  // F03
  {
    id: "policy-workspace-type",
    flow: "F03",
    route: "/settings/policy",
    role: "owner",
    config: "A",
    interaction:
      "scroll the workspace type card into view (feature workspace_mode_change on)",
    async setup(page) {
      const section = page.locator("#settings-workspace-type")
      if ((await section.count()) > 0) {
        await scrollTo(page, section.first())
        return "#settings-workspace-type"
      }
      const heading = await firstVisible(page.getByText(/workspace type/i))
      if (!heading) throw new Error("setup: workspace type card not rendered")
      await scrollTo(page, heading)
      return "text 'workspace type'"
    },
  },
  // F04
  {
    id: "notifications",
    flow: "F04",
    route: "/settings/notifications",
    role: "owner",
    config: "A",
    full: true,
  },
  {
    id: "notifications-member",
    flow: "F04",
    route: "/settings/notifications",
    role: "member",
    config: "A",
    full: true,
  },
  // F05 / F06
  {
    id: "connections",
    flow: "F05/F06",
    route: "/settings/connections",
    role: "owner",
    config: "A",
    full: true,
  },
  {
    id: "connections-error-return",
    flow: "F05",
    route:
      "/settings/connections?google=error&status=400&reason=google_scope_missing&rid=req_visual_p6",
    role: "owner",
    config: "A",
    full: true,
    interaction:
      "OAuth error return (query handled by components/settings/oauth-return.tsx)",
  },
  {
    id: "connections-disconnect-dialog",
    flow: "F06",
    route: "/settings/connections",
    role: "owner",
    config: "A",
    interaction: "⋯ Actions for the login → Disconnect… (not confirmed)",
    async setup(page) {
      await (
        await must(
          page.getByRole("button", { name: /^Actions for / }),
          "connection actions"
        )
      ).click()
      await (
        await must(
          page.getByRole("menuitem", { name: /^Disconnect/ }),
          "Disconnect… item"
        )
      ).click()
      await dialog(page).waitFor({ state: "visible", timeout: 5000 })
      await page.waitForTimeout(400)
      return "disconnect dialog open"
    },
  },
  // F07
  {
    id: "operations",
    flow: "F07",
    route: "/settings/operations",
    role: "owner",
    config: "A",
    full: true,
  },
  // F08
  {
    id: "privacy",
    flow: "F08",
    route: "/settings/privacy",
    role: "owner",
    config: "A",
    full: true,
  },
  // F09
  {
    id: "security",
    flow: "F09",
    route: "/settings/security",
    role: "owner",
    config: "B",
    full: true,
  },
  // F10
  {
    id: "billing",
    flow: "F10",
    route: "/settings/billing",
    role: "owner",
    config: "B",
    full: true,
  },
  {
    id: "billing-canceled",
    flow: "F10",
    route: "/settings/billing?checkout=canceled",
    role: "owner",
    config: "B",
    full: true,
  },
  {
    id: "billing-admin-denied",
    flow: "F10",
    route: "/settings/billing",
    role: "admin",
    config: "B",
  },
  // F11
  {
    id: "billing-confirming",
    flow: "F11",
    route: "/settings/billing/confirming",
    role: "owner",
    config: "B",
    networkidle: false,
  },
  // F12
  {
    id: "usage",
    flow: "F12",
    route: "/settings/usage",
    role: "owner",
    config: "B",
    full: true,
  },
  {
    id: "usage-member",
    flow: "F12",
    route: "/settings/usage",
    role: "member",
    config: "B",
    full: true,
  },
  // Extra context for config B: the index with Billing, Usage and Sign-in security rows.
  {
    id: "settings-index-billing-on",
    flow: "F01",
    route: "/settings",
    role: "owner",
    config: "B",
    full: true,
  },
  // F13
  {
    id: "team",
    flow: "F13",
    route: "/team",
    role: "owner",
    config: "A",
    full: true,
  },
  {
    id: "team-member-sheet",
    flow: "F13",
    route: "/team",
    role: "owner",
    config: "A",
    interaction:
      "390: tap the first non-owner member row (sheet); 1280: open that row's ⋯ menu (no sheet at desk)",
    async setup(page, { width }) {
      if (width < 768) {
        const row = await must(
          page
            .getByRole("list", { name: "Members" })
            .getByRole("button", { name: /^M5 walk user/ }),
          "member row"
        )
        await row.click()
        await dialog(page).waitFor({ state: "visible", timeout: 5000 })
        await page.waitForTimeout(400)
        return "member sheet open"
      }
      await (
        await must(
          page.getByRole("button", { name: /^Actions for M5 walk user/ }),
          "row ⋯"
        )
      ).click()
      await page
        .getByRole("menu")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
      await page.waitForTimeout(300)
      return "row menu open"
    },
  },
  {
    id: "team-denied",
    flow: "F13",
    route: "/team",
    role: "member",
    config: "A",
  },
  // F14
  {
    id: "team-invite",
    flow: "F14",
    route: "/team#invite",
    role: "owner",
    config: "A",
    interaction: "#invite opens the invite sheet",
    async setup(page) {
      await dialog(page).waitFor({ state: "visible", timeout: 8000 })
      await page.waitForTimeout(400)
      return "invite sheet open"
    },
  },
  {
    id: "team-invite-admin",
    flow: "F14",
    route: "/team#invite",
    role: "owner",
    config: "A",
    interaction:
      "invite sheet, choose the Admin role (Send invite not pressed)",
    async setup(page) {
      const sheet = dialog(page)
      await sheet.waitFor({ state: "visible", timeout: 8000 })
      await (
        await must(sheet.getByRole("radio", { name: /^Admin/ }), "Admin radio")
      ).click()
      await page.waitForTimeout(400)
      return "Admin chosen"
    },
  },
  // F15
  {
    id: "team-change-role",
    flow: "F15",
    route: "/team",
    role: "owner",
    config: "A",
    interaction:
      "a member's role chip → Change role → pick Viewer (not confirmed)",
    async setup(page) {
      await (
        await must(
          page.getByRole("button", { name: /^Member: change .*role$/ }),
          "member role chip"
        )
      ).click()
      const box = dialog(page)
      await box.waitFor({ state: "visible", timeout: 5000 })
      await (
        await must(box.getByRole("radio", { name: /^Viewer/ }), "Viewer radio")
      ).click()
      await page.waitForTimeout(400)
      return "Viewer picked"
    },
  },
  {
    id: "team-remove-dialog",
    flow: "F15",
    route: "/team",
    role: "owner",
    config: "A",
    interaction:
      "a member's ⋯ → Remove (390) / Remove from team… (1280); not confirmed",
    async setup(page) {
      await (
        await must(
          page.getByRole("button", { name: /^Actions for M5 walk user/ }),
          "row ⋯"
        )
      ).click()
      await (
        await must(
          page.getByRole("menuitem", { name: /^Remove/ }),
          "Remove item"
        )
      ).click()
      await dialog(page).waitFor({ state: "visible", timeout: 5000 })
      await page.waitForTimeout(400)
      return "remove dialog open"
    },
  },
  // F16
  {
    id: "design-system",
    flow: "F16",
    route: "/design-system",
    role: "anon",
    config: "A",
  },
  {
    id: "design-system-settings",
    flow: "F16",
    route: "/design-system",
    role: "anon",
    config: "A",
    interaction:
      "scroll to the settings block's title (#ds-settings-title if present, else 'Settings group', else Mail patterns)",
    async setup(page) {
      const title = page.locator("#ds-settings-title").first()
      if ((await title.count()) > 0) {
        // The block is taller than the screen: start the shot at its title.
        await title.evaluate((element) =>
          element.scrollIntoView({ block: "start" })
        )
        await page.evaluate(() => window.scrollBy(0, -72))
        await page.waitForTimeout(300)
        return "#ds-settings-title"
      }
      for (const [selector, note] of [
        ["text=Settings group: card with a footer", "'Settings group' demo"],
        ["#section-notion-mail", "#section-notion-mail"],
      ]) {
        const target = page.locator(selector).first()
        if ((await target.count()) > 0) {
          await scrollTo(page, target)
          await page.evaluate(() => window.scrollBy(0, -16))
          return note
        }
      }
      throw new Error("setup: no settings block on /design-system")
    },
  },
]

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const selected = STATES.filter(
  (s) => s.config === config && (!onlyIds || onlyIds.has(s.id))
)
if (selected.length === 0) throw new Error("No states selected.")

for (const role of new Set(selected.map((s) => s.role))) {
  if (!(role in cookies)) throw new Error(`Unknown role ${role}`)
  const cookie = cookies[role]
  if (!cookie) continue
  const response = await fetch(`${base}/api/session`, { headers: { cookie } })
  const organisation = (await response.json())?.session?.organisationName
  if (organisation !== FIXTURE_ORG) {
    throw new Error(
      `Refusing to shoot: cookie for ${role} resolves to "${organisation}", not the fixture tenant.`
    )
  }
}

// The server's configuration must match --config. `next dev` streams a
// page's notFound() with status 200, so read the settings tab row instead:
// the Billing and Sign-in security links are drawn only when their flag is on.
const settingsHtml = await (
  await fetch(base + "/settings/notifications", {
    headers: { cookie: cookies.owner },
  })
).text()
const billingOn = settingsHtml.includes('href="/settings/billing"')
const mfaOn = settingsHtml.includes('href="/settings/security"')
const billingStatus = billingOn ? "on" : "off"
const securityStatus = mfaOn ? "on" : "off"
if (config === "A" && (billingOn || mfaOn)) {
  throw new Error(
    `Config A needs billing and MFA off (billing ${billingStatus}, security ${securityStatus}).`
  )
}
if (config === "B" && !(billingOn && mfaOn)) {
  throw new Error(
    `Config B needs BILLING_ENABLED and MFA_ENABLED on (billing ${billingStatus}, security ${securityStatus}).`
  )
}

// ---------------------------------------------------------------------------
// Shoot
// ---------------------------------------------------------------------------

await mkdir(out, { recursive: true })
const log = resolve(out, "shots.jsonl")
let cwebp = null
if (webp) {
  try {
    cwebp =
      execFileSync("sh", ["-c", "command -v cwebp"]).toString().trim() || null
  } catch {
    cwebp = null
  }
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"])
const browser = await chromium.launch()

// Warm-up: `next dev` compiles a route and its client chunks on first visit
// and may then reload the page, which would interrupt a setup. Visit every
// selected route once, at both widths, before shooting anything.
if (!arg("no-warm", false)) {
  for (const width of [390, 1280]) {
    const warmContext = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: width < 768,
      isMobile: width < 768,
    })
    if (cookies.owner) {
      const [cookieName, value] = cookies.owner.split("=")
      await warmContext.addCookies([
        { name: cookieName, value, url: base, httpOnly: true, sameSite: "Lax" },
      ])
    }
    const warmPage = await warmContext.newPage()
    for (const route of new Set(selected.map((s) => s.route.split("#")[0]))) {
      await warmPage
        .goto(base + route, { waitUntil: "load", timeout: 90_000 })
        .catch(() => {})
      await warmPage.waitForTimeout(3000)
    }
    await warmContext.close()
  }
}
let failures = 0
try {
  for (const s of selected) {
    for (const v of variants) {
      const mobile = v.width < 768
      const context = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        colorScheme: v.scheme,
        reducedMotion: "reduce",
        hasTouch: mobile,
        isMobile: mobile,
      })
      const blocked = []
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.protocol.startsWith("http") && !LOCAL.has(url.hostname)) {
          blocked.push(url.host)
          return route.abort()
        }
        return route.continue()
      })
      const cookie = cookies[s.role]
      if (cookie) {
        const [name, ...rest] = cookie.split("=")
        await context.addCookies([
          {
            name,
            value: rest.join("="),
            url: base,
            httpOnly: true,
            sameSite: "Lax",
          },
        ])
      }
      const page = await context.newPage()
      const errors = []
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().includes("webpack-hmr")
        )
          errors.push(message.text().slice(0, 240))
      })
      page.on("pageerror", (error) => errors.push(String(error).slice(0, 240)))

      const file = resolve(out, `${s.id}-${v.key}.png`)
      const record = { id: s.id, variant: v.key, role: s.role, route: s.route }
      try {
        let response
        try {
          response = await page.goto(base + s.route, {
            waitUntil: s.networkidle === false ? "load" : "networkidle",
            timeout: 90_000,
          })
        } catch (error) {
          if (!String(error).includes("Timeout")) throw error
          record.gotoNote = "networkidle timed out; shot after load"
        }
        await page.waitForTimeout(settle)
        if (s.setup)
          record.setup = await s.setup(page, { width: v.width, mobile })
        await page.waitForTimeout(300)
        const overflow = await page.evaluate(() => {
          const doc = document.scrollingElement ?? document.documentElement
          const viewport = window.innerWidth
          const offenders = []
          if (doc.scrollWidth > viewport + 1) {
            for (const element of document.querySelectorAll("body *")) {
              const rect = element.getBoundingClientRect()
              if (rect.right > viewport + 1 && rect.width > 0) {
                offenders.push({
                  tag: element.tagName.toLowerCase(),
                  cls: String(element.className).slice(0, 80),
                  right: Math.round(rect.right),
                })
              }
              if (offenders.length >= 6) break
            }
          }
          return { scrollWidth: doc.scrollWidth, viewport, offenders }
        })
        await page.screenshot({
          path: file,
          fullPage: Boolean(s.full) && !s.setup,
        })
        let written = file
        if (cwebp) {
          const target = file.replace(/\.png$/, ".webp")
          execFileSync(cwebp, ["-quiet", "-q", "80", file, "-o", target])
          await rm(file)
          written = target
        }
        Object.assign(record, {
          ok: true,
          file: written.replace(`${out}/`, ""),
          status: response?.status() ?? null,
          url: page.url().replace(base, ""),
          title: await page.title(),
          horizontalOverflow: overflow.scrollWidth > overflow.viewport + 1,
          overflow: overflow.offenders,
          errors,
          blocked: [...new Set(blocked)],
        })
      } catch (error) {
        failures += 1
        Object.assign(record, {
          ok: false,
          error: String(error).split("\n")[0].slice(0, 300),
          url: page.url().replace(base, ""),
          errors,
          blocked: [...new Set(blocked)],
        })
      }
      await appendFile(log, `${JSON.stringify(record)}\n`)
      console.log(
        JSON.stringify({
          id: record.id,
          variant: record.variant,
          ok: record.ok,
          status: record.status,
          url: record.url,
          error: record.error,
        })
      )
      await context.close()
    }
  }
} finally {
  await browser.close()
}
console.log(
  `done: ${selected.length} states x ${variants.length} variants, ${failures} failed`
)
