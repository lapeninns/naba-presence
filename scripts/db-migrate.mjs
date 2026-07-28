import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { loadEnvConfig } = nextEnv
loadEnvConfig(root)

if (!process.env.DIRECT_DATABASE_URL && !process.env.DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required")
}

const migrationsDirectory = join(root, "db", "migrations")
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort()

const sql = postgres(
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  { max: 1, prepare: false }
)

try {
  for (const migrationFile of migrationFiles) {
    const version = migrationFile.replace(/\.sql$/, "")
    const [existing] = await sql`
      select to_regclass('public.schema_migration') as table_name
    `

    if (existing?.table_name) {
      const [applied] = await sql`
        select version from schema_migration where version = ${version}
      `
      if (applied) {
        console.log(`Already applied ${version}`)
        continue
      }
    }

    const migration = await readFile(
      join(migrationsDirectory, migrationFile),
      "utf8"
    )
    await sql.unsafe(migration)
    console.log(`Applied ${version}`)
  }
} finally {
  await sql.end()
}
