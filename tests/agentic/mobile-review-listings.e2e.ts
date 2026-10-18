// Phone journeys over the code AMA-146 split out of the first load: the
// Inbox's open review loads on demand (components/inbox/lazy-review-pane.tsx)
// and the Listings board's health pills come with the page
// (listingsBoardPrefetch). Mobile only; nothing is changed.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { pathPattern, readJourneyState, requireLayout } from "./support.ts"

describe(
  "mobile review and listings",
  { tags: ["mobile", "inbox", "listings"] },
  () => {
    test(
      "a phone opens a review from the list and goes back to it",
      { session: "owner", timeout: 300_000 },
      async ({ agent, app, browser, screen }) => {
        const state = await readJourneyState()
        await app.open("/inbox?queue=all")
        await requireLayout(browser, "mobile")
        await expect(
          screen.getByRole("heading", { name: "Inbox", level: 1 })
        ).toBeVisible({ timeout: 30_000 })

        await agent.act(
          "In the review list, tap the review that reads {review}",
          { params: { review: state.directReview.text } }
        )
        await expect(browser).toHaveURL(/[?&]selected=/)
        const selected = screen.getByRole("region", { name: "Selected review" })
        await expect(
          selected.getByText(state.directReview.text, { exact: true })
        ).toBeVisible()
        await expect(
          screen.getByRole("textbox", { name: "Your reply" })
        ).toBeVisible({ timeout: 30_000 })

        await agent.act(
          "Go back to the review list with the back control at the top of the screen. Do not use the browser's back button."
        )
        await expect(browser).not.toHaveURL(/[?&]selected=/)
        await expect(
          screen.getByRole("heading", { name: "Inbox", level: 1 })
        ).toBeVisible()
        // Below lg the list replaces the review again.
        await expect(selected).toBeHidden()
      }
    )

    test(
      "a phone sees each listing's health and filters and orders the board",
      { session: "owner", timeout: 300_000 },
      async ({ agent, app, browser, screen }) => {
        await app.open("/listings?health=attention")
        await requireLayout(browser, "mobile")
        await expect(
          screen.getByRole("heading", { name: "Listings", level: 1 })
        ).toBeVisible({ timeout: 30_000 })
        const health = screen.getByRole("group", { name: "Filter by health" })

        await agent.act(
          'In the "Filter by health" chips, tap "All" to show every listing'
        )
        await expect(browser).not.toHaveURL(/[?&]health=/)
        await expect(
          health.getByRole("button", { name: /^All/ })
        ).toHaveAttribute("aria-pressed", "true")
        // Every row carries its health pill; the fixture's are never checked.
        await expect(screen.getByText("Not checked").first()).toBeVisible()

        await agent.act(
          'Open the listing order menu (the chip reading "Worst first") and choose "By client"'
        )
        await expect(browser).toHaveURL(/[?&]order=client/)
        await expect(
          screen.getByRole("button", { name: "Order listings: By client" })
        ).toBeVisible()
        await expect(browser).toHaveURL(pathPattern("/listings"))
      }
    )
  }
)
