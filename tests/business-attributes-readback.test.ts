import { beforeEach, describe, expect, it, vi } from "vitest"

import type { memoryAttemptStore } from "./helpers/memory-attempt-store"

type Statement = { text: string; values: unknown[] }

const mocks = vi.hoisted(() => ({
  getLocation: vi.fn(),
  patchLocation: vi.fn(),
  getAttributes: vi.fn(),
  patchAttributes: vi.fn(),
  audit: vi.fn(),
  statements: [] as Statement[],
  snapshotRows: [] as Array<{ payload: unknown; googleHash: string }>,
  memory: null as unknown as ReturnType<typeof memoryAttemptStore>,
}))

function fakeSql(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join("?")
  mocks.statements.push({ text, values })
  if (text.includes("from gbp_resource_snapshot")) {
    return Promise.resolve(mocks.snapshotRows)
  }
  return Promise.resolve([])
}

vi.mock("@/lib/server/db", () => ({
  getDatabase: () => ({}),
  jsonColumn: (_sql: unknown, value: unknown) => value,
  jsonColumnOrNull: (_sql: unknown, value: unknown) => value ?? null,
  withTenant: async (_id: string, callback: (sql: unknown) => unknown) =>
    callback(fakeSql),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: mocks.audit }))
vi.mock("@/lib/server/env", () => ({
  gbpWritesEnabled: () => true,
  getServerEnv: () => ({}),
}))
vi.mock("@/lib/server/gbp-management", async (importOriginal) => {
  const { memoryAttemptStore } = await import("./helpers/memory-attempt-store")
  mocks.memory = memoryAttemptStore()
  return {
    ...(await importOriginal<typeof import("@/lib/server/gbp-management")>()),
    resolveGbpLocationContext: async () => ({
      connectionId: "con1",
      googleLocationName: "locations/l1",
      accountName: "accounts/a1",
      googleAccountId: "a1",
      canPublish: true,
    }),
    gbpManagementAttemptStore: mocks.memory.store,
  }
})
vi.mock("@/lib/server/google", async () => {
  const transport = await import("@/lib/server/google/transport")
  return {
    connectionAccessToken: async () => "synthetic-token",
    getGoogleLocation: mocks.getLocation,
    patchGoogleLocation: mocks.patchLocation,
    getGoogleLocationAttributes: mocks.getAttributes,
    patchGoogleLocationAttributes: mocks.patchAttributes,
    listGoogleAttributeMetadata: vi.fn(),
    listGoogleCategories: vi.fn(),
    searchGoogleChains: vi.fn(),
    GoogleMutationAmbiguousError: transport.GoogleMutationAmbiguousError,
  }
})

import {
  updateBusinessAttributes,
  updateBusinessInformation,
} from "@/lib/server/business-information"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
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

const LOCATION = {
  name: "locations/l1",
  title: "Old Crown",
  phoneNumbers: { primaryPhone: "+44 1223 000000" },
}

const ATTRIBUTES = {
  name: "locations/l1/attributes",
  attributes: [
    { name: "attributes/has_wheelchair_accessible_entrance", values: [true] },
    { name: "attributes/has_live_music", values: [true] },
  ],
}

function snapshotWrites() {
  return mocks.statements
    .filter((s) => s.text.includes("insert into gbp_resource_snapshot"))
    .map((s) => ({ resourceType: s.values[3], payload: s.values[5] }))
}

function auditActions() {
  return mocks.audit.mock.calls.map(([, input]) => input.action)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.statements.length = 0
  mocks.snapshotRows = []
  mocks.memory.reset()
})

