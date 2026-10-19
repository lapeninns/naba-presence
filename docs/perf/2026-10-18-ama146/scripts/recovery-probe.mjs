// AMA-146 recovery: the pane's chunk fails; Back, pick another review once the network is back.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, expect } from "@playwright/test"
const base = process.env.APP_URL, out = process.env.OUT
mkdirSync(out, { recursive: true })
const state = JSON.parse(readFileSync("test-results/e2e-journey-state.json", "utf8"))
const [n, ...r] = state.cookie.split("=")
const browser = await chromium.launch()
const res = {}
for (const how of ["try-again", "another-review"]) {
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
    await ctx.addCookies([{ name: n, value: r.join("="), url: base, httpOnly: true, sameSite: "Lax" }])
    const page = await ctx.newPage()
    await page.goto(base + "/inbox?queue=all", { waitUntil: "load" })
    const rows = page.locator('[data-slot="review-row"]')
    await expect(rows.first()).toBeVisible()
    const blocked = []
    await page.route("**/_next/static/chunks/**", (q) => { blocked.push(q.request().url().split("/").pop()); return q.abort() })
    await page.waitForTimeout(5000)
    await rows.first().tap()
    await expect(page.getByText("This review could not be shown.")).toBeVisible({ timeout: 15000 })
    await page.unroute("**/_next/static/chunks/**")
    if (how === "try-again") {
      await page.getByRole("button", { name: "Try again" }).tap()
    } else {
      await page.locator('[data-slot="back-control"]:visible').first().tap()
      await expect(rows.nth(1)).toBeVisible()
      await rows.nth(1).tap()
    }
    await expect(page.locator('[data-slot="reply-composer"]').first()).toBeVisible({ timeout: 15000 })
    res[how] = { ok: true, blocked: [...new Set(blocked)] }
    await ctx.close()
  } catch (e) { res[how] = { ok: false, error: String(e).slice(0, 400) } }
}
writeFileSync(join(out, "recovery.json"), JSON.stringify(res, null, 2))
console.log(JSON.stringify(res, null, 1))
await browser.close()
