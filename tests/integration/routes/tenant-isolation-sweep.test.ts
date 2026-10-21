import { randomBytes, randomUUID } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedReview,
} from "../helpers/tenant"

/**
 * NP3-G03: no session GET hands one tenant another tenant's object by id.
 *
 * The route list is derived from `app/api/**\/route.ts`, so a new GET with a
 * dynamic segment is swept without editing this file, or fails here until
 * its segment is mapped below. Tenant A (an owner, so role gates pass)
 * requests tenant B's real objects; every answer must be the route's 404
 * not-found contract, must carry none of B's data, and must not reach
 * Google.
 */

const API_ROOT = join(process.cwd(), "app", "api")

type DynamicGet = {
  /** e.g. `locations/[id]/summary` */
  route: string
  auth: "session" | "public" | "cron"
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return name === "route.ts" ? [path] : []
  })
}

function discoverDynamicGets(): DynamicGet[] {
  const found: DynamicGet[] = []
  for (const file of routeFiles(API_ROOT)) {
    const route = relative(API_ROOT, file).split(sep).slice(0, -1).join("/")
    if (!route.includes("[")) continue
    const source = readFileSync(file, "utf8")
    const start = source.search(/export (const|async function|function) GET\b/)
    if (start < 0) continue
    // Every handler goes through route() (route-authorization-contract);
    // a GET that does not is refused here too rather than guessed at.
    const declaration = source.slice(start)
    if (!/^export const GET = route\(/.test(declaration)) {
      throw new Error(
        `${route}: GET is not declared as \`export const GET = route(\``
      )
    }
    const config = declaration.slice(0, declaration.search(/\bhandler\b/))
    const auth = /\bauth:\s*"(public|cron)"/.exec(config)?.[1] as
      "public" | "cron" | undefined
    found.push({ route, auth: auth ?? "session" })
  }
  return found.sort((a, b) => a.route.localeCompare(b.route))
}

const DISCOVERED = discoverDynamicGets()

/**
 * Dynamic GETs that are not session routes, so there is no tenant A session
 * whose scope could leak. Listed so a change of auth is noticed: a route
 * that becomes a session route drops out of this list and into the sweep.
 */
const NOT_SESSION_ROUTES: Record<string, string> = {
  // The token is the bearer credential of an invitation link and the lookup
  // runs before anyone signs in; covered by invitations.test.ts.
  "invitations/[token]": "public",
  // Operator surface on the cron bearer, keyed by any organisation id by
  // design; covered by ai-credit-adjustments.test.ts.
  "operations/organisations/[id]/ai-credits": "cron",
}

/**
 * Session GETs whose id segment is not a tenant-owned object. Each needs a
 * reason. Empty today: every session GET with an id is swept.
 */
const SKIPPED_SESSION_ROUTES: Record<string, string> = {}

type TenantObjects = {
  organisationId: string
  userId: string
  email: string
  cookie: string
  marker: string
  clientId: string
  connectionId: string
  googleAccountId: string
  googleAccountName: string
  locationId: string
  externalLocationId: string
  googleLocationName: string
  reviewId: string
  draftId: string
  operationId: string
  bulkOperationId: string
  privacyRequestId: string
  onboardingReviewId: string
  matchLinkReviewId: string
  changeSets: Record<ChangeSetKind, string>
}

const CHANGE_SET_KINDS = [
  "administration_access",
  "location_lifecycle",
  "place_action",
  "verification_start",
  "verification_complete",
] as const
type ChangeSetKind = (typeof CHANGE_SET_KINDS)[number]

/**
 * Tenant B's object for each id segment, keyed by the literal segment before
 * it and the segment itself. Every one is a real row of B's.
 */
const SEGMENTS: Record<string, (b: TenantObjects) => string> = {
  "clients/[clientId]": (b) => b.clientId,
  "accounts/[accountId]": (b) => b.googleAccountId,
  "drafts/[draftId]": (b) => b.draftId,
  // Under drafts/[draftId]: the onboarding approval review.
  "reviews/[reviewId]": (b) => b.onboardingReviewId,
  "match-link-reviews/[reviewId]": (b) => b.matchLinkReviewId,
  "bulk/[id]": (b) => b.bulkOperationId,
  "locations/[id]": (b) => b.locationId,
  "administration-access-reviews/[reviewId]": (b) =>
    b.changeSets.administration_access,
  "administration-lifecycle-reviews/[reviewId]": (b) =>
    b.changeSets.location_lifecycle,
  "place-action-reviews/[reviewId]": (b) => b.changeSets.place_action,
  "verification-completion-reviews/[reviewId]": (b) =>
    b.changeSets.verification_complete,
  "verification-reviews/[reviewId]": (b) => b.changeSets.verification_start,
  "members/[userId]": (b) => b.userId,
  "mutations/[operationId]": (b) => b.operationId,
  "requests/[id]": (b) => b.privacyRequestId,
  "reviews/[id]": (b) => b.reviewId,
}

function segmentKeys(route: string) {
  const parts = route.split("/")
  return parts.flatMap((part, index) =>
    part.startsWith("[") ? [`${parts[index - 1]}/${part}`] : []
  )
}

/**
 * The route's URL with every id taken from `child`'s objects, except that
 * the parent segments (all but the last) come from `parent` when given.
 */
function urlFor(route: string, child: TenantObjects, parent = child) {
  const parts = route.split("/")
  const last = parts.findLastIndex((part) => part.startsWith("["))
  return (
    "/api/" +
    parts
      .map((part, index) =>
        part.startsWith("[")
          ? SEGMENTS[`${parts[index - 1]}/${part}`](
              index === last ? child : parent
            )
          : part
      )
      .join("/")
  )
}

/**
 * Query strings some GETs validate before they look anything up, all naming
 * B's objects too, so the lookup that answers is B's and not a 400.
 */
const QUERIES: Record<string, (b: TenantObjects) => Record<string, string>> = {
  "google/accounts/[accountId]/categories": (b) => ({
    connectionId: b.connectionId,
    regionCode: "GB",
    languageCode: "en",
    query: "pub",
  }),
  "google/accounts/[accountId]/drafts": (b) => ({
    connectionId: b.connectionId,
  }),
  "google/accounts/[accountId]/drafts/[draftId]/accessible-matches": () => ({
    expectedRevision: "1",
    expectedMatchCheckedAt: new Date().toISOString(),
  }),
  "google/accounts/[accountId]/drafts/[draftId]/chains": () => ({
    expectedRevision: "1",
    query: "pub",
  }),
  "google/accounts/[accountId]/drafts/[draftId]/services": () => ({
    expectedRevision: "1",
  }),
}

/**
 * KNOWN GAP, reported to the integrator (C7 handoff): for an owner or admin,
 * `grantsFor` (lib/server/permissions.ts) grants every location id it is
 * given without checking that the location exists in the tenant, so these
 * routes answer 200 for tenant B's location instead of 404. Forced RLS still
 * hides B's rows, so the answer must be exactly what a location id that
 * exists nowhere gets: B's id is indistinguishable from a random one and
 * carries none of B's data. When the gap is closed these become 404 and
 * this list must shrink (the sweep fails until it does).
 */
const KNOWN_200_FOR_FOREIGN_LOCATION = new Set([
  "locations/[id]/capabilities",
  "locations/[id]/change-requests",
  "locations/[id]/legacy-post-schedules",
  "locations/[id]/post-schedules",
  "locations/[id]/posts",
])

/**
 * Session GETs that take a tenant-owned id in the query rather than the path
 * and read with the unscoped pool for the Google token (NP3-G03 named them).
 */
const QUERY_ID_ROUTES: Array<[string, (b: TenantObjects) => string]> = [
  ["google/accounts", (b) => `connection_id=${b.connectionId}`],
  ["google/notifications", (b) => `account_id=${b.googleAccountId}`],
]

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describe("tenant isolation sweep: route discovery", () => {
  it("finds the dynamic GET routes", () => {
    // A floor, not an exact count: it catches a broken scan, not new routes.
    expect(DISCOVERED.length).toBeGreaterThan(40)
  })

  it("lists every non-session dynamic GET explicitly", () => {
    const notSession = Object.fromEntries(
      DISCOVERED.filter((r) => r.auth !== "session").map((r) => [
        r.route,
        r.auth,
      ])
    )
    expect(notSession).toEqual(NOT_SESSION_ROUTES)
  })

  it("maps every id segment of every swept route", () => {
    const unmapped = DISCOVERED.filter((r) => r.auth === "session")
      .filter((r) => !(r.route in SKIPPED_SESSION_ROUTES))
      .flatMap((r) =>
        segmentKeys(r.route)
          .filter((key) => !(key in SEGMENTS))
          .map((key) => `${r.route}: ${key}`)
      )
    expect(
      unmapped,
      "map the segment in SEGMENTS or add a commented skip"
    ).toEqual([])
  })
})

describeDatabase("tenant isolation sweep: session GETs by id", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let google: GoogleStub
  let tenantA: TenantObjects
  let tenantB: TenantObjects
  const organisations: string[] = []

  async function seedTenant(label: string): Promise<TenantObjects> {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    // Feature gates answer before the lookup; open them so the lookup does.
    for (const feature of ["bulk_actions", "post_scheduling"]) {
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${tenant.organisationId}, ${feature}, true, 'test')
      `
    }
    const marker = `isolation-${label}-${randomUUID()}`
    const [client] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${tenant.organisationId}, ${marker}, ${`client-${marker.slice(-12)}`})
      returning id::text as id
    `
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const [account] = await admin<{ id: string }[]>`
      select id::text as id from google_account
      where organisation_id = ${tenant.organisationId}
        and google_connection_id = ${connection.connectionId}
    `
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      ...connection,
    })
    const review = await seedReview(admin, {
      organisationId: tenant.organisationId,
      text: marker,
    })
    const draftId = randomUUID()
    await admin`
      insert into google_onboarding_draft (
        id, organisation_id, google_account_id, account_name, connection_id,
        requested_by, payload, payload_hash, expires_at
      ) values (
        ${draftId}, ${tenant.organisationId}, ${account.id},
        ${connection.googleAccountName}, ${connection.connectionId},
        ${tenant.userId}, ${admin.json({ title: marker })}, 'draft-hash',
        now() + interval '1 day'
      )
    `
    const [operation] = await admin<{ id: string }[]>`
      insert into mutation_operation (
        organisation_id, intent_id, actor_user_id, surface, action,
        location_id, payload_hash, state
      ) values (
        ${tenant.organisationId}, ${randomUUID()}, ${tenant.userId}, 'hours',
        'publish', ${location.locationId}, ${"a".repeat(64)}, 'confirmed_applied'
      )
      returning id::text as id
    `
    const [bulk] = await admin<{ id: string }[]>`
      insert into bulk_listing_operation (
        organisation_id, operation, input, items, target_location_ids,
        preview_hash, requested_by, require_two_person_approval
      ) values (
        ${tenant.organisationId}, 'regular_hours', ${admin.json({ marker })},
        ${admin.json([{ marker }])}, ${[location.locationId]}::uuid[],
        ${"b".repeat(64)}, ${tenant.userId}, false
      )
      returning id::text as id
    `
    const [privacy] = await admin<{ id: string }[]>`
      insert into privacy_request (
        organisation_id, request_type, subject_reference, requested_by
      ) values (
        ${tenant.organisationId}, 'erasure', ${marker}, ${tenant.userId}
      )
      returning id::text as id
    `
    const [onboardingReview] = await admin<{ id: string }[]>`
      insert into google_onboarding_review (
        organisation_id, draft_id, revision, match_request_id, frozen,
        review_hash, requested_by, require_two_person_approval,
        validation_request_id, validation_response
      ) values (
        ${tenant.organisationId}, ${draftId}, 1, ${randomUUID()},
        ${admin.json({ marker })}, ${"c".repeat(64)}, ${tenant.userId}, false,
        ${randomUUID()}, '{}'::jsonb
      )
      returning id::text as id
    `
    const [matchLinkReview] = await admin<{ id: string }[]>`
      insert into google_onboarding_match_link_review (
        organisation_id, draft_id, match_request_id, frozen, review_hash,
        requested_by, require_two_person_approval
      ) values (
        ${tenant.organisationId}, ${draftId}, ${randomUUID()},
        ${admin.json({ marker })}, ${"d".repeat(64)}, ${tenant.userId}, false
      )
      returning id::text as id
    `
    // One reviewed change set per location review kind, each satisfying its
    // kind's payload check (supabase 0071-0077).
    const reviewed = {
      connectionId: connection.connectionId,
      credentialGeneration: 1,
      observedAt: new Date().toISOString(),
    }
    const payloads: Record<ChangeSetKind, unknown> = {
      administration_access: {
        ...reviewed,
        request: { operation: "create_admin", payload: { marker } },
      },
      location_lifecycle: {
        ...reviewed,
        request: { operation: "delete_location", payload: { marker } },
      },
      place_action: { ...reviewed, request: { operation: "create", marker } },
      verification_start: { contextProvided: false },
      verification_complete: {
        name: "locations/stub/verifications/stub",
        method: "SMS",
        credentialBindingHash: "e".repeat(64),
      },
    }
    const changeSets = {} as Record<ChangeSetKind, string>
    for (const kind of CHANGE_SET_KINDS) {
      const privatePayload = kind.startsWith("verification_")
        ? randomBytes(32)
        : null
      const [row] = await admin<{ id: string }[]>`
        insert into gbp_change_set (
          organisation_id, location_id, google_account_id, connection_id,
          target_resource_name, resource_type, requested_by, payload,
          private_payload, payload_hash, update_mask, baseline, baseline_hash,
          require_two_person_approval, expires_at
        ) values (
          ${tenant.organisationId}, ${location.locationId}, ${account.id},
          ${connection.connectionId}, ${location.googleLocationName}, ${kind},
          ${tenant.userId}, ${admin.json(payloads[kind] as never)},
          ${privatePayload}, ${"a".repeat(64)}, array[]::text[], '{}'::jsonb,
          ${"b".repeat(64)}, false, now() + interval '1 day'
        )
        returning id::text as id
      `
      changeSets[kind] = row.id
    }
    return {
      ...tenant,
      marker,
      clientId: client.id,
      connectionId: connection.connectionId,
      googleAccountId: account.id,
      googleAccountName: connection.googleAccountName,
      locationId: location.locationId,
      externalLocationId: location.externalLocationId,
      googleLocationName: location.googleLocationName,
      reviewId: review.reviewId,
      draftId,
      operationId: operation.id,
      bulkOperationId: bulk.id,
      privacyRequestId: privacy.id,
      onboardingReviewId: onboardingReview.id,
      matchLinkReviewId: matchLinkReview.id,
      changeSets,
    }
  }

  /** Strings that identify B and must never reach A. */
  function tenantBData(b: TenantObjects) {
    return [
      b.organisationId,
      b.email,
      b.marker,
      b.connectionId,
      b.googleAccountName,
      b.externalLocationId,
      b.googleLocationName,
    ]
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    tenantA = await seedTenant("a")
    tenantB = await seedTenant("b")
    // Any Google call lands in the stub, never at Google, and is asserted
    // absent: a cross-tenant id must be refused before any provider call.
    google = await startGoogleStub({ port: 0 })
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl })
  })

  afterAll(async () => {
    await server?.stop()
    await google?.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function getAsA(path: string) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      headers: { cookie: tenantA.cookie },
    })
    return { status: response.status, text: await response.text() }
  }

  function expectNotFoundWithoutLeak(
    path: string,
    response: { status: number; text: string }
  ) {
    expect(response.status, `${path}: ${response.text}`).toBe(404)
    expect(JSON.parse(response.text).error, path).toMatch(/_not_found$/)
    for (const value of tenantBData(tenantB)) {
      expect(response.text, `${path} leaked ${value}`).not.toContain(value)
    }
  }

  it("serves tenant A its own objects (the sweep's control)", async () => {
    for (const path of [
      `/api/reviews/${tenantA.reviewId}`,
      `/api/locations/${tenantA.locationId}/summary`,
      `/api/clients/${tenantA.clientId}`,
      `/api/mutations/${tenantA.operationId}`,
      `/api/privacy/requests/${tenantA.privacyRequestId}/preview`,
    ]) {
      const response = await getAsA(path)
      expect(response.status, `${path}: ${response.text}`).toBe(200)
    }
  })

  const swept = DISCOVERED.filter(
    (r) => r.auth === "session" && !(r.route in SKIPPED_SESSION_ROUTES)
  ).map((r) => r.route)

  it.each(swept)(
    "GET %s with tenant B's ids is 404 without B's data",
    async (route) => {
      const query = QUERIES[route]?.(tenantB)
      const search = query ? `?${new URLSearchParams(query)}` : ""
      const path = urlFor(route, tenantB) + search
      const before = google.calls.length
      const response = await getAsA(path)
      if (KNOWN_200_FOR_FOREIGN_LOCATION.has(route)) {
        const nowhere =
          urlFor(route, { ...tenantB, locationId: randomUUID() }) + search
        const control = await getAsA(nowhere)
        expect(response.status, `${path}: ${response.text}`).toBe(200)
        expect(JSON.parse(response.text), path).toEqual(
          JSON.parse(control.text)
        )
        for (const value of tenantBData(tenantB)) {
          expect(response.text, `${path} leaked ${value}`).not.toContain(value)
        }
      } else {
        expectNotFoundWithoutLeak(path, response)
      }
      expect(google.calls.slice(before), `${path} called Google`).toEqual([])
    }
  )

  // The child tables' own scoping: tenant A's real parent (its location,
  // account or draft, which A may read) with tenant B's child id.
  const nested = swept.filter((route) => segmentKeys(route).length > 1)

  it.each(nested)(
    "GET %s with tenant A's parent and B's child is 404 without B's data",
    async (route) => {
      const query = QUERIES[route]?.(tenantA)
      const path =
        urlFor(route, tenantB, tenantA) +
        (query ? `?${new URLSearchParams(query)}` : "")
      const before = google.calls.length
      expectNotFoundWithoutLeak(path, await getAsA(path))
      expect(google.calls.slice(before), `${path} called Google`).toEqual([])
    }
  )

  it.each(QUERY_ID_ROUTES)(
    "GET %s with tenant B's id in the query is 404 without B's data",
    async (route, query) => {
      const path = `/api/${route}?${query(tenantB)}`
      const before = google.calls.length
      expectNotFoundWithoutLeak(path, await getAsA(path))
      expect(google.calls.slice(before), `${path} called Google`).toEqual([])
    }
  )
})
