// Shared helpers for the agentic journeys (not a test file: the config glob
// only collects *.e2e.ts).
//
// The seeded tenant comes from tests/visual/nm-serve.mjs, which runs the
// journey bridge (tests/e2e/helpers/stub-bridge.ts) before the app starts and
// writes test-results/e2e-journey-state.json at the worktree root. The file
// is read when a test runs, never at import, so `e2e list` works without it.
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { test } from "@e2e-dev/web"
import type { Browser } from "@e2e-dev/web"

/** The parts of stub-bridge's `JourneyState` these journeys read. */
export type JourneyState = {
  cookie: string
  viewerCookie: string
  adminCookie: string
  memberAssignedCookie: string
  directReview: {
    id: string
    locationId: string
    locationName: string
    text: string
  }
  approvalReview: {
    id: string
    locationId: string
    locationName: string
    text: string
  }
  approval: {
    requesterCookie: string
    approverCookie: string
    reviewId: string
    locationId: string
    locationName: string
    text: string
  }
  primaryLocationId: string
  clientId: string
  clientName: string
}

const here = dirname(fileURLToPath(import.meta.url))

/** nm-serve exports NM_STATE_FILE to a child it starts; else the default. */
export const journeyStatePath =
  process.env.NM_STATE_FILE ??
  resolve(here, "../../test-results/e2e-journey-state.json")

export async function readJourneyState(): Promise<JourneyState> {
  try {
    return JSON.parse(await readFile(journeyStatePath, "utf8")) as JourneyState
  } catch (error) {
    throw new Error(
      `Journey state not found at ${journeyStatePath}; start the app through tests/visual/nm-serve.mjs so the tenant is seeded. (${String(error)})`
    )
  }
}

/**
 * Sets a seeded session cookie ("naba_session=<token>") on the app's origin.
 * The value is base64url, so the first "=" is the only separator.
 */
export async function useSessionCookie(
  browser: Browser,
  baseUrl: string | undefined,
  cookie: string
) {
  if (!baseUrl) throw new Error("The target has no app URL.")
  const at = cookie.indexOf("=")
  if (at <= 0) throw new Error("A seeded cookie must look like name=value.")
  await browser.setCookies([
    {
      name: cookie.slice(0, at),
      value: cookie.slice(at + 1),
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ])
}

/**
 * Both targets are platform "web", so `platforms` cannot tell them apart and
 * no fixture names the target. Tests carry a `desktop` or `mobile` tag for
 * selection (`--target desktop --tag desktop`), and this guard skips a test
 * that still lands on the wrong viewport (a run without --tag). Call it right
 * after the first `app.open()`, before anything changes data.
 */
export async function requireLayout(
  browser: Browser,
  layout: "desktop" | "mobile"
) {
  const width = await browser.evaluate(() => window.innerWidth)
  // The phone tab bar is drawn below 768px; the desk sidebar from 1180px.
  const isMobile = width < 768
  const isDesktop = width >= 1180
  test.skip(
    layout === "mobile" ? !isMobile : !isDesktop,
    `${layout} journey; this target is ${width}px wide`
  )
}

/** A full-URL RegExp for a path, with any query string allowed after it. */
export function pathPattern(path: string) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^https?://[^/]+${escaped}(?:\\?.*)?$`)
}
