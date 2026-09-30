import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verificationWorkflowResponseSchema } from "@/lib/contracts/google-verification-workflows"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedMemberUser } from "../helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
suite("standalone saved verification workflow discovery", () => {
  let admin: ReturnType<typeof postgres>, google: GoogleStub, server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) throw new Error("Disposable database required")
    admin = postgres(url, { max: 1 }); google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "false", PUBLISH_ENABLED: "false" })
  })
  afterAll(async () => { await server.stop(); await google.stop(); await destroyTenants(admin, organisations); await admin.end() })
  async function fixture() {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const [scope] = await admin`select a.id as account_id, c.credential_generation as generation from google_account a join google_connection c on c.id = a.google_connection_id where c.id = ${connection.connectionId}`
    if (!scope) throw new Error("Fixture account missing")
    google.reset()
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/verification-workflows`
    async function seed(operation: "start" | "complete" = "start", at = "2026-09-30T00:00:00.000001Z", twoPerson = false) {
      const id = randomUUID(), name = `${linked.googleLocationName}/verifications/saved`
      const payload = operation === "start" ? { method: "EMAIL", emailAddress: "private-destination@example.test", contextProvided: true, contextHash: "c".repeat(64), optionId: "d".repeat(64) }
        : { name, method: "SMS", credentialBindingHash: "c".repeat(64) }
      await admin`insert into gbp_change_set (id, organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by, payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload, approval_expires_at, created_at)
        values (${id}, ${owner.organisationId}, ${linked.locationId}, ${scope.account_id}, ${connection.connectionId}, ${linked.googleLocationName}, ${operation === "start" ? "verification_start" : "verification_complete"}, ${owner.userId}, ${admin.json(payload)}, ${"a".repeat(64)}, array[]::text[], ${admin.json({ credentialGeneration: scope.generation })}, ${"b".repeat(64)}, ${twoPerson}, ${Buffer.alloc(128)}, now() + interval '20 minutes', ${at}::text::timestamptz)`
      return { id, operation, name }
    }
    async function attempt(review: Awaited<ReturnType<typeof seed>>) {
      const id = randomUUID()
      await admin`insert into gbp_management_mutation (id, organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, status, idempotency_key, execution_state, confirmation_state, requested_payload, google_response, last_error_code, change_set_id)
        values (${id}, ${owner.organisationId}, ${linked.locationId}, ${scope.account_id}, ${owner.userId}, 'verification', ${review.operation === "start" ? "start_verification" : "complete_verification"}, ${review.operation === "start" ? linked.googleLocationName : review.name}, 'ambiguous', ${id}, 'unknown', 'unresolved', '{"pin":"legacy-private-echo"}', '{"pin":"legacy-private-echo"}', 'legacy-private-echo', ${review.id})`
      return id
    }
    async function get(params = "", cookie = owner.cookie) { return fetch(`${url}${params ? `?${params}` : ""}`, { headers: { cookie } }) }
    async function list(params = "", cookie = owner.cookie) {
      const response = await get(params, cookie)
      expect(response.status, await response.clone().text()).toBe(200)
      return verificationWorkflowResponseSchema.parse(await response.json())
    }
    return { owner, connection, linked, scope, seed, attempt, get, list }
  }
  it("returns an empty index without contacting Google or creating attempts", async () => {
    const f = await fixture()
    expect(await f.list()).toEqual({ workflows: [], nextCursor: null })
    expect(google.calls).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  })
  it("discovers both review families without private context, destinations, PINs or provider echoes", async () => {
    const f = await fixture(); const start = await f.seed(); const complete = await f.seed("complete")
    const attempt = await f.attempt(complete)
    const result = await f.list()
    expect(result.workflows).toHaveLength(2)
    expect(result.workflows.find((item) => item.reviewId === start.id)).toMatchObject({ operation: "start_verification", method: "EMAIL", canApprove: true, attempt: null })
    expect(result.workflows.find((item) => item.reviewId === complete.id)).toMatchObject({ operation: "complete_verification", method: "SMS", canApprove: false, attempt: { id: attempt, status: "ambiguous", executionState: "unknown", confirmationState: "unresolved" } })
    expect(JSON.stringify(result)).not.toContain("private-destination")
    expect(JSON.stringify(result)).not.toContain("legacy-private-echo")
    expect(result.workflows.every((item) => !("payload" in item) && !("baseline" in item) && !("privatePayload" in item))).toBe(true)
    expect(google.calls).toHaveLength(0)
  })
  it("lets a second manager discover an approval that the initiating owner cannot approve", async () => {
    const f = await fixture(); await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    const review = await f.seed("complete", undefined, true)
    const second = await seedMemberUser(admin, { organisationId: f.owner.organisationId })
    await admin`update member set role = 'admin' where user_id = ${second.userId}`
    expect((await f.list()).workflows[0]).toMatchObject({ reviewId: review.id, requiresSecondApprover: true, canApprove: false })
    expect((await f.list("", second.cookie)).workflows[0]).toMatchObject({ reviewId: review.id, requiresSecondApprover: true, canApprove: true })
  })
  it("preserves sub-millisecond cursor order and UUID ties across every page", async () => {
    const f = await fixture()
    const seeds = await Promise.all([f.seed("start", "2026-09-30T00:00:00.000001Z"), f.seed("complete", "2026-09-30T00:00:00.000002Z"), f.seed("start", "2026-09-30T00:00:00.000002Z"), f.seed("complete", "2026-09-30T00:00:00.000003Z")])
    const expected = [seeds[3]?.id, ...[seeds[1]?.id, seeds[2]?.id].sort().reverse(), seeds[0]?.id]
    const ids: string[] = []; let cursor: string | null = null
    do {
      const page = await f.list(`pageSize=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      ids.push(...page.workflows.map((item) => item.reviewId)); cursor = page.nextCursor
    } while (cursor)
    expect(ids).toEqual(expected)
    expect(new Set(ids).size).toBe(4)
  })
  it("keeps review order stable when an attempt is created between pages", async () => {
    const f = await fixture(); const older = await f.seed("start", "2026-09-30T00:00:00.000001Z"), newer = await f.seed("complete", "2026-09-30T00:00:00.000002Z")
    const first = await f.list("pageSize=1"); expect(first.workflows[0]?.reviewId).toBe(newer.id)
    await f.attempt(newer)
    const next = await f.list(`pageSize=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`)
    expect(next.workflows.map((item) => item.reviewId)).toEqual([older.id])
    expect(next.nextCursor).toBeNull()
  })
  it.each(["operation=complete", "stage=reviews", "stage=attempts"])("applies %s before cursor pagination", async (filter) => {
    const f = await fixture(); await f.seed(); const complete = await f.seed("complete"); await f.attempt(complete)
    const result = await f.list(filter)
    expect(result.workflows).toHaveLength(1)
    expect(result.workflows[0]?.reviewId === complete.id).toBe(filter !== "stage=reviews")
  })
  it("excludes expired unexecuted reviews by default but retains recorded outcomes after expiry and disconnect", async () => {
    const f = await fixture(); const unexecuted = await f.seed(), executed = await f.seed("complete"); const attempt = await f.attempt(executed)
    await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where organisation_id = ${f.owner.organisationId}`
    await admin`update google_connection set status = 'revoked' where id = ${f.connection.connectionId}`
    const result = await f.list()
    expect(result.workflows).toHaveLength(1)
    expect(result.workflows[0]).toMatchObject({ reviewId: executed.id, canApprove: false, reviewReason: "expired", attempt: { id: attempt, confirmationState: "unresolved" } })
    expect((await f.list("includeExpired=true&stage=reviews")).workflows[0]).toMatchObject({ reviewId: unexecuted.id, canApprove: false, reviewReason: "expired" })
    expect(google.calls).toHaveLength(0)
  })
  it.each(["policy_changed", "credential_changed", "actor_access_changed"])("shows %s without advertising approval", async (reason) => {
    const f = await fixture(); const review = await f.seed()
    if (reason === "policy_changed") await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    if (reason === "credential_changed") await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${f.connection.connectionId}`
    if (reason === "actor_access_changed") {
      const initiator = await seedMemberUser(admin, { organisationId: f.owner.organisationId, role: "viewer" })
      await admin`update gbp_change_set set requested_by = ${initiator.userId} where id = ${review.id}`
    }
    expect((await f.list()).workflows[0]).toMatchObject({ reviewId: review.id, reviewReason: reason, canApprove: false })
  })
  it.each(["revoked_connection", "inactive_account"])("keeps %s review visible while requiring reconnection before approval", async (kind) => {
    const f = await fixture(); const review = await f.seed()
    if (kind === "revoked_connection") await admin`update google_connection set status = 'revoked' where id = ${f.connection.connectionId}`
    if (kind === "inactive_account") await admin`update google_account set is_active = false where id = ${f.scope.account_id}`
    expect((await f.list()).workflows[0]).toMatchObject({ reviewId: review.id, canApprove: false, reviewReason: "reconnect_required" })
    expect(google.calls).toHaveLength(0)
  })
  it("preserves an unfamiliar stored method as unknown without exposing it or offering approval", async () => {
    const f = await fixture(); const review = await f.seed()
    await admin`update gbp_change_set set payload = payload || '{"method":"private-or-future-method"}'::jsonb where id = ${review.id}`
    const result = await f.list()
    expect(result.workflows[0]).toMatchObject({ reviewId: review.id, method: "UNKNOWN", canApprove: false, reviewReason: "review_unreadable" })
    expect(JSON.stringify(result)).not.toContain("private-or-future-method")
  })
  it.each(["operation=start", "stage=reviews", "includeExpired=true"])("rejects cursor reuse after %s filter changes", async (filter) => {
    const f = await fixture(); await f.seed(); await f.seed("complete")
    const first = await f.list("pageSize=1")
    expect((await f.get(`${filter}&cursor=${encodeURIComponent(first.nextCursor ?? "")}`)).status).toBe(400)
  })
  it("rejects a cursor after a linked-target change and hides the earlier target's workflows", async () => {
    const f = await fixture(); await f.seed(); await f.seed("complete")
    const first = await f.list("pageSize=1")
    await admin`update external_location set google_location_name = 'locations/new-target' where id = ${f.linked.externalLocationId}`
    expect((await f.get(`cursor=${encodeURIComponent(first.nextCursor ?? "")}`)).status).toBe(400)
    expect((await f.list()).workflows).toHaveLength(0)
  })
  it("isolates another location in the same organisation and rejects its cursor reuse", async () => {
    const f = await fixture(); const review = await f.seed(); await f.seed("complete")
    const other = await seedLinkedReview(admin, { organisationId: f.owner.organisationId, connectionId: f.connection.connectionId, googleAccountName: f.connection.googleAccountName })
    const id = randomUUID()
    await admin`insert into gbp_change_set (id, organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by, payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload, approval_expires_at)
      select ${id}, organisation_id, ${other.locationId}, google_account_id, connection_id, ${other.googleLocationName}, resource_type, requested_by, payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload, approval_expires_at from gbp_change_set where id = ${review.id}`
    expect((await f.list()).workflows).toHaveLength(2)
    const url = `${server.baseUrl}/api/locations/${other.locationId}/verification-workflows`
    const response = await fetch(url, { headers: { cookie: f.owner.cookie } })
    expect(verificationWorkflowResponseSchema.parse(await response.json()).workflows.map((item) => item.reviewId)).toEqual([id])
    const first = await f.list("pageSize=1")
    expect((await fetch(`${url}?cursor=${encodeURIComponent(first.nextCursor ?? "")}`, { headers: { cookie: f.owner.cookie } })).status).toBe(400)
  })
  it("rejects malformed queries, foreign tenants and viewers without contacting Google", async () => {
    const f = await fixture(); await f.seed()
    for (const query of ["cursor=invalid", "pageSize=0", "pageSize=51", "pin=private", "stage=invalid"]) expect((await f.get(query)).status).toBe(400)
    const foreign = await createTestTenant(admin); organisations.push(foreign.organisationId)
    expect((await f.get("", foreign.cookie)).status).toBe(404)
    const viewer = await seedMemberUser(admin, { organisationId: f.owner.organisationId, role: "viewer" })
    expect((await f.get("", viewer.cookie)).status).toBe(403)
    expect(google.calls).toHaveLength(0)
  })
})
