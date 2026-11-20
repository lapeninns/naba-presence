import postgres from "postgres"
import { describe, expect, it } from "vitest"

import { listClientSummaries } from "@/lib/server/clients"
import type { Session } from "@/lib/server/session"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "./helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("client summary query budget", () => {
  it("does not add SQL statements per client or linked listing", async () => {
    const { DIRECT_DATABASE_URL, TEST_RUNTIME_DATABASE_URL } = process.env
    if (!DIRECT_DATABASE_URL || !TEST_RUNTIME_DATABASE_URL)
      throw new Error("The integration database harness is required")
    const admin = postgres(DIRECT_DATABASE_URL, { max: 1 })
    let statements = 0
    const runtime = postgres(TEST_RUNTIME_DATABASE_URL, {
      max: 1,
      prepare: false,
      debug: () => {
        statements++
      },
    })
    const organisations: string[] = []
    try {
      const tenant = await createTestTenant(admin)
      organisations.push(tenant.organisationId)
      const connection = await seedGoogleConnection(admin, tenant)
      const session: Session = {
        sessionId: tenant.userId,
        userId: tenant.userId,
        organisationId: tenant.organisationId,
        organisationName: "Harness tenant",
        workspaceMode: "agency",
        displayName: "Harness user",
        email: tenant.email,
        role: "owner",
        canPublish: true,
      }
      const seedClient = async (index: number) => {
        const [{ id }] = await admin<{ id: string }[]>`
          insert into client (organisation_id, name, slug, created_by)
          values (${tenant.organisationId}, ${`Budget ${index}`},
                  ${`budget-${index}`}, ${tenant.userId})
          returning id
        `
        const { locationId } = await seedLinkedLocation(admin, {
          organisationId: tenant.organisationId,
          ...connection,
        })
        await admin`update location set client_id = ${id} where id = ${locationId}`
      }
      const load = () =>
        runtime.begin(async (sql) => {
          await sql`select set_config('app.organisation_id', ${tenant.organisationId}, true)`
          const before = statements
          const result = await listClientSummaries(sql, session)
          return { result, queries: statements - before }
        })
      await seedClient(0)
      const one = await load()
      for (let index = 1; index < 8; index++) await seedClient(index)
      const many = await load()
      expect(one.result.items).toHaveLength(1)
      expect(many.result.items).toHaveLength(8)
      expect(many.result.items.every((item) => item.linkedCount === 1)).toBe(
        true
      )
      expect(one.queries).toBeGreaterThan(0)
      expect(one.queries).toBeLessThanOrEqual(20)
      expect(many.queries).toBe(one.queries)
    } finally {
      await runtime.end()
      await destroyTenants(admin, organisations)
      await admin.end()
    }
  })
})
