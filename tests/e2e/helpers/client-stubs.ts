import type { Page } from "@playwright/test"

/** Signs the page in with a journey cookie ("name=value", as the bridge stores it). */
export async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

/**
 * A client summary that satisfies `clientSummarySchema`
 * (lib/contracts/clients.ts), for stubbing `POST/PATCH /api/clients` answers
 * and `GET /api/clients/{id}`. `id` is usually the seeded client's, so the
 * page the app navigates to afterwards is a real one.
 */
export function stubClientSummary(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    locationCount: 0,
    linkedCount: 0,
    verifiedCount: 0,
    health: "not_connected",
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 0, notStarted: 0 },
    lastSyncAt: null,
    ...overrides,
  }
}
