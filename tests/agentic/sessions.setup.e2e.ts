// Seeded sessions. Password sign-in is off in this environment
// (PASSWORD_AUTH_ENABLED=false), so each persona is the seeded session cookie
// from the journey state, proven on /inbox before it is saved. No secret is
// filled, so screenshots stay available to the agent and the report.
import { test } from "@e2e-dev/web"
import { expect } from "e2e"

import {
  type JourneyState,
  readJourneyState,
  useSessionCookie,
} from "./support.ts"

type Persona = "owner" | "viewer" | "requester"

/** The persona's cookie, and a review only that persona's organisation has. */
const PERSONAS: Record<
  Persona,
  (state: JourneyState) => { cookie: string; review: string }
> = {
  // Owner of the "Sprint 5 Journey tenant" (direct publish, one client).
  owner: (state) => ({ cookie: state.cookie, review: state.directReview.text }),
  // Viewer in the same organisation: read-only everywhere.
  viewer: (state) => ({
    cookie: state.viewerCookie,
    review: state.directReview.text,
  }),
  // Member of the separate two-person-approval organisation.
  requester: (state) => ({
    cookie: state.approval.requesterCookie,
    review: state.approval.text,
  }),
}

for (const persona of Object.keys(PERSONAS) as Persona[]) {
  test.setup(
    `session: ${persona}`,
    { sessions: [persona] },
    async ({ app, browser, screen, session }) => {
      const { cookie, review } = PERSONAS[persona](await readJourneyState())
      await useSessionCookie(browser, app.baseUrl, cookie)
      await app.open("/inbox?queue=all")
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      // Prove the seeded organisation, not just any Inbox (with nm-serve
      // --bootstrap an anonymous visitor is the local owner): its own review
      // is in the list.
      await expect(
        screen.getByText(review, { exact: true }).first()
      ).toBeVisible({
        timeout: 30_000,
      })
      await session.save(persona)
    }
  )
}
