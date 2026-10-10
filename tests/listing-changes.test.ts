import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { apiFetch, ApiClientError, isAwaitingApproval } from "@/lib/api/client"
import {
  LISTING_CHANGE_AWAITING_APPROVAL,
  LISTING_CHANGE_EDITOR,
  LISTING_CHANGE_KINDS,
  LISTING_CHANGE_LABEL,
  type ListingChangeParkedResponse,
} from "@/lib/contracts/listing-changes"
import { ORG_FEATURES } from "@/lib/contracts/org-features"
import { describeOutcome } from "@/lib/editors/outcome"
import {
  describeActionError,
  errorOutcome,
  isUnconfirmedFailure,
} from "@/lib/errors/action-errors"
import { LISTING_CHANGE_ENTRIES } from "@/lib/server/listing-change-registry"
import { describeListingChange } from "@/lib/domain/listing-change-details"
import {
  LISTING_CHANGE_DECIDER_ROLES,
  LISTING_CHANGE_FEATURE,
} from "@/lib/server/listing-changes"
import { RECOVERY_ADAPTERS } from "@/lib/server/mutation-recovery-registry"

/**
 * Two-person approval for direct listing writes (plan P02-S2b). The parking,
 * approval and dispatch paths run against Postgres in
 * tests/integration/routes/listing-change-approval.test.ts; this file pins
 * the registry and the client's reading of a parked answer.
 */

describe("listing change registry", () => {
  it("covers every kind with an entry of that kind", () => {
    expect(Object.keys(LISTING_CHANGE_ENTRIES).sort()).toEqual(
      [...LISTING_CHANGE_KINDS].sort()
    )
    for (const [key, entry] of Object.entries(LISTING_CHANGE_ENTRIES)) {
      expect(entry.kind).toBe(key)
      expect(LISTING_CHANGE_LABEL[entry.kind].length).toBeGreaterThan(0)
      expect(LISTING_CHANGE_EDITOR[entry.kind]).toBeTruthy()
    }
  })

  it("records each change under a surface the recovery job can read back", () => {
    // An approved request follows its dispatch's attempt, so an uncertain
    // one is recovered through the same (surface, attempt table) adapter.
    const surfaces = new Set(
      (RECOVERY_ADAPTERS as unknown as { surface: string }[]).map(
        (adapter) => adapter.surface
      )
    )
    for (const entry of Object.values(LISTING_CHANGE_ENTRIES)) {
      expect(surfaces, entry.kind).toContain(entry.surface)
    }
  })

  it("is switched by a known, default-off organisation feature", () => {
    expect(ORG_FEATURES).toContain(LISTING_CHANGE_FEATURE)
  })

  it("routes every listing write through submitListingChange", () => {
    const routes: Record<string, string[]> = {
      "hours/route.ts": ['"hours_publish"'],
      "profile/route.ts": ['"profile_publish"'],
      "business-information/route.ts": [
        '"business_information_update"',
        '"business_attributes_update"',
      ],
      "industry/route.ts": ['"industry_update"'],
      "food-menus/route.ts": ['"food_menus_publish"'],
      "media/route.ts": ['"media_create"', "refuseUploadWhenApprovalRequired("],
      "media/[mediaId]/route.ts": ['"media_update"', '"media_delete"'],
      "place-actions/route.ts": ['"place_action_create"'],
      "place-actions/[linkId]/route.ts": [
        '"place_action_update"',
        '"place_action_delete"',
      ],
    }
    for (const [file, needles] of Object.entries(routes)) {
      const source = readFileSync(
        join(process.cwd(), "app/api/locations/[id]", file),
        "utf8"
      )
      for (const needle of needles) expect(source, file).toContain(needle)
    }
  })
})

