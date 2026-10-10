import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "./helpers/app-server"
import { createTestTenant, destroyTenants } from "./helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// Receipts (0067_mutation_operation.sql) belong to one organisation: tenant B
// cannot read tenant A's receipt through GET /api/mutations/{id} (by
// operation id or by intent id) or through SQL as the runtime role.
describeDatabase("mutation operation tenant isolation", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>
  const operationId = randomUUID()
  const intentId = randomUUID()

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
    tenantA = await createTestTenant(admin)
    tenantB = await createTestTenant(admin)
    organisations.push(tenantA.organisationId, tenantB.organisationId)
    const [location] = await admin<{ id: string }[]>`
      insert into location (organisation_id, name)
      values (${tenantA.organisationId}, 'Receipt location')
      returning id::text as id
    `
    await admin`
      insert into mutation_operation (
        id, organisation_id, intent_id, actor_user_id, surface, action,
        location_id, payload_hash, state
      )
      values (
        ${operationId}, ${tenantA.organisationId}, ${intentId},
        ${tenantA.userId}, 'hours', 'publish', ${location.id},
        ${"a".repeat(64)}, 'confirmed_applied'
      )
    `
  })

  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await Promise.all([admin.end(), runtime.end()])
  })

  const get = (cookie: string, id: string) =>
    fetch(`${server.baseUrl}/api/mutations/${id}`, { headers: { cookie } })

  it("serves the owning tenant its receipt by operation id and by intent id", async () => {
    for (const id of [operationId, intentId]) {
      const response = await get(tenantA.cookie, id)
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({
        operation: {
          id: operationId,
          intentId,
          surface: "hours",
          action: "publish",
          outcome: "confirmed_applied",
        },
      })
    }
  })

  it("answers another tenant with the same 404 as a missing receipt", async () => {
    for (const id of [operationId, intentId, randomUUID()]) {
      const response = await get(tenantB.cookie, id)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        error: "mutation_not_found",
      })
    }
  })

  it("hides the row from another tenant's runtime SQL and refuses a cross-tenant write", async () => {
    const rows = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${tenantB.organisationId}, true)`
      return sql`select id from mutation_operation where id = ${operationId}`
    })
    expect(rows).toHaveLength(0)
    await expect(
      runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${tenantB.organisationId}, true)`
        await sql`
          insert into mutation_operation (
            organisation_id, intent_id, surface, action, payload_hash
          )
          values (
            ${tenantA.organisationId}, ${randomUUID()}, 'hours', 'publish',
            ${"b".repeat(64)}
          )
        `
      })
    ).rejects.toThrow()
    const updated = await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${tenantB.organisationId}, true)`
      return sql`
        update mutation_operation set state = 'failed'
        where id = ${operationId}
        returning id
      `
    })
    expect(updated).toHaveLength(0)
  })
})
