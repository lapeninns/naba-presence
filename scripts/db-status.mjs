import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { loadEnvConfig } = nextEnv
loadEnvConfig(root)

if (!process.env.DIRECT_DATABASE_URL && !process.env.DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required")
}

const sql = postgres(
  process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL,
  { max: 1, prepare: false }
)

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
  console.log({
    database: database.database,
    role: database.role,
    tables: tables.count,
    migrations,
  })
} finally {
  await sql.end()
}
