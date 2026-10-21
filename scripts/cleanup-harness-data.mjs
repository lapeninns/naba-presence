// Removes leftover test-harness tenants (organisation slug 'harness-%') that
// interrupted integration/e2e runs left behind, mirroring destroyTenants in
// tests/integration/helpers/tenant.ts. Dry run by default; pass --yes to
// delete. Shares the harness guard (scripts/test-database.mjs): refuses a
// non-local database (with no override), and the local Supabase dev
// database on port 54322 unless NABA_ALLOW_DEV_DB=1 says that is the one to
// clean.
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

import { assertLocalDatabaseUrl } from "./test-database.mjs"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error("DIRECT_DATABASE_URL is required.")
// No remote override here: this script only ever cleans a local database.
assertLocalDatabaseUrl("DIRECT_DATABASE_URL", {
  ...process.env,
  ALLOW_REMOTE_TEST_DB: undefined,
})

const apply = process.argv.includes("--yes")
const sql = postgres(url, { max: 1 })
try {
  const orgs = await sql`
    select id, name, slug, created_at
    from organisation
    where slug like 'harness-%'
    order by created_at
  `
  const locations = await sql`
    select l.name
    from location l
    join organisation o on o.id = l.organisation_id
    where o.slug like 'harness-%'
    order by l.name
  `
  console.log(`Harness organisations: ${orgs.length}`)
  for (const org of orgs) console.log(`  - ${org.slug} (${org.name})`)
  console.log(`Their locations: ${locations.length}`)
  for (const location of locations) console.log(`  - ${location.name}`)

  if (!apply) {
    console.log("\nDry run - re-run with --yes to delete the rows above.")
  } else if (orgs.length === 0) {
    console.log("\nNothing to delete.")
  } else {
    await sql.begin(async (tx) => {
      await tx`alter table audit_log disable trigger audit_log_no_update`
      await tx`
        alter table publish_attempt_event
        disable trigger publish_attempt_event_no_update
      `
      await tx`delete from organisation where slug like 'harness-%'`
      await tx`
        alter table publish_attempt_event
        enable trigger publish_attempt_event_no_update
      `
      await tx`alter table audit_log enable trigger audit_log_no_update`
    })
    const users = await sql`
      delete from app_user
      where email like 'harness-%@nabapresence.test'
        and default_organisation_id is null
      returning id
    `
    const [remaining] = await sql`
      select count(*)::int as n from organisation where slug like 'harness-%'
    `
    console.log(
      `\nDeleted ${orgs.length} organisations and ${users.length} orphaned ` +
        `harness users. Remaining harness organisations: ${remaining.n}`
    )
  }
} finally {
  await sql.end()
}