describe("business information through runGbpWrite", () => {
  function update(payload: Record<string, unknown>, updateMask: string[]) {
    return updateBusinessInformation({
      session,
      locationId: "l1",
      payload,
      updateMask,
      expectedGoogleHash: stableGoogleHash(LOCATION),
      requestId: "r1",
    })
  }

  it("settles succeeded on a readback equal after normalisation, and caches it", async () => {
    // Given: Google stores the new phone in its international form.
    const applied = {
      ...LOCATION,
      phoneNumbers: { primaryPhone: "+44 1223 111111" },
    }
    mocks.getLocation
      .mockResolvedValueOnce(LOCATION)
      .mockResolvedValueOnce(applied)
    mocks.patchLocation.mockResolvedValue(applied)

    // When
    const result = await update(
      { phoneNumbers: { primaryPhone: "01223 111111" } },
      ["phoneNumbers"]
    )

    // Then: validateOnly then the real call, succeeded with the readback.
    expect(result).toMatchObject({ status: "succeeded", idempotent: false })
    expect(
      mocks.patchLocation.mock.calls.map(([, input]) => input.validateOnly)
    ).toEqual([true, false])
    expect(mocks.memory.only()).toMatchObject({
      status: "succeeded",
      response: applied,
    })
    expect(snapshotWrites()).toEqual([
      { resourceType: "business_info", payload: applied },
    ])
    expect(auditActions()).toEqual(["business_information.updated"])
  })

  it("settles failed with business_information_readback_mismatch on a real difference", async () => {
    mocks.getLocation.mockResolvedValue(LOCATION)
    mocks.patchLocation.mockResolvedValue(LOCATION)

    await expect(
      update({ title: "The Old Crown" }, ["title"])
    ).rejects.toMatchObject({
      status: 502,
      code: "business_information_readback_mismatch",
    })
    expect(mocks.memory.only()).toMatchObject({
      status: "failed",
      errorCode: "business_information_readback_mismatch",
    })
    expect(snapshotWrites()).toEqual([])
  })

  it("settles ambiguous and audits it unconfirmed when the readback cannot be read", async () => {
    mocks.getLocation
      .mockResolvedValueOnce(LOCATION)
      .mockRejectedValueOnce(new ApiError(503, "google_unavailable", "down"))
    mocks.patchLocation.mockResolvedValue({})

    await expect(
      update({ title: "The Old Crown" }, ["title"])
    ).rejects.toMatchObject({
      code: "google_unavailable",
    })
    expect(mocks.memory.only().status).toBe("ambiguous")
    expect(auditActions()).toEqual(["business_information.update.unconfirmed"])
    expect(mocks.audit.mock.calls[0]![1].metadata).toMatchObject({
      phase: "readback_read",
      errorCode: "google_unavailable",
    })
  })

  it("settles an ambiguous provider call ambiguous without reading back", async () => {
    mocks.getLocation.mockResolvedValue(LOCATION)
    mocks.patchLocation
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new GoogleMutationAmbiguousError("timeout"))

    await expect(
      update({ title: "The Old Crown" }, ["title"])
    ).rejects.toBeInstanceOf(GoogleMutationAmbiguousError)
    expect(mocks.memory.only().status).toBe("ambiguous")
    // Only the staleness read: no readback after an ambiguous PATCH.
    expect(mocks.getLocation).toHaveBeenCalledTimes(1)
    expect(auditActions()).toEqual(["business_information.update.unconfirmed"])
  })

  it("settles a validateOnly refusal failed without writing", async () => {
    mocks.getLocation.mockResolvedValue(LOCATION)
    mocks.patchLocation.mockRejectedValueOnce(
      new ApiError(400, "google_invalid_argument", "bad")
    )

    await expect(update({ title: "x" }, ["title"])).rejects.toMatchObject({
      code: "google_invalid_argument",
    })
    expect(mocks.patchLocation).toHaveBeenCalledTimes(1)
    expect(mocks.memory.only()).toMatchObject({
      status: "failed",
      errorCode: "google_invalid_argument",
    })
    expect(auditActions()).toEqual([])
  })
})

