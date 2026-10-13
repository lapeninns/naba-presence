// Business profile editor: an unsaved edit guards the way out
// (lib/editors/use-leave-guard.ts intercepts in-app link clicks and opens
// "Leave without saving?"). Desktop only: the way out is the sidebar's
// Primary navigation. Nothing is published, but it stays on desktop with the
// other editor journeys.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { pathPattern, readJourneyState, requireLayout } from "./support.ts"

describe("listing profile", { tags: ["desktop", "listings"] }, () => {
  test(
    "an unsaved edit asks before leaving; keep editing, then leave and discard",
    { session: "owner", timeout: 300_000 },
    async ({ agent, app, browser, screen }) => {
      const state = await readJourneyState()
      const profilePath = `/listings/${state.primaryLocationId}/profile`
      await app.open(profilePath)
      await requireLayout(browser, "desktop")
      await expect(
        screen.getByRole("heading", { name: "Business profile", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      // The editor waits on paced Google reads (the local stub) before it
      // fills in.
      const name = screen.getByRole("textbox", { name: "Business name" })
      await expect(name).toBeEnabled({ timeout: 45_000 })

      const suffix = " Edited"
      await agent.act(
        'Add {suffix} to the end of the "Business name" field, keeping the current name. Do not save or publish.',
        {
          params: { suffix },
        }
      )
      await expect(name).toHaveValue(/ Edited$/)
      await expect(
        screen.getByRole("button", { name: "Review changes" })
      ).toBeVisible()

      // Leave through the app's own navigation, not the address bar: the
      // guard answers link clicks with an in-app dialog.
      const prompt = screen.getByRole("alertdialog", {
        name: "Leave without saving?",
      })
      await agent.act(
        'Leave this page by clicking the "Inbox" link in the sidebar navigation. Do not type an address. If a dialog asks about unsaved changes, stop and leave it open.'
      )
      await expect(prompt).toBeVisible()
      await expect(browser).toHaveURL(pathPattern(profilePath))

      await agent.act(
        'In the "Leave without saving?" dialog, choose "Keep editing"'
      )
      await expect(prompt).toBeHidden()
      await expect(browser).toHaveURL(pathPattern(profilePath))
      await expect(name).toHaveValue(/ Edited$/)

      // Still guarded: the next way out asks again, and discarding leaves.
      await agent.act(
        'Click the "Inbox" link in the sidebar navigation again. When "Leave without saving?" appears, choose "Leave and discard".'
      )
      await expect(browser).toHaveURL(pathPattern("/inbox"), {
        timeout: 30_000,
      })
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible()

      // The discarded edit is gone: the editor opens clean, nothing to review.
      await app.open(profilePath)
      await expect(name).toBeEnabled({ timeout: 45_000 })
      await expect(name).not.toHaveValue(/ Edited$/)
      await expect(
        screen.getByRole("button", { name: "Review changes" })
      ).toHaveCount(0)
    }
  )
})
