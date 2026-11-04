import type { TransactionSql } from "postgres"
import { describe, expect, it, vi } from "vitest"

import { OUTCOME_PRESENTATION } from "@/lib/editors/outcome"
import {
  decodeOutboxQuery,
  encodeOutboxQuery,
  outboxViewFromSearch,
  type OutboxItem,
} from "@/lib/outbox/contract"
import { outboxKeys } from "@/lib/outbox/keys"
import {
  OUTBOX_GROUPS,
  OUTBOX_PRESENTED_STATE,
  OUTBOX_STATES,
  outboxGroupOf,
  outboxRecoveryVerb,
  outboxStatus,
  type OutboxState,
} from "@/lib/outbox/vocabulary"
import {
  bulkItem,
  changeItem,
  changeState,
  compareItems,
  countOutbox,
  decodeCursor,
  pageOf,
  postItem,
  postState,
  replyItem,
  replyState,
  readOutboxCounts,
  readOutboxPage,
  SOURCE_LIMIT,
  type BulkRow,
  type ChangeRow,
  type PostRow,
  type ReplyRow,
} from "@/lib/server/outbox"

import type { Session } from "@/lib/server/session"

vi.mock("@/lib/server/org-features", () => ({
  isOrgFeatureEnabled: async () => false,
}))

const place = {
  locationId: "loc-1",
  locationName: "Harbour Inn",
  clientId: "client-1",
  clientName: "Journey Hospitality",
  clientIsHome: false,
}

const reply = (overrides: Partial<ReplyRow> = {}): ReplyRow => ({
  ...place,
  reviewId: "review-1",
  workflowStatus: "awaiting_approval",
  reviewerName: "Sam K.",
  reviewerAnonymous: false,
  starRating: 4,
  publishStatus: null,
  googleReplyState: null,
  attemptStatus: null,
  attemptOperation: null,
  failedDeletion: false,
  nextAttemptAt: null,
  sentBackAt: null,
  at: new Date("2026-11-02T10:00:00Z"),
  ...overrides,
})

const change = (overrides: Partial<ChangeRow> = {}): ChangeRow => ({
  ...place,
  id: "op-1",
  surface: "hours",
  action: "publish",
  state: "failed",
  errorCode: null,
  isRequest: false,
  at: new Date("2026-11-02T10:00:00Z"),
  ...overrides,
})

const post = (overrides: Partial<PostRow> = {}): PostRow => ({
  ...place,
  id: "post-1",
  status: "published",
  googleState: "PROCESSING",
  attemptOperation: null,
  attemptStatus: null,
  failedDeletion: false,
  lastErrorCode: null,
  topicType: "STANDARD",
  summary: "Autumn menu launches on Friday",
  sentBackAt: null,
  at: new Date("2026-11-02T10:00:00Z"),
  ...overrides,
})

describe("Outbox vocabulary", () => {
  it("reads every label, tone and glyph from the shared presentation map", () => {
    for (const state of OUTBOX_STATES) {
      const shared = OUTCOME_PRESENTATION[OUTBOX_PRESENTED_STATE[state]]
      const status = outboxStatus(state, { time: "14:05" })
      expect(status.tone).toBe(shared.tone)
      expect(status.glyph).toBe(shared.glyph)
      expect(status.label).toBe(shared.label.replace("{time}", "14:05"))
    }
  })

  it("says On Google for live alone", () => {
    const onGoogle = OUTBOX_STATES.filter(
      (state) => outboxStatus(state).label === "On Google"
    )
    expect(onGoogle).toEqual(["live"])
    for (const state of OUTBOX_STATES)
      expect(outboxStatus(state).label).not.toMatch(/published|live/i)
  })

  it("fills the retry time, and reads 'later' without one", () => {
    expect(outboxStatus("retrying", { time: "14:05" }).label).toBe(
      "Will retry at 14:05"
    )
    expect(outboxStatus("retrying").label).toBe("Will retry later")
  })

  it("puts each state in the DIRECTION §7.1 group", () => {
    const groups: Record<string, OutboxState[]> = {}
    for (const state of OUTBOX_STATES)
      (groups[outboxGroupOf(state)] ??= []).push(state)
    expect(groups).toEqual({
      person: ["approval", "changes", "approved"],
      google: ["sending", "retrying", "waiting", "uncertain"],
      failed: ["rejected", "failed"],
      live: ["live"],
    })
    expect(OUTBOX_GROUPS.map((group) => group.title)).toEqual([
      "Waiting for a person",
      "With Google",
      "Failed",
      "Confirmed today",
    ])
  })

  it("names a recovery verb that never sends from the Outbox", () => {
    expect(outboxRecoveryVerb("listing_change", "failed")).toBe("Retry sending")
    expect(outboxRecoveryVerb("post", "uncertain")).toBe("Check Google")
    expect(outboxRecoveryVerb("reply", "rejected")).toBe("Edit reply")
    expect(outboxRecoveryVerb("post", "rejected")).toBe("Edit and send again")
    expect(outboxRecoveryVerb("bulk", "approved")).toBe("Review and publish")
    expect(outboxRecoveryVerb("reply", "waiting")).toBe("View progress")
  })
})