describe("attributes through runGbpWrite", () => {
  const mask = ["attributes/has_wheelchair_accessible_entrance"]

  function update(
    attributes: Array<{ name: string; values?: unknown[] }>,
    expectedGoogleHash = stableGoogleHash(ATTRIBUTES)
  ) {
    return updateBusinessAttributes({
      session,
      locationId: "l1",
      attributes,
      attributeMask: mask,
      expectedGoogleHash,
      requestId: "r1",
    })
  }

  it("settles succeeded when the masked attribute reads back, ignoring unrelated drift", async () => {
    const applied = {
      ...ATTRIBUTES,
      attributes: [
        {
          name: "attributes/has_wheelchair_accessible_entrance",
          values: [false],
        },
        // Changed on Google between the write and the read: not compared.
        { name: "attributes/has_live_music", values: [false] },
      ],
    }
    mocks.getAttributes
      .mockResolvedValueOnce(ATTRIBUTES)
      .mockResolvedValueOnce(applied)
    mocks.patchAttributes.mockResolvedValue(applied)

    await expect(
      update([{ name: mask[0]!, values: [false] }])
    ).resolves.toMatchObject({ status: "succeeded" })
    expect(mocks.memory.only()).toMatchObject({
      status: "succeeded",
      response: applied,
    })
    expect(snapshotWrites()).toEqual([
      { resourceType: "attributes", payload: applied },
    ])
  })

  it("settles failed when false reads back as unset", async () => {
    const unset = {
      ...ATTRIBUTES,
      attributes: [{ name: "attributes/has_live_music", values: [true] }],
    }
    mocks.getAttributes
      .mockResolvedValueOnce(ATTRIBUTES)
      .mockResolvedValueOnce(unset)
    mocks.patchAttributes.mockResolvedValue(unset)

    await expect(
      update([{ name: mask[0]!, values: [false] }])
    ).rejects.toMatchObject({
      status: 502,
      code: "business_attributes_readback_mismatch",
    })
    expect(mocks.memory.only()).toMatchObject({
      status: "failed",
      errorCode: "business_attributes_readback_mismatch",
    })
  })

  it("settles ambiguous when the readback cannot be read", async () => {
    mocks.getAttributes
      .mockResolvedValueOnce(ATTRIBUTES)
      .mockRejectedValueOnce(new ApiError(503, "google_unavailable", "down"))
    mocks.patchAttributes.mockResolvedValue({})

    await expect(
      update([{ name: mask[0]!, values: [false] }])
    ).rejects.toMatchObject({
      code: "google_unavailable",
    })
    expect(mocks.memory.only().status).toBe("ambiguous")
    expect(auditActions()).toEqual(["business_attributes.update.unconfirmed"])
  })

  it("is stale only when a masked attribute changed since the load", async () => {
    // Given: the editor loaded `loaded`; since then Google changed only an
    // attribute outside the mask.
    const loaded = {
      ...ATTRIBUTES,
      attributes: [
        {
          name: "attributes/has_wheelchair_accessible_entrance",
          values: [true],
        },
        { name: "attributes/has_live_music", values: [false] },
      ],
    }
    mocks.snapshotRows = [
      { payload: loaded, googleHash: stableGoogleHash(loaded) },
    ]
    const applied = {
      ...ATTRIBUTES,
      attributes: [
        { name: mask[0]!, values: [false] },
        ATTRIBUTES.attributes[1]!,
      ],
    }
    mocks.getAttributes
      .mockResolvedValueOnce(ATTRIBUTES)
      .mockResolvedValueOnce(applied)
    mocks.patchAttributes.mockResolvedValue(applied)

    // Then: not stale.
    await expect(
      update([{ name: mask[0]!, values: [false] }], stableGoogleHash(loaded))
    ).resolves.toMatchObject({ status: "succeeded" })

    // Given: the masked attribute itself changed since the load.
    mocks.memory.reset()
    mocks.patchAttributes.mockClear()
    const masked = {
      ...ATTRIBUTES,
      attributes: [
        { name: mask[0]!, values: [false] },
        ATTRIBUTES.attributes[1]!,
      ],
    }
    mocks.snapshotRows = [
      { payload: masked, googleHash: stableGoogleHash(masked) },
    ]
    mocks.getAttributes.mockResolvedValueOnce(ATTRIBUTES)

    // Then: stale, and nothing is sent.
    await expect(
      update([{ name: mask[0]!, values: [true] }], stableGoogleHash(masked))
    ).rejects.toMatchObject({ status: 409, code: "attributes_stale" })
    expect(mocks.patchAttributes).not.toHaveBeenCalled()
    expect(mocks.memory.rows.size).toBe(0)
  })

  it("is stale when the load's snapshot has since been replaced", async () => {
    mocks.getAttributes.mockResolvedValueOnce(ATTRIBUTES)
    await expect(
      update([{ name: mask[0]!, values: [false] }], "f".repeat(64))
    ).rejects.toMatchObject({ status: 409, code: "attributes_stale" })
  })
})
