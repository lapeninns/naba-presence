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

// R1 (Task 3, security headers): a review media thumbnail on a real Google
// media host, so the remote-thumbnail render e2e can prove the CSP's
// `img-src` allow-list actually lets a client-rendered <img> load one (the
// route interception in inbox.spec.ts fulfils this URL locally - no real
// network call is made - but the CSP check happens against this exact
// hostname, matching what production actually stores per lib/server/reviews.ts).
const DIRECT_REVIEW_THUMBNAIL_URL =
  "https://lh3.googleusercontent.com/e2e-stub-review-thumbnail"
const DIRECT_REVIEW_THUMBNAIL_LABEL = "E2E stub review photo"

export type JourneyState = {
  cookie: string
  organisationId: string
  directReview: {
    id: string
    locationId: string
    locationName: string
    text: string
    media: {
      thumbnailUrl: string
      thumbnailLabel: string
    }
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
  /** The client every seeded location is filed under. */
  clientId: string
  clientName: string
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
    // R1: one review-media row on a real googleusercontent.com host (see the
    // module-level comment above) for the CSP remote-thumbnail render test.
    await admin`
      insert into review_media_item (
        organisation_id, review_id, thumbnail_url, thumbnail_label
      )
      values (
        ${organisationId}, ${directReview.reviewId},
        ${DIRECT_REVIEW_THUMBNAIL_URL}, ${DIRECT_REVIEW_THUMBNAIL_LABEL}
      )
    `
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

    // --- reporting seed (Task 8) -------------------------------------------
    // A recent day of Google performance metrics against the journey org's
    // primary linked location, so the /performance Google tab is "ready"
    // (route: performance_metric_daily -> location_link -> location).
    const reportingNow = new Date()
    const perfDay = reportingNow.toISOString().slice(0, 10)
    const PERF_METRICS: Array<[string, number]> = [
      ["CALL_CLICKS", 12],
      ["WEBSITE_CLICKS", 30],
      ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", 140],
      ["BUSINESS_IMPRESSIONS_MOBILE_SEARCH", 260],
    ]
    for (const [metric, value] of PERF_METRICS) {
      await admin`
        insert into performance_metric_daily
          (organisation_id, external_location_id, metric, metric_date, value)
        values
          (${organisationId}, ${directReview.externalLocationId}, ${metric}, ${perfDay}::date, ${value})
        on conflict do nothing
      `
    }

    // Two keyword months so the Keywords tab is "ready", incl. one exact
    // term and one honestly-thresholded term ("N+"). The
    // performance_search_keyword_monthly check constraint requires exactly
    // one of impressions/threshold per row, so the thresholded keyword is
    // split across two months: an exact-known month (impressions) and a
    // suppressed-additional month (threshold only) - their aggregate is what
    // the route sums, matching real Google reporting shape.
    const perfMonth = `${reportingNow.toISOString().slice(0, 7)}-01`
    const prevMonth = new Date(
      Date.UTC(reportingNow.getUTCFullYear(), reportingNow.getUTCMonth() - 1, 1)
    )
      .toISOString()
      .slice(0, 10)
    await admin`
      insert into performance_search_keyword_monthly
        (organisation_id, external_location_id, keyword, metric_month, impressions, threshold, rank)
      values
        (${organisationId}, ${directReview.externalLocationId}, 'riverside hotel bath', ${perfMonth}::date, 5200, null, 1),
        (${organisationId}, ${directReview.externalLocationId}, 'spa near me', ${perfMonth}::date, 1000, null, 2),
        (${organisationId}, ${directReview.externalLocationId}, 'spa near me', ${prevMonth}::date, null, 250, 2)
      on conflict do nothing
    `

    // A succeeded checkpoint for both sync types, so state resolves to
    // "ready" via a healthy sync history (not merely absent rows).
    await admin`
      insert into sync_checkpoint (organisation_id, external_location_id, sync_type, status, last_error_code)
      values
        (${organisationId}, ${directReview.externalLocationId}, 'performance', 'succeeded', null),
        (${organisationId}, ${directReview.externalLocationId}, 'keywords', 'succeeded', null)
      on conflict do nothing
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

    // The GET /accounts stub handler that returns BOTH orgs' accounts is
    // registered further down (once `approvalConnection` exists too) — see
    // the comment there. Google's real `accounts.list` path is a bare
    // `/accounts` with no account segment, so there's nothing in the path
    // itself to key a per-tenant handler on; registering it once with both
    // accounts (rather than twice, one per tenant, which silently shadowed
    // via last-registered-wins — see that comment) is what fixes it.
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
    // covering every readMask the wave-1 tabs request. `locationOverrides` is
    // mutable (Task 8): the Business Information console's `update_location`
    // publish re-fetches this same readMask GET to verify Google's readback
    // matches the just-patched fields (lib/server/business-information.ts's
    // `updateBusinessInformation`), so the stub has to reflect its own writes
    // rather than stay static.
    let locationOverrides: Record<string, unknown> = {}
    const baseGoogleLocation: Record<string, unknown> = {
      name: "locations/stub",
      title: "Riverside Rooms",
      phoneNumbers: { primaryPhone: "+44 20 7946 0000" },
      profile: { description: "A calm riverside stay." },
      storefrontAddress: { addressLines: ["1 River Road"], locality: "Bath", postalCode: "BA1 1AA", regionCode: "GB" },
      websiteUri: "https://riverside.example",
      categories: { primaryCategory: { name: "categories/gcid:lodging", displayName: "Hotel" } },
      storeCode: "",
      labels: [] as string[],
      openInfo: { status: "OPEN" },
      regularHours: { periods: [] },
      specialHours: { specialHourPeriods: [] },
      moreHours: [],
      // The lodging and healthcare rules below serve real data for this
      // location, so its metadata has to say Google will answer them. Google
      // returns these two keys only when they are true, and the profile editor
      // reads them to decide whether the industry group is worth seven paced
      // calls (lib/locations/industry-capability.ts). Without them the fixture
      // described a location that serves lodging data while telling callers it
      // cannot — a shape Google never produces.
      metadata: {
        canHaveFoodMenus: true,
        canOperateLodgingData: true,
        canOperateHealthData: true,
        mapsUri: "https://maps.example/x",
        newReviewUri: "https://g.page/x/review",
      },
    }
    stub.respond({ method: "GET", pathIncludes: "readMask" }, () => ({
      status: 200,
      json: { ...baseGoogleLocation, ...locationOverrides },
    }))
    // Business Information's `update_location`, Hours' patch, and
    // Administration's `accept_google_update` all PATCH this same
    // `{locationName}?updateMask=...&validateOnly=...` shape (both the
    // validate-only dry run and the real write) — merge whatever was sent so
    // the readMask GET above reflects it on the very next read, mirroring
    // Google's own read-your-writes behaviour.
    stub.respond({ method: "PATCH", pathIncludes: "validateOnly=" }, (call) => {
      const body = (call.body ?? {}) as Record<string, unknown>
      locationOverrides = { ...locationOverrides, ...body }
      return { status: 200, json: { ...baseGoogleLocation, ...locationOverrides } }
    })
    stub.respond({ method: "GET", pathIncludes: "/media" }, () => ({ status: 200, json: { mediaItems: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/media/customers" }, () => ({ status: 200, json: { mediaItems: [] } }))
    stub.respond({ method: "GET", pathIncludes: "/localPosts" }, () => ({ status: 200, json: { localPosts: [], nextPageToken: null } }))
    stub.respond({ method: "GET", pathIncludes: "/placeActionLinks" }, () => ({ status: 200, json: { placeActionLinks: [] } }))
    // Settings > Connections notifications card (Task 11): the Google
    // notifications GET, so the card loads clean off the M5-seeded active
    // account (`google_account.is_active = true` -> deriveAutoSelection
    // resolves an accountId -> useNotificationSetting fetches this).
    stub.respond({ method: "GET", pathIncludes: "notificationSetting" }, () => ({
      status: 200,
      json: {
        name: "accounts/stub/notificationSetting",
        pubsubTopic: "",
        notificationTypes: [],
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({ status: 200, json: { name: "locations/stub/foodMenus", menus: [] } }))
    // Booking create journey: echo the posted link back (name + input fields) so
    // the readback hash matches the request.
    stub.respond({ method: "POST", pathIncludes: "/placeActionLinks" }, (call) => {
      const body = (call.body ?? {}) as Record<string, unknown>
      return { status: 200, json: { name: "locations/stub/placeActionLinks/created", uri: body.uri, placeActionType: body.placeActionType, isPreferred: body.isPreferred ?? false } }
    })

    // --- M8 console stubs (Task 8) ------------------------------------------
    // Business Information / Industry / Administration each call Google
    // sub-resources beyond the shared readMask GET above. Every path fragment
    // below is read straight off lib/domain/google-contract.ts's request
    // builders (the real client the server routes call through) — not
    // guessed — since GOOGLE_API_PROXY_BASE strips the original host and the
    // stub only ever sees `{path}{?query}`.
    const primaryGoogleLocationName = googleLocationName(directReview.externalLocationId)
    const primaryAccountName = connection.googleAccountName

    // Business Information: attributes, attribute metadata, category/chain
    // search (metadata's `pageSize=200` is unique to listGoogleAttributeMetadata
    // — categories/chains both use pageSize=100 — so it can't collide with the
    // location-attributes GET below, which sends no query at all).
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/attributes` },
      () => ({
        status: 200,
        json: { name: `${primaryGoogleLocationName}/attributes`, attributes: [{ name: "attributes/wi_fi_free", values: [true] }] },
      })
    )
    stub.respond(
      { method: "PATCH", pathIncludes: `${primaryGoogleLocationName}/attributes` },
      (call) => {
        const body = (call.body ?? {}) as { attributes?: unknown }
        return { status: 200, json: { name: `${primaryGoogleLocationName}/attributes`, attributes: body.attributes ?? [] } }
      }
    )
    stub.respond({ method: "GET", pathIncludes: "pageSize=200" }, () => ({
      status: 200,
      json: {
        attributeMetadata: [
          { parent: "attributes/wi_fi_free", displayName: "Free Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" },
        ],
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "v1/categories?" }, () => ({
      status: 200,
      json: { categories: [{ name: "categories/gcid:lodging", displayName: "Hotel" }] },
    }))
    stub.respond({ method: "GET", pathIncludes: "chains:search" }, () => ({ status: 200, json: { chains: [] } }))

    // Industry: lodging / business calls / healthcare.
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/lodging:getGoogleUpdated` },
      () => ({ status: 200, json: { diffMask: { paths: [] } } })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/lodging?` },
      () => ({ status: 200, json: { name: `${primaryGoogleLocationName}/lodging`, policies: { checkinTime: "15:00", checkoutTime: "11:00" } } })
    )
    stub.respond(
      { method: "PATCH", pathIncludes: `${primaryGoogleLocationName}/lodging?` },
      (call) => ({ status: 200, json: { name: `${primaryGoogleLocationName}/lodging`, ...(call.body as Record<string, unknown>) } })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/businesscallssettings` },
      () => ({ status: 200, json: { name: `${primaryGoogleLocationName}/businesscallssettings`, callsState: "ENABLED" } })
    )
    stub.respond(
      { method: "PATCH", pathIncludes: `${primaryGoogleLocationName}/businesscallssettings` },
      (call) => ({ status: 200, json: { name: `${primaryGoogleLocationName}/businesscallssettings`, ...(call.body as Record<string, unknown>) } })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/businesscallsinsights` },
      () => ({ status: 200, json: { businessCallsInsights: [] } })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryAccountName}/${primaryGoogleLocationName}/serviceList` },
      () => ({ status: 200, json: { services: [] } })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryAccountName}/${primaryGoogleLocationName}/healthProviderAttributes` },
      () => ({ status: 200, json: {} })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryAccountName}/${primaryGoogleLocationName}/insuranceNetworks` },
      () => ({ status: 200, json: { networks: [] } })
    )

    // Administration: suggested update, voice of merchant, verification,
    // admins/invitations, and the danger-zone mutations (transfer / delete).
    // `:getGoogleUpdated` here (no `/lodging` in front) is Administration's
    // own suggested-update GET — distinct from Industry's
    // `${name}/lodging:getGoogleUpdated` above since that has `/lodging`
    // between the location name and the colon.
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}:getGoogleUpdated` },
      () => ({ status: 200, json: { diffMask: { paths: [] } } })
    )
    stub.respond({ method: "GET", pathIncludes: "VoiceOfMerchantState" }, () => ({
      status: 200,
      json: { hasVoiceOfMerchant: true },
    }))
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/verifications` },
      () => ({ status: 200, json: { verifications: [] } })
    )
    stub.respond({ method: "POST", pathIncludes: "fetchVerificationOptions" }, () => ({
      status: 200,
      json: { options: [{ verificationMethod: "EMAIL" }] },
    }))
    // Lowercase ":verify" (start_verification) never collides with the
    // capital-V "fetchVerificationOptions"/"...Verifications" paths above.
    stub.respond({ method: "POST", pathIncludes: ":verify" }, () => ({
      status: 200,
      json: { name: `${primaryGoogleLocationName}/verifications/e2e`, method: "EMAIL", state: "PENDING" },
    }))
    stub.respond(
      { method: "GET", pathIncludes: `${primaryGoogleLocationName}/admins` },
      () => ({
        status: 200,
        json: { admins: [{ name: `${primaryGoogleLocationName}/admins/owner`, admin: "Journey Owner", role: "PRIMARY_OWNER" }] },
      })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryAccountName}/admins` },
      () => ({
        status: 200,
        json: { admins: [{ name: `${primaryAccountName}/admins/owner`, admin: "Journey Owner", role: "PRIMARY_OWNER" }] },
      })
    )
    stub.respond(
      { method: "GET", pathIncludes: `${primaryAccountName}/invitations` },
      () => ({ status: 200, json: { invitations: [] } })
    )
    stub.respond(
      { method: "POST", pathIncludes: `${primaryAccountName}/locations` },
      (call) => ({ status: 200, json: { name: `${primaryGoogleLocationName}-created`, ...(call.body as Record<string, unknown>) } })
    )
    stub.respond({ method: "POST", pathIncludes: ":transfer" }, (call) => ({
      status: 200,
      json: { name: primaryGoogleLocationName, destinationAccount: (call.body as Record<string, unknown> | undefined)?.destinationAccount ?? null },
    }))
    // Google's PERMANENT delete (deleteGoogleLocation) — the danger-zone
    // journey's target. deleteGoogleLocation's URL is exactly
    // `.../v1/{locationName}` with nothing after it, so `pathEndsWith` pins
    // this rule to that exact resource. A plain `pathIncludes` match on the
    // bare location name would ALSO match a location-scoped `delete_admin`
    // DELETE (`.../v1/{locationName}/admins/{adminId}`, since the location
    // name is a strict prefix of that path) and silently misroute it here.
    stub.respond({ method: "DELETE", pathEndsWith: primaryGoogleLocationName }, () => ({ status: 200, json: {} }))

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

    // The stub-bridge tenant fix: this was previously TWO handlers on the
    // identical `{ method: "GET", pathIncludes: "/accounts" }` matcher (one
    // registered here, one back where `connection` is seeded) — `respond`
    // unshifts each rule to the front and `find` takes the first match, so
    // last-registered-wins silently shadowed the primary org's handler with
    // this one: EVERY /accounts call (primary or approval org alike)
    // resolved to the approval account, and the primary org's own
    // `google_account` row was never upserted with its real name (the
    // upsert only matches on `google_account_name`, which never matched, so
    // it inserted a stray extra row instead of updating the seeded one).
    // Google's real accounts.list path (`/accounts`) carries no account
    // segment to key a per-tenant matcher on, so there's nothing in the
    // request the stub can discriminate on — the fix is a SINGLE handler
    // that returns both accounts, so either org's caller finds (and
    // upserts) its own by name; see the primary-org assertion in
    // tests/e2e/connections-oauth.spec.ts.
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

    // Every seeded location belongs to one client, so the agency surfaces
    // (the client index, the hub, the inbox's per-client grouping) have real
    // data rather than the empty state a fresh tenant would otherwise show.
    const clientName = "Journey Hospitality"
    const [seededClient] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${organisationId}, ${clientName}, 'journey-hospitality')
      returning id::text as id
    `
    await admin`
      update location set client_id = ${seededClient!.id}
      where organisation_id = ${organisationId}
    `

    const state: JourneyState = {
      cookie: tenant.cookie,
      organisationId,
      directReview: {
        id: directReview.reviewId,
        locationId: directReview.locationId,
        locationName: locationName(directReview.locationId),
        text: "Sprint 5 journey review",
        media: {
          thumbnailUrl: DIRECT_REVIEW_THUMBNAIL_URL,
          thumbnailLabel: DIRECT_REVIEW_THUMBNAIL_LABEL,
        },
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
      clientId: seededClient!.id,
      clientName,
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
