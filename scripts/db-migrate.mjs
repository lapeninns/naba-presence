import { readFile, readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

import {
  DEFAULT_LOCK_TIMEOUT,
  migrationDatabaseUrl,
  migrationLockTimeout,
  prepareMigration,
} from "./migration-rules.mjs"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { loadEnvConfig } = nextEnv
loadEnvConfig(root)

const url = migrationDatabaseUrl(process.env)
if (!url) {
  throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required")
}

// The session advisory lock below needs one server session for the whole run.
// Supabase's transaction pooler (port 6543) hands each statement to a
// different session, so the lock would silently protect nothing.
if (portOf(url) === "6543") {
  throw new Error(
    "db:migrate refuses a transaction-pooler URL (port 6543); use the direct " +
      "or session-pooler URL (port 5432) in DIRECT_DATABASE_URL"
  )
}

const expectNoop = process.env.DB_MIGRATE_EXPECT_NOOP === "1"
const migrationsDirectory = resolve(
  root,
  process.env.MIGRATIONS_DIR ?? "supabase/migrations"
)
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort()

// Two-int advisory key space: the app's own session locks (scheduler leases,
// Google refresh) use the single-key hashtext() form, so these cannot collide.
const LOCK_CLASS = 0x6e616261 // "naba"
const LOCK_ID = 1 // db:migrate
const lockWaitSeconds = Number(process.env.DB_MIGRATE_LOCK_TIMEOUT ?? 600)
// Postgres lock_timeout for each transactional migration (`0` for none); a
// file's own `-- migrate:lock-timeout <value>` header wins. Distinct from
// DB_MIGRATE_LOCK_TIMEOUT above, which is how long to wait for another run.
const tableLockTimeout =
  process.env.MIGRATION_LOCK_TIMEOUT || DEFAULT_LOCK_TIMEOUT
migrationLockTimeout("MIGRATION_LOCK_TIMEOUT", "", {
  transactional: true,
  fallback: tableLockTimeout,
})

const sql = postgres(url, { max: 1, prepare: false, max_lifetime: null })
let connection
let locked = false
let backendPid

try {
  connection = await sql.reserve()

  locked = await acquireLock(connection)
  const [{ pid }] = await connection`select pg_backend_pid() as pid`
  backendPid = pid

  const applied = await appliedVersions(connection)
  const pending = migrationFiles.filter(
    (file) => !applied.has(file.replace(/\.sql$/, ""))
  )

  if (expectNoop && pending.length > 0) {
    for (const file of pending) console.error(`Pending ${file}`)
    console.error(
      `DB_MIGRATE_EXPECT_NOOP=1 but ${pending.length} migration(s) would apply`
    )
    process.exitCode = 1
  } else {
    for (const migrationFile of migrationFiles) {
      const version = migrationFile.replace(/\.sql$/, "")
      if (applied.has(version)) {
        console.log(`Already applied ${version}`)
        continue
      }

      const text = await readFile(
        resolve(migrationsDirectory, migrationFile),
        "utf8"
      )
      await applyMigration(connection, migrationFile, version, text)
      console.log(`Applied ${version}`)
    }
  }
} finally {
  if (connection) {
    if (locked) {
      await connection`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_ID})`.catch(
        () => {}
      )
    }
    connection.release()
  }
  await sql.end()
}

async function acquireLock(db) {
  const deadline = Date.now() + lockWaitSeconds * 1000
  let announced = false
  for (;;) {
    const [{ acquired }] = await db`
      select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_ID}) as acquired
    `
    if (acquired) return true
    if (!announced) {
      console.log("Waiting for another db:migrate run to finish")
      announced = true
    }
    if (Date.now() > deadline) {
      // A crashed run can leave the lock on a backend a pooler keeps alive.
      const holders = await db`
        select a.pid, a.application_name, a.client_addr::text, a.state,
               a.backend_start
        from pg_locks l join pg_stat_activity a using (pid)
        where l.locktype = 'advisory' and l.granted
          and l.classid = ${LOCK_CLASS} and l.objid = ${LOCK_ID}
          and l.objsubid = 2
      `
      throw new Error(
        `db:migrate lock still held after ${lockWaitSeconds}s by ` +
          `${JSON.stringify(holders)}; if that session is stale, end it ` +
          "with pg_terminate_backend(pid)"
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function appliedVersions(db) {
  const [existing] = await db`
    select to_regclass('public.schema_migration') as table_name
  `
  if (!existing?.table_name) return new Set()
  const rows = await db`select version from schema_migration`
  return new Set(rows.map((row) => row.version))
}

async function applyMigration(db, file, version, text) {
  const migration = prepareMigration(file, text)
  // Validated by migrationLockTimeout (digits and a unit only), so it is safe
  // to interpolate: SET takes no bind parameters.
  const lockTimeout = migrationLockTimeout(file, text, {
    transactional: migration.transactional,
    fallback: tableLockTimeout,
  })

  if (!migration.transactional) {
    // The file manages its own transactions (or runs statements that cannot
    // run inside one), so a failed self-record check cannot be rolled back.
    if (lockTimeout) await db.unsafe(`set lock_timeout = '${lockTimeout}'`)
    try {
      // Each statement is sent alone: a multi-statement string would run as
      // one implicit transaction.
      for (const statement of migration.statements) {
        await db.unsafe(statement)
      }
    } catch (error) {
      throw explainLockTimeout(error, version, lockTimeout, false)
    } finally {
      if (lockTimeout) await db.unsafe("reset lock_timeout").catch(() => {})
    }
    if (!(await isRecorded(db, version))) {
      throw new Error(
        `migration ${version} did not record itself (no-transaction file; ` +
          "its changes were not rolled back)"
      )
    }
    return
  }

  await db.unsafe("begin")
  try {
    if (lockTimeout) {
      await db.unsafe(`set local lock_timeout = '${lockTimeout}'`)
    }
    await db.unsafe(migration.body).catch((error) => {
      throw explainLockTimeout(error, version, lockTimeout, true)
    })
    if (!(await isRecorded(db, version))) {
      throw new Error(`migration ${version} did not record itself`)
    }
    // If the connection dropped and was silently reopened, this is no longer
    // the locked session inside our transaction (which has written at least
    // the schema_migration row, so it has an xid): roll back, do not commit.
    const [{ pid, in_transaction: inTransaction }] = await db`
      select pg_backend_pid() as pid,
             pg_current_xact_id_if_assigned() is not null as in_transaction
    `
    if (pid !== backendPid || !inTransaction) {
      throw new Error(
        `migration ${version}: database session changed mid-migration; ` +
          "re-run db:migrate"
      )
    }
    await db.unsafe("commit")
  } catch (error) {
    await db.unsafe("rollback").catch(() => {})
    throw error
  }
}

function explainLockTimeout(error, version, lockTimeout, rolledBack) {
  if (error?.code !== "55P03" || !lockTimeout) return error
  return new Error(
    `migration ${version} could not take a table lock within lock_timeout ` +
      `${lockTimeout} (another transaction holds it)` +
      (rolledBack
        ? " and was rolled back; "
        : "; no-transaction file, so earlier statements were not rolled back; ") +
      "re-run db:migrate when the database is quieter, or raise the limit " +
      "with MIGRATION_LOCK_TIMEOUT or a -- migrate:lock-timeout header",
    { cause: error }
  )
}

async function isRecorded(db, version) {
  const [{ table_name: table }] = await db`
    select to_regclass('public.schema_migration') as table_name
  `
  if (!table) return false
  const [row] = await db`
    select 1 as recorded from schema_migration where version = ${version}
  `
  return Boolean(row)
}

function portOf(connectionString) {
  try {
    return new URL(connectionString).port
  } catch {
    return ""
  }
}
