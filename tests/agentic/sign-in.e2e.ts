// Sign-in in this environment (tests/visual/nm-serve.mjs):
// - LOCAL_BOOTSTRAP_ENABLED=false (nm-serve's default; `--bootstrap` turns it
//   on, and then every anonymous request is the local owner, /sign-in
//   included, so these tests would not apply). An anonymous /inbox is sent
//   to /sign-in.
// - PASSWORD_AUTH_ENABLED=false, so POST /api/auth/password/login answers
//   503 password_auth_disabled and the form shows the alert "Sign-in is
//   temporarily unavailable." (lib/api/auth-errors.ts).
// - /sign-in with a live session redirects to ?next= or /inbox
//   (app/(auth)/sign-in/page.tsx).
// Runs on both targets; nothing is written.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { pathPattern } from "./support.ts"

describe("sign-in", { tags: ["desktop", "mobile", "auth"] }, () => {
  test(
    "the sign-in form is usable and reports that password sign-in is unavailable",
    { timeout: 180_000 },
    async ({ agent, app, browser, screen }) => {
      // Fresh context, no cookie: /sign-in renders the form.
      await app.open("/sign-in")
      await expect(
        screen.getByRole("heading", {
          name: "Sign in to NabaPresence",
          level: 1,
        })
      ).toBeVisible({ timeout: 30_000 })

      await agent.act(
        'Fill "Email address" with {email} and "Password" with {password}, then press "Sign in" once. Password sign-in is switched off in this test environment, so an error message is the expected result: the goal is done once you have pressed "Sign in", whatever the page then says. Do not retry.',
        {
          params: {
            email: "someone@example.test",
            password: "correct-horse-9",
          },
        }
      )
      // Password auth is switched off here, so the honest outcome is the
      // provider-unavailable alert, and the visitor stays on /sign-in.
      await expect(screen.getByRole("main").getByRole("alert")).toContainText(
        "Sign-in is temporarily unavailable.",
        { timeout: 30_000 }
      )
      await expect(browser).toHaveURL(pathPattern("/sign-in"))
    }
  )

  test(
    "an anonymous visitor to /inbox is sent to sign in",
    { timeout: 120_000 },
    async ({ app, browser, screen }) => {
      await app.open("/inbox")
      await expect(browser).toHaveURL(pathPattern("/sign-in"), {
        timeout: 30_000,
      })
      await expect(
        screen.getByRole("heading", {
          name: "Sign in to NabaPresence",
          level: 1,
        })
      ).toBeVisible({ timeout: 30_000 })
    }
  )

  test(
    "a seeded session skips the sign-in page and lands on the Inbox",
    { session: "owner", timeout: 120_000 },
    async ({ app, browser, screen }) => {
      await app.open("/sign-in?next=%2Finbox")
      await expect(browser).toHaveURL(pathPattern("/inbox"), {
        timeout: 30_000,
      })
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
    }
  )
})