describe("deciding a listing change", () => {
  /** The `roles` of the route() block that submits `kind`, if any. */
  function routeRoles(kind: string): string[] | null {
    const files = [
      "hours/route.ts",
      "profile/route.ts",
      "business-information/route.ts",
      "industry/route.ts",
      "food-menus/route.ts",
      "media/route.ts",
      "media/[mediaId]/route.ts",
      "place-actions/route.ts",
      "place-actions/[linkId]/route.ts",
    ]
    for (const file of files) {
      const source = readFileSync(
        join(process.cwd(), "app/api/locations/[id]", file),
        "utf8"
      )
      for (const block of source.split(/\nexport const /)) {
        if (
          !block.includes("submitListingChange(") ||
          !block.includes(`"${kind}"`)
        ) {
          continue
        }
        const roles = /\broles: \[([^\]]*)\]/.exec(block)
        return roles
          ? roles[1]!
              .split(",")
              .map((role) => role.trim().replace(/"/g, ""))
              .filter(Boolean)
          : null
      }
    }
    throw new Error(`no route submits ${kind}`)
  }

  it("requires the authoring route's roles of every decider", () => {
    for (const kind of LISTING_CHANGE_KINDS) {
      const expected = routeRoles(kind)
      const actual = LISTING_CHANGE_DECIDER_ROLES[kind]
      expect(actual ? [...actual].sort() : null, kind).toEqual(
        expected ? expected.sort() : null
      )
    }
  })

  it("shows the approver every content value of the frozen body", () => {
    const details = describeListingChange({
      kind: "place_action_create",
      target: null,
      body: {
        confirmation: "create_google_place_action",
        uri: "https://phish.example.com/book",
        placeActionType: "DINING_RESERVATION",
        isPreferred: true,
      },
    })
    expect(details).toEqual([
      { label: "Web address", value: "https://phish.example.com/book" },
      { label: "Link type", value: "DINING_RESERVATION" },
      { label: "Preferred link", value: "Yes" },
    ])

    const info = describeListingChange({
      kind: "business_information_update",
      target: null,
      body: {
        operation: "update_location",
        payload: { title: "The Bell", phoneNumbers: { primaryPhone: "01234" } },
        updateMask: ["title", "phoneNumbers"],
        expectedGoogleHash: "a".repeat(64),
      },
    })
    expect(info).toContainEqual({ label: "Title", value: "The Bell" })
    expect(info).toContainEqual({
      label: "Phone numbers › Primary phone",
      value: "01234",
    })
    // Bookkeeping is not content: masks are shown as fieldMask, hashes are
    // checked at dispatch.
    expect(info.map((row) => row.label).join()).not.toMatch(/mask|hash/i)
  })

  it("names the photo a delete removes and what it is now", () => {
    expect(
      describeListingChange({
        kind: "media_delete",
        target: "66666666-6666-4666-8666-666666666666",
        body: { confirmation: "delete_google_media", expectedGoogleHash: "c" },
        targetNow: { category: "INTERIOR", googleUrl: "https://g/p.jpg" },
      })
    ).toEqual([
      { label: "Photo", value: "66666666-6666-4666-8666-666666666666" },
      { label: "Now: category", value: "INTERIOR" },
      { label: "Now: google url", value: "https://g/p.jpg" },
    ])
  })

  it("says a saved-copy publish sends the editor's saved copy", () => {
    expect(
      describeListingChange({
        kind: "hours_publish",
        target: null,
        body: {
          confirmation: "publish_nabapresence_hours_to_google",
          expectedCanonicalRevision: 4,
          approvedUpdateMask: ["regularHours"],
          confirmOverwriteGoogleChanges: false,
        },
      })
    ).toEqual([
      expect.objectContaining({ label: "Publishes" }),
      { label: "Saved version", value: "4" },
      { label: "Overwrite changes made on Google", value: "No" },
    ])
  })
})

describe("a parked answer on the client", () => {
  afterEach(() => vi.restoreAllMocks())

  const parked: ListingChangeParkedResponse = {
    status: "awaiting_approval",
    changeRequest: {
      id: "11111111-1111-4111-8111-111111111111",
      intentId: "22222222-2222-4222-8222-222222222222",
      kind: "hours_publish",
      label: LISTING_CHANGE_LABEL.hours_publish,
      locationId: "33333333-3333-4333-8333-333333333333",
      target: null,
      fieldMask: ["regularHours"],
      details: [],
      payloadHash: "b".repeat(64),
      outcome: "awaiting_approval",
      errorCode: null,
      author: { id: "44444444-4444-4444-8444-444444444444", name: "Ada" },
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T10:00:00.000Z",
      isOwn: false,
      canDecide: false,
    },
    operation: {
      operationId: "11111111-1111-4111-8111-111111111111",
      outcome: "awaiting_approval",
    },
  }

  function respond(status: number, body: unknown) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  }

  it("raises a 202 change request as awaiting approval, never as success or failure", async () => {
    respond(202, parked)
    const error = await apiFetch("/api/locations/x/hours", {
      method: "POST",
      body: {},
      schema: { safeParse: () => ({ success: true, data: "parsed" }) } as never,
    }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(isAwaitingApproval(error)).toBe(true)
    const apiError = error as ApiClientError
    expect(apiError.status).toBe(202)
    expect(apiError.code).toBe(LISTING_CHANGE_AWAITING_APPROVAL)
    expect(apiError.details).toMatchObject({
      operationId: parked.operation.operationId,
      changeRequest: { kind: "hours_publish" },
    })
    expect(errorOutcome(error)).toBe("awaiting_approval")
    // Nothing was sent, so a retry is a new request, not a resend.
    expect(isUnconfirmedFailure(error)).toBe(false)
    expect(describeActionError(error)).toMatch(/^Sent for approval\./)
    expect(describeOutcome("awaiting_approval").live).toBe(false)
  })

  it("leaves any other 202 to the caller's schema", async () => {
    respond(202, { status: "awaiting_approval" })
    await expect(
      apiFetch("/api/locations/x/posts/y/publish", { method: "POST" })
    ).resolves.toEqual({ status: "awaiting_approval" })
  })
})
