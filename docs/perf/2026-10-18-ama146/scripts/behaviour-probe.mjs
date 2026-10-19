// AMA-146 behaviour + cold first-open probe (scratch; not committed).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, expect } from "@playwright/test"

const base = process.env.APP_URL
const out = process.env.OUT
const runs = Number(process.env.RUNS ?? "1")
mkdirSync(out, { recursive: true })
const state = JSON.parse(readFileSync("test-results/e2e-journey-state.json", "utf8"))
const [cookieName, ...rest] = state.cookie.split("=")
const browser = await chromium.launch()
const results = { firstOpen: [], checks: {} }
const errorsOf = (page, list) => {
  page.on("pageerror", (e) => list.push(String(e).slice(0, 200)))
  page.on("console", (m) => m.type() === "error" && list.push(m.text().slice(0, 200)))
}
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await ctx.addCookies([{ name: cookieName, value: rest.join("="), url: base, httpOnly: true, sameSite: "Lax" }])
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  return { ctx, page }
}
const check = async (name, fn) => {
  try {
    results.checks[name] = { ok: true, ...(await fn()) }
  } catch (error) {
    results.checks[name] = { ok: false, error: String(error).slice(0, 400) }
  }
}

// Cold first open: phone list, wait for quiet, tap the first row, until the
// composer of the opened review is visible.
for (let i = 0; i < runs; i++) {
  const { ctx, page } = await phone()
  const errors = []
  errorsOf(page, errors)
  await page.goto(base + "/inbox", { waitUntil: "load" })
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  const row = page.locator('[data-slot="review-row"]').first()
  const t0 = Date.now()
  await row.tap()
  await expect(page.locator('[data-slot="reply-composer"]').first()).toBeVisible({ timeout: 20_000 })
  const ms = Date.now() - t0
  const backFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-slot"))
  results.firstOpen.push({ ms, url: page.url().replace(base, ""), backFocused, errors })
  await ctx.close()
}

await check("phone deep link renders the review on the server", async () => {
  const res = await fetch(`${base}/inbox?selected=${state.directReview.id}`, { headers: { cookie: state.cookie } })
  const html = await res.text()
  if (!html.includes('data-slot="reply-composer"')) throw new Error("composer not in server HTML")
  return { status: res.status }
})
await check("phone /inbox list HTML has no review pane", async () => {
  const html = await (await fetch(`${base}/inbox`, { headers: { cookie: state.cookie, "user-agent": "Mozilla/5.0 (Linux; Android 10; Mobile)" } })).text()
  return { composerInHtml: html.includes('data-slot="reply-composer"') }
})
await check("desktop /inbox auto-selects and shows the composer", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookieName, value: rest.join("="), url: base, httpOnly: true, sameSite: "Lax" }])
  const page = await ctx.newPage()
  const errors = []
  errorsOf(page, errors)
  await page.goto(base + "/inbox", { waitUntil: "load" })
  await expect(page.locator('[data-slot="reply-composer"]').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForURL(/selected=/, { timeout: 10_000 })
  // j moves to the next review; the pane follows.
  const before = page.url()
  await page.keyboard.press("j")
  await page.waitForFunction((u) => location.href !== u, before, { timeout: 5000 })
  await expect(page.locator('[data-slot="reply-composer"]').first()).toBeVisible()
  await ctx.close()
  return { errors }
})
await check("phone Back returns to the list and refocuses the row", async () => {
  const { ctx, page } = await phone()
  await page.goto(base + "/inbox", { waitUntil: "load" })
  await page.waitForLoadState("networkidle")
  await page.locator('[data-slot="review-row"]').first().tap()
  await expect(page.locator('[data-slot="reply-composer"]').first()).toBeVisible({ timeout: 20_000 })
  await page.locator('[data-slot="back-control"]:visible').first().tap()
  await expect(page.locator('[data-slot="review-row"]').first()).toBeVisible()
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-slot"))
  await ctx.close()
  return { focused, url: page.url().replace(base, "") }
})
await check("listings HTML has the health pills", async () => {
  const html = await (await fetch(`${base}/listings`, { headers: { cookie: state.cookie } })).text()
  return { notCheckedInHtml: html.includes("Not checked") }
})
await check("profile review sheet opens, closes and returns focus", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookieName, value: rest.join("="), url: base, httpOnly: true, sameSite: "Lax" }])
  const page = await ctx.newPage()
  const errors = []
  errorsOf(page, errors)
  await page.goto(`${base}/listings/${state.primaryLocationId}/profile`, { waitUntil: "load" })
  const name = page.getByRole("textbox", { name: "Business name", exact: true })
  await expect(page.getByRole("button", { name: "Check Google now" })).toBeVisible({ timeout: 20_000 })
  await expect(name).toBeEditable({ timeout: 20_000 })
  await page.waitForLoadState("networkidle")
  await name.fill((await name.inputValue()) + " AMA146")
  const review = page.getByRole("button", { name: "Review changes", exact: true })
  await expect(review).toBeEnabled({ timeout: 15_000 })
  await review.focus()
  await review.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  const title = await dialog.getByRole("heading").first().innerText()
  const rows = await dialog.innerText()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim())
  // Open again (already loaded) and close.
  await review.click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await ctx.close()
  return { title, mentionsChange: rows.includes("AMA146"), focusedText, errors }
})
writeFileSync(join(out, "behaviour.json"), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 1))
await browser.close()
