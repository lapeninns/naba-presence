import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const accessibilityTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
]

async function expectAccessible(page: Page, surface: string) {
  const results = await new AxeBuilder({ page })
    .withTags(accessibilityTags)
    .analyze()
  expect(
    results.violations,
    `${surface} accessibility violations:\n${results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`
      )
      .join("\n")}`
  ).toEqual([])
}

async function openNavigationSurface(
  page: Page,
  name: string,
  mobile: boolean
) {
  if (mobile) {
    await page.getByRole("button", { name: "Toggle navigation" }).click()
  }
  await page.getByRole("button", { name, exact: true }).click()
  if (mobile) {
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden()
  }
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} WCAG 2.2 AA`, () => {
    test.use({ viewport })

    test("application shell", async ({ page }) => {
      await page.goto("/")
      if (viewport.name === "desktop") {
        await expect(page.locator('[data-variant="floating"]')).toBeVisible()
      } else {
        await page.getByRole("button", { name: "Toggle navigation" }).click()
        await expect(
          page.getByRole("dialog", { name: "Sidebar" })
        ).toBeVisible()
      }
      await expect(
        page.getByRole("navigation", { name: "Primary" })
      ).toBeVisible()
      if (viewport.name === "mobile") {
        await page.waitForTimeout(350)
      }
      await expectAccessible(page, `${viewport.name} application shell`)
    })

    test("overview", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-overview-a11y",
              userId: "user-overview-a11y",
              organisationId: "org-overview-a11y",
              organisationName: "Naba Review",
              displayName: "Alex Morgan",
              email: "alex@example.com",
              role: "owner",
              canPublish: true,
            },
          },
        })
      })
      await page.route(
        /\/api\/analytics\/overview(?:\?.*)?$/,
        async (route) => {
          await route.fulfill({
            json: {
              from: "2026-07-22T00:00:00.000Z",
              to: "2026-07-29T00:00:00.000Z",
              summary: {
                reviewVolume: 8,
                averageRating: 4.6,
                responseRate: 88,
                unresolvedComplaints: 1,
                verificationFailures: 0,
                verificationRejectionRate: 0,
                medianResponseSeconds: 1800,
                p95ResponseSeconds: 5400,
              },
              series: [
                {
                  period: "2026-07-29T00:00:00.000Z",
                  reviews: 8,
                  replies: 7,
                  averageRating: 4.6,
                },
              ],
              locations: [],
            },
          })
        }
      )
      await page.route(
        /\/api\/google\/connections(?:\?.*)?$/,
        async (route) => {
          await route.fulfill({
            json: {
              connections: [
                {
                  id: "connection-overview-a11y",
                  googleEmail: "reviews@example.com",
                  status: "active",
                  scope: "https://www.googleapis.com/auth/business.manage",
                  notificationsEnabled: true,
                  lastRefreshAt: "2026-07-29T09:00:00.000Z",
                  lastErrorCode: null,
                  reconnectRequired: false,
                  createdAt: "2026-07-01T09:00:00.000Z",
                },
              ],
            },
          })
        }
      )
      await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            settings: {
              approvalRequired: true,
              rawContentRetentionDays: 30,
              defaultLanguageCode: "en",
              defaultTimezone: "Europe/London",
            },
          },
        })
      })
      await page.goto("/")
      await openNavigationSurface(page, "Overview", viewport.name === "mobile")
      await expect(
        page.getByRole("heading", {
          name: /Good (morning|afternoon|evening)/,
        })
      ).toBeVisible()
      await expect(
        page.getByText("Google connection", { exact: true })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} overview`)
    })

    test("inbox, review detail, and reply editor", async ({ page }) => {
      await page.goto("/")
      const row = page
        .getByRole("region", { name: "Review list" })
        .getByRole("button")
        .first()
      await expect(row).toBeVisible()
      if (viewport.name === "mobile") {
        await expectAccessible(page, "mobile review inbox")
        await row.click()
      }
      await expect(
        page
          .getByRole("region", { name: "Selected review" })
          .getByRole("heading")
          .first()
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} review detail and editor`)
    })

    test("connections", async ({ page }) => {
      await page.goto("/")
      await openNavigationSurface(
        page,
        "Connections",
        viewport.name === "mobile"
      )
      await expect(
        page.getByRole("heading", { name: "Google Business Profile" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} connections`)
    })

    test("settings", async ({ page }) => {
      await page.goto("/")
      await openNavigationSurface(page, "Settings", viewport.name === "mobile")
      await expect(
        page.getByRole("heading", { name: "Reply policy" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} settings`)
    })
  })
}
