// Phone navigation (components/app-shell/tab-bar.tsx, more-sheet.tsx): below
// 768px the Primary navigation is a bottom tab bar (Inbox, Listings, Clients,
// Reports) plus a More button whose sheet (dialog "More", navigation "More")
// holds the rest: Calendar, Notifications, Team, Settings. Modelled on
// tests/e2e/touch-critical.spec.ts and routing.spec.ts. Mobile only.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { pathPattern, requireLayout } from "./support.ts"

describe("mobile navigation", { tags: ["mobile", "navigation"] }, () => {
  test(
    "the tab bar moves between destinations and More reaches the rest",
    { session: "owner", timeout: 300_000 },
    async ({ agent, app, browser, screen }) => {
      await app.open("/inbox")
      await requireLayout(browser, "mobile")
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      const tabs = screen.getByRole("navigation", { name: "Primary" })
      await expect(
        tabs.getByRole("button", { name: "More", exact: true })
      ).toBeVisible()

      for (const tab of [
        { name: "Listings", path: "/listings" },
        { name: "Clients", path: "/clients" },
        { name: "Reports", path: "/reports" },
        { name: "Inbox", path: "/inbox" },
      ]) {
        await agent.act(`Tap the "${tab.name}" tab in the bottom tab bar`)
        await expect(browser).toHaveURL(pathPattern(tab.path))
        await expect(
          screen.getByRole("heading", { name: tab.name, level: 1 })
        ).toBeVisible()
        // The tab's name may carry a count ("Inbox, 2 need a reply").
        await expect(
          tabs.getByRole("link", { name: new RegExp(`^${tab.name}`) })
        ).toHaveAttribute("aria-current", "page")
      }

      const sheet = screen.getByRole("dialog", { name: "More" })
      await agent.act('Tap "More" in the bottom tab bar')
      await expect(sheet).toBeVisible()
      await expect(
        sheet.getByRole("navigation", { name: "More" })
      ).toBeVisible()

      await agent.act('In the More sheet, tap "Team"')
      await expect(sheet).toBeHidden()
      await expect(browser).toHaveURL(pathPattern("/team"))
      await expect(
        screen.getByRole("heading", { name: "Team", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await agent.act(
        'Open the More sheet from the bottom tab bar and tap "Settings"'
      )
      await expect(browser).toHaveURL(pathPattern("/settings"))
      await expect(
        screen.getByRole("heading", { name: "Settings", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      // No tab holds Settings, so More is what reads as current.
      await expect(
        tabs.getByRole("button", { name: "More", exact: true })
      ).toHaveAttribute("data-current", "true")
    }
  )
})
