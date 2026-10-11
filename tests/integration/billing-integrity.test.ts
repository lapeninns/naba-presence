import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * 0222: every organisation gets its pilot billing row from the database,
 * whichever code creates it, so an organisation made by an app release that
 * predates billing is never left read-only (billing_missing).
 */
describeDatabase("billing integrity (0222)", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  const created: string[] = []

  beforeAll(() => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
  })

  afterAll(async () => {
    for (const id of created) {
      await admin`delete from organisation where id = ${id}`
    }
    await runtime.end()
    await admin.end()
  })

  const billingState = async (id: string) =>
    admin<{ state: string }[]>`
      select state from organisation_billing where organisation_id = ${id}
    `

  it("seeds a pilot row for an organisation an operator inserts", async () => {
    const id = randomUUID()
    created.push(id)
    await admin`
      insert into organisation (id, slug, name)
      values (${id}, ${`operator-${id.slice(0, 8)}`}, 'Operator org')
    `
    expect(await billingState(id)).toEqual([{ state: "pilot" }])
  })

  it("seeds a pilot row for an organisation the runtime role inserts without seeding", async () => {
    // The previous app release: inserts the organisation under its own
    // tenant context and never touches organisation_billing.
    const id = randomUUID()
    created.push(id)
    await runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${id}, true)`
      await sql`
        insert into organisation (id, slug, name)
        values (${id}, ${`legacy-${id.slice(0, 8)}`}, 'Legacy org')
      `
    })
    expect(await billingState(id)).toEqual([{ state: "pilot" }])
  })
})
