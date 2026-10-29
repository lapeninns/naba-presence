import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { pageSettled, trackRequests } from "./helpers/settled"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

const AUTH_PAGES = [
  { path: "/sign-in", heading: "Sign in to NabaPresence" },
  {
    path: "/sign-in?mode=create-account",
    heading: "Create your NabaPresence account",
  },
  { path: "/forgot-password", heading: "Reset your password" },
  { path: "/reset-password", heading: "Choose a new password" },
]

test.describe("auth surfaces", () => {
  for (const page_ of AUTH_PAGES) {
    test(`${page_.path} renders one main and one h1`, async ({ page }) => {
      await page.goto(page_.path)
      await expect(
        page.getByRole("heading", { level: 1, name: page_.heading })
      ).toBeVisible()
      expect(await page.getByRole("main").count()).toBe(1)
    })
  }

  // Shared by single businesses and agencies (plan P06-5): no screen may
  // assume the reader manages clients. The aside is hidden below 901px, so
  // read the DOM text rather than only what is visible.
  for (const path of ["/sign-in", "/forgot-password", "/reset-password"]) {
    test(`${path} never addresses the reader as an agency with clients`, async ({
      page,
    }) => {
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      const text = (await page.locator("body").textContent()) ?? ""
      expect(text).not.toMatch(/\bclients?\b|client’s/i)
      expect(text).not.toMatch(/your agency|new agency/i)
    })
  }

  test("create account offers business or agency, business first", async ({
    page,
  }) => {
    await page.goto("/sign-in?mode=create-account")
    const group = page.getByRole("radiogroup", {
      name: "What are you setting up?",
    })
    await expect(
      group.getByRole("radio", { name: "My business" })
    ).toBeChecked()
    await group.getByRole("radio", { name: "An agency" }).focus()
    await page.keyboard.press("Space")
    await expect(group.getByRole("radio", { name: "An agency" })).toBeChecked()
  })

  test("sign-in form is keyboard operable and password toggling works", async ({
    page,
  }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email address").fill("someone@example.test")
    await page.getByLabel("Password").fill("correct-horse-9")
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "type",
      "password"
    )
    await page.getByRole("button", { name: "Show password" }).click()
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "text")
  })

  test("an unconfirmed account is offered a resend", async ({ page }) => {
    await page.route("**/api/auth/password/login", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "email_not_verified",
          message: "Confirm your email address before signing in.",
        }),
      })
    })
    await page.goto("/sign-in")
    await page.getByLabel("Email address").fill("someone@example.test")
    await page.getByLabel("Password").fill("correct-horse-9")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    const alert = page.getByRole("main").getByRole("alert")
    await expect(alert).toContainText("Confirm your email address to continue.")
    // Scoped to the alert: the sign-in surface also renders its own
    // always-visible resend affordance (D3), so more than one "Resend
    // confirmation email" button is on screen at once.
    await expect(
      alert.getByRole("button", { name: "Resend confirmation email" })
    ).toBeVisible()
  })

  test("a confirmation-link failure explains itself on sign-in", async ({
    page,
  }) => {
    await page.goto("/sign-in?status=invitation_expired")
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "That invitation has expired."
    )
  })

  test("a reset page without a token offers a fresh link", async ({ page }) => {
    await page.goto("/reset-password")
    await expect(page.getByLabel("New password")).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Request another link" })
    ).toBeVisible()
  })

  test("an expired invitation is a dead end with an exit", async ({ page }) => {
    await page.route("**/api/invitations/**", async (route) => {
      // A finished invitation answers with its code only (D8).
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invitation_expired",
          message: "This invitation is invalid or expired.",
        }),
      })
    })
    await page.goto("/invite/some-token")
    await expect(page.getByText("That invitation has expired.")).toBeVisible()
    await expect(page.getByText("Role", { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Go to sign in" })
    ).toBeVisible()
  })

  test("a live invitation shows the role and when the link expires", async ({
    page,
  }) => {
    await page.route("**/api/invitations/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          organisationName: "Lapen Inns",
          email: "invited@example.test",
          role: "member",
          expiresAt: "2099-10-22T14:05:00.000Z",
        }),
      })
    })
    await page.goto("/invite/some-token")
    await expect(
      page.getByRole("heading", { level: 1, name: "Join Lapen Inns" })
    ).toBeVisible()
    await expect(page.getByText("Role", { exact: true })).toBeVisible()
    await expect(page.getByText("Member", { exact: true })).toBeVisible()
    await expect(
      page.getByText("Drafts replies and posts; publishes only if allowed")
    ).toBeVisible()
    await expect(page.getByText("Link expires", { exact: true })).toBeVisible()
    // One password field: no confirmation on create-account (D9).
    await expect(page.getByLabel("Confirm password")).toHaveCount(0)
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean across auth pages (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      for (const target of AUTH_PAGES.map((p) => p.path)) {
        await page.goto(target)
        await pageSettled(page)
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${target} ${theme} wcag`).toEqual([])
        const best = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)),
          `${target} ${theme} structure`
        ).toEqual([])
      }
    })
  }
})

// The states this pass changed (docs/audits/2026-10-28-all-flows/p1): the
// legal contents, the confirmation interstitial and its incomplete link, the
// email-link failure on sign-in, and the two "Check your email" stages,
// in both themes. Every request is stubbed; nothing reaches a provider.
test.describe("changed auth states stay axe clean", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`axe clean on the changed states (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      const scan = async (label: string) => {
        await pageSettled(page)
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${label} ${theme}`).toEqual([])
      }
      for (const target of [
        "/privacy",
        "/terms",
        "/confirm-email?token_hash=fixture-token-hash-000000000000",
        "/confirm-email",
        "/sign-in?status=invalid_email_link&email=error",
      ]) {
        await page.goto(target)
        await scan(target)
      }

      await page.route("**/api/auth/password/reset/request", (route) =>
        route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ accepted: true }),
        })
      )
      await page.goto("/forgot-password")
      await page.getByLabel("Email address").fill("sam@example.test")
      await page.getByRole("button", { name: "Send reset link" }).click()
      await expect(
        page.getByRole("heading", { name: "Check your email" })
      ).toBeFocused()
      await scan("forgot-password sent")

      await page.route("**/api/auth/password/register", (route) =>
        route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            authenticated: false,
            confirmationRequired: true,
          }),
        })
      )
      await page.goto("/sign-in?mode=create-account")
      await page.getByLabel("Your name").fill("Sam Fixture")
      await page.getByLabel("Email address").fill("sam@example.test")
      await page
        .getByLabel("Password", { exact: true })
        .fill("correct horse battery staple")
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click()
      await expect(
        page.getByRole("heading", { name: "Check your email" })
      ).toBeFocused()
      await scan("create-account sent")
    })
  }
})

test.describe("auth surfaces raise no console or page errors", () => {
  const SWEEP = [
    "/sign-in",
    "/sign-in?mode=create-account",
    "/forgot-password",
    "/reset-password",
    "/invite/some-token",
  ]
  for (const theme of ["light", "dark"] as const) {
    test(`clean console across auth pages (${theme})`, async ({ page }) => {
      const requests = trackRequests(page)
      await page.emulateMedia({ colorScheme: theme })
      // /invite lookups hit the API on mount; give it a ready invitation so the
      // page renders the create-account form instead of erroring on the fetch.
      await page.route("**/api/invitations/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            organisationName: "Lapen Inns",
            email: "invited@example.test",
            role: "member",
            expiresAt: "2099-10-22T14:05:00.000Z",
          }),
        })
      })
      for (const target of SWEEP) {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
          if (msg.type() === "error") consoleErrors.push(msg.text())
        }
        const onPageError = (err: Error) => pageErrors.push(err.message)
        page.on("console", onConsole)
        page.on("pageerror", onPageError)
        await page.goto(target)
        await pageSettled(page)
        await requests.idle()
        page.off("console", onConsole)
        page.off("pageerror", onPageError)
        expect(consoleErrors, `${target} ${theme} console errors`).toEqual([])
        expect(pageErrors, `${target} ${theme} page errors`).toEqual([])
      }
    })
  }
})
