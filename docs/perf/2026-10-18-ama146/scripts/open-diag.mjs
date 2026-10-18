import { readFileSync } from "node:fs"
import { chromium, expect } from "@playwright/test"
const base = process.env.APP_URL
const state = JSON.parse(readFileSync("test-results/e2e-journey-state.json", "utf8"))
const [n, ...r] = state.cookie.split("=")
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
await ctx.addCookies([{ name: n, value: r.join("="), url: base, httpOnly: true, sameSite: "Lax" }])
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send("Network.enable")
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
let t0 = 0
page.on("request", (q) => console.log(`${t0 ? Date.now() - t0 : "pre"} REQ ${q.url().replace(base, "").slice(0, 90)}`))
page.on("requestfinished", (q) => t0 && console.log(`${Date.now() - t0} DONE ${q.url().replace(base, "").slice(0, 90)}`))
await page.goto(base + "/inbox", { waitUntil: "load" })
await page.waitForLoadState("networkidle")
await page.waitForTimeout(1500)
console.log("---- tap")
t0 = Date.now()
await page.locator('[data-slot="review-row"]').first().tap()
const watch = async (sel, label) => { await expect(page.locator(sel).first()).toBeVisible({ timeout: 20000 }); console.log(`${Date.now() - t0} VISIBLE ${label}`) }
await Promise.all([watch('[role="status"]:has-text("Loading the review")', "pane loading fallback").catch(() => console.log("no fallback seen")), watch('[data-slot="reply-composer"]', "composer"), watch('[data-slot="back-control"]', "back")])
await browser.close()
