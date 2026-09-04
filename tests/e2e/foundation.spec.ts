import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

test.describe("rebuild foundation", () => {
  test("boots to the shell with sound structure", async ({ page }) => {
    await page.goto("/home")
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
    expect(await page.getByRole("main").count()).toBe(1)
    // Skip link is the first tab stop and works
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to content" })
    await expect(skip).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("#main")).toBeFocused()
  })

  test("the health chip reports the agency, not one connection", async ({ page }) => {
    // The old chip collapsed every connection in the organisation to
    // connected/disconnected, which hid one client's broken login behind
    // another client's working one. It now reports a count.
    await page.goto("/home")
    await expect(
      page.getByText(
        /All clients connected|clients? needs? attention|Importing reviews|No clients yet|Not connected yet/
      )
    ).toBeVisible({ timeout: 10_000 })
  })

  test("mobile nav opens as a dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/home")
    await page.getByRole("button", { name: "Open navigation" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "Inbox" })
    ).toBeVisible()
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "Clients" })
    ).toBeVisible()
  })

  test("responses carry conservative security headers", async ({ page }) => {
    const response = await page.goto("/home")
    const headers = response!.headers()
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["x-frame-options"]).toBe("DENY")
    const csp = headers["content-security-policy"]
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    // R1: Google-hosted thumbnails must be allowed, or client-rendered <img> break.
    expect(csp).toContain("googleusercontent.com")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean on /home and /design-system (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      for (const path of ["/home", "/design-system"]) {
        await page.goto(path)
        await page.waitForLoadState("networkidle")
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${path} ${theme} wcag`).toEqual([])
        const bestPractice = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          bestPractice.violations.filter((v) =>
            ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"].includes(v.id)
          ),
          `${path} ${theme} structure`
        ).toEqual([])
      }
    })
  }
})
