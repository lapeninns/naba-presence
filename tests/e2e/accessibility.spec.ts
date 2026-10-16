import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { LISTING_HEALTH, listingHealthLabel } from "@/lib/listings/health"

import { readJourneyState } from "./helpers/stub-bridge"
import { seedTeamTenant } from "./helpers/team-tenant"

// Several authenticated surfaces below are gated server-side by the REAL
// session cookie (`getSession()` reading a request cookie), not by the
// client-side `/api/session` route mocked per-test — e.g.
// `/settings/connections` and `/settings/team` each
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
// /design-system (app/design-system/page.tsx).
const proofSections = [
  "Foundations",
  "Typography",
  "Spacing and radius",
  "Primitives",
  // FOUNDATION Drop 1 (2026-10-13) added the shared Notion Mail pattern
  // section; it is axe-checked with the rest of the page.
  "Notion Mail patterns",
  "Compositions",
]

async function expectAccessible(page: Page, surface: string) {
  // Settle the document before axe reads it. Every route declares a title in
  // its `metadata` export, but axe injected mid-hydration can observe the
  // document before Next has applied it and report `document-title` against a
  // page that is correctly titled a moment later. This asserts the title is
  // really there rather than waiting blindly, so a genuinely untitled surface
  // still fails -- it just fails deterministically.
  await expect(page).toHaveTitle(/.+/)
  // Overlays enter on a spring. Axe read mid-transition blends a half-faded
  // dialog with the scrim and reports colours nothing paints at rest, so let
  // every Base UI enter/exit state clear and every CSS transition finish.
  // Only transitions: a spinner's infinite animation never "finishes".
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-starting-style], [data-ending-style]")
        .length === 0
  )
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined))
    )
  )
  const results = await new AxeBuilder({ page })
    .withTags(accessibilityTags)
    // An open Base UI menu brackets its trigger and popup with zero-size
    // `aria-hidden` focus guards whose only job is to pass Tab focus on to
    // the real target. Axe's aria-hidden-focus reads them as hidden focusable
    // content; nothing in them is ever focused or announced.
    .exclude("[data-base-ui-focus-guard]")
    .analyze()
  expect(
    results.violations,
    // Name every offending node with the colours axe measured, so a failure
    // says which element on which surface, not just how many.
    `${surface} accessibility violations:\n${results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)\n` +
          violation.nodes
            .map((node) => {
              const data = node.any[0]?.data as
                | { fgColor?: string; bgColor?: string; contrastRatio?: number }
                | undefined
              const colours = data?.fgColor
                ? ` fg=${data.fgColor} bg=${data.bgColor} ratio=${data.contrastRatio}`
                : ""
              return `  - ${node.target.join(" ")}${colours}\n    ${node.html.replace(/\s+/g, " ").slice(0, 160)}`
            })
            .join("\n")
      )
      .join("\n")}`
  ).toEqual([])
}

async function mockReviewWorkspace(
  page: Page,
  options: { disconnected?: boolean } = {}
) {
  // `useContextHealth` (components/app-shell/context-health-chip.tsx) is
  // what actually derives "stale" for the chip and the More sheet's row: a
  // *subsequent* failed refetch of the client list after an earlier success,
  // not a failed `/api/reviews/counts`. `failClients()` drives it;
  // `/api/google/connections` keeps its own toggle for the inbox.
  let connectionsShouldFail = false
  let clientsShouldFail = false
  // Registered FIRST so it is the LAST resort: Playwright matches route
  // handlers in reverse registration order. Anything the specific mocks below
  // do not claim gets named here, instead of reaching the real server,
  // answering 401 and surfacing as a mystery redirect to /sign-in halfway
  // through an assertion.
  await page.route(/\/api\//, async (route) => {
    console.log("UNSTUBBED " + new URL(route.request().url()).pathname)
    await route.fulfill({ status: 500, json: { error: "unstubbed_route" } })
  })
  await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        session: {
          sessionId: "session-review-state-a11y",
          userId: "user-review-state-a11y",
          organisationId: "org-review-state-a11y",
          organisationName: "Naba Presence",
          workspaceMode: "agency",
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
        },
        byQueue: {
          needs_reply: 0,
          approval: 0,
          awaiting_my_approval: 0,
          awaiting_others: 0,
          publishing: 0,
          failed: 0,
          done: options.disconnected ? 0 : 1,
          all: options.disconnected ? 0 : 1,
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
                reviewer: {
                  displayName: "Jordan Lee",
                  isAnonymous: false,
                  profilePhotoUrl: null,
                },
                rating: 5,
                location: {
                  id: "location-state-a11y",
                  name: "Camden",
                  clientId: "client-state-a11y",
                  clientName: "Camden Group",
                },
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
        locations: [
          {
            id: "location-state-a11y",
            name: "Camden",
            linked: true,
            clientId: "client-state-a11y",
            clientName: "Camden Group",
          },
        ],
      },
    })
  })
  await page.route(/\/api\/organisations(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [] } })
  })
  // The shell reads the client list for its sidebar, breadcrumbs and health
  // chip. Unstubbed it answers 401, and lib/api/client.ts hard-navigates the
  // whole page to /sign-in mid-assertion.
  await page.route(/\/api\/clients(?:\?.*)?$/, async (route) => {
    if (clientsShouldFail) {
      // 503, not 401: a 401 would be treated as "sign in again" and navigate
      // away, which is a different state from "we could not reach the server".
      await route.fulfill({
        status: 503,
        json: { error: "service_unavailable", message: "Try again shortly." },
      })
      return
    }
    await route.fulfill({
      json: {
        items: [
          {
            id: "client-state-a11y",
            name: "Camden Group",
            slug: "camden-group",
            colour: null,
            logoUrl: null,
            notes: null,
            archivedAt: null,
            createdAt: "2026-07-01T09:00:00.000Z",
            locationCount: 1,
            linkedCount: 1,
            verifiedCount: 1,
            health: options.disconnected ? "disconnected" : "healthy",
            connections: [],
            openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
            backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
            lastSyncAt: "2026-07-31T09:00:00.000Z",
          },
        ],
        unassignedLocationCount: 0,
      },
    })
  })
  return {
    failClients() {
      clientsShouldFail = true
    },
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

      // Tenants seeded by a test, destroyed after it whatever the outcome.
      const cleanups: (() => Promise<void>)[] = []
      test.afterEach(async () => {
        for (const cleanup of cleanups.splice(0)) await cleanup()
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
        // Scoped to this test on purpose. axe samples painted colour, and the
        // inbox is the one measured surface that animates, so it is the one
        // that needs motion settled. Applying reduced motion suite-wide broke
        // focus restoration on mobile (see the reply-editor test below), which
        // is its own defect and not something to mask here.
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.goto("/inbox")
        // components/app-shell/app-shell.tsx: from 768px the persistent
        // `aside[aria-label="Sidebar"]` holds the Primary nav; below it the
        // fixed bottom tab bar is the Primary nav and More opens a bottom
        // sheet with the rest, which is measured open.
        const primary = page.getByRole("navigation", { name: "Primary" })
        if (viewport.name === "desktop") {
          await expect(
            page.locator('aside[aria-label="Sidebar"]')
          ).toBeVisible()
          await expect(
            page
              .locator('aside[aria-label="Sidebar"]')
              .getByRole("navigation", {
                name: "Primary",
              })
          ).toBeVisible()
          await expect(primary).toHaveCount(1)
        } else {
          await expect(page.locator('aside[aria-label="Sidebar"]')).toBeHidden()
          await expect(primary).toHaveAttribute("data-slot", "tab-bar")
          await expect(primary).toBeVisible()
          await primary
            .getByRole("button", { name: "More", exact: true })
            .click()
          await expect(page.getByRole("dialog", { name: "More" })).toBeVisible()
        }
        if (viewport.name === "mobile") {
          // The sheet's rise settles before axe samples its colours.
          await page.waitForTimeout(350)
        }
        // The review list carries `opacity-80` behind a `transition-opacity`
        // for as long as it is refreshing (components/inbox/review-list.tsx).
        // Sampling mid-transition lightens every colour inside it by the same
        // factor, which axe reports as a contrast failure against tokens that
        // are in fact correct. Wait for the list to stop declaring itself
        // busy rather than for a fixed interval.
        await expect(
          page.locator('[aria-label="Review list"][aria-busy="true"]')
        ).toHaveCount(0)
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
        await expect(
          page.getByRole("listitem", { name: /Between 12 and 128 characters/ })
        ).toBeVisible()
        await expect(page.getByLabel("Confirm password")).toHaveCount(0)
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
        await expect(
          page.getByLabel("New password", { exact: true })
        ).toBeVisible()
        await expect(page.getByLabel("Confirm new password")).toHaveCount(0)
        await expectAccessible(page, `${viewport.name} ${theme} reset password`)
      })

      test("invitation", async ({ page }) => {
        await page.route(
          /\/api\/invitations\/invite-token-a11y(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              json: {
                organisationName: "Naba Presence",
                workspaceMode: "agency",
                email: "invitee@example.com",
                role: "admin",
                expiresAt: "2099-10-22T14:05:00.000Z",
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

      test("inbox landing", async ({ baseURL, page }) => {
        // Real journey tenant/cookie (see the module comment above): the
        // landing inbox reads live counts and the client list. A real cookie
        // makes those calls resolve against the real backend instead of
        // 401-ing and hard-redirecting to /sign-in.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto("/inbox")
        await expect(
          page.getByRole("heading", { name: "Inbox", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("navigation", { name: "Review queues" })
        ).toBeVisible()
        await page.waitForLoadState("networkidle")
        await expectAccessible(page, `${viewport.name} ${theme} inbox landing`)
      })

      test("reports", async ({ baseURL, page }) => {
        // Real journey tenant/cookie: the "By location" table
        // (components/performance/reply-locations-table.tsx) renders response
        // rate as a plain table cell, not a named progressbar, and a real
        // cookie means `/api/google/connections` (never mocked here) resolves
        // for real instead of 401-ing and hard-redirecting to /sign-in.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto("/reports")
        await expect(
          page.getByRole("heading", { name: "Reports", level: 1 })
        ).toBeVisible()
        // Below 720px of container width the table is a responsive one
        // (components/ui/table.tsx): the header row hides and every cell
        // carries its column name as a label, so the column header is only
        // asserted where it is drawn.
        if (viewport.name === "desktop") {
          await expect(
            page.getByRole("columnheader", { name: "Response rate" })
          ).toBeVisible()
        }
        const locationRow = page
          .getByRole("row")
          .filter({ hasText: state.directReview.locationName })
        await expect(locationRow).toBeVisible()
        if (viewport.name === "mobile") {
          await expect(
            locationRow.locator('td[data-label="Response rate"]')
          ).toBeVisible()
        }
        await expectAccessible(page, `${viewport.name} ${theme} reports`)
      })

      test("listings board", async ({ baseURL, page }) => {
        // Real journey tenant/cookie: the board reads the directory and the
        // DB-only summary for real, and an owner sees the address and health
        // the management view carries.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto("/listings")
        await expect(
          page.getByRole("heading", { name: "Listings", level: 1 })
        ).toBeVisible()
        // The board's table is responsive (components/ui/table.tsx): below
        // 720px of container width the header row hides and each listing
        // becomes a compact record card led by its name (no per-cell
        // labels: the name, health pill and waiting count speak for
        // themselves).
        const header = page.getByRole("columnheader", {
          name: "Listing",
          exact: true,
        })
        if (viewport.name === "desktop") {
          await expect(header).toBeVisible()
        } else {
          await expect(header).toBeHidden()
          // A card per listing, identified by it: the row holding the
          // journey listing carries its name as the link and its health as
          // a word (one of the board's labels), not as colour alone.
          const card = page
            .locator("tbody > tr")
            .filter({ hasText: state.directReview.locationName })
          await expect(card).toHaveCount(1)
          await expect(
            card.getByRole("link", { name: state.directReview.locationName })
          ).toBeVisible()
          await expect(
            card.getByText(
              new RegExp(
                `^(${LISTING_HEALTH.map(listingHealthLabel).join("|")})$`
              )
            )
          ).toBeVisible()
        }
        await expect(
          page.getByRole("link", { name: state.directReview.locationName })
        ).toBeVisible()
        await page.waitForLoadState("networkidle")
        await expectAccessible(page, `${viewport.name} ${theme} listings board`)
      })

      test("clients index and hub", async ({ baseURL, page }) => {
        // The agency surfaces that replaced the flat single-business routes.
        // Journey cookie because they render real data: a client with real
        // locations, health and open work.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)

        await page.goto("/clients")
        await expect(
          page.getByRole("heading", { name: "Clients", level: 1 })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} clients index`)

        await page.goto(`/clients/${state.clientId}`)
        await expect(
          page.getByRole("heading", { name: state.clientName, level: 1 })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} client hub`)
      })

      test("listing overview and the profile editor", async ({
        baseURL,
        page,
      }) => {
        // Real journey tenant/cookie + the real seeded `primaryLocationId`.
        // The overview paints from DB-only reads; the profile editor is the
        // merged business profile: one heading, one set of fields.
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(`/listings/${state.primaryLocationId}`)
        await expect(
          page.getByRole("heading", {
            name: state.directReview.locationName,
            level: 1,
          })
        ).toBeVisible()
        await expect(
          page
            .getByRole("region", { name: "Areas" })
            .getByRole("heading", { name: "Business profile", level: 3 })
        ).toBeVisible()
        await page.waitForLoadState("networkidle")
        await expectAccessible(
          page,
          `${viewport.name} ${theme} listing overview`
        )

        await page.goto(`/listings/${state.primaryLocationId}/profile`)
        await expect(
          page.getByRole("heading", { name: "Business profile", level: 1 })
        ).toBeVisible()
        await expect(
          page.getByRole("textbox", { name: "Business name" })
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} listing profile`
        )
      })

      test("inbox, review detail, and reply editor", async ({ page }) => {
        // The reply composer shows the month's AI credit balance. Unstubbed
        // it answers 401 and the whole page navigates to /sign-in.
        await page.route(/\/api\/ai\/credits(?:\?.*)?$/, async (route) => {
          await route.fulfill({
            json: {
              used: 3,
              allowance: 100,
              remaining: 97,
              periodId: "00000000-0000-4000-8000-0000000000e1",
              periodKind: "pilot_month",
              periodStart: "2026-07-01T00:00:00.000Z",
              periodEnd: "2026-08-01T00:00:00.000Z",
              canUseAi: true,
              accessReason: "pilot",
            },
          })
        })
        // The review's triage menu lists who it can be assigned to. Unstubbed
        // it answers 401 and the page navigates to /sign-in.
        await page.route(/\/api\/members(?:\?.*)?$/, async (route) => {
          await route.fulfill({
            json: {
              members: [
                {
                  userId: "user-reviews-a11y",
                  email: "alex@example.com",
                  displayName: "Alex Morgan",
                  role: "owner",
                  canPublish: true,
                  locationScope: "all",
                  createdAt: "2026-07-01T09:00:00.000Z",
                  locations: [],
                },
                {
                  userId: "user-reviews-a11y-2",
                  email: "sam@example.com",
                  displayName: "Sam Patel",
                  role: "member",
                  canPublish: true,
                  locationScope: "all",
                  createdAt: "2026-07-01T09:00:00.000Z",
                  locations: [],
                },
              ],
            },
          })
        })
        // The shell reads the client list for its sidebar, breadcrumbs and
        // health chip. Unstubbed it answers 401, and lib/api/client.ts treats
        // that as "sign in again" and navigates the whole page away.
        await page.route(/\/api\/clients(?:\?.*)?$/, async (route) => {
          await route.fulfill({
            json: {
              items: [
                {
                  id: "client-reviews-a11y",
                  name: "Camden Group",
                  slug: "camden-group",
                  colour: null,
                  logoUrl: null,
                  notes: null,
                  archivedAt: null,
                  createdAt: "2026-07-01T09:00:00.000Z",
                  locationCount: 1,
                  linkedCount: 1,
                  verifiedCount: 1,
                  health: "healthy",
                  connections: [],
                  openWork: { needsReply: 1, awaitingApproval: 0, failed: 0 },
                  backfill: {
                    running: 0,
                    failed: 0,
                    succeeded: 1,
                    notStarted: 0,
                  },
                  lastSyncAt: "2026-07-31T09:00:00.000Z",
                },
              ],
              unassignedLocationCount: 0,
            },
          })
        })
        await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
          await route.fulfill({
            json: {
              session: {
                sessionId: "session-reviews-a11y",
                userId: "user-reviews-a11y",
                organisationId: "org-reviews-a11y",
                organisationName: "Naba Presence",
                workspaceMode: "agency",
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
              },
              byQueue: {
                needs_reply: 0,
                approval: 0,
                awaiting_my_approval: 0,
                awaiting_others: 0,
                publishing: 0,
                failed: 0,
                done: 1,
                all: 1,
              },
            },
          })
        })
        // The inbox stopped reading client setup and the analytics overview
        // when the Today strip went. They stay stubbed because any read that
        // slips through unstubbed answers 401 and lib/api/client.ts
        // navigates away mid-run.
        await page.route(
          /\/api\/clients\/[^/]+\/setup(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              json: { setup: { nextStep: "done", steps: [] } },
            })
          }
        )
        await page.route(
          /\/api\/analytics\/overview(?:\?.*)?$/,
          async (route) => {
            await route.fulfill({
              json: {
                from: "2026-06-28T00:00:00.000Z",
                to: "2026-07-28T00:00:00.000Z",
                timezone: "UTC",
                summary: {
                  reviewVolume: 1,
                  averageRating: 5,
                  responseRate: 100,
                  unresolvedComplaints: 0,
                  verificationFailures: 0,
                  verificationRejectionRate: null,
                  medianFirstResponseSeconds: null,
                  p95FirstResponseSeconds: null,
                  medianLatestEditSeconds: null,
                },
                series: [],
                locations: [],
                providerTotals: {
                  averageRating: null,
                  totalReviewCount: null,
                  localReviewCount: 1,
                  divergence: false,
                },
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
              locations: [
                {
                  id: "location-a11y",
                  name: "Camden",
                  linked: true,
                  clientId: "client-reviews-a11y",
                  clientName: "Camden Group",
                },
              ],
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
                  location: {
                    id: "location-a11y",
                    name: "Camden",
                    clientId: "client-reviews-a11y",
                    clientName: "Camden Group",
                  },
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
        await page.goto("/inbox?queue=all")
        await expect(
          page.getByRole("heading", { name: "Inbox", level: 1 })
        ).toBeVisible()
        // The five queue controls and the Filters button sit in the inbox
        // toolbar above the two panes at every width, so nothing has to be
        // opened to reach a queue, on a phone or otherwise.
        const queues = page.getByRole("navigation", { name: "Review queues" })
        await expect(
          queues.getByRole("button", { name: /^Needs reply/ })
        ).toBeVisible()
        await expect(
          queues.getByRole("button", { name: /^Approval/ })
        ).toBeVisible()
        await expect(
          page.getByRole("group", { name: "Filter reviews" })
        ).toBeVisible()
        // Rating is one-tap chips above the list, not part of the sheet. Read
        // before the sheet opens: a modal sheet hides the page behind it from
        // the accessibility tree.
        await expect(
          page.getByRole("group", { name: "Quick filters" })
        ).toBeVisible()
        // Every narrowing opens from one Filters button (a side sheet, or a
        // bottom sheet on a phone), and Escape dismisses it.
        const filtersButton = page.getByRole("button", { name: /^Filters/ })
        await expect(filtersButton).toBeVisible()
        await filtersButton.click()
        const filtersSheet = page.getByRole("dialog", { name: "Filters" })
        await expect(filtersSheet).toBeVisible()
        // Every filter keeps an accessible group name. The sheet's sections
        // were named regions (a dozen landmarks); they are now groups named
        // by their headings, and where the control is itself the named group
        // (Written review is a radio group) that control carries the name.
        await expect(
          filtersSheet.getByRole("radiogroup", { name: "Written review" })
        ).toBeVisible()
        await expect(
          filtersSheet.getByRole("group", { name: "Date range" })
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} inbox filters sheet`
        )
        await page.keyboard.press("Escape")
        await expect(filtersSheet).toBeHidden()
        const reviewList = page.getByRole("region", { name: "Review list" })
        await expect(reviewList).toBeVisible()
        const row = reviewList.getByRole("button", { name: /^Jordan Lee/ })
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
          // On a phone the open review parks the workspace controls as well
          // as the list: the inbox toolbar sits above the panes, and leaving
          // it tabbable behind an open review would put focus on controls
          // the review covers.
          await expect(
            page.locator('[data-slot="inbox-workspace-controls"]')
          ).toBeHidden()
          await expect(
            page
              .locator('section[aria-label="Review list"] button')
              .filter({ hasText: "Jordan Lee" })
          ).toHaveAttribute("aria-current", "true")
          // The pushed review's one labelled way back: the app bar's
          // "‹ Inbox" link (PageChrome back); the review draws none, and
          // has no head band above its first line.
          const backButton = page.getByRole("link", {
            name: "Back to Inbox",
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
        // The pane leads with the reviewer, then the customer's words, then
        // the reply — one reading order, with no five-stage tracker above it.
        // On a phone the review has replaced the list, so the name is the
        // page's h1; from lg "Inbox" is, and the name is an h2.
        await expect(
          selectedReview.getByRole("heading", {
            name: "Jordan Lee",
            level: viewport.name === "mobile" ? 1 : 2,
          })
        ).toBeVisible()
        await expect(
          selectedReview.locator('[data-slot="review-head"]')
        ).toHaveCount(0)
        // The customer's words open the thread, above the reply.
        await expect(
          selectedReview.getByRole("article", {
            name: "Review from Jordan Lee",
          })
        ).toBeVisible()

        // One status surface, from lib/inbox/reply-state.ts: a confirmed
        // `published` reply with nothing newer in the composer is the only
        // state that reads "Live on Google". Asserting the strip by its slot
        // keeps this pointed at the one place the pane answers the question.
        await expect(
          selectedReview.locator('[data-slot="reply-status-strip"]')
        ).toHaveText("Live on Google")

        // The editor is always open: the live words, editable in place.
        await expect(
          selectedReview.getByRole("textbox", { name: "Your reply" })
        ).toHaveValue("Thank you for your thoughtful review, Jordan.")
        // What must stay absent is LiveReplyDisclosure's toggle: that section
        // shows Google's copy only when it disagrees with what the composer
        // holds, and this fixture's draft and reply are the same words.
        await expect(
          selectedReview.getByRole("button", {
            name: /differs from the reply below/,
          })
        ).toBeHidden()

        // AI generate is manual: Regenerate (there is text) is available, with
        // the tone chosen inside it, but nothing calls the LLM until the
        // operator picks one.
        await expect(
          selectedReview.getByRole("button", { name: "Regenerate" })
        ).toBeVisible()
        await expect(
          selectedReview.getByRole("radiogroup", { name: "Reply tone" })
        ).toHaveCount(0)
        // Checks are said under the editor only when they fail or warn; a
        // passed check draws nothing, and there is no checks panel.
        await expect(
          selectedReview.getByRole("heading", {
            name: "Verification",
            level: 3,
            exact: true,
          })
        ).toHaveCount(0)

        // "Publish" is the wrong verb once a reply is live, and re-sending
        // identical text is a no-op the domain has no transition for — so the
        // primary is "Update reply", disabled.
        const primary = selectedReview.getByRole("button", {
          name: "Update reply",
        })
        await expect(primary).toBeVisible()
        await expect(primary).toBeDisabled()
        await expect(
          selectedReview.getByRole("button", { name: "Review actions" })
        ).toBeVisible()
        // History lives behind ⋯, not on the pane.
        await expect(
          selectedReview.getByRole("heading", { name: /^Activity/ })
        ).toHaveCount(0)
        await page.waitForTimeout(500)
        await expectAccessible(
          page,
          `${viewport.name} ${theme} review detail and editor`
        )

        // ⋯ holds the listing, the history and the review's details. Each is
        // reachable by keyboard, and Escape hands focus back to the trigger.
        const more = selectedReview.getByRole("button", {
          name: "More actions",
        })
        await more.focus()
        await page.keyboard.press("Enter")
        const moreMenu = page.getByRole("menu")
        await expect(moreMenu).toBeVisible()
        await expect(
          moreMenu.getByRole("menuitem", { name: "Open listing" })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} review ⋯ menu`)
        await moreMenu.getByRole("menuitem", { name: "History" }).click()
        const history = page.getByRole("dialog", { name: "History" })
        await expect(history).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} review history dialog`
        )
        await page.keyboard.press("Escape")
        await expect(history).toBeHidden()
        await expect(more).toBeFocused()
        if (viewport.name === "mobile") {
          await page.getByRole("link", { name: "Back to Inbox" }).click()
          await expect(reviewList).toBeVisible()
          await expect(selectedReview).toBeHidden()
          await expect(
            page.locator('[data-slot="inbox-workspace-controls"]')
          ).toBeVisible()
          await expect(row).toBeFocused()
        }
      })

      test("stale data chip", async ({ page }) => {
        // The health chip says "Data may be stale" when a refetch fails AFTER
        // an earlier success. That is a different claim from "Google is
        // disconnected": the connection may be fine and it is our own server
        // we cannot reach, and an operator acting on stale counts would
        // double-reply.
        //
        // Forcing that refetch needs a virtual clock: the query has no
        // `staleTime` override (the app's 30s default), so
        // `refetchOnWindowFocus` is a no-op on fresh data. Installing the
        // clock BEFORE navigating virtualises the page's timers from its very
        // first tick, so fast-forwarding reliably fires the next attempt.
        await page.clock.install()
        const controls = await mockReviewWorkspace(page)
        await page.goto("/inbox")
        // From 768px the words are the toolbar's health chip. A phone's bar
        // has no chip: the same words (one hook, useContextHealth in
        // components/app-shell/context-health-chip.tsx) are the More sheet's
        // Connections row, so the sheet stays open across the refetch.
        let health = page.locator('[data-slot="health-chip"]')
        if (viewport.name === "mobile") {
          await page
            .getByRole("navigation", { name: "Primary" })
            .getByRole("button", { name: "More", exact: true })
            .click()
          health = page
            .getByRole("dialog", { name: "More" })
            .locator('[data-slot="health-row"]')
        }
        await expect(
          health.getByText("All clients in sync", { exact: true })
        ).toBeVisible()
        controls.failClients()
        // Past the clients list's own poll (CLIENTS_POLL_MS, five minutes,
        // lib/queries/use-shell-status.ts): nothing else refetches it here.
        await page.clock.fastForward("00:05:05")
        await expect(
          health.getByText("Data may be stale", { exact: true })
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
          page.getByText("Google is not connected.", { exact: true })
        ).toBeVisible()
        await expect(
          page.getByText(
            "Reconnect Google to sync and reply to your reviews.",
            { exact: true }
          )
        ).toBeVisible()
        await expect(
          page.getByRole("link", { name: "Reconnect Google" })
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
          await reviewList.getByRole("button", { name: /^Jordan Lee/ }).click()
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
                workspaceMode: "agency",
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
          page.getByRole("heading", { name: "Google connections" })
        ).toBeVisible()
        // Current section headings (components/settings/*-card.tsx) — the old
        // aria-labelled-section names ("Connection setup progress", "Google
        // location import", "Historical review backfill", "Notification
        // management", "Connection management", "Connection status and
        // guidance") don't exist on any current card.
        await expect(
          page.getByRole("heading", {
            name: "Google accounts",
            level: 2,
            exact: true,
          })
        ).toBeVisible()
        // Choosing accounts, importing locations and backfilling history all
        // moved to /setup, where they run in order against a named client.
        // What is left here is the account-level view: what is connected, who
        // depends on it (a "Clients it serves" column, which becomes a row
        // label on a phone), and how to start a client.
        await expect(
          page.getByRole("heading", {
            name: "Real-time notifications",
            level: 2,
          })
        ).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Setting up a client", level: 2 })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} connections`)
      })

      test("settings policy and the team page", async ({ baseURL, page }) => {
        // Real tenant/cookie: /settings' PolicyForm fetches
        // `/api/settings/capabilities` for real (never mocked below), /team
        // gates on an owner/admin session server-side, which the client-side
        // `/api/session` mock alone cannot satisfy, and since P20 the policy
        // settings and Team's members and invitations are read on the server
        // too. So the scanned state is seeded into a throwaway tenant rather
        // than stubbed: Reply policy with approval on and 30 days kept, a
        // second owner and one pending invitation.
        const team = await seedTeamTenant({
          members: [
            {
              displayName: "Alex Morgan",
              email: "alex.{id}@example.test",
              role: "owner",
              canPublish: true,
            },
          ],
          invitations: [
            {
              email: "invitee@example.com",
              role: "member",
              canPublish: false,
              createdAt: new Date("2026-07-29T09:00:00.000Z"),
              // Always a week ahead: a fixed date expires and turns the row
              // into the expired state this check does not cover.
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          ],
          settings: { approvalRequired: true, rawContentRetentionDays: 30 },
        })
        cleanups.push(team.destroy)
        const alex = team.members[0]!
        await applyCookie(page, baseURL, team.cookie)
        await page.route(/\/api\/session(?:\?.*)?$/, async (route) => {
          await route.fulfill({
            json: {
              session: {
                sessionId: "session-settings-a11y",
                userId: "user-settings-a11y",
                organisationId: "org-settings-a11y",
                organisationName: "Naba Presence",
                workspaceMode: "agency",
                displayName: "Alex Morgan",
                email: "alex@example.com",
                role: "owner",
                canPublish: true,
              },
            },
          })
        })
        await page.route(/\/api\/location-links(?:\?.*)?$/, async (route) => {
          await route.fulfill({ json: { locations: [] } })
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
        // On phones /settings is the grouped settings index and Reply policy
        // is its own page; from md /settings still lands on Reply policy.
        // Scan both pages at every width.
        await page.goto("/settings")
        await expect(
          page.getByRole("heading", {
            name: viewport.name === "mobile" ? "Settings" : "Reply policy",
            level: 1,
          })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} settings home`)
        await page.goto("/settings/policy")
        await expect(
          page.getByRole("heading", { name: "Reply policy", level: 1 })
        ).toBeVisible()
        await expectAccessible(
          page,
          `${viewport.name} ${theme} reply policy settings`
        )

        await page.goto("/team")
        await expect(
          page.getByRole("heading", { name: "Team", level: 1 })
        ).toBeVisible()
        // From md the table's row menu holds every action. On a phone each
        // member is a row that opens the member sheet (SET-02).
        if (viewport.name === "mobile") {
          await expect(
            page.getByRole("button", {
              name: `Alex Morgan, ${alex.email}`,
            })
          ).toBeVisible()
        } else {
          await expect(
            page.getByRole("button", { name: "Actions for Alex Morgan" })
          ).toBeVisible()
        }
        await expect(
          page.getByRole("button", {
            name: "Copy invite link for invitee@example.com",
          })
        ).toBeVisible()
        await expectAccessible(page, `${viewport.name} ${theme} team`)
        if (viewport.name === "mobile") {
          await page
            .getByRole("button", {
              name: `Alex Morgan, ${alex.email}`,
            })
            .click()
          await expect(
            page.getByRole("dialog", { name: "Alex Morgan" })
          ).toBeVisible()
          await expectAccessible(page, `${viewport.name} ${theme} member sheet`)
          await page.keyboard.press("Escape")
        }
      })
    })
  }
}
