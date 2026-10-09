// Screenshot sweep for rendered-layout verification against the visual
// fixtures (see fixture-server.ts). Not part of the e2e suite.
//
//   node tests/visual/shoot.mjs --route /listings/{loc}/hours \
//     --widths 320,390,768,1280 --role owner --out <dir> [--browser webkit]
//     [--theme dark] [--height 800] [--full] [--wait 1500] [--name hours]
//
// --route may also be an absolute file:// or http(s) URL (for rendering the
// Open Design reference pages at the same widths); cookies are then unused.
// Placeholders: {loc} primary location, {loc2} approval location,
// {client} seeded client, {review} direct review.
// Roles: owner (default), viewer, admin, member, member-unassigned,
// requester, approver, anon.
//
// For every width it prints one JSON line: the file written, whether the
// page scrolls horizontally (document wider than the viewport), the widest
// offending elements when it does, and any console errors.
import { mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { chromium, webkit } from "@playwright/test"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = argv[index + 1]
  return next === undefined || next.startsWith("--") ? true : next
}

// localhost, not 127.0.0.1: the Turbopack dev client only hydrates when its
// HMR websocket is accepted, and next dev accepts it from localhost only.
const base = arg("base", "http://localhost:3200")
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
const route = String(arg("route", "/inbox"))
  .replaceAll("{loc}", state.primaryLocationId)
  .replaceAll("{loc2}", state.approvalReview.locationId)
  .replaceAll("{client}", state.clientId)
  .replaceAll("{review}", state.directReview.id)
const role = String(arg("role", "owner"))
const widths = String(arg("widths", "390,1280"))
  .split(",")
  .map((value) => Number.parseInt(value, 10))
const height = Number.parseInt(String(arg("height", "860")), 10)
const out = resolve(String(arg("out", "test-results/visual")))
const browserName = String(arg("browser", "chromium"))
const theme = String(arg("theme", "light"))
const wait = Number.parseInt(String(arg("wait", "1200")), 10)
const full = Boolean(arg("full", false))
const name =
  String(arg("name", "")) ||
  route
    .replace(/^.*\/(?=[^/]+\.html)/, "ref-")
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .slice(0, 60) ||
  "root"

if (!(role in cookies)) throw new Error(`Unknown role ${role}`)
await mkdir(out, { recursive: true })

// Refuse to run unless the cookie resolves to the fixture tenant: `next dev`
// signs any request without a valid session in as the local owner, and the
// sweep must never act as the real organisation.
const external = /^(file|https?):\/\//.test(route)
if (!external) {
  const cookie = cookies[role]
  const response = await fetch(`${base}/api/session`, {
    headers: cookie ? { cookie } : {},
  })
  const organisation = (await response.json())?.session?.organisationName
  if (cookie && organisation !== "Sprint 5 Journey tenant") {
    throw new Error(
      `Refusing to shoot: cookie for ${role} resolves to "${organisation}", not the fixture tenant. Restart the visual-fixtures server.`
    )
  }
}

const browser = await (browserName === "webkit" ? webkit : chromium).launch()
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme === "dark" ? "dark" : "light",
      reducedMotion: "reduce",
      hasTouch: width < 768,
      isMobile: browserName !== "webkit" && width < 768,
    })
    const cookie = cookies[role]
    if (cookie) {
      const [cookieName, value] = cookie.split("=")
      await context.addCookies([
        { name: cookieName, value, url: base, httpOnly: true, sameSite: "Lax" },
      ])
    }
    const page = await context.newPage()
    const errors = []
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("webpack-hmr"))
        errors.push(message.text().slice(0, 240))
    })
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 240)))
    const response = await page.goto(external ? route : base + route, {
      waitUntil: external ? "load" : "networkidle",
    })
    await page.waitForTimeout(wait)
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
    const file = resolve(out, `${name}-${browserName}-${theme}-${width}.png`)
    await page.screenshot({ path: file, fullPage: full })
    console.log(
      JSON.stringify({
        file,
        width,
        status: response?.status(),
        url: page.url().replace(base, ""),
        horizontalOverflow: overflow.scrollWidth > overflow.viewport + 1,
        overflow: overflow.offenders,
        errors,
      })
    )
    await context.close()
  }
} finally {
  await browser.close()
}