describe("reply mapping", () => {
  it.each([
    ["started", "sending"],
    ["retryable", "retrying"],
    ["ambiguous", "uncertain"],
    ["failed", "failed"],
  ])(
    "maps the latest delete attempt %s over a confirmed reply",
    (attemptStatus, expected) => {
      expect(
        replyState(
          reply({
            workflowStatus: "published",
            publishStatus: "published",
            googleReplyState: "APPROVED",
            attemptOperation: "delete",
            attemptStatus,
            failedDeletion: attemptStatus === "failed",
          })
        )
      ).toBe(expected)
    }
  )

  it("links a definitively failed deletion to the existing reply", () => {
    expect(
      replyItem(
        reply({
          workflowStatus: "published",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          attemptOperation: "delete",
          attemptStatus: "failed",
          failedDeletion: true,
        })
      )
    ).toMatchObject({
      state: "failed",
      operation: "delete",
      title: "Delete reply to Sam K.",
      href: "/inbox?queue=done&selected=review-1",
    })
  })

  it.each<[Partial<ReplyRow>, OutboxState | null]>([
    [{ workflowStatus: "awaiting_approval" }, "approval"],
    [{ workflowStatus: "publish_requested" }, "sending"],
    [
      { workflowStatus: "publish_requested", attemptStatus: "retryable" },
      "retrying",
    ],
    [
      { workflowStatus: "publish_requested", attemptStatus: "ambiguous" },
      "uncertain",
    ],
    [
      {
        workflowStatus: "published",
        publishStatus: "published",
        googleReplyState: "PENDING",
      },
      "waiting",
    ],
    [
      {
        workflowStatus: "published",
        publishStatus: "accepted",
        googleReplyState: "APPROVED",
      },
      "waiting",
    ],
    [
      {
        workflowStatus: "published",
        publishStatus: "published",
        googleReplyState: "APPROVED",
      },
      "live",
    ],
    [{ workflowStatus: "published", googleReplyState: "REJECTED" }, "rejected"],
    [{ workflowStatus: "rejected" }, "rejected"],
    [{ workflowStatus: "failed" }, "failed"],
    [{ workflowStatus: "failed", attemptStatus: "ambiguous" }, "uncertain"],
    [{ workflowStatus: "drafted", sentBackAt: new Date() }, "changes"],
    [{ workflowStatus: "verified", sentBackAt: new Date() }, "changes"],
    [{ workflowStatus: "drafted" }, null],
    [{ workflowStatus: "new" }, null],
  ])("%o reads %s", (overrides, state) => {
    expect(replyState(reply(overrides))).toBe(state)
  })

  it("links to the Inbox queue that holds the review", () => {
    expect(replyItem(reply())?.href).toBe(
      "/inbox?queue=approval&selected=review-1"
    )
    expect(
      replyItem(reply({ workflowStatus: "failed", attemptStatus: "ambiguous" }))
        ?.href
    ).toBe("/inbox?queue=failed&selected=review-1")
    expect(
      replyItem(
        reply({ workflowStatus: "published", googleReplyState: "REJECTED" })
      )?.href
    ).toBe("/inbox?queue=done&selected=review-1")
    expect(replyItem(reply({ workflowStatus: "rejected" }))?.href).toBe(
      "/inbox?selected=review-1"
    )
  })

  it("names the reviewer, and hides a business's home client", () => {
    expect(replyItem(reply())).toMatchObject({
      title: "Reply to Sam K.",
      detail: "4-star review",
      clientName: "Journey Hospitality",
    })
    expect(
      replyItem(reply({ reviewerAnonymous: true, clientIsHome: true }))
    ).toMatchObject({
      title: "Reply to an anonymous reviewer",
      clientId: null,
      clientName: null,
    })
  })

  it("carries the retry time only while retrying", () => {
    const nextAttemptAt = new Date("2026-11-02T14:05:00Z")
    expect(
      replyItem(
        reply({
          workflowStatus: "publish_requested",
          attemptStatus: "retryable",
          nextAttemptAt,
        })
      )?.retryAt
    ).toBe(nextAttemptAt.toISOString())
    expect(
      replyItem(reply({ workflowStatus: "failed", nextAttemptAt }))?.retryAt
    ).toBeNull()
  })
})

