// Client scope (lib/clients/scope.ts): `?clientId=` on Inbox, Listings and
// Reports is the scope. The top-bar switcher only renders when there is more
// than one client (components/app-shell/client-switcher.tsx: `clients.length
// <= 1` returns null) and the seeded tenant has exactly one, "Journey
// Hospitality", so this journey scopes from the client's hub and returns to
// all clients through the Inbox's removable "Client: …" filter chip.
import { describe, test } from "@e2e-dev/web"
import { expect } from "e2e"

import { pathPattern, readJourneyState, requireLayout } from "./support.ts"

/** /inbox with no clientId in the query. */
const UNSCOPED_INBOX = /^https?:\/\/[^/]+\/inbox(?:\?(?!(?:.*&)?clientId=).*)?$/

describe("client scope", { tags: ["desktop", "clients"] }, () => {
  test(
    "scope the Inbox to the seeded client, then back to all clients",
    { session: "owner", timeout: 300_000 },
    async ({ agent, app, browser, screen }) => {
      const state = await readJourneyState()
      await app.open("/clients")
      await requireLayout(browser, "desktop")
      await expect(
        screen.getByRole("heading", { name: "Clients", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await agent.act("Open the client {client} from the clients table", {
        params: { client: state.clientName },
      })
      await expect(browser).toHaveURL(pathPattern(`/clients/${state.clientId}`))
      await expect(
        screen.getByRole("heading", { name: state.clientName, level: 1 })
      ).toBeVisible()

      await agent.act(
        'Open this client\'s Inbox: use "Open inbox", or the "Needs reply" tile if there is no Open inbox button'
      )
      await expect(browser).toHaveURL(
        new RegExp(
          `^https?://[^/]+/inbox\\?(?:.*&)?clientId=${state.clientId}(?:&.*)?$`
        ),
        { timeout: 30_000 }
      )
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible()
      // The scope stays on screen as a removable chip.
      const clientChip = screen.getByRole("button", {
        name: /^Remove filter: Client: /,
      })
      await expect(clientChip).toBeVisible()
      await agent.assert(
        `The Inbox shows that it is filtered to the client "${state.clientName}"`
      )

      await agent.act(
        'Remove the client filter so the Inbox shows all clients (the "Client: …" filter chip)'
      )
      await expect(browser).toHaveURL(UNSCOPED_INBOX, { timeout: 30_000 })
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible()
      await expect(clientChip).toHaveCount(0)
    }
  )
})
