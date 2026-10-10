import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  verification: vi.fn(),
  start: vi.fn(),
  settle: vi.fn(),
  audit: vi.fn(),
  token: vi.fn(),
}))
vi.mock("@/lib/server/db", () => ({
  getDatabase: () => ({}),
  withTenant: async (_id: string, callback: (sql: object) => unknown) =>
    callback({}),
}))
vi.mock("@/lib/server/env", () => ({
  gbpWritesEnabled: () => true,
  getServerEnv: () => ({}),
}))
vi.mock("@/lib/server/gbp-management", () => ({
  resolveGbpLocationContext: async () => ({
    connectionId: "con1",
    googleLocationName: "locations/111",
    accountName: "accounts/222",
    googleAccountId: "g1",
    canPublish: true,
  }),
  cacheGbpSnapshot: vi.fn(),
  startGbpMutation: mocks.start,
  settleGbpMutation: mocks.settle,
  auditGbpMutation: mocks.audit,
  googleCreateRequestId: () => "req",
}))
vi.mock("@/lib/server/google", () => ({
  connectionAccessToken: mocks.token,
  googleVerificationApi: mocks.verification,
  googleAccountManagementApi: mocks.account,
  GoogleMutationAmbiguousError: class extends Error {},
}))

import {
  ADMINISTRATION_CONFIRMATIONS,
  administrationMutationSchema,
  type AdministrationNamedOperation,
} from "@/lib/contracts/location-administration"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
import { administrationAccessTarget } from "@/lib/domain/google-administration"
import { prepareVerificationCompletion } from "@/lib/server/google-verification-transient"
import { ApiError } from "@/lib/server/http"
import {
  mutateLocationAdministration,
  scopedAdministrationResourceName,
} from "@/lib/server/location-administration"
import type { Session } from "@/lib/server/session"

const session: Session = {
  sessionId: "s1",
  organisationName: "Test",
  workspaceMode: "business",
  displayName: "Test",
  email: "test@invalid.test",
  userId: "u1",
  organisationId: "o1",
  role: "owner",
  canPublish: true,
}
const linked = {
  googleLocationName: "locations/111",
  accountName: "accounts/222",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockResolvedValue("synthetic-token")
  mocks.start.mockResolvedValue({ id: "m1", idempotent: false })
  mocks.account.mockResolvedValue({})
  mocks.verification.mockResolvedValue({})
})

// Names that must never reach a Google URL, per operation. Each is either
// malformed (traversal, query/fragment, encoded slash, wrong resource type)
// or well-formed but scoped to a location/account this request is not.
const hostile: Record<AdministrationNamedOperation, [string, unknown][]> = {
  complete_verification: [
    ["traversal", "locations/111/verifications/../../accounts/222/admins/9"],
    ["dot segment", "locations/111/verifications/.."],
    ["query injection", "locations/111/verifications/5?alt=media"],
    ["fragment injection", "locations/111/verifications/5#x"],
    ["encoded slash", "locations/111/verifications/5%2F..%2Fadmins"],
    ["other location", "locations/999/verifications/5"],
    ["wrong resource type", "locations/111/admins/5"],
    ["missing name", undefined],
  ],
  update_admin: [
    ["traversal", "locations/111/admins/../../999/admins/1"],
    ["query injection", "locations/111/admins/1?updateMask=account"],
    ["fragment injection", "accounts/222/admins/1#frag"],
    ["encoded slash", "accounts/222/admins/1%2F..%2F..%2F333"],
    ["other location", "locations/999/admins/1"],
    ["other account", "accounts/999/admins/1"],
    ["wrong resource type", "accounts/222/invitations/1"],
    ["bare parent", "locations/111"],
    ["non-string", 42],
  ],
  delete_admin: [
    ["traversal", "accounts/222/admins/../../../locations/999"],
    ["query injection", "locations/111/admins/1?x=y"],
    ["encoded slash", "locations/111/admins/%2E%2E"],
    ["other account", "accounts/2220/admins/1"],
    ["prefix of linked id", "locations/11/admins/1"],
    ["wrong resource type", "locations/111/verifications/1"],
    ["absolute url", "https://evil.test/locations/111/admins/1"],
  ],
  accept_invitation: [
    ["traversal", "accounts/222/invitations/../../999/invitations/1"],
    ["query injection", "accounts/222/invitations/1?key=x"],
    ["encoded slash", "accounts/222/invitations/1%2Fx"],
    ["other account", "accounts/999/invitations/1"],
    ["location parent", "locations/111/invitations/1"],
    ["wrong resource type", "accounts/222/admins/1"],
  ],
  decline_invitation: [
    ["fragment injection", "accounts/222/invitations/1#x"],
    ["whitespace", "accounts/222/invitations/1 "],
    ["other account", "accounts/1/invitations/1"],
    ["wrong resource type", "accounts/222/admins/1"],
  ],
}

const valid: Record<AdministrationNamedOperation, string[]> = {
  complete_verification: ["locations/111/verifications/abc-123_X"],
  update_admin: ["locations/111/admins/1", "accounts/222/admins/2"],
  delete_admin: ["locations/111/admins/1", "accounts/222/admins/2"],
  accept_invitation: ["accounts/222/invitations/7"],
  decline_invitation: ["accounts/222/invitations/7"],
}

