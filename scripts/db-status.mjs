import { readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

import {
  compareMigrations,
  describeDatabaseTarget,
  listMigrationVersions,
  migrationDatabaseUrl,
} from "./migration-rules.mjs"

// Usage: pnpm db:status [--expect-current]
//
// Prints the database, role, table count and applied migrations, then
// compares the applied versions with supabase/migrations:
// - pending: in the repository but not applied. The app built from this
//   checkout refuses to start in production until they are applied.
// - unknown: applied but not in this checkout. Expected when the database is
//   ahead of the code (expand, then contract); not an error.
// With --expect-current the script exits 1 when anything is pending, so an
// operator can check a database before promoting a deployment.
// Like db:migrate, DIRECT_DATABASE_URL wins over DATABASE_URL; the target
// host, port and database are printed so the operator can confirm which
// database was checked.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { loadEnvConfig } = nextEnv
loadEnvConfig(root)

const url = migrationDatabaseUrl(process.env)
if (!url) {
  throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required")
}

const expectCurrent = process.argv.slice(2).includes("--expect-current")
const repositoryVersions = listMigrationVersions(
  await readdir(resolve(root, "supabase/migrations"))
)

const sql = postgres(url, { max: 1, prepare: false })

try {
  const [database] = await sql`
    select current_database() as database, current_user as role
  `
  const migrations = await sql`
    select version, applied_at from schema_migration order by applied_at
  `.catch(() => [])
  const [tables] = await sql`
    select count(*)::integer as count
    from information_schema.tables
    where table_schema = 'public'
  `
  const { pending, unknown } = compareMigrations(
    migrations.map((row) => row.version),
    repositoryVersions
  )
  console.log({
    target: describeDatabaseTarget(url),
    database: database.database,
    role: database.role,
    tables: tables.count,
    migrations,
    pending,
    unknown,
  })
  if (pending.length > 0) {
    console.error(
      `${pending.length} migration(s) pending: ${pending.join(", ")}`
    )
    if (expectCurrent) process.exitCode = 1
  } else {
    console.log(
      `Schema is current: all ${repositoryVersions.length} migration(s) applied` +
        (unknown.length > 0 ? `, plus ${unknown.length} unknown` : "")
    )
  }
} finally {
  await sql.end()
}
