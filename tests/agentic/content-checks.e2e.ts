// Uses only a seeded disposable tenant and saves locally; no Google publish.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { readJourneyState, requireLayout, useSessionCookie } from "./support.ts"

describe(
  "post content checks",
  { tags: ["desktop", "listings", "mutates"] },
  () => {
    test(
      "a blocked post stays open and a warning requires explicit acknowledgement",
      { timeout: 300_000 },
      async ({ agent, app, browser, screen }) => {
        const state = await readJourneyState()
        await useSessionCookie(browser, app.baseUrl, state.cookie)
        await app.open("/listings/" + state.primaryLocationId + "/posts")
        await requireLayout(browser, "desktop")
        await expect(
          screen.getByRole("heading", { name: "Posts", level: 1 })
        ).toBeVisible({ timeout: 30_000 })

        await agent.act(
          'Open the "New post" composer. Do not publish anything.'
        )
        const composer = screen.getByRole("dialog", {
          name: "New post",
          exact: true,
        })
        await expect(composer).toBeVisible()
        const summary = composer.getByRole("textbox", { name: "Post summary" })
        const save = composer.getByRole("button", {
          name: "Save draft",
          exact: true,
        })
        const blocked = "Call +44 20 7946 0958 to reserve your table."
        await summary.fill(blocked)
        await save.click()
        await expect(composer.getByText(/Remove phone numbers/)).toBeVisible()
        await expect(composer).toBeVisible()
        await expect(summary).toHaveValue(blocked)

        const warning = "Come and see our new menu!!!"
        await summary.fill(warning)
        await save.click()
        const acknowledgement = composer.getByRole("checkbox", {
          name: "I have reviewed these content warnings.",
        })
        await expect(acknowledgement).toBeVisible()
        await expect(acknowledgement).not.toBeChecked()
        await expect(composer.getByText(/repeated punctuation/)).toBeVisible()

        // A second attempt without consent must still stay in the composer.
        await save.click()
        await expect(composer).toBeVisible()
        await expect(acknowledgement).not.toBeChecked()

        await agent.act(
          'In the "New post" composer, select "I have reviewed these content warnings.". Do not publish or save yet.'
        )
        await expect(acknowledgement).toBeChecked()
        await save.click()
        await expect(composer).toBeHidden()
        await expect(screen.getByText(warning, { exact: true })).toBeVisible()
      }
    )
  }
)
