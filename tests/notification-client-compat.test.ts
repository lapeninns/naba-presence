import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchShellStatus } from "@/lib/api/shell-status"
import {
  fetchNotificationPreferences,
  fetchNotifications,
  updateNotificationPreferences,
} from "@/lib/api/operational-notifications"
import {
  CLIENT_CAPABILITIES_HEADER,
  clientCapabilityHeaders,
  requestHasCapability,
} from "@/lib/contracts/client-capabilities"
import {
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
} from "@/lib/contracts/operational-notifications"

import * as mainContract from "./fixtures/contracts/notifications-main-3f335f82"

/**
 * Deploy skew (#214 review, P1): during a deployment, browsers still on the
 * build before the approval kinds (main 3f335f82) call the new server and
 * check its answers with their own strict contracts. These tests pin both
 * halves of the fix: the new kinds are only sent to a build that declares
 * it reads them, and this build's readers drop a kind they do not know
 * instead of rejecting the whole answer.
 */

const item = (kind: string, id: string) => ({
  id,
  kind,
  subjectType: "review",
  subjectId: `org:review:${id}`,
  locationId: "11111111-1111-4111-8111-111111111111",
  locationName: "Fixture Inn 1",
  status: "open",
  reason: null,
  summary: { title: "Fixture Inn 1" },
  openedAt: "2026-10-17T06:00:00.000Z",
  lastSeenAt: "2026-10-17T06:00:00.000Z",
  resolvedAt: null,
  readAt: null,
  canResolve: false,
})
const KNOWN = "22222222-2222-4222-8222-222222222222"
const NEW = "33333333-3333-4333-8333-333333333333"
const list = (kinds: string[]) => ({
  items: kinds.map((kind, index) => item(kind, index === 0 ? KNOWN : NEW)),
  nextCursor: null,
  unreadCount: kinds.length,
})
const preferences = (kinds: string[]) => ({
  emailConfigured: true,
  preferences: kinds.flatMap((kind) =>
    (["in_app", "email"] as const).map((channel) => ({
      kind,
      channel,
      mode: channel === "in_app" ? "immediate" : "off",
      explicit: false,
    }))
  ),
})

describe("notification answers and older clients", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("main's contract rejects a whole answer that names a new kind", () => {
    // Why the server must not send them to an older build.
    expect(
      mainContract.notificationListResponseSchema.safeParse(
        list(["publication_failed", "approval_requested"])
      ).success
    ).toBe(false)
    expect(
      mainContract.notificationPreferencesResponseSchema.safeParse(
        preferences(["publication_failed", "reply_sent_back"])
      ).success
    ).toBe(false)
    // The answer an older build is sent (no addressed kinds) still parses.
    expect(
      mainContract.notificationListResponseSchema.safeParse(
        list(["publication_failed"])
      ).success
    ).toBe(true)
  })

  it("drops rows of a kind this build does not know and keeps the rest", () => {
    const parsed = notificationListResponseSchema.parse(
      list(["publication_failed", "a_kind_from_a_later_build"])
    )
    expect(parsed.items.map((row) => row.id)).toEqual([KNOWN])
    const prefs = notificationPreferencesResponseSchema.parse(
      preferences(["approval_requested", "a_kind_from_a_later_build"])
    )
    expect([...new Set(prefs.preferences.map((row) => row.kind))]).toEqual([
      "approval_requested",
    ])
    // A row of a known kind is still checked in full.
    expect(
      notificationListResponseSchema.safeParse({
        ...list(["publication_failed"]),
        items: [{ ...item("publication_failed", KNOWN), status: "gone" }],
      }).success
    ).toBe(false)
  })

  it("reads the capability header exactly", () => {
    const request = (value?: string) => ({
      headers: new Headers(
        value === undefined ? {} : { [CLIENT_CAPABILITIES_HEADER]: value }
      ),
    })
    expect(requestHasCapability(request(), "notification-kinds-2")).toBe(false)
    expect(
      requestHasCapability(
        request("notification-kinds-1"),
        "notification-kinds-2"
      )
    ).toBe(false)
    expect(
      requestHasCapability(
        request("other, notification-kinds-2"),
        "notification-kinds-2"
      )
    ).toBe(true)
    expect(
      requestHasCapability(
        { headers: new Headers(clientCapabilityHeaders()) },
        "notification-kinds-2"
      )
    ).toBe(true)
    // S5: the Google change watch kind (0155) has its own capability; a
    // build that only reads the approval kinds does not get it.
    expect(
      requestHasCapability(
        request("notification-kinds-2"),
        "notification-kinds-3"
      )
    ).toBe(false)
    expect(
      requestHasCapability(
        { headers: new Headers(clientCapabilityHeaders()) },
        "notification-kinds-3"
      )
    ).toBe(true)
  })

  it("declares the capability on every read whose answer can name the new kinds", async () => {
    const seen: Array<[string, Headers]> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        seen.push([path, new Headers(init?.headers)])
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      })
    )
    // The answers are empty, so the schema checks fail; only the requests
    // matter here.
    await Promise.allSettled([
      fetchNotifications("all"),
      fetchNotificationPreferences(),
      updateNotificationPreferences([
        { kind: "approval_requested", channel: "in_app", mode: "off" },
      ]),
      fetchShellStatus(),
    ])
    expect(seen.map(([path]) => path.split("?")[0]).sort()).toEqual([
      "/api/notifications",
      "/api/notifications/preferences",
      "/api/notifications/preferences",
      "/api/shell-status",
    ])
    for (const [path, headers] of seen) {
      expect(
        requestHasCapability({ headers }, "notification-kinds-2"),
        path
      ).toBe(true)
      expect(
        requestHasCapability({ headers }, "notification-kinds-3"),
        path
      ).toBe(true)
    }
  })
})