const operations = Object.keys(hostile) as AdministrationNamedOperation[]

describe("administration resource names: contract", () => {
  const parse = (operation: AdministrationNamedOperation, name: unknown) =>
    administrationMutationSchema.safeParse({
      operation,
      confirmation: ADMINISTRATION_CONFIRMATIONS[operation],
      payload: { name, role: "MANAGER", pin: "12345" },
    })

  it.each(
    operations.flatMap((operation) =>
      hostile[operation]
        // Other-location/account names are well-formed: only the server,
        // which knows the linked location, can reject those.
        .filter(([label]) => !/^other |^prefix /.test(label))
        .map(([label, name]) => [operation, label, name] as const)
    )
  )("%s rejects %s", (operation, _label, name) => {
    const result = parse(operation, name)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "payload.name"
    )
  })

  it.each(
    operations.flatMap((operation) =>
      valid[operation].map((name) => [operation, name] as const)
    )
  )("%s accepts %s", (operation, name) => {
    expect(parse(operation, name).success).toBe(true)
  })

  it("leaves operations without a resource name untouched", () => {
    expect(
      administrationMutationSchema.safeParse({
        operation: "transfer_location",
        confirmation: ADMINISTRATION_CONFIRMATIONS.transfer_location,
        payload: { destinationAccount: "accounts/2" },
      }).success
    ).toBe(true)
  })
})

describe("administration resource names: server scope", () => {
  it.each(
    operations.flatMap((operation) =>
      hostile[operation].map(
        ([label, name]) => [operation, label, name] as const
      )
    )
  )("%s rejects %s before any Google call", async (operation, _label, name) => {
    expect(() =>
      scopedAdministrationResourceName(operation, name, linked)
    ).toThrow(ApiError)
    const error = await mutateLocationAdministration({
      session,
      locationId: "l1",
      operation,
      payload: { name, role: "MANAGER", pin: "12345" },
      requestId: "r1",
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_request",
      fieldErrors: { "payload.name": expect.any(String) },
    })
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.account).not.toHaveBeenCalled()
    expect(mocks.verification).not.toHaveBeenCalled()
  })

  // The legacy endpoint no longer sends name-bearing operations: after the
  // scope check they are refused in favour of the reviewed workflows, which
  // apply their own scoping (below).
  it.each(
    operations.flatMap((operation) =>
      valid[operation].map((name) => [operation, name] as const)
    )
  )("%s with the scoped name %s goes to its reviewed workflow without a Google call", async (operation, name) => {
    const error = await mutateLocationAdministration({
      session,
      locationId: "l1",
      operation,
      payload: { name, role: "MANAGER", pin: "12345" },
      requestId: "r1",
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code:
        operation === "complete_verification"
          ? "verification_review_required"
          : "administration_review_required",
    })
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.account).not.toHaveBeenCalled()
    expect(mocks.verification).not.toHaveBeenCalled()
  })
})

describe("administration resource names: reviewed workflows", () => {
  const adminOperations = ["update_admin", "delete_admin", "accept_invitation", "decline_invitation"] as const
  const request = (operation: (typeof adminOperations)[number], name: unknown) =>
    administrationAccessRequestSchema.safeParse({
      operation,
      payload: operation === "update_admin" ? { name, role: "MANAGER" } : { name },
    })

  it.each(
    adminOperations.flatMap((operation) =>
      hostile[operation].map(([label, name]) => [operation, label, name] as const)
    )
  )("%s never targets %s", (operation, _label, name) => {
    const parsed = request(operation, name)
    if (!parsed.success) return
    // Well-formed but outside the linked location/account.
    expect(() => administrationAccessTarget(parsed.data, linked)).toThrow(RangeError)
  })

  it("sends a scoped location admin name unchanged", () => {
    const parsed = request("update_admin", "locations/111/admins/1")
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(administrationAccessTarget(parsed.data, linked)).toMatchObject({
      resourceType: "location_admin",
      target: "locations/111/admins/1",
    })
  })

  it("records an account admin by its validated name", () => {
    const parsed = request("delete_admin", "accounts/222/admins/2")
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(administrationAccessTarget(parsed.data, linked)).toMatchObject({
      resourceType: "account_admin",
      target: "accounts/222/admins/2",
    })
  })

  it("answers an invitation on its scoped name", () => {
    const parsed = request("decline_invitation", "accounts/222/invitations/7")
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(administrationAccessTarget(parsed.data, linked)).toMatchObject({
      resourceType: "invitation",
      target: "accounts/222/invitations/7",
    })
  })

  it.each(hostile.complete_verification)(
    "verification completion rejects %s",
    (_label, name) => {
      expect(() =>
        prepareVerificationCompletion({ name, pin: "12345" }, linked.googleLocationName)
      ).toThrow(ApiError)
    }
  )

  it("verification completion keeps a scoped name", () => {
    expect(
      prepareVerificationCompletion(
        { name: "locations/111/verifications/v1", pin: "12345" },
        linked.googleLocationName
      )
    ).toEqual({ name: "locations/111/verifications/v1", pin: "12345" })
  })
})