describe("listing change mapping", () => {
  it.each<[Partial<ChangeRow>, OutboxState | null]>([
    [{ state: "awaiting_approval" }, "approval"],
    [{ state: "sent" }, "sending"],
    [{ state: "awaiting_confirmation" }, "waiting"],
    [{ state: "uncertain" }, "uncertain"],
    [{ state: "rejected" }, "rejected"],
    [{ state: "failed" }, "failed"],
    [{ state: "failed", errorCode: "google_readback_mismatch" }, "failed"],
    [{ state: "failed", errorCode: "approval_rejected" }, "changes"],
    [{ state: "failed", errorCode: "approval_withdrawn" }, null],
    [{ state: "failed", errorCode: "approval_superseded" }, null],
    [{ state: "confirmed_applied" }, "live"],
    [{ state: "saved_locally" }, null],
  ])("%o reads %s", (overrides, state) => {
    expect(changeState(change(overrides))).toBe(state)
  })

  it("titles the area and links to its editor", () => {
    expect(changeItem(change())).toMatchObject({
      title: "Opening hours",
      href: "/listings/loc-1/hours",
    })
    expect(
      changeItem(change({ surface: "food_menus", isRequest: true }))
    ).toMatchObject({
      title: "Food menu",
      detail: "Change request",
      href: "/listings/loc-1/menu",
    })
    expect(
      changeItem(change({ surface: "media", action: "create" }))
    ).toMatchObject({ title: "New photo", href: "/listings/loc-1/photos" })
  })
})

describe("post mapping", () => {
  it.each(["published", "failed", "ambiguous", "draft"])(
    "shows a definitively failed deletion for a %s post",
    (status) => {
      expect(
        postItem(
          post({
            status,
            googleState: "LIVE",
            attemptOperation: "delete",
            attemptStatus: "failed",
            failedDeletion: true,
          })
        )
      ).toMatchObject({
        state: "failed",
        operation: "delete",
        title: "Delete post",
        href: "/listings/loc-1/posts",
      })
    }
  )

  it.each<[Partial<PostRow>, OutboxState | null]>([
    [{ status: "awaiting_approval" }, "approval"],
    [{ status: "draft", sentBackAt: new Date() }, "changes"],
    [{ status: "draft" }, null],
    [{ status: "publishing" }, "sending"],
    [{ status: "published", googleState: "PROCESSING" }, "waiting"],
    [{ status: "published", googleState: null }, "waiting"],
    [{ status: "published", googleState: "LIVE" }, "live"],
    [{ status: "published", googleState: "REJECTED" }, "rejected"],
    [{ status: "failed", lastErrorCode: "google_post_rejected" }, "rejected"],
    [{ status: "failed" }, "failed"],
    [{ status: "ambiguous" }, "uncertain"],
    [{ status: "deleted" }, null],
  ])("%o reads %s", (overrides, state) => {
    expect(postState(post(overrides))).toBe(state)
  })

  it("shortens a long summary to one line", () => {
    const item = postItem(post({ summary: `${"word ".repeat(40)}\nmore` }))
    expect(item?.detail?.length).toBeLessThanOrEqual(80)
    expect(item?.detail).toMatch(/…$/)
    expect(postItem(post({ topicType: "OFFER" }))?.title).toBe("Offer post")
  })
})

describe("bulk rows", () => {
  const row = (overrides: Partial<BulkRow> = {}): BulkRow => ({
    operationId: "bulk-1",
    operation: "regular_hours",
    state: "failed",
    listings: 3,
    total: 12,
    locationId: null,
    locationName: null,
    clientId: null,
    clientName: null,
    clientIsHome: null,
    retryAt: null,
    at: new Date("2026-11-02T10:00:00Z"),
    ...overrides,
  })

  it("says how many of the batch's visible listings are in the state", () => {
    expect(bulkItem(row())).toMatchObject({
      id: "bulk:bulk-1:failed",
      kind: "bulk",
      title: "Bulk change: Opening hours",
      detail: "3 of 12 listings",
      locationId: null,
      locationName: "3 listings",
      href: "/listings/bulk/bulk-1",
    })
    expect(
      bulkItem(
        row({
          listings: 1,
          total: 1,
          locationId: "loc-1",
          locationName: "Harbour Inn",
        })
      )
    ).toMatchObject({
      detail: "1 listing",
      locationId: "loc-1",
      locationName: "Harbour Inn",
    })
  })
})

