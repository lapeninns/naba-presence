import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "./helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Tenant = Awaited<ReturnType<typeof createTestTenant>>

/**
 * The description content checks on the business-information path, in
 * process against a real schema through the runtime role: the editor's
 * review (previewBusinessInformation, which a Google change put back also
 * goes through), its publish (updateBusinessInformation) and a bulk batch's
 * description. Each refuses before any Google read, so no Google stub is
 * needed: a check that ran after the read would fail on the read instead.
 */
describeDatabase("business-information description content checks", () => {
  let admin: ReturnType<typeof postgres>
  const organisations: string[] = []
  let tenant: Tenant
  let locationId: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    await admin`
      update organisation set banned_phrases = ${["best in town"]}
      where id = ${tenant.organisationId}
    `
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    ;({ locationId } = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      ...connection,
    }))
  })

  afterAll(async () => {
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  const session = () => ({
    sessionId: randomUUID(),
    userId: tenant.userId,
    organisationId: tenant.organisationId,
    organisationName: "Harness tenant",
    workspaceMode: "agency" as const,
    displayName: "Harness",
    email: tenant.email,
    role: "owner" as const,
    canPublish: true,
  })

  const write = (description: string, updateMask = ["profile"]) => ({
    session: session(),
    locationId,
    payload: { profile: { description } },
    updateMask,
    expectedGoogleHash: "0".repeat(64),
    requestId: randomUUID(),
  })

  async function refusal(promise: Promise<unknown>) {
    const { ApiError } = await import("@/lib/server/http")
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(ApiError)
    return error as InstanceType<typeof ApiError>
  }

  it("refuses a banned phrase at review with the posts' code and shape", async () => {
    const { previewBusinessInformation } =
      await import("@/lib/server/business-information")
    const error = await refusal(
      previewBusinessInformation(write("The best in town for Sunday lunch."))
    )
    expect(error.status).toBe(422)
    expect(error.code).toBe("content_checks_failed")
    expect(error.details).toEqual({
      reasons: [
        {
          code: "banned_phrase",
          severity: "fail",
          message:
            "“best in town” is on your banned-phrase list (Settings › Reply policy).",
        },
      ],
    })
  })

  it("leaves an update that does not write the description alone", async () => {
    const { assertBusinessDescriptionChecks } =
      await import("@/lib/server/content-checks")
    const { withTenant } = await import("@/lib/server/db")
    await expect(
      withTenant(tenant.organisationId, (sql) =>
        assertBusinessDescriptionChecks(sql, {
          locationId,
          updateMask: ["websiteUri"],
          payload: { profile: { description: "The best in town." } },
        })
      )
    ).resolves.toBeUndefined()
  })

  it("sends warnings to the profile editor, with no token it cannot carry", async () => {
    const { previewBusinessInformation } =
      await import("@/lib/server/business-information")
    const error = await refusal(
      previewBusinessInformation(write("THE FRIENDLIEST PUB AROUND"))
    )
    expect(error.status).toBe(409)
    expect(error.code).toBe("content_warning_acknowledgement_required")
    expect(error.message).toMatch(/profile editor/)
    expect(error.details).toEqual({
      reasons: [expect.objectContaining({ code: "content_caps" })],
    })
  })

  it("checks again at publish, before the approval or Google", async () => {
    const { updateBusinessInformation } =
      await import("@/lib/server/business-information")
    const error = await refusal(
      updateBusinessInformation({
        ...write("The best in town."),
        changeSetId: randomUUID(),
      })
    )
    expect(error.status).toBe(422)
    expect(error.code).toBe("content_checks_failed")
  })

  it("checks a bulk description at preview, and takes the consent it names", async () => {
    const { assertBulkBusinessInfoContent } =
      await import("@/lib/server/bulk-families/business-info")
    const { withTenant } = await import("@/lib/server/db")
    const description = (value: string, token?: string) => ({
      operation: "business_info" as const,
      changes: [
        {
          field: "profile.description" as const,
          action: "set" as const,
          value,
          ...(token ? { contentWarningAcknowledgement: token } : {}),
        },
      ],
    })
    const check = (
      items: Parameters<typeof assertBulkBusinessInfoContent>[1]
    ) =>
      withTenant(tenant.organisationId, (sql) =>
        assertBulkBusinessInfoContent(sql, items)
      )

    const failed = await refusal(
      check([
        {
          operation: "business_info",
          changes: [{ field: "labels", action: "clear" }],
        },
        description("The best in town."),
      ])
    )
    expect(failed.status).toBe(422)
    expect(failed.code).toBe("content_checks_failed")
    expect(failed.details).toMatchObject({ item: 1 })

    const warned = await refusal(
      check([description("THE FRIENDLIEST PUB AROUND")])
    )
    expect(warned.status).toBe(409)
    expect(warned.code).toBe("content_warning_acknowledgement_required")
    const token = (
      warned.details as { contentWarningAcknowledgement: string; item: number }
    ).contentWarningAcknowledgement
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(warned.details).toMatchObject({ item: 0 })

    await expect(
      check([description("THE FRIENDLIEST PUB AROUND", token)])
    ).resolves.toBeUndefined()
    // A clear, or a description the checks pass, needs nothing.
    await expect(
      check([
        {
          operation: "business_info",
          changes: [{ field: "profile.description", action: "clear" }],
        },
        description("A friendly pub with a garden."),
      ])
    ).resolves.toBeUndefined()
  })
})
