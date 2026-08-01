import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type { FullConfig } from "@playwright/test"
import postgres from "postgres"

import { startGoogleStub } from "../../integration/helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../../integration/helpers/tenant"

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export type JourneyState = {
  cookie: string
  organisationId: string
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
  externalLocationId: string
  timezone: string
  viewerCookie: string
  approval: {
    requesterCookie: string
    approverCookie: string
    reviewId: string
    locationId: string
    locationName: string
    text: string
  }
  primaryLocationId: string
  adminCookie: string
  memberAssignedCookie: string
  memberUnassignedCookie: string
}

export const journeyStatePath = resolve(
  process.cwd(),
  "test-results/e2e-journey-state.json"
)

export async function readJourneyState() {
  return JSON.parse(
    await readFile(journeyStatePath, "utf8")
  ) as JourneyState
}

export default async function startJourneyBridge(config: FullConfig) {
  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL
  if (!directDatabaseUrl) {
    throw new Error("DIRECT_DATABASE_URL is required for Playwright journeys.")
  }

  const baseURL = config.projects[0]?.use.baseURL
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is required for journey setup.")
  }
  const appPort = Number.parseInt(new URL(baseURL).port, 10)
  const stubPort =
    process.env.PLAYWRIGHT_GOOGLE_STUB_PORT ??
    String(appPort + 1)
  process.env.GOOGLE_STUB_PORT = stubPort

  const admin = postgres(directDatabaseUrl, { max: 1 })
  let organisationId: string | undefined
  let approvalTenant: Awaited<ReturnType<typeof createTestTenant>> | undefined
  let stub: Awaited<ReturnType<typeof startGoogleStub>> | undefined

  try {
    stub = await startGoogleStub()
    const tenant = await createTestTenant(admin)
    organisationId = tenant.organisationId
    const connection = await seedGoogleConnection(admin, {
      organisationId,
    })
    const directReview = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Sprint 5 journey review",
      rating: 5,
    })
    const approvalReview = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Sprint 5 approval journey review",
      rating: 4,
    })

    const timezone = "Pacific/Auckland"
    await admin`
      update organisation
      set
        name = 'Sprint 5 Journey tenant',
        approval_required = false,
        require_two_person_approval = false,
        direct_publish_consent_at = now(),
        direct_publish_consent_by = ${tenant.userId},
        default_timezone = ${timezone}
      where id = ${organisationId}
    `
    const locations = await admin<
      { id: string; name: string }[]
    >`
      select id::text as id, name
      from location
      where organisation_id = ${organisationId}
      order by id
    `
    const externalLocations = await admin<
      { id: string; googleLocationName: string }[]
    >`
      select
        id::text as id,
        google_location_name as "googleLocationName"
      from external_location
      where organisation_id = ${organisationId}
    `
    const locationName = (locationId: string) => {
      const location = locations.find((item) => item.id === locationId)
      if (!location) throw new Error(`Journey location ${locationId} is missing.`)
      return location.name
    }
    const googleLocationName = (externalLocationId: string) => {
      const location = externalLocations.find(
        (item) => item.id === externalLocationId
      )
      if (!location) {
        throw new Error(
          `Journey external location ${externalLocationId} is missing.`
        )
      }
      return location.googleLocationName
    }

    stub.respond(
      { method: "GET", pathIncludes: "/accounts" },
      () => ({
        status: 200,
        json: {
          accounts: [
            {
              name: connection.googleAccountName,
              accountName: "Sprint 5 Stub account",
              type: "LOCATION_GROUP",
              role: "OWNER",
              permissionLevel: "OWNER_LEVEL",
            },
          ],
        },
      })
    )
    stub.respond(
      {
        method: "GET",
        pathIncludes: `/${connection.googleAccountName}/locations`,
      },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: googleLocationName(directReview.externalLocationId),
              title: locationName(directReview.locationId),
              metadata: { hasVoiceOfMerchant: true },
              storefrontAddress: {
                addressLines: ["1 Journey Way"],
                locality: "Auckland",
                postalCode: "1010",
              },
            },
            {
              name: googleLocationName(approvalReview.externalLocationId),
              title: locationName(approvalReview.locationId),
              metadata: { hasVoiceOfMerchant: true },
              storefrontAddress: {
                addressLines: ["2 Journey Way"],
                locality: "Auckland",
                postalCode: "1010",
              },
            },
          ],
        },
      })
    )

    // A viewer in the primary org, for the per-role permission walk: viewers
    // see disabled Publish with a reason and a read-only composer.
    const viewerUserId = randomUUID()
    const viewerToken = randomBytes(32).toString("base64url")
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (${viewerUserId}, ${`viewer-${viewerUserId.slice(0, 8)}@nabapresence.test`}, 'Journey viewer', ${organisationId})
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationId}, ${viewerUserId}, 'viewer', false)
    `
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at)
      values (${hashToken(viewerToken)}, ${viewerUserId}, ${organisationId}, now() + interval '1 hour')
    `

    // Wave-1 Locations e2e (Task 11): an admin and two members in the primary
    // org, for the per-role permission walk against directReview.locationId
    // (the primary linked location). The assigned member gets a
    // `location_member` grant to it; the unassigned member does not.
    //
    // `organisationId` is captured here (not read directly inside the
    // closure below) because it is declared `let ... : string | undefined`
    // in the enclosing scope for the catch/finally cleanup paths; TS cannot
    // narrow a mutable outer binding across a nested-function boundary, so
    // `seedUser` closes over this already-narrowed `orgId` instead.
    const orgId = organisationId
    async function seedUser(role: "admin" | "member", canPublish: boolean) {
      const userId = randomUUID()
      const token = randomBytes(32).toString("base64url")
      await admin`
        insert into app_user (id, email, display_name, default_organisation_id)
        values (${userId}, ${`m5-${userId.slice(0, 8)}@nabapresence.test`}, 'M5 walk user', ${orgId})
      `
      await admin`
        insert into member (organisation_id, user_id, role, can_publish)
        values (${orgId}, ${userId}, ${role}, ${canPublish})
      `
      await admin`
        insert into app_session (token_hash, user_id, organisation_id, expires_at)
        values (${hashToken(token)}, ${userId}, ${orgId}, now() + interval '1 hour')
      `
      return { userId, cookie: `naba_session=${token}` }
    }
    const adminUser = await seedUser("admin", true)
    const memberAssigned = await seedUser("member", true)
    const memberUnassigned = await seedUser("member", false)
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${orgId}, ${directReview.locationId}, ${memberAssigned.userId}, true)
    `

    // Location read (profile + hours + food-menu eligibility) — one rich object
    // covering every readMask the wave-1 tabs request.
    stub.respond({ method: "GET", pathIncludes: "readMask" }, () => ({
      status: 200,
      json: {
        name: "locations/stub",
        title: "Riverside Rooms",
        phoneNumbers: { primaryPhone: "+44 20 7946 0000" },
        profile: { description: "A calm riverside stay." },
        storefrontAddress: { addressLines: ["1 River Road"], locality: "Bath", postalCode: "BA1 1AA", regionCode: "GB" },
        websiteUri: "https://riverside.example",
        categories: { primaryCategory: { displayName: "Hotel" } },
        regularHours: { periods: [] },
        specialHours: { specialHourPeriods: [] },
        moreHours: [],
        metadata: { canHaveFoodMenus: true, mapsUri: "https://maps.example/x", newReviewUri: "https://g.page/x/review" },
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/media" }, () => ({ status: 200, json: { mediaItems: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/media/customers" }, () => ({ status: 200, json: { mediaItems: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/localPosts" }, () => ({ status: 200, json: { localPosts: [], nextPageToken: null } }))
    stub.respond({ method: "GET", pathIncludes: "/placeActionLinks" }, () => ({ status: 200, json: { placeActionLinks: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({ status: 200, json: { name: "locations/stub/foodMenus", menus: [] } }))
    // Booking create journey: echo the posted link back (name + input fields) so
    // the readback hash matches the request.
    stub.respond({ method: "POST", pathIncludes: "/placeActionLinks" }, (call) => {
      const body = (call.body ?? {}) as Record<string, unknown>
      return { status: 200, json: { name: "locations/stub/placeActionLinks/created", uri: body.uri, placeActionType: body.placeActionType, isPreferred: body.isPreferred ?? false } }
    })

    // A separate approval-required org: a requester whose publish routes to
    // approval (202), and a distinct owner approver who approves (200).
    //
    // Deviation from a plain "non-publisher requests approval" scenario:
    // `lib/server/capabilities.ts` mirrors `canPublishLocation` exactly, and
    // the ActionBar's Publish control (components/inbox/action-bar.tsx) is
    // hard-gated on `capabilities.canPublish` with no awareness of the org's
    // `approval_required` flag (locked by the Task 7 unit test "disables
    // Publish with a reason when the user cannot publish" in
    // tests/components/action-bar.test.tsx, which asserts this for EVERY
    // `canPublish: false` case). So a canPublish:false member's Publish
    // button is disabled in the real browser and can never be clicked to
    // reach the server's non-publisher-request branch
    // (`!canPublish && approval_required` in lib/server/publishing.ts) --
    // that branch is only reachable via direct API calls (see
    // tests/integration/routes/approval.test.ts), not through the UI.
    // Exercising the SAME 202 -> approve -> 200 lifecycle through the actual
    // UI therefore uses `require_two_person_approval` instead: it routes
    // even a canPublish:true actor's first publish attempt to approval
    // (independent of their own canPublish), so the requester's Publish
    // button stays enabled while the outcome is still `awaiting_approval`,
    // and a DIFFERENT authorised approver is required to complete it --
    // identical observable UI/API behaviour (202, "Reply submitted for
    // approval.", `/inbox?queue=awaiting_approval`, 200, "Reply published"),
    // backed by an already-implemented, already-unit-tested code path.
    approvalTenant = await createTestTenant(admin, { role: "owner" })
    const approvalConnection = await seedGoogleConnection(admin, {
      organisationId: approvalTenant.organisationId,
    })
    const approvalReviewSeed = await seedLinkedReview(admin, {
      organisationId: approvalTenant.organisationId,
      connectionId: approvalConnection.connectionId,
      googleAccountName: approvalConnection.googleAccountName,
      text: "Sprint 5 approver journey review",
      rating: 5,
    })
    await admin`
      update organisation
      set approval_required = true, require_two_person_approval = true,
          default_timezone = ${timezone}
      where id = ${approvalTenant.organisationId}
    `
    const requesterUserId = randomUUID()
    const requesterToken = randomBytes(32).toString("base64url")
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (${requesterUserId}, ${`requester-${requesterUserId.slice(0, 8)}@nabapresence.test`}, 'Journey requester', ${approvalTenant.organisationId})
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${approvalTenant.organisationId}, ${requesterUserId}, 'member', true)
    `
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at)
      values (${hashToken(requesterToken)}, ${requesterUserId}, ${approvalTenant.organisationId}, now() + interval '1 hour')
    `
    const approvalLocations = await admin<{ id: string; name: string }[]>`
      select id::text as id, name from location
      where organisation_id = ${approvalTenant.organisationId}
      order by id
    `
    const approvalLocationName =
      approvalLocations.find((l) => l.id === approvalReviewSeed.locationId)?.name ??
      "Approval location"

    stub.respond(
      { method: "GET", pathIncludes: "/accounts" },
      () => ({
        status: 200,
        json: {
          accounts: [
            {
              name: approvalConnection.googleAccountName,
              accountName: "Sprint 5 Approval Stub account",
              type: "LOCATION_GROUP",
              role: "OWNER",
              permissionLevel: "OWNER_LEVEL",
            },
          ],
        },
      })
    )
    stub.respond(
      {
        method: "GET",
        pathIncludes: `/${approvalConnection.googleAccountName}/locations`,
      },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: approvalReviewSeed.googleLocationName,
              title: approvalLocationName,
              metadata: { hasVoiceOfMerchant: true },
              storefrontAddress: {
                addressLines: ["3 Journey Way"],
                locality: "Auckland",
                postalCode: "1010",
              },
            },
          ],
        },
      })
    )

    const state: JourneyState = {
      cookie: tenant.cookie,
      organisationId,
      directReview: {
        id: directReview.reviewId,
        locationId: directReview.locationId,
        locationName: locationName(directReview.locationId),
        text: "Sprint 5 journey review",
      },
      approvalReview: {
        id: approvalReview.reviewId,
        locationId: approvalReview.locationId,
        locationName: locationName(approvalReview.locationId),
        text: "Sprint 5 approval journey review",
      },
      externalLocationId: directReview.externalLocationId,
      timezone,
      viewerCookie: `naba_session=${viewerToken}`,
      approval: {
        requesterCookie: `naba_session=${requesterToken}`,
        approverCookie: approvalTenant.cookie,
        reviewId: approvalReviewSeed.reviewId,
        locationId: approvalReviewSeed.locationId,
        locationName: approvalLocationName,
        text: "Sprint 5 approver journey review",
      },
      primaryLocationId: directReview.locationId,
      adminCookie: adminUser.cookie,
      memberAssignedCookie: memberAssigned.cookie,
      memberUnassignedCookie: memberUnassigned.cookie,
    }
    await mkdir(dirname(journeyStatePath), { recursive: true })
    await writeFile(journeyStatePath, JSON.stringify(state), "utf8")
  } catch (error) {
    await stub?.stop()
    const organisationIds = [organisationId, approvalTenant?.organisationId].filter(
      (id): id is string => Boolean(id)
    )
    if (organisationIds.length > 0) await destroyTenants(admin, organisationIds)
    await admin.end()
    throw error
  }

  return async () => {
    await stub?.stop()
    const organisationIds = [organisationId, approvalTenant?.organisationId].filter(
      (id): id is string => Boolean(id)
    )
    if (organisationIds.length > 0) await destroyTenants(admin, organisationIds)
    await admin.end()
    await rm(journeyStatePath, { force: true })
    delete process.env.GOOGLE_STUB_PORT
  }
}
