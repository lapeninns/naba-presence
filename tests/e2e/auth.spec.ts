import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = [
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "heading-order",
  "page-has-heading-one",
]

const AUTH_PAGES = [
  { path: "/sign-in", heading: "Sign in to NabaPresence" },
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

  test("sign-in form is keyboard operable and password toggling works", async ({
    page,
  }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email address").fill("someone@example.test")
    await page.getByLabel("Password").fill("correct-horse-9")
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "password")
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
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toContainText(
      "Confirm your email address to continue."
    )
    await expect(
      page.getByRole("button", { name: "Resend confirmation email" })
    ).toBeVisible()
  })

  test("a confirmation-link failure explains itself on sign-in", async ({
    page,
  }) => {
    await page.goto("/sign-in?status=invitation_expired")
    await expect(page.getByRole("alert")).toContainText(
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          organisationName: "Lapen Inns",
          email: "invited@example.test",
          accepted: false,
          expired: true,
        }),
      })
    })
    await page.goto("/invite/some-token")
    await expect(page.getByText("That invitation has expired.")).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean across auth pages (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      for (const target of [...AUTH_PAGES.map((p) => p.path), "/sign-in?mode=create-account"]) {
        await page.goto(target)
        await page.waitForLoadState("networkidle")
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
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
            accepted: false,
            expired: false,
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
        await page.waitForLoadState("networkidle")
        page.off("console", onConsole)
        page.off("pageerror", onPageError)
        expect(consoleErrors, `${target} ${theme} console errors`).toEqual([])
        expect(pageErrors, `${target} ${theme} page errors`).toEqual([])
      }
    })
  }
})
