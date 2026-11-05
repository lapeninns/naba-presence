import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { readJourneyState, requireLayout, useSessionCookie } from "./support.ts"

describe(
  "listing editor capability notices",
  { tags: ["desktop", "listings", "editor-capabilities"] },
  () => {
    for (const reconnect of [true, false]) {
      test(
        `${reconnect ? "reconnect gate" : "verification advisory"} keeps local edits available`,
        { timeout: 240_000 },
        async ({ app, agent, browser, screen }) => {
          const state = (await readJourneyState()).editorCapabilities
          await useSessionCookie(browser, app.baseUrl, state.cookie)
          await app.open(
            `/listings/${reconnect ? state.reconnectLocationId : state.unverifiedLocationId}/hours`
          )
          await requireLayout(browser, "desktop")
          await expect(
            screen.getByText(
              reconnect
                ? "The Google login for this listing needs reconnecting"
                : "Google verification isn’t confirmed for this listing",
              { exact: true }
            )
          ).toBeVisible({ timeout: 45_000 })
          await expect(
            screen.getByRole("switch", { name: "Monday open" })
          ).toBeEnabled()
          if (!reconnect) {
            await expect(
              screen.getByText("Hours changed on Google", { exact: true })
            ).toBeVisible()
            await expect(
              screen.getByRole("button", {
                name: "Keep Google’s hours",
                exact: true,
              })
            ).toBeEnabled()
          }
          await agent.act(
            'Toggle the "Monday open" switch once to edit the local schedule. Do not save, review or publish any changes.'
          )
          await expect(
            screen.getByRole("button", { name: "Save here", exact: true })
          ).toBeEnabled()
          const review = screen.getByRole("button", {
            name: "Review changes",
            exact: true,
          })
          if (reconnect) await expect(review).toBeDisabled()
          else await expect(review).toBeEnabled()
          await agent.assert(
            reconnect
              ? "The page explains that the Google login needs reconnecting and that editing and saving here remain possible."
              : "The page presents verification as a warning while still allowing editing and submitting changes; it does not say all publishing is forbidden."
          )
        }
      )
    }
  }
)
