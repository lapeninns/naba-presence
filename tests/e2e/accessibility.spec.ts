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

async function mockReviewWorkspace(
  page: Page,
  options: { disconnected?: boolean } = {}
) {
  let countsShouldFail = false
  await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        session: {
          sessionId: "session-review-state-a11y",
          userId: "user-review-state-a11y",
          organisationId: "org-review-state-a11y",
          organisationName: "Naba Presence",
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
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    if (countsShouldFail) {
      await route.abort("failed")
      return
    }
    await route.fulfill({
      json: {
        total: 1,
        byStatus: {
          new: 0,
          drafted: 0,
          verified: 0,
          awaiting_approval: 0,
          publish_requested: 0,
          published: 1,
          rejected: 0,
          failed: 0,
          escalated: 0,
        },
      },
    })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: "review-state-a11y",
            reviewer: { displayName: "Jordan Lee", isAnonymous: false },
            rating: 5,
            location: { id: "location-state-a11y", name: "Camden" },
            text: "A thoughtful and accessible review.",
            createTime: "2026-07-28T10:00:00.000Z",
            updateTime: "2026-07-28T10:00:00.000Z",
            detectedLanguageCode: "en",
            languageConfidence: 1,
            workflowStatus: "published",
            verificationStatus: "pass",
            draftBody: "Thank you for your thoughtful review.",
            replyBody: "Thank you for your thoughtful review.",
            draftId: "draft-state-a11y",
            replyStatus: "published",
            syncStatus: "succeeded",
            googleReplyState: "APPROVED",
            googlePolicyViolation: null,
          },
        ],
        nextCursor: null,
      },
    })
  })
  await page.route(/\/api\/reviews\/review-state-a11y$/, async (route) => {
    await route.fulfill({
      json: {
        review: {
          media: [],
          reply: {
            publishStatus: "published",
            googleReplyState: "APPROVED",
            googlePolicyViolation: null,
          },
          timeline: [],
        },
      },
    })
  })
  await page.route(
    /\/api\/google\/connections(?:\?.*)?$/,
    async (route) => {
      await route.fulfill({
        json: {
          connections: options.disconnected
            ? []
            : [
                {
                  id: "connection-review-state-a11y",
                  googleEmail: "reviews@example.com",
                  status: "active",
                  scope:
                    "https://www.googleapis.com/auth/business.manage",
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
  await page.route(/\/api\/location-links(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        locations: [{ id: "location-state-a11y", name: "Camden" }],
      },
    })
  })
  await page.route(/\/api\/organisations(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [] } })
  })
  return {
    failCounts() {
      countsShouldFail = true
    },
  }
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} WCAG 2.2 AA`, () => {
    test.use({ viewport })

    test("design-system proof", async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("theme", "light"))
      await page.goto("/design-system")
      await expect(
        page.getByRole("heading", {
          name: "NabaPresence design system",
          level: 1,
        })
      ).toBeVisible()
      const sectionHeadings = page.getByRole("heading", { level: 2 })
      await expect(sectionHeadings).toHaveCount(7)
      await expect(sectionHeadings).toHaveText(proofSections)
      for (const section of proofSections) {
        await expect(
          page.getByRole("heading", { name: section, level: 2 })
        ).toBeVisible()
      }
      await expectAccessible(page, `${viewport.name} design-system proof`)
      await page.getByRole("button", { name: "Toggle theme" }).click()
      await expect(page.locator("html")).toHaveClass(/dark/)
      if (viewport.name === "desktop") {
        await expectAccessible(page, "dark desktop design-system proof")
      }
    })

    test("application shell", async ({ page }) => {
      await page.goto("/reviews")
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

    test("sign-in", async ({ page }) => {
      await page.goto("/sign-in")
      await expect(
        page
          .locator("form")
          .getByRole("button", { name: "Sign in", exact: true })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} sign-in`)
      await page
        .getByLabel("Account action")
        .getByRole("button", { name: "Create account", exact: true })
        .click()
      await expect(page.getByLabel("Confirm password")).toBeVisible()
      await page.waitForTimeout(250)
      await expectAccessible(page, `${viewport.name} registration`)
    })

    test("password recovery", async ({ page }) => {
      await page.goto("/forgot-password")
      await expect(
        page.getByRole("heading", { name: "Reset your password" })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} forgot password`)

      await page.goto(
        "/reset-password?token_hash=recovery-token-hash-for-a11y"
      )
      await expect(page.getByLabel("Confirm password")).toBeVisible()
      await expectAccessible(page, `${viewport.name} reset password`)
    })

    test("invitation", async ({ page }) => {
      await page.route(
        /\/api\/invitations\/invite-token-a11y(?:\?.*)?$/,
        async (route) => {
          await route.fulfill({
            json: {
              organisationName: "Naba Presence",
              email: "invitee@example.com",
              expired: false,
            },
          })
        }
      )
      await page.goto("/invite/invite-token-a11y")
      await expect(
        page.getByRole("heading", { name: "Join Naba Presence" })
      ).toBeVisible()
      await expect(
        page
          .locator("form")
          .getByRole("button", { name: "Create account", exact: true })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} invitation`)
    })

    test("overview", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-overview-a11y",
              userId: "user-overview-a11y",
              organisationId: "org-overview-a11y",
              organisationName: "Naba Presence",
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
              timezone: "Europe/London",
              summary: {
                reviewVolume: 8,
                averageRating: 4.6,
                responseRate: 88,
                unresolvedComplaints: 1,
                verificationFailures: 0,
                verificationRejectionRate: 0,
                medianFirstResponseSeconds: 1800,
                p95FirstResponseSeconds: 5400,
                medianLatestEditSeconds: 2400,
              },
              series: [
                {
                  period: "2026-07-29T00:00:00.000Z",
                  reviewCount: 8,
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
      await page.goto("/overview")
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
              organisationName: "Naba Presence",
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
              timezone: "Europe/London",
              summary: {
                reviewVolume: 8,
                averageRating: 4.6,
                responseRate: 88,
                unresolvedComplaints: 1,
                verificationFailures: 0,
                verificationRejectionRate: 0,
                medianFirstResponseSeconds: 1800,
                p95FirstResponseSeconds: 5400,
                medianLatestEditSeconds: 2400,
              },
              series: [
                {
                  period: "2026-07-29T00:00:00.000Z",
                  reviewCount: 8,
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
                  medianFirstResponseSeconds: 1800,
                  p95FirstResponseSeconds: 5400,
                  medianLatestEditSeconds: 2400,
                  unresolvedComplaints: 1,
                  verificationRejectionRate: 0,
                },
              ],
            },
          })
        }
      )
      await page.goto("/analytics")
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
              organisationName: "Naba Presence",
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
      await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            total: 1,
            byStatus: {
              new: 0,
              drafted: 0,
              verified: 0,
              awaiting_approval: 0,
              publish_requested: 0,
              published: 1,
              rejected: 0,
              failed: 0,
              escalated: 0,
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
                  id: "connection-reviews-a11y",
                  googleEmail: "reviews@example.com",
                  status: "active",
                  scope:
                    "https://www.googleapis.com/auth/business.manage",
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
      await page.route(/\/api\/location-links(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            locations: [{ id: "location-a11y", name: "Camden" }],
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
      await page.goto("/reviews")
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
      await expect(
        selectedReview.getByRole("combobox", { name: "Reply language" })
      ).toBeVisible()
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

    test("stale review data banner", async ({ page }) => {
      const controls = await mockReviewWorkspace(page)
      await page.goto("/reviews")
      await expect(
        page.getByRole("button", { name: "Live data" })
      ).toBeVisible()
      controls.failCounts()
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(page.getByText("Data may be out of date")).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Retry", exact: true })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} stale review data`)
    })

    test("disconnected review data state", async ({ page }) => {
      await mockReviewWorkspace(page, { disconnected: true })
      await page.goto("/reviews")
      await expect(
        page.getByText("No active Google connection")
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: "Manage connections" })
      ).toHaveAttribute("href", "/connections")
      await expectAccessible(page, `${viewport.name} disconnected review data`)
    })

    test("delete published reply confirmation", async ({ page }) => {
      await mockReviewWorkspace(page)
      await page.goto("/reviews")
      const reviewList = page.getByRole("region", { name: "Review list" })
      if (viewport.name === "mobile") {
        await reviewList.getByRole("button", { name: /Jordan Lee/ }).click()
      }
      await page.getByRole("button", { name: "Review actions" }).click()
      await page
        .getByRole("menuitem", { name: "Delete published reply" })
        .click()
      const dialog = page.getByRole("alertdialog", {
        name: "Delete published reply?",
      })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(
        "This removes the reply on Google. The review returns to the inbox as unreplied."
      )
      await expectAccessible(
        page,
        `${viewport.name} delete published reply dialog`
      )
    })

    test("connections", async ({ page }) => {
      await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            session: {
              sessionId: "session-connections-a11y",
              userId: "user-connections-a11y",
              organisationId: "org-connections-a11y",
              organisationName: "Naba Presence",
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
                accountName: "Naba Presence Hospitality",
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
                googleLocationName: "locations/camden-a11y",
                title: "Camden Hotel",
                accountName: "accounts/123456789",
                verified: true,
                address:
                  "10 Camden High Street, London, England, NW1 0JH",
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
      await page.goto("/connections")
      await expect(
        page.getByRole("heading", { name: "Google Business Profile" })
      ).toBeVisible()
      await expect(page.getByLabel("Connection setup progress")).toBeVisible()
      await expect(page.getByText("Naba Presence Hospitality")).toBeVisible()
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
              organisationName: "Naba Presence",
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
      await page.route(/\/api\/invitations(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            items: [
              {
                id: "invitation-settings-a11y",
                email: "invitee@example.com",
                role: "member",
                canPublish: false,
                expiresAt: "2026-08-05T09:00:00.000Z",
                acceptedAt: null,
                createdAt: "2026-07-29T09:00:00.000Z",
                inviteUrl:
                  "http://localhost:3000/invite/invitation-settings-a11y",
              },
            ],
          },
        })
      })
      await page.route(/\/api\/organisations(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          json: {
            items: [
              {
                organisationId: "org-settings-a11y",
                name: "Naba Presence",
                role: "owner",
              },
            ],
          },
        })
      })
      await page.goto("/settings")
      await expect(
        page.getByRole("heading", { name: "Reply policy" })
      ).toBeVisible()
      await expect(page.getByText("Team access", { exact: true })).toBeVisible()
      await expect(
        page.getByRole("combobox", { name: "Role for Alex Morgan" })
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Copy invitation link for invitee@example.com",
        })
      ).toBeVisible()
      await expectAccessible(page, `${viewport.name} settings`)
    })
  })
}
