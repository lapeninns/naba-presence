import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { retentionStatusResponseSchema } from "@/lib/contracts/privacy"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
  seedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// GET /api/privacy/retention-status (plan P04-7): this organisation's
// standing in the retention cycles and its legal-hold counts, behind the
// privacy_settings feature, and never another organisation's cycle row.
describeDatabase("privacy retention status route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const cycles: string[] = []

  async function status(cookie: string) {
    return fetch(`${server.baseUrl}/api/privacy/retention-status`, {
      headers: { cookie },
    })
  }

  async function enable(organisationId: string) {
    await admin`
      insert into organisation_feature (organisation_id, feature, enabled, changed_by)
      values (${organisationId}, 'privacy_settings', true, 'test')
    `
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    if (cycles.length) {
      await admin`delete from retention_cycle where id in ${admin(cycles)}`
    }
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("is a 404 while the organisation's privacy_settings feature is off", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const response = await status(tenant.cookie)
    expect(response.status).toBe(404)
  })

  it("serves the /settings/privacy page only once the feature is on", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const page = () =>
      fetch(`${server.baseUrl}/settings/privacy`, {
        headers: { cookie: tenant.cookie },
        redirect: "manual",
      })
    // The settings loading boundary streams the shell first, so notFound()
    // can arrive after a 200 status; what matters is that the area is not
    // rendered.
    const DESCRIPTION = "Requests from reviewers about their data"
    expect(await (await page()).text()).not.toContain(DESCRIPTION)
    await enable(tenant.organisationId)
    const response = await page()
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(DESCRIPTION)
  })

  it("refuses members", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    await enable(tenant.organisationId)
    const member = await seedMemberUser(admin, {
      organisationId: tenant.organisationId,
    })
    const response = await status(member.cookie)
    expect(response.status).toBe(403)
  })

  it("reports only this organisation's cycle standing and its holds", async () => {
    const tenant = await createTestTenant(admin)
    const other = await createTestTenant(admin)
    organisations.push(tenant.organisationId, other.organisationId)
    await enable(tenant.organisationId)
    const { reviewId } = await seedReview(admin, {
      organisationId: tenant.organisationId,
    })
    await admin`
      insert into legal_hold (organisation_id, review_id, reason, approved_by)
      values (${tenant.organisationId}, ${reviewId}, 'Litigation pending', ${tenant.userId})
    `
    // Dated far from any cycle another suite leaves: the completed one is
    // the latest, the running one the oldest.
    const [completed] = await admin<{ id: string }[]>`
      insert into retention_cycle (
        cycle_date, status, completed_at, enumeration_completed_at,
        enumerated, succeeded, failed
      )
      values ('2098-06-01', 'completed', now(), now(), 2, 1, 1)
      returning id::text as id
    `
    const [running] = await admin<{ id: string }[]>`
      insert into retention_cycle (cycle_date, enumerated)
      values ('1990-01-01', 1)
      returning id::text as id
    `
    cycles.push(completed.id, running.id)
    await admin`
      insert into retention_cycle_org (
        cycle_id, organisation_id, status, attempts, last_error_code, finished_at
      )
      values
        (${completed.id}, ${tenant.organisationId}, 'succeeded', 1, null, now()),
        (${completed.id}, ${other.organisationId}, 'failed', 3, 'internal_error', now()),
        (${running.id}, ${other.organisationId}, 'pending', 0, null, null)
    `

    const response = await status(tenant.cookie)
    expect(response.status).toBe(200)
    const body = retentionStatusResponseSchema.parse(await response.json())
    expect(body.lastCompletedCycle).toMatchObject({
      cycleDate: "2098-06-01",
      organisation: { status: "succeeded", attempts: 1, lastErrorCode: null },
    })
    expect(body.currentCycle).toMatchObject({
      cycleDate: "1990-01-01",
      completedAt: null,
      organisation: null,
    })
    expect(body.heldReviews).toBe(1)
    expect(body.heldLocations).toBe(0)
    expect(body.rawContentRetentionDays).toBe(30)
    expect(typeof body.deletesEnabled).toBe("boolean")
    // Nothing fleet-wide leaves the route.
    expect(JSON.stringify(body)).not.toContain("enumerated")
    expect(JSON.stringify(body)).not.toContain(other.organisationId)

    const adminUser = await seedMemberUser(admin, {
      organisationId: tenant.organisationId,
    })
    await admin`
      update member set role = 'admin'
      where organisation_id = ${tenant.organisationId}
        and user_id = ${adminUser.userId}
    `
    expect((await status(adminUser.cookie)).status).toBe(200)
  })
})
