import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

import { pageSettled, transitionsSettled } from "./helpers/settled"
import { pageWorkspaceMode } from "./helpers/workspace-mode"

/** The health chip's words: agency wording, then business (lib/clients/health.ts). */
const HEALTH_WORDS =
  /All clients up to date|clients? needs? (?:action|attention)|data delayed|Importing reviews|No clients yet|Not connected yet|Needs action|Needs attention|All in sync/

/** "Inbox", or "Inbox, 2 need a reply" / "Inbox, 1 awaiting your approval" (components/app-shell/use-needs-reply-count.ts). */
const INBOX_TAB =
  /^Inbox(, \d+ (?:needs? a reply|awaiting your approval|needs? your attention: \d+ to reply, \d+ to approve))?$/

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/**
 * The page is rendered and still. /design-system is a showcase: it shows
 * skeletons and busy controls on purpose, so no "nothing is busy" state ever
 * arrives there. It is ready when its heading is up and nothing is moving.
 */
async function settle(page: Page, path: string) {
  if (path !== "/design-system") return pageSettled(page)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await transitionsSettled(page)
}

test.describe("rebuild foundation", () => {
  // The shell's two shapes (components/app-shell/app-shell.tsx): the phone
  // app bar and tab bar below 768px, the sidebar and toolbar from 768px. In
  // both the skip link is the first Tab stop and the one <main> its target.
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desk", width: 1280, height: 800 },
  ]) {
    test(`boots to the shell with sound structure (${viewport.name})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto("/inbox")
      await expect(
        page.getByRole("heading", { level: 1, name: "Inbox" })
      ).toBeVisible()
      expect(await page.getByRole("main").count()).toBe(1)
      await expect(page.locator("main#main")).toHaveCount(1)
      // Skip link is the first tab stop and works
      await page.keyboard.press("Tab")
      const skip = page.getByRole("link", { name: "Skip to content" })
      await expect(skip).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(page.locator("#main")).toBeFocused()
    })
  }

  test("the health chip reports the agency, not one connection", async ({
    page,
  }) => {
    // The old chip collapsed every connection in the organisation to
    // connected/disconnected, which hid one client's broken login behind
    // another client's working one. It now reports a count.
    await page.goto("/inbox")
    // The chip is the desk toolbar's link (from 768px); the home page's own
    // "Work by client" empty state can say "No clients yet" too, so match
    // the chip rather than any text on the page.
    const chip = page.locator(
      'header[data-slot="toolbar"] [data-slot="health-chip"]'
    )
    await expect(chip).toBeVisible({ timeout: 10_000 })
    // Agency wording, then the business wording (lib/clients/health.ts).
    await expect(chip).toHaveAccessibleName(HEALTH_WORDS)
  })

  test("phones carry health as a row in More, not a chip in the bar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/inbox")
    await expect(
      page.getByRole("heading", { level: 1, name: "Inbox" })
    ).toBeVisible()
    await expect(page.locator('[data-slot="health-chip"]')).toBeHidden()
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "More", exact: true })
      .click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toBeVisible()
    const row = sheet.locator('[data-slot="health-row"]')
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText("Connections")
    await expect(row).toContainText(HEALTH_WORDS)
  })

  test("phones navigate with a tab bar and a More sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const business = (await pageWorkspaceMode(page)) === "business"
    await page.goto("/inbox")
    await expect(
      page.getByRole("heading", { level: 1, name: "Inbox" })
    ).toBeVisible()
    // No hamburger and no drawer any more: the destinations are on screen.
    await expect(
      page.getByRole("button", { name: "Open navigation" })
    ).toHaveCount(0)
    await expect(page.locator('aside[aria-label="Sidebar"]')).toBeHidden()
    await expect(page.locator('header[data-slot="app-bar"]')).toBeVisible()
    await expect(page.locator('header[data-slot="toolbar"]')).toBeHidden()

    const tabs = page.getByRole("navigation", { name: "Primary" })
    await expect(tabs).toHaveAttribute("data-slot", "tab-bar")
    // The Inbox tab's name carries the needs-reply count when there is one.
    await expect(tabs.getByRole("link", { name: INBOX_TAB })).toBeVisible()
    await expect(tabs.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    await expect(
      tabs.getByRole("link", { name: "Listings", exact: true })
    ).toBeVisible()
    await expect(
      tabs.getByRole("link", { name: "Reports", exact: true })
    ).toBeVisible()
    // A business has no Clients layer; an agency does.
    await expect(
      tabs.getByRole("link", { name: "Clients", exact: true })
    ).toHaveCount(business ? 0 : 1)

    // Notifications is a tab only when a slot is free (a business with
    // scheduling off); otherwise it is a row in the sheet. Never both.
    const notifications = /^Notifications(, \d+ unread)?$/
    const notificationTabs = await tabs
      .getByRole("link", { name: notifications })
      .count()
    expect(notificationTabs).toBeLessThanOrEqual(1)

    const more = tabs.getByRole("button", { name: "More", exact: true })
    await expect(more).toHaveAttribute("aria-haspopup", "dialog")
    await expect(more).toHaveAttribute("aria-expanded", "false")
    await more.click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toBeVisible()
    // The modal sheet hides the rest of the page from the accessibility
    // tree, so the open trigger is read by its markup.
    await expect(
      page.locator('nav[data-slot="tab-bar"] button[aria-haspopup="dialog"]')
    ).toHaveAttribute("aria-expanded", "true")
    const rest = sheet.getByRole("navigation", { name: "More" })
    await expect(
      rest.getByRole("link", { name: "Settings", exact: true })
    ).toBeVisible()
    await expect(rest.getByRole("link", { name: notifications })).toHaveCount(
      1 - notificationTabs
    )
    // Destinations already on a tab are not repeated in the sheet.
    await expect(
      rest.getByRole("link", { name: "Listings", exact: true })
    ).toHaveCount(0)
    const account = sheet.getByRole("region", { name: "Account" })
    await expect(account.getByRole("radio", { name: "System" })).toBeVisible()
    await expect(
      account.getByRole("button", { name: "Sign out", exact: true })
    ).toBeVisible()
    await expect(
      account.getByRole("button", { name: "Sign out everywhere…", exact: true })
    ).toBeVisible()

    // Closing returns focus to the More tab.
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(more).toBeFocused()

    // A row in the sheet navigates and the sheet goes away.
    await more.click()
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("navigation", { name: "More" })
      .getByRole("link", { name: "Settings", exact: true })
      .click()
    await expect.poll(() => new URL(page.url()).pathname).toBe("/settings")
    await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0)
    // Settings lives behind More, so More reads as the current tab.
    await expect(more).toHaveAttribute("data-current", "true")
  })

  test("responses carry conservative security headers", async ({ page }) => {
    const response = await page.goto("/inbox")
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
    test(`axe clean on /inbox and /design-system (${theme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme })
      for (const path of ["/inbox", "/design-system"]) {
        await page.goto(path)
        await settle(page, path)
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${path} ${theme} wcag`).toEqual([])
        const bestPractice = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          bestPractice.violations.filter((v) =>
            [
              "landmark-no-duplicate-main",
              "landmark-main-is-top-level",
              "heading-order",
              "page-has-heading-one",
            ].includes(v.id)
          ),
          `${path} ${theme} structure`
        ).toEqual([])
      }
    })
  }
})

// RC3 (FINAL-QA #4, #19, #21): checks that need a real layout engine.
test.describe("foundation layout and theme (RC3)", () => {
  // The built CSS is minified, which may write `oklch(0.18 …)` as
  // `oklch(18% …)`: read both as a 0–1 lightness.
  const lightness = (value: string) => {
    const match = /oklch\(\s*([\d.]+)(%?)/.exec(value)
    if (!match) throw new Error(`not oklch: ${value}`)
    return Number(match[1]) / (match[2] ? 100 : 1)
  }

  for (const width of [390, 320]) {
    test(`/design-system never scrolls sideways at ${width}px (#21)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto("/design-system")
      await settle(page, "/design-system")
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    })

    test(`a left-aligned sheet header keeps Close clear of its words at ${width}px (#4)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto("/design-system")
      await page.getByRole("button", { name: "Choose a client" }).click()
      const sheet = page.getByRole("dialog", { name: "Choose a client" })
      await expect(sheet).toBeVisible()
      const close = await sheet
        .getByRole("button", { name: "Close" })
        .boundingBox()
      const words = await sheet
        .locator('[data-slot="sheet-header-title"]')
        .boundingBox()
      expect(close && words).toBeTruthy()
      // Side by side, never on top of each other.
      expect(words!.x + words!.width).toBeLessThanOrEqual(close!.x)
    })
  }

  test("without script, a system-dark visitor still gets the dark theme and charcoal (#19, #3)", async ({
    browser,
  }) => {
    const baseURL = test.info().project.use.baseURL
    for (const colorScheme of ["dark", "light"] as const) {
      const context = await browser.newContext({
        baseURL,
        javaScriptEnabled: false,
        colorScheme,
      })
      const page = await context.newPage()
      await page.goto("/sign-in")
      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return {
          theme:
            document.documentElement.classList.contains("dark") ||
            document.documentElement.classList.contains("light"),
          canvas: style.getPropertyValue("--np-surface-canvas"),
          charcoal: style.getPropertyValue("--np-charcoal"),
          inkOnCharcoal: style.getPropertyValue("--np-ink-on-charcoal"),
        }
      })
      // No script ran, so no theme class: the system scheme decides.
      expect(tokens.theme).toBe(false)
      if (colorScheme === "dark")
        expect(lightness(tokens.canvas)).toBeLessThan(0.3)
      else expect(lightness(tokens.canvas)).toBeGreaterThan(0.9)
      // Charcoal is the dark counter-surface in both schemes, never a light slab.
      expect(lightness(tokens.charcoal)).toBeLessThan(0.4)
      expect(lightness(tokens.inkOnCharcoal)).toBeGreaterThan(0.9)
      await context.close()
    }
  })

  test("with script, dark is a class on <html> before hydration, and charcoal stays dark (#19, #3)", async ({
    browser,
  }) => {
    const baseURL = test.info().project.use.baseURL
    const context = await browser.newContext({ baseURL, colorScheme: "dark" })
    const page = await context.newPage()
    // Recorded the moment the document is parsed, ahead of React.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        ;(window as unknown as { __themeAtParse: string }).__themeAtParse =
          document.documentElement.className
      })
    })
    await page.goto("/design-system")
    const atParse = await page.evaluate(
      () => (window as unknown as { __themeAtParse: string }).__themeAtParse
    )
    expect(atParse.split(/\s+/)).toContain("dark")
    const charcoal = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--np-charcoal"
      )
    )
    expect(lightness(charcoal)).toBeLessThan(0.4)
    await context.close()
  })
})
