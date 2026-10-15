// Settings: moving between areas, and a viewer told plainly when a route is
// closed (tests/e2e/settings.spec.ts). From md (768px) /settings is Reply
// policy under a "Settings sections" tab row; below md it is an index of
// areas titled "Settings", and each area page leads back with the app bar's
// "Settings" back link.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { pathPattern, requireLayout } from "./support.ts"

const NO_ACCESS = /You don.t have access to this page/

describe("settings", { tags: ["settings"] }, () => {
  test(
    "desktop: the settings tabs reach Reply policy, Notifications and Google connections",
    { session: "owner", tags: ["desktop"], timeout: 240_000 },
    async ({ agent, app, browser, screen }) => {
      await app.open("/settings")
      await requireLayout(browser, "desktop")
      await expect(
        screen.getByRole("heading", { name: "Reply policy", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        screen.getByRole("navigation", { name: "Settings sections" })
      ).toBeVisible()

      await agent.act('Open "Notifications" in the Settings sections tabs')
      await expect(browser).toHaveURL(pathPattern("/settings/notifications"))
      await expect(
        screen.getByRole("heading", { name: "Notifications", level: 1 })
      ).toBeVisible()

      await agent.act('Open "Google connections" in the Settings sections tabs')
      await expect(browser).toHaveURL(pathPattern("/settings/connections"))
      await expect(
        screen.getByRole("heading", { name: "Google connections", level: 1 })
      ).toBeVisible()

      await agent.act('Open "Reply policy" in the Settings sections tabs')
      await expect(browser).toHaveURL(/\/settings(\/policy)?(\?.*)?$/)
      await expect(
        screen.getByRole("heading", { name: "Reply policy", level: 1 })
      ).toBeVisible()
    }
  )

  test(
    "mobile: the settings index leads to each area and back",
    { session: "owner", tags: ["mobile"], timeout: 240_000 },
    async ({ agent, app, browser, screen }) => {
      await app.open("/settings")
      await requireLayout(browser, "mobile")
      await expect(
        screen.getByRole("heading", { name: "Settings", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await agent.act('In the settings list, open "Reply policy"')
      await expect(browser).toHaveURL(pathPattern("/settings/policy"))
      await expect(
        screen.getByRole("heading", { name: "Reply policy", level: 1 })
      ).toBeVisible()

      await agent.act(
        'Go back to the settings list with the "Settings" back link at the top'
      )
      await expect(browser).toHaveURL(pathPattern("/settings"))
      await expect(
        screen.getByRole("heading", { name: "Settings", level: 1 })
      ).toBeVisible()

      await agent.act('In the settings list, open "Notifications"')
      await expect(browser).toHaveURL(pathPattern("/settings/notifications"))
      await expect(
        screen.getByRole("heading", { name: "Notifications", level: 1 })
      ).toBeVisible()

      await agent.act(
        'Go back to the settings list with the "Settings" back link at the top'
      )
      await expect(browser).toHaveURL(pathPattern("/settings"))

      await agent.act('In the settings list, open "Google connections"')
      await expect(browser).toHaveURL(pathPattern("/settings/connections"))
      await expect(
        screen.getByRole("heading", { name: "Google connections", level: 1 })
      ).toBeVisible()
    }
  )

  test(
    "a viewer is told they have no access to Google connections and Team",
    { session: "viewer", tags: ["desktop", "mobile"], timeout: 240_000 },
    async ({ agent, app, browser, screen }) => {
      await app.open("/settings/policy")
      await expect(
        screen.getByRole("heading", { name: "Reply policy", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      // The form loads after the heading; wait for it before judging.
      await agent.waitFor(
        "The Reply policy page has finished loading: its settings or a permissions message are shown, not a loading placeholder"
      )
      // The gate copy is being reworded in the redesign, so judge the outcome.
      await agent.assert(
        "The Reply policy page is view-only for this person: it says they cannot change these settings, or it offers no control to save changes"
      )

      // A colleague's link to an owner-only area explains the refusal on the
      // same address rather than landing somewhere else.
      await app.open("/settings/connections")
      await expect(browser).toHaveURL(pathPattern("/settings/connections"))
      await expect(
        screen.getByRole("heading", { name: NO_ACCESS, level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await app.open("/team")
      await expect(browser).toHaveURL(pathPattern("/team"))
      await expect(
        screen.getByRole("heading", { name: NO_ACCESS, level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await agent.act('Use the "Back to Inbox" link on this page')
      await expect(browser).toHaveURL(pathPattern("/inbox"))
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible()
    }
  )
})
