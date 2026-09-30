import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview } from "./helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
suite("legacy verification credential cleanup", () => {
  let admin: ReturnType<typeof postgres>
  const organisations: string[] = []
  beforeAll(() => {
    if (!process.env.DIRECT_DATABASE_URL) throw new Error("Isolated database required")
    admin = postgres(process.env.DIRECT_DATABASE_URL, { max: 1 })
  })
  afterAll(async () => { await destroyTenants(admin, organisations); await admin.end() })

  it("redacts untyped history, preserves reviewed bytes and restores trigger/RLS boundaries", async () => {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const [account] = await admin`select id from google_account where google_connection_id = ${connection.connectionId}`
    const secret = "fixture-private-historical-echo"
    const name = `${linked.googleLocationName}/verifications/historical`
    const payload = { name, method: "EMAIL", pin: secret, arbitrary: { response: secret } }
    const [review] = await admin`
      insert into gbp_change_set (organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by, payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload)
      values (${owner.organisationId}, ${linked.locationId}, ${account.id}, ${connection.connectionId}, ${name}, 'verification_start', ${owner.userId}, '{"contextProvided":true}', 'fixture-review-hash', '{}', '{}', 'fixture-baseline-hash', false, ${Buffer.alloc(32, 7)}) returning id`
    for (const kind of ["legacy", "reviewed", "unrelated", "malformed"] as const) {
      await admin`
        insert into gbp_management_mutation (organisation_id, location_id, actor_user_id, resource_type, operation, target_resource_name, status, execution_state, confirmation_state, idempotency_key, requested_payload, google_response, confirmation_response, change_set_id, created_at, expires_at, finished_at, confirmation_observed_at)
        values (${owner.organisationId}, ${linked.locationId}, ${owner.userId}, ${kind === "unrelated" ? "location_admin" : "verification"}, 'start_verification', ${name}, 'succeeded', 'accepted', 'confirmed', ${kind}, ${admin.json(kind === "malformed" ? [secret] : payload)}, ${admin.json({ verification: { name, method: "EMAIL", state: "COMPLETED", createTime: "2026-09-29T09:00:00Z", echo: secret }, error: { message: secret } })}, ${admin.json({ state: "COMPLETED", echo: secret })}, ${kind === "reviewed" ? review.id : null}, '2026-09-01T00:00:00Z', '2027-01-01T00:00:00Z', '2026-09-02T00:00:00Z', '2026-09-02T00:01:00Z')`
    }
    await admin`insert into gbp_resource_snapshot (organisation_id, location_id, resource_type, resource_name, payload, google_hash, observed_at, expires_at, created_at, updated_at) values (${owner.organisationId}, ${linked.locationId}, 'verification', ${linked.googleLocationName + "/VoiceOfMerchantState"}, ${admin.json({ nested: { echo: secret } })}, 'old-hash', '2026-09-01', '2026-10-01', '2026-09-01', '2026-09-02')`
    await admin`insert into audit_log (organisation_id, actor_user_id, action, subject_type, subject_id, metadata) values (${owner.organisationId}, ${owner.userId}, 'google.start_verification', 'location', ${linked.locationId}, ${admin.json({ nested: { echo: secret } })}), (${owner.organisationId}, ${owner.userId}, 'google.verification.requested', 'location', ${linked.locationId}, '{"reviewId":"preserved"}')`
    const before = await admin`select * from gbp_management_mutation where organisation_id = ${owner.organisationId} order by idempotency_key`
    const [reviewBefore] = await admin`select * from gbp_change_set where id = ${review.id}`
    const [snapshotBefore] = await admin`select * from gbp_resource_snapshot where organisation_id = ${owner.organisationId}`
    const auditBefore = await admin`select * from audit_log where organisation_id = ${owner.organisationId} order by action`
    const migration = await readFile(new URL("../../supabase/migrations/0069_legacy_verification_redaction.sql", import.meta.url), "utf8")
    const body = migration.replace(/^begin;\s*/, "").replace(/commit;\s*$/, "")
    await expect(admin.begin(async (transaction) => {
      await transaction.unsafe(body.replace("update audit_log set metadata", "select 1 / 0;\nupdate audit_log set metadata"))
    })).rejects.toThrow("division by zero")
    expect(await admin`select * from gbp_management_mutation where organisation_id = ${owner.organisationId} order by idempotency_key`).toEqual(before)
    expect((await admin`select * from gbp_resource_snapshot where organisation_id = ${owner.organisationId}`)[0]).toEqual(snapshotBefore)
    await expect(admin`update audit_log set metadata = '{}' where organisation_id = ${owner.organisationId}`).rejects.toThrow("append-only")
    await admin.unsafe(migration)
    const after = await admin`select * from gbp_management_mutation where organisation_id = ${owner.organisationId} order by idempotency_key`
    for (let index = 0; index < before.length; index++) {
      const old = before[index], current = after[index]
      if (old.idempotency_key === "reviewed" || old.idempotency_key === "unrelated") expect(current).toEqual(old)
      else {
        expect(JSON.stringify(current)).not.toContain(secret)
        const columns = Object.fromEntries(Object.entries(old).filter(([key]) => !["requested_payload", "google_response", "confirmation_response"].includes(key)))
        expect(current).toMatchObject(columns)
        expect(current.google_response.verification).toMatchObject({ name, method: "EMAIL", state: "COMPLETED", createTime: "2026-09-29T09:00:00Z" })
      }
    }
    expect((await admin`select * from gbp_change_set where id = ${review.id}`)[0]).toEqual(reviewBefore)
    const [snapshotAfter] = await admin`select * from gbp_resource_snapshot where organisation_id = ${owner.organisationId}`
    expect(snapshotAfter).toEqual({ ...snapshotBefore, payload: { historicalRedacted: true }, google_hash: createHash("sha256").update('{"historicalRedacted":true}').digest("hex") })
    const auditAfter = await admin`select * from audit_log where organisation_id = ${owner.organisationId} order by action`
    expect(auditAfter).toEqual(auditBefore.map((row) => row.action === "google.start_verification" ? { ...row, metadata: { historicalRedacted: true } } : row))
    await expect(admin`update audit_log set metadata = '{}' where organisation_id = ${owner.organisationId}`).rejects.toThrow("append-only")
    const triggers = await admin`select tgname, tgenabled from pg_trigger where tgname in ('audit_log_no_update', 'gbp_resource_snapshot_updated_at')`
    expect(triggers).toHaveLength(2)
    expect(triggers.every((trigger) => trigger.tgenabled === "O")).toBe(true)
    const tables = await admin`select relrowsecurity, relforcerowsecurity from pg_class where relname in ('gbp_management_mutation', 'gbp_resource_snapshot', 'audit_log', 'gbp_change_set')`
    expect(tables).toHaveLength(4)
    expect(tables.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true)
    await expect(admin.begin(async (transaction) => {
      await transaction`set local role naba_app_runtime`
      await transaction`alter table audit_log disable trigger audit_log_no_update`
    })).rejects.toThrow("must be owner")
  })
})
