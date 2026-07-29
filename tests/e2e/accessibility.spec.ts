import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const accessibilityTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
]
const proofSections = [
  "Foundations",
  "Typography",
  "Spacing and radius",
  "Elevation and glass",
  "Controls",
  "Status and feedback",
  "Product compositions",
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

    test("design-system proof", async ({ page }) => {
      await page.goto("/design-system")
      await expect(
        page.getByRole("heading", {
          name: "NabaReview design system",
          level: 1,
        })
      ).toBeVisible()
      for (const section of proofSections) {
        await expect(
          page.getByRole("heading", { name: section, level: 2 })
        ).toBeVisible()
      }
      await expectAccessible(page, `${viewport.name} design-system proof`)
    })

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

    test("analytics", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-analytics-a11y",
              userId: "user-analytics-a11y",
              organisationId: "org-analytics-a11y",
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
              from: "2026-06-29T00:00:00.000Z",
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
              locations: [
                {
                  id: "location-analytics-a11y",
                  name: "Camden",
                  averageRating: 4.6,
                  reviews: 8,
                  responseRate: 88,
                  medianResponseSeconds: 1800,
                  p95ResponseSeconds: 5400,
                  unresolvedComplaints: 1,
                  verificationRejectionRate: 0,
                },
              ],
            },
          })
        }
      )
      await page.goto("/")
      await openNavigationSurface(page, "Analytics", viewport.name === "mobile")
      await expect(
        page.getByRole("heading", { name: "Analytics", level: 1 })
      ).toBeVisible()
      const camdenRow = page.getByRole("row").filter({ hasText: "Camden" })
      await expect(camdenRow).toBeVisible()
      await expect(
        camdenRow.getByRole("progressbar", {
          name: "Response rate for Camden",
        })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} analytics`)
    })

    test("inbox, review detail, and reply editor", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-reviews-a11y",
              userId: "user-reviews-a11y",
              organisationId: "org-reviews-a11y",
              organisationName: "Naba Review",
              displayName: "Alex Morgan",
              email: "alex@example.com",
              role: "owner",
              canPublish: true,
            },
          },
        })
      })
      await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            settings: {
              defaultLanguageCode: "en",
              defaultTimezone: "Europe/London",
            },
          },
        })
      })
      await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            items: [
              {
                id: "review-a11y",
                reviewer: {
                  displayName: "Jordan Lee",
                  isAnonymous: false,
                },
                rating: 5,
                location: { id: "location-a11y", name: "Camden" },
                text: "A thoughtful and accessible review.",
                createTime: "2026-07-28T10:00:00.000Z",
                updateTime: "2026-07-28T10:00:00.000Z",
                detectedLanguageCode: "en",
                languageConfidence: 1,
                workflowStatus: "published",
                verificationStatus: "pass",
                draftBody: "Updated draft reply for Jordan.",
                replyBody: "Published reply for Jordan.",
                draftId: "draft-a11y",
                replyStatus: "published",
                syncStatus: "succeeded",
                googleReplyState: null,
                googlePolicyViolation: null,
              },
            ],
            nextCursor: null,
          },
        })
      })
      await page.route(/\/api\/reviews\/review-a11y$/, async (route) => {
        await route.fulfill({
          json: {
            review: {
              media: [],
              reply: null,
              timeline: [],
            },
          },
        })
      })
      let publishRequestCount = 0
      await page.route(
        /\/api\/reviews\/review-a11y\/publish$/,
        async (route) => {
          publishRequestCount += 1
          await route.fulfill({
            json: {
              status:
                publishRequestCount === 1 ? "published" : "awaiting_approval",
              googleReplyState:
                publishRequestCount === 1 ? "APPROVED" : "PENDING",
            },
          })
        }
      )
      await page.goto("/")
      await expect(
        page.getByRole("heading", { name: "Reviews", level: 1 })
      ).toBeVisible()
      await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible()
      const reviewList = page.getByRole("region", { name: "Review list" })
      await expect(reviewList).toBeVisible()
      const row = reviewList.getByRole("button", { name: /Jordan Lee/ })
      await expect(row).toBeVisible()
      if (viewport.name === "mobile") {
        await expect(
          page.getByRole("region", { name: "Selected review" })
        ).toBeHidden()
        await expectAccessible(page, "mobile review inbox")
        await row.click()
        await expect(reviewList).toBeHidden()
        await expect(
          page
            .locator('section[aria-label="Review list"] button')
            .filter({ hasText: "Jordan Lee" })
        ).toHaveAttribute("aria-current", "true")
        await expect(
          page.getByRole("button", { name: "Back to review list" })
        ).toBeVisible()
      } else {
        await expect(row).toHaveAttribute("aria-current", "true")
      }
      const selectedReview = page.getByRole("region", {
        name: "Selected review",
      })
      await expect(selectedReview).toBeVisible()
      await expect(selectedReview.getByRole("heading").first()).toBeVisible()
      await expect(
        selectedReview.getByRole("textbox", { name: "Reply draft" })
      ).toHaveValue("Updated draft reply for Jordan.")
      const publishedReply = selectedReview
        .getByText(/Published business reply/)
        .locator("..")
      await expect(publishedReply).toContainText("Published reply for Jordan.")
      await expect(publishedReply).not.toContainText(
        "Updated draft reply for Jordan."
      )
      await expect(
        selectedReview.getByRole("button", { name: "Update reply" })
      ).toBeVisible()
      await selectedReview.getByRole("button", { name: "Update reply" }).click()
      await expect(publishedReply).toContainText(
        "Updated draft reply for Jordan."
      )
      await expect(publishedReply).not.toContainText(
        "Published reply for Jordan."
      )
      await selectedReview.getByRole("button", { name: "Update reply" }).click()
      await expect(
        selectedReview.getByRole("button", { name: "Approve and publish" })
      ).toBeVisible()
      await expect(publishedReply).toContainText(
        "Updated draft reply for Jordan."
      )
      await expect(
        selectedReview.getByText(
          "Published replies are public on Google; approval may be required.",
          { exact: true }
        )
      ).toBeVisible()
      await expect(
        selectedReview.getByRole("heading", { name: "Verification" })
      ).toBeVisible()
      await expect(
        selectedReview.getByRole("heading", { name: "Activity" })
      ).toBeVisible()
      await page.waitForTimeout(500)
      await expectAccessible(page, `${viewport.name} review detail and editor`)
      if (viewport.name === "mobile") {
        await page.getByRole("button", { name: "Back to review list" }).click()
        await expect(reviewList).toBeVisible()
        await expect(selectedReview).toBeHidden()
      }
    })

    test("connections", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-connections-a11y",
              userId: "user-connections-a11y",
              organisationId: "org-connections-a11y",
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
        /\/api\/google\/connections(?:\?.*)?$/,
        async (route) => {
          await route.fulfill({
            json: {
              connections: [
                {
                  id: "connection-connections-a11y",
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
      await page.route(/\/api\/google\/accounts(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            accounts: [
              {
                id: "account-connections-a11y",
                googleAccountName: "accounts/123456789",
                accountName: "Naba Review Hospitality",
                type: "ORGANIZATION",
                role: "OWNER",
                permissionLevel: "OWNER_LEVEL",
                isActive: true,
              },
            ],
          },
        })
      })
      await page.route(/\/api\/google\/locations(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            locations: [
              {
                id: "locations/camden-a11y",
                name: "locations/camden-a11y",
                title: "Camden Hotel",
                accountName: "accounts/123456789",
                verified: true,
                storefrontAddress: {
                  addressLines: ["10 Camden High Street"],
                  locality: "London",
                  administrativeArea: "England",
                  postalCode: "NW1 0JH",
                  regionCode: "GB",
                },
              },
            ],
          },
        })
      })
      await page.route(/\/api\/location-links(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            locations: [
              {
                locationId: "location-connections-a11y",
                name: "Camden Hotel",
                timezone: "Europe/London",
                address: {
                  addressLines: ["10 Camden High Street"],
                  locality: "London",
                  administrativeArea: "England",
                  postalCode: "NW1 0JH",
                  regionCode: "GB",
                },
                linkId: "link-connections-a11y",
                externalLocationId: "locations/camden-a11y",
                googleLocationName: "locations/camden-a11y",
                googleTitle: "Camden Hotel",
                verified: true,
              },
            ],
          },
        })
      })
      await page.route(/\/api\/sync\/backfill(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            progress: {
              items: [
                {
                  externalLocationId: "locations/camden-a11y",
                  locationName: "Camden Hotel",
                  status: "succeeded",
                  attemptCount: 1,
                  hasMorePages: false,
                  lastErrorCode: null,
                  startedAt: "2026-07-29T09:00:00.000Z",
                  finishedAt: "2026-07-29T09:01:00.000Z",
                  nextAttemptAt: null,
                },
              ],
              counts: { succeeded: 1 },
              total: 1,
            },
          },
        })
      })
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
      await openNavigationSurface(
        page,
        "Connections",
        viewport.name === "mobile"
      )
      await expect(
        page.getByRole("heading", { name: "Google Business Profile" })
      ).toBeVisible()
      await expect(page.getByLabel("Connection setup progress")).toBeVisible()
      await expect(page.getByText("Naba Review Hospitality")).toBeVisible()
      await expect(
        page.getByLabel("Google location import").getByText("Camden Hotel")
      ).toBeVisible()
      await expect(page.getByLabel("Historical review backfill")).toContainText(
        "Complete"
      )
      await expect(page.getByLabel("Notification management")).toBeVisible()
      await expect(page.getByLabel("Connection management")).toBeVisible()
      await expect(
        page.getByLabel("Connection status and guidance")
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} connections`)
    })

    test("settings", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-settings-a11y",
              userId: "user-settings-a11y",
              organisationId: "org-settings-a11y",
              organisationName: "Naba Review",
              displayName: "Alex Morgan",
              email: "alex@example.com",
              role: "owner",
              canPublish: true,
            },
          },
        })
      })
      await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            settings: {
              approvalRequired: true,
              rawContentRetentionDays: 30,
              defaultLanguageCode: "en",
              defaultTimezone: "Europe/London",
              directPublishConsentAt: null,
            },
          },
        })
      })
      await page.route(/\/api\/members(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            members: [
              {
                userId: "user-settings-a11y",
                email: "alex@example.com",
                displayName: "Alex Morgan",
                role: "owner",
                canPublish: true,
                locations: [],
              },
            ],
          },
        })
      })
      await page.route(/\/api\/location-links(?:\?.*)?$/, async (route) => {
        await route.fulfill({ json: { locations: [] } })
      })
      await page.goto("/")
      await openNavigationSurface(page, "Settings", viewport.name === "mobile")
      await expect(
        page.getByRole("heading", { name: "Reply policy" })
      ).toBeVisible()
      await expect(page.getByText("Team access", { exact: true })).toBeVisible()
      await expect(
        page.getByRole("combobox", { name: "Role for Alex Morgan" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} settings`)
    })
  })
}
