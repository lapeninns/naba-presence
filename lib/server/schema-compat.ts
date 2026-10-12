import "server-only"

import { getDatabase } from "@/lib/server/db"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

/**
 * Required migrations the database has not applied. Versions applied but not
 * required are allowed: the database may run ahead of the code during an
 * expand-then-contract rollout.
 */
export function missingMigrations(
  applied: ReadonlySet<string>,
  required: readonly string[] = REQUIRED_MIGRATIONS
): string[] {
  return required.filter((version) => !applied.has(version))
}

export function collectSchemaViolations(
  applied: ReadonlySet<string>,
  required: readonly string[] = REQUIRED_MIGRATIONS
): string[] {
  const missing = missingMigrations(applied, required)
  if (missing.length === 0) return []
  return [
    `The database is missing ${missing.length} migration(s) this build requires: ${missing.join(", ")}. Run pnpm db:migrate before deploying this code.`,
  ]
}

/**
 * Versions recorded in `schema_migration`, read through the runtime role
 * (0004_runtime_role.sql grants it SELECT). A database with no ledger table
 * has applied nothing.
 */
export async function readAppliedMigrations(): Promise<Set<string>> {
  try {
    const rows = await getDatabase()<{ version: string }[]>`
      select version from schema_migration
    `
    return new Set(rows.map((row) => row.version))
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
    ) {
      return new Set()
    }
    throw error
  }
}
