import { readdir } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import {
  compareMigrations,
  describeDatabaseTarget,
  LEGACY_MIGRATION_FILES,
  listMigrationVersions,
  migrationDatabaseUrl,
  migrationVersion,
} from "../scripts/migration-rules.mjs"
import {
  collectSchemaViolations,
  missingMigrations,
} from "@/lib/server/schema-compat"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url)

describe("required-migrations manifest", () => {
  it("lists exactly the versions in supabase/migrations", async () => {
    const onDisk = listMigrationVersions(await readdir(migrationsDirectory))
    const manifest = [...REQUIRED_MIGRATIONS].sort()
    const notInManifest = onDisk.filter((v) => !manifest.includes(v))
    const notOnDisk = manifest.filter((v) => !onDisk.includes(v))
    expect(
      notInManifest,
      "add these to REQUIRED_MIGRATIONS in lib/server/schema-manifest.ts"
    ).toEqual([])
    expect(
      notOnDisk,
      "REQUIRED_MIGRATIONS names versions with no migration file"
    ).toEqual([])
    expect(manifest).toEqual(onDisk)
  })

  it("has no duplicate entries", () => {
    expect(new Set(REQUIRED_MIGRATIONS).size).toBe(REQUIRED_MIGRATIONS.length)
  })
})

describe("listMigrationVersions", () => {
  it("keeps only .sql files, sorted, without the extension", () => {
    expect(
      listMigrationVersions([
        "0002_b.sql",
        "README.md",
        "0001_a.sql",
        "20260729000400_remove_local_demo_data.sql",
      ])
    ).toEqual(["0001_a", "0002_b", "20260729000400_remove_local_demo_data"])
  })

  it("matches the version db:migrate records", () => {
    expect(migrationVersion("0061_workspace_mode.sql")).toBe(
      "0061_workspace_mode"
    )
  })
})

describe("collectSchemaViolations", () => {
  const required = ["0001_initial", "0002_second", "0003_third"]

  it("accepts a database that has every required version", () => {
    expect(collectSchemaViolations(new Set(required), required)).toEqual([])
  })

  it("reports each missing version", () => {
    const applied = new Set(["0001_initial"])
    expect(missingMigrations(applied, required)).toEqual([
      "0002_second",
      "0003_third",
    ])
    const violations = collectSchemaViolations(applied, required)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("0002_second, 0003_third")
    expect(violations[0]).toContain("pnpm db:migrate")
  })

  it("accepts a database ahead of the code", () => {
    expect(
      collectSchemaViolations(
        new Set([...required, "0004_from_a_newer_deploy"]),
        required
      )
    ).toEqual([])
  })

  it("treats legacy versions like any other", () => {
    const legacy = migrationVersion(LEGACY_MIGRATION_FILES[0])
    expect(REQUIRED_MIGRATIONS).toContain(legacy)
    const withLegacy = [...required, legacy]
    expect(collectSchemaViolations(new Set(withLegacy), withLegacy)).toEqual([])
    expect(
      collectSchemaViolations(new Set(required), withLegacy).join(" ")
    ).toContain(legacy)
  })

  it("reports everything when nothing is applied", () => {
    expect(missingMigrations(new Set())).toEqual([...REQUIRED_MIGRATIONS])
  })
})

describe("compareMigrations (db:status)", () => {
  const repository = ["0001_a", "0002_b", "20260729000400_legacy"]

  it("reports nothing when the database matches the repository", () => {
    expect(compareMigrations(repository, repository)).toEqual({
      pending: [],
      unknown: [],
    })
  })

  it("lists repository versions the database has not applied", () => {
    expect(compareMigrations(["0001_a"], repository)).toEqual({
      pending: ["0002_b", "20260729000400_legacy"],
      unknown: [],
    })
  })

  it("lists applied versions the checkout does not know, sorted", () => {
    expect(
      compareMigrations([...repository, "0004_d", "0003_c"], repository)
    ).toEqual({ pending: [], unknown: ["0003_c", "0004_d"] })
  })

  it("treats a database without a ledger as having everything pending", () => {
    expect(compareMigrations([], repository)).toEqual({
      pending: repository,
      unknown: [],
    })
  })
})

describe("migrationDatabaseUrl", () => {
  it("prefers DIRECT_DATABASE_URL over a local DATABASE_URL", () => {
    expect(
      migrationDatabaseUrl({
        DIRECT_DATABASE_URL: "postgresql://admin@prod.example:5432/postgres",
        DATABASE_URL: "postgresql://app@127.0.0.1:54322/postgres",
      })
    ).toBe("postgresql://admin@prod.example:5432/postgres")
  })

  it("falls back to DATABASE_URL", () => {
    expect(
      migrationDatabaseUrl({ DATABASE_URL: "postgresql://app@db:5432/x" })
    ).toBe("postgresql://app@db:5432/x")
    expect(migrationDatabaseUrl({})).toBeUndefined()
  })
})

describe("describeDatabaseTarget", () => {
  it("shows host, port and database without credentials or query", () => {
    expect(
      describeDatabaseTarget(
        "postgresql://admin:s3cret@db.example.com:6543/postgres?sslmode=require"
      )
    ).toBe("db.example.com:6543/postgres")
  })

  it("defaults the port and survives a malformed URL", () => {
    expect(describeDatabaseTarget("postgres://u:p@host/db")).toBe(
      "host:5432/db"
    )
    expect(describeDatabaseTarget("not a url")).not.toContain("not a url")
  })
})
