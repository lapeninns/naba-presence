import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"

// Several authenticated surfaces below are gated server-side by the REAL
// session cookie (`getSession()` reading a request cookie), not by the
// client-side `/api/session` route mocked per-test — e.g.
// `/settings/connections`, `/settings/team` and `/settings/compliance` each
// `redirect("/settings")` for a null-or-non-owner-admin session, and
// `PolicyForm` fetches `/api/settings/capabilities` for real (never mocked
// below). A real cookie from the shared journey tenant (an owner, seeded by
// tests/e2e/helpers/stub-bridge.ts's globalSetup) satisfies both without
// this file needing to mock every such route — the page.route overrides
// elsewhere in this file still win for any path they match, since Playwright
// intercepts those before the request ever reaches the real server.
async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

const accessibilityTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
]
// Matches the CURRENT top-level `<Section title="...">` headings on
// /design-system (app/design-system/page.tsx) — the design system was
// consolidated to four broad sections since this sweep was last revived.
const proofSections = [
  "Foundations",
  "Typography",
  "Spacing and radius",
  "Primitives",
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
  // `useConnectionHealth` (components/app-shell/status-chip.tsx) is what
  // actually derives "stale" — a *subsequent* failed refetch of
  // `/api/google/connections` after an earlier success — not a failed
  // `/api/reviews/counts`, so the "stale" toggle lives on the connections
  // route.
  let connectionsShouldFail = false
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
    await route.fulfill({
      json: {
        total: options.disconnected ? 0 : 1,
        byStatus: {
          new: 0,
          drafted: 0,
          verified: 0,
          awaiting_approval: 0,
          publish_requested: 0,
          published: options.disconnected ? 0 : 1,
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
        // A disconnected connection with a non-empty review list would never
        // reach the "disconnected" EmptyState (components/inbox/empty-states.tsx):
        // `InboxViewInner.renderList()` only shows it once `reviews.length === 0`.
        items: options.disconnected
          ? []
          : [
              {
                id: "review-state-a11y",
                reviewer: { displayName: "Jordan Lee", isAnonymous: false, profilePhotoUrl: null },
                rating: 5,
                location: { id: "location-state-a11y", name: "Camden" },
                text: "A thoughtful and accessible review.",
                createTime: "2026-07-28T10:00:00.000Z",
                updateTime: "2026-07-28T10:00:00.000Z",
                detectedLanguageCode: "en",
                languageConfidence: 1,
                hasMedia: false,
                workflowStatus: "published",
                verificationStatus: "pass",
                draftBody: "Thank you for your thoughtful review.",
                replyBody: "Thank you for your thoughtful review.",
                draftId: "draft-state-a11y",
                replyStatus: "published",
                syncStatus: "succeeded",
                googleReplyState: "APPROVED",
                googlePolicyViolation: null,
                capabilities: {
                  canPublish: true,
                  canEdit: true,
                  canRequestApproval: false,
                },
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
          id: "review-state-a11y",
          reviewerDisplayName: "Jordan Lee",
          reviewerIsAnonymous: false,
          reviewerProfilePhotoUrl: null,
          rating: 5,
          text: "A thoughtful and accessible review.",
          detectedLanguageCode: "en",
          languageConfidence: 1,
          createTime: "2026-07-28T10:00:00.000Z",
          updateTime: "2026-07-28T10:00:00.000Z",
          hasMedia: false,
          workflowStatus: "published",
          locationId: "location-state-a11y",
          locationName: "Camden",
          timezone: "Europe/London",
          verified: true,
          media: [],
          drafts: [
            {
              id: "draft-state-a11y",
              source: "ai",
              body: "Thank you for your thoughtful review.",
              bodyBytes: 38,
              evidenceHash: null,
              modelName: "gpt-test",
              verificationStatus: "pass",
              createdAt: "2026-07-28T10:00:00.000Z",
            },
          ],
          reply: {
            id: "reply-state-a11y",
            body: "Thank you for your thoughtful review.",
            publishStatus: "published",
            googleReplyState: "APPROVED",
            googlePolicyViolation: null,
            googleReplyUpdatedAt: "2026-07-28T10:05:00.000Z",
          },
          timeline: [],
          capabilities: {
            canPublish: true,
            canEdit: true,
            canRequestApproval: false,
          },
          latestVerification: { verdict: "pass", reasons: [] },
        },
      },
    })
  })
  await page.route(/\/api\/google\/connections(?:\?.*)?$/, async (route) => {
    if (connectionsShouldFail) {
      await route.fulfill({
        status: 500,
        json: { error: "internal_error", message: "Failed to load." },
      })
      return
    }
    await route.fulfill({
      json: {
        connections: options.disconnected
          ? []
          : [
              {
                id: "connection-review-state-a11y",
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
  })
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
    failConnections() {
      connectionsShouldFail = true
    },
  }
}

// §9 "dark-mode product scan": every surface below sweeps in BOTH themes, not
// just /design-system's old manual toggle. The pre-auth surfaces
// (/sign-in, /forgot-password, /reset-password, /invite/[token]) have no
// "Toggle theme" control at all, so the theme is set the same way for every
// surface — via `page.addInitScript` writing next-themes' persisted
// `"theme"` localStorage key (the default `storageKey`, `attribute="class"`
// — confirmed in components/theme-provider.tsx) before any navigation, not
// by clicking a control.
const themes = ["light", "dark"] as const

for (const theme of themes) {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test.describe(`${viewport.name} ${theme} WCAG 2.2 AA`, () => {
      test.use({ viewport })

      test.beforeEach(async ({ page }) => {
        await page.addInitScript((value) => {
          window.localStorage.setItem("theme", value)
        }, theme)
      })

      test("design-system proof", async ({ page }) => {
        await page.goto("/design-system")
        await expect(
          page.getByRole("heading", {
            name: "NabaPresence design system",
            level: 1,
          })
        ).toBeVisible()
        // Scoped to the real top-level `<Section>` headings (each has an
        // `id="section-*"` — see app/design-system/page.tsx) rather than
        // every level-2 heading on the page: the "Primitives" section's Card
        // demo deliberately renders one of its own headings as an `<h2>`
        // (`<CardTitle as="h2">`) to show off that prop, which would
        // otherwise inflate this count.
        const sectionHeadings = page.locator("h2[id^='section-']")
        await expect(sectionHeadings).toHaveCount(proofSections.length)
        await expect(sectionHeadings).toHaveText(proofSections)
        for (const section of proofSections) {
          await expect(
            page.getByRole("heading", { name: section, level: 2 })
          ).toBeVisible()
        }
        // /design-system has no ThemeToggle control (it isn't wrapped by
        // AppShell — see app/design-system/page.tsx) — the "Light theme" /
        // "Dark theme" evidence panels on the page are static side-by-side
        // specimens with literal hardcoded colours, not a live toggle. Full
        // dark-mode coverage of this surface (and every other) already comes
        // from the outer `theme` loop's `addInitScript`, so there's nothing
        // left to click here.
        await expectAccessible(
          page,
          `${viewport.name} ${theme} design-system proof`
        )
      })

      test("application shell", async ({ page }) => {
        await page.goto("/inbox")
        if (viewport.name === "desktop") {
          // No `data-variant="floating"` attribute exists on the current
          // shell; the persistent desktop sidebar is the `<aside>` element
          // (components/app-shell/app-shell.tsx).
          await expect(page.locator("aside")).toBeVisible()
        } else {
          await page.getByRole("button", { name: "Open navigation" }).click()
          await expect(page.getByRole("dialog")).toBeVisible()
        }
        await expect(
          page.getByRole("navigation", { name: "Primary" })
        ).toBeVisible()
        if (viewport.name === "mobile") {
          await page.waitForTimeout(350)
        }
        await expectAccessible(
          page,
          `${viewport.name} ${theme} application shell`
        )
      })

      test("sign-in", async ({ page }) => {
        await page.goto("/sign-in")
        await expect(
          page
            .locator("form")
            .getByRole("button", { name: "Sign in", exact: true })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} sign-in`)
        await page
          .getByLabel("Account action")
          .getByRole("button", {
            name: "Switch to create account",
            exact: true,
          })
          .click()
        await expect(page.getByLabel("Confirm password")).toBeVisible()
        await page.waitForTimeout(250)
        await expectAccessible(page, `${viewport.name} ${theme} registration`)
      })

      test("password recovery", async ({ page }) => {
        await page.goto("/forgot-password")
        await expect(
          page.getByRole("heading", { name: "Reset your password" })
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} forgot password`
        )

        await page.goto(
          "/reset-password?token_hash=recovery-token-hash-for-a11y"
        )
        await expect(page.getByLabel("Confirm new password")).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} reset password`)
      })

      test("invitation", async ({ page }) => {
        await page.route(
          /\/api\/invitations\/invite-token-a11y(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              json: {
                organisationName: "Naba Presence",
                email: "invitee@example.com",
                accepted: false,
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
        await expectAccessible(page, `${viewport.name} ${theme} invitation`)
      })

      test("home", async ({ baseURL, page }) => {
        // Real journey tenant/cookie (see the module comment above): the
        // Overview page reads live counts + analytics (Your work / Health /
        // Pulse). A real cookie makes those calls resolve against the real
        // backend instead of 401-ing and hard-redirecting to /sign-in.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto("/home")
        await expect(
          page.getByRole("heading", { name: "Overview", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Pulse" })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} home`)
      })

      test("performance", async ({ baseURL, page }) => {
        // Real journey tenant/cookie: the "By location" table
        // (components/performance/reply-locations-table.tsx) renders response
        // rate as a plain table cell, not a named progressbar, and a real
        // cookie means `/api/google/connections` (never mocked here) resolves
        // for real instead of 401-ing and hard-redirecting to /sign-in.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto("/performance")
        await expect(
          page.getByRole("heading", { name: "Performance", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("columnheader", { name: "Response rate" })
        ).toBeVisible()
        const locationRow = page
          .getByRole("row")
          .filter({ hasText: state.directReview.locationName })
        await expect(locationRow).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} performance`)
      })

      test("locations index", async ({ baseURL, page }) => {
        // Real journey tenant/cookie: an owner sees the management view
        // (Location/Address/Status columns) built from the real seeded
        // location — no mock needed, and it sidesteps the plain-vs-management
        // shape split in `useLocationDirectory` (the server-side `role` a
        // route-mocked, cookie-less session would otherwise always resolve to
        // `null`).
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto("/locations")
        await expect(
          page.getByRole("heading", { name: "Locations", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("columnheader", { name: "Location" })
        ).toBeVisible()
        await expect(
          page.getByText(state.directReview.locationName)
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} locations index`
        )
      })

      test("flat business routes", async ({ baseURL, page }) => {
        // The single-business surface: every one of these resolves its
        // location server-side, so none carries an id in the URL. Journey
        // cookie because they render real tab components against real data.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        for (const [path, heading] of [
          ["/profile", "Business profile"],
          ["/profile/hours", "Opening hours"],
          ["/photos", "Photos"],
          ["/posts", "Posts"],
        ] as const) {
          await page.goto(path)
          await expect(
            page.getByRole("heading", { name: heading, level: 1 })
          ).toBeVisible()
          await expectAccessible(
            page,
            `${viewport.name} ${theme} ${path}`
          )
        }
      })

      test("location profile workspace", async ({ baseURL, page }) => {
        // Real journey tenant/cookie + the real seeded `primaryLocationId`:
        // the CanonicalDiff table's "NabaPresence vs Google" section is the
        // CURRENT profile-workspace content — the pinned copy this test used
        // to assert on ("Identity NabaPresence currently stores for this
        // location") doesn't exist anywhere in the app any more
        // (components/locations/profile-tab.tsx renders a diff table, not
        // that sentence).
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(`/locations/${state.primaryLocationId}`)
        await expect(
          page.getByRole("heading", { name: "NabaPresence vs Google" })
        ).toBeVisible()
        await expect(
          page
            .getByRole("navigation", { name: "Location sections" })
            .getByRole("link", { name: "Profile" })
        ).toHaveAttribute("aria-current", "page")
        await expectAccessible(
          page,
          `${viewport.name} ${theme} location profile`
        )
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
                    profilePhotoUrl: null,
                  },
                  rating: 5,
                  location: { id: "location-a11y", name: "Camden" },
                  text: "A thoughtful and accessible review.",
                  createTime: "2026-07-28T10:00:00.000Z",
                  updateTime: "2026-07-28T10:00:00.000Z",
                  detectedLanguageCode: "en",
                  languageConfidence: 1,
                  hasMedia: false,
                  workflowStatus: "published",
                  verificationStatus: "pass",
                  draftBody: "Thank you for your thoughtful review, Jordan.",
                  replyBody: "Thank you for your thoughtful review, Jordan.",
                  draftId: "draft-a11y",
                  replyStatus: "published",
                  syncStatus: "succeeded",
                  googleReplyState: "APPROVED",
                  googlePolicyViolation: null,
                  capabilities: {
                    canPublish: true,
                    canEdit: true,
                    canRequestApproval: false,
                  },
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
                id: "review-a11y",
                reviewerDisplayName: "Jordan Lee",
                reviewerIsAnonymous: false,
                reviewerProfilePhotoUrl: null,
                rating: 5,
                text: "A thoughtful and accessible review.",
                detectedLanguageCode: "en",
                languageConfidence: 1,
                createTime: "2026-07-28T10:00:00.000Z",
                updateTime: "2026-07-28T10:00:00.000Z",
                hasMedia: false,
                workflowStatus: "published",
                locationId: "location-a11y",
                locationName: "Camden",
                timezone: "Europe/London",
                verified: true,
                media: [],
                drafts: [
                  {
                    id: "draft-a11y",
                    source: "ai",
                    body: "Thank you for your thoughtful review, Jordan.",
                    bodyBytes: 45,
                    evidenceHash: null,
                    modelName: "gpt-test",
                    verificationStatus: "pass",
                    createdAt: "2026-07-28T10:05:00.000Z",
                  },
                ],
                reply: {
                  id: "reply-a11y",
                  body: "Thank you for your thoughtful review, Jordan.",
                  publishStatus: "published",
                  googleReplyState: "APPROVED",
                  googlePolicyViolation: null,
                  googleReplyUpdatedAt: "2026-07-28T10:10:00.000Z",
                },
                timeline: [],
                capabilities: {
                  canPublish: true,
                  canEdit: true,
                  canRequestApproval: false,
                },
                latestVerification: { verdict: "pass", reasons: [] },
              },
            },
          })
        })
        await page.goto("/inbox")
        await expect(
          page.getByRole("heading", { name: "Reviews", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("button", { name: "Filters" })
        ).toBeVisible()
        const reviewList = page.getByRole("region", { name: "Review list" })
        await expect(reviewList).toBeVisible()
        const row = reviewList.getByRole("button", { name: /Jordan Lee/ })
        await expect(row).toBeVisible()
        if (viewport.name === "mobile") {
          await expect(
            page.getByRole("region", { name: "Selected review" })
          ).toBeHidden()
          await expectAccessible(
            page,
            `${viewport.name} ${theme} mobile review inbox`
          )
          await row.click()
          await expect(reviewList).toBeHidden()
          await expect(
            page
              .locator('section[aria-label="Review list"] button')
              .filter({ hasText: "Jordan Lee" })
          ).toHaveAttribute("aria-current", "true")
          // Renamed from "Back to review list" (components/inbox/inbox-view.tsx).
          const backButton = page.getByRole("button", {
            name: "Back to reviews",
          })
          await expect(backButton).toBeVisible()
          await expect(backButton).toBeFocused()
        } else {
          await expect(row).toHaveAttribute("aria-current", "true")
        }
        const selectedReview = page.getByRole("region", {
          name: "Selected review",
        })
        await expect(selectedReview).toBeVisible()
        await expect(selectedReview.getByRole("heading").first()).toBeVisible()

        // This fixture's draft and live reply are the same words. The composer
        // edits those words directly, so they appear exactly ONCE — the old
        // pane rendered them as a "published reply" block AND a textarea.
        await expect(
          selectedReview.getByRole("textbox", { name: "Your reply" })
        ).toHaveValue("Thank you for your thoughtful review, Jordan.")
        await expect(selectedReview.getByText("In sync with Google")).toBeVisible()
        await expect(selectedReview.getByText("Live on Google")).toBeHidden()
        await expect(selectedReview.getByText("Drafted by AI")).toBeVisible()

        // AI generate is manual: Regenerate (draft already exists) + tone are
        // available, but nothing calls the LLM until the operator clicks.
        await expect(
          selectedReview.getByRole("button", { name: "Regenerate" })
        ).toBeVisible()
        await expect(
          selectedReview.getByRole("combobox", { name: "Reply tone" })
        ).toBeVisible()
        // A clean pass is one line in the label row, not a bordered card, so
        // there is no Verification heading unless something is wrong.
        await expect(
          selectedReview.getByRole("heading", { name: "Verification" })
        ).toBeHidden()

        // "Publish" is the wrong verb once a reply is live, and re-sending
        // identical text is a no-op the domain has no transition for — so the
        // primary is "Update reply", disabled, with the reason on the page.
        const primary = selectedReview.getByRole("button", {
          name: "Update reply",
        })
        await expect(primary).toBeVisible()
        await expect(primary).toBeDisabled()
        await expect(selectedReview).toContainText(
          "Edit the reply above to publish a change."
        )
        await expect(
          selectedReview.getByRole("button", { name: "Review actions" })
        ).toBeVisible()
        await expect(
          selectedReview.getByRole("heading", { name: "Activity" })
        ).toBeVisible()
        await page.waitForTimeout(500)
        await expectAccessible(
          page,
          `${viewport.name} ${theme} review detail and editor`
        )
        if (viewport.name === "mobile") {
          await page.getByRole("button", { name: "Back to reviews" }).click()
          await expect(reviewList).toBeVisible()
          await expect(selectedReview).toBeHidden()
          await expect(row).toBeFocused()
        }
      })

      test("stale review data banner", async ({ page }) => {
        // `useConnectionHealth` (lib/queries/use-connection-health.ts) shows
        // "Live data" as plain text, not a button, and derives "stale" from a
        // FAILED refetch of `/api/google/connections` after an earlier
        // success — the label is "Live data may be stale", and there's no
        // separate "Retry" affordance for it (the chip has no action at all).
        //
        // Forcing that refetch needs a virtual clock: the connections query
        // has no `staleTime` override (the app's 30s default —
        // lib/queries/query-client.ts), so `refetchOnWindowFocus` is a no-op
        // on fresh data regardless of which event fires it, and the
        // `refetchInterval: 60_000` (lib/queries/use-connection-health.ts)
        // is scheduled via a real timer nothing here can wait out. Installing
        // the clock BEFORE navigating virtualises both from the page's very
        // first tick, so fast-forwarding past 60s reliably fires that
        // interval's next real (mocked) fetch attempt.
        await page.clock.install()
        const controls = await mockReviewWorkspace(page)
        await page.goto("/inbox")
        await expect(page.getByText("Live data", { exact: true })).toBeVisible()
        controls.failConnections()
        await page.clock.fastForward("00:01:05")
        await expect(
          page.getByText("Live data may be stale", { exact: true })
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} stale review data`
        )
      })

      test("disconnected review data state", async ({ page }) => {
        await mockReviewWorkspace(page, { disconnected: true })
        await page.goto("/inbox")
        await expect(
          page.getByText("Google is not connected", { exact: true })
        ).toBeVisible()
        await expect(
          page.getByText(
            "Reconnect Google to sync and reply to your reviews.",
            { exact: true }
          )
        ).toBeVisible()
        await expect(
          page.getByRole("link", { name: "Manage connection" })
        ).toHaveAttribute("href", "/settings/connections")
        await expectAccessible(
          page,
          `${viewport.name} ${theme} disconnected review data`
        )
      })

      test("delete published reply confirmation", async ({ page }) => {
        await mockReviewWorkspace(page)
        await page.goto("/inbox")
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
        // Drift (a): current copy (components/inbox/action-bar.tsx:178-180).
        await expect(dialog).toContainText(
          "This removes your reply from Google. You can write a new one afterwards."
        )
        await expectAccessible(
          page,
          `${viewport.name} ${theme} delete published reply dialog`
        )
      })

      test("connections", async ({ baseURL, page }) => {
        // Real journey tenant/cookie: `/settings/connections`
        // (app/(dashboard)/settings/connections/page.tsx) `redirect("/settings")`s
        // server-side for anything other than an owner/admin session, which the
        // mocked `/api/session` below can never satisfy on its own (that mock
        // only ever changes what the CLIENT sees, not what `getSession()` reads
        // from the actual request cookie).
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
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
        await page.route(
          /\/api\/google\/locations(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              json: {
                locations: [
                  {
                    id: "locations/camden-a11y",
                    googleLocationName: "locations/camden-a11y",
                    title: "Camden Hotel",
                    accountName: "accounts/123456789",
                    verified: true,
                    address: "10 Camden High Street, London, England, NW1 0JH",
                  },
                ],
              },
            })
          }
        )
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
        await page.route(
          /\/api\/google\/notifications(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              json: {
                setting: {
                  name: "accounts/123456789/notificationSetting",
                  pubsubTopic: "",
                  notificationTypes: [],
                },
              },
            })
          }
        )
        await page.goto("/settings/connections")
        await expect(
          page.getByRole("heading", { name: "Google Business Profile" })
        ).toBeVisible()
        // Current section headings (components/settings/*-card.tsx) — the old
        // aria-labelled-section names ("Connection setup progress", "Google
        // location import", "Historical review backfill", "Notification
        // management", "Connection management", "Connection status and
        // guidance") don't exist on any current card.
        await expect(
          page.getByRole("heading", {
            name: "Google account",
            level: 2,
            exact: true,
          })
        ).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Google accounts", level: 2 })
        ).toBeVisible()
        await expect(page.getByText("Naba Presence Hospitality")).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Import locations", level: 2 })
        ).toBeVisible()
        await expect(page.getByText("Camden Hotel").first()).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Backfill reviews", level: 2 })
        ).toBeVisible()
        await expect(page.getByText("Synced")).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Google notifications", level: 2 })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} connections`)
      })

      test("settings policy, team, and compliance", async ({
        baseURL,
        page,
      }) => {
        // Real journey tenant/cookie: /settings' PolicyForm fetches
        // `/api/settings/capabilities` for real (never mocked below), and
        // /settings/team + /settings/compliance both `redirect("/settings")`
        // server-side for anything other than an owner/admin session — neither
        // is satisfiable by the client-side `/api/session` mock alone.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
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
                  createdAt: "2026-07-01T09:00:00.000Z",
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
        await expectAccessible(
          page,
          `${viewport.name} ${theme} reply policy settings`
        )

        await page.goto("/settings/team")
        await expect(
          page.getByRole("heading", { name: "Team access", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("combobox", { name: "Role for Alex Morgan" })
        ).toBeVisible()
        await expect(
          page.getByRole("button", {
            name: "Copy invite link for invitee@example.com",
          })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} team settings`)

        await page.goto("/settings/compliance")
        await expect(
          page.getByRole("heading", {
            name: "Data and compliance",
            level: 1,
          })
        ).toBeVisible()
        // Current cards (components/settings/*-card.tsx) — there's no
        // "Data retention" copy on this page any more.
        await expect(
          page.getByRole("heading", { name: "Privacy requests" })
        ).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Legal holds" })
        ).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Export a subject’s records" })
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} compliance settings`
        )
      })
    })
  }
}