describe("paging", () => {
  const item = (id: string, state: OutboxState, at: string): OutboxItem => ({
    id,
    kind: "post",
    state,
    title: id,
    detail: null,
    locationId: "loc-1",
    locationName: "Harbour Inn",
    clientId: null,
    clientName: null,
    at,
    retryAt: null,
    href: "/listings/loc-1/posts",
  })

  const items = [
    item("live-new", "live", "2026-11-02T12:00:00.000Z"),
    item("failed-old", "failed", "2026-10-20T12:00:00.000Z"),
    item("approval", "approval", "2026-11-01T12:00:00.000Z"),
    item("waiting", "waiting", "2026-11-02T09:00:00.000Z"),
    item("failed-new", "failed", "2026-11-02T08:00:00.000Z"),
  ].sort(compareItems)

  it("orders by group, then newest first", () => {
    expect(items.map((i) => i.id)).toEqual([
      "approval",
      "waiting",
      "failed-new",
      "failed-old",
      "live-new",
    ])
  })

  it("walks every row exactly once, page by page", () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = pageOf(items, { cursor, limit: 2 })
      seen.push(...page.items.map((i) => i.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toEqual(items.map((i) => i.id))
  })

  it("has no next page when the rows fit", () => {
    expect(pageOf(items, { limit: 5 }).nextCursor).toBeNull()
    expect(pageOf([], { limit: 5 })).toEqual({ items: [], nextCursor: null })
  })

  it("refuses a cursor it did not write", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(/cursor/)
    expect(() =>
      decodeCursor(Buffer.from('{"rank":"x"}').toString("base64url"))
    ).toThrow(/cursor/)
  })

  it("counts each group, and says when a source is missing", () => {
    expect(countOutbox(items)).toEqual({
      person: 1,
      google: 1,
      failed: 2,
      live: 1,
      partial: false,
    })
    expect(countOutbox([], true).partial).toBe(true)
  })
})

describe("wire codec", () => {
  const clientId = "2f8e8a8e-6a4f-4d0e-9a39-3f5d7c1e2b10"

  it("round-trips a query in snake_case", () => {
    const params = encodeOutboxQuery({ clientId, group: "failed", limit: 20 })
    expect(params.toString()).toBe(
      `client_id=${clientId}&group=failed&limit=20`
    )
    expect(decodeOutboxQuery(params)).toEqual({
      clientId,
      locationId: undefined,
      group: "failed",
      cursor: undefined,
      limit: 20,
    })
  })

  it("refuses malformed ids and groups", () => {
    expect(() =>
      decodeOutboxQuery(new URLSearchParams("client_id=nope"))
    ).toThrow()
    expect(() => decodeOutboxQuery(new URLSearchParams("group=all"))).toThrow()
    expect(() => decodeOutboxQuery(new URLSearchParams("limit=1000"))).toThrow()
  })

  it("reads the page address leniently", () => {
    expect(
      outboxViewFromSearch(
        new URLSearchParams(`clientId=${clientId}&group=bogus&locationId=x`)
      )
    ).toEqual({ clientId, locationId: undefined, group: undefined })
  })

  it("keys each scope apart under one root", () => {
    expect(outboxKeys.counts({ clientId })).toEqual([
      "outbox",
      "counts",
      `all:${clientId}`,
    ])
    expect(outboxKeys.list({}, "failed")).toEqual([
      "outbox",
      "list",
      "all:all",
      "failed",
    ])
  })
})

describe("capped Outbox counts", () => {
  it.each([SOURCE_LIMIT, SOURCE_LIMIT + 1])(
    "reports incomplete counts in both read paths when %i replies exceed the cap",
    async (total) => {
      // The oldest failure falls outside the retained rows only at cap + 1.
      const replies = Array.from({ length: total }, (_, index) =>
        reply({
          reviewId: `review-${index}`,
          workflowStatus:
            index === SOURCE_LIMIT ? "failed" : "awaiting_approval",
        })
      )
      const sql = (async (parts: TemplateStringsArray) =>
        parts.join(" ").includes("from review r")
          ? replies
          : []) as unknown as TransactionSql
      sql.savepoint = (async (read: (tx: TransactionSql) => Promise<unknown>) =>
        read(sql)) as TransactionSql["savepoint"]
      const session = {
        role: "owner",
        organisationId: "org-1",
        userId: "user-1",
      } as Session
      const { page, counts } = await readOutboxPage(sql, session, {
        group: "failed",
        limit: 50,
      })
      expect(page.items).toEqual([])
      expect(page.nextCursor).toBeNull()
      expect(page.truncated).toBe(total > SOURCE_LIMIT)
      expect(page.unavailable).toEqual([])
      expect(counts).toEqual({
        person: SOURCE_LIMIT,
        google: 0,
        failed: 0,
        live: 0,
        partial: total > SOURCE_LIMIT,
      })
      expect(await readOutboxCounts(sql, session, {})).toEqual(counts)
    }
  )
})
