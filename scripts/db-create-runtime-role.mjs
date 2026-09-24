import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import postgres from "postgres"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required")

const roleName = process.env.RUNTIME_ROLE_NAME ?? "naba_test_runtime"
const rolePassword = process.env.RUNTIME_ROLE_PASSWORD ?? "naba_test_runtime"
if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
  throw new Error(`Unsafe role name: ${roleName}`)
}

const sql = postgres(url, { max: 1, prepare: false })
try {
  await sql.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${roleName}') then
        create role ${roleName} login nosuperuser nobypassrls;
      end if;
    end
    $$;
  `)
  await sql.unsafe(
    `alter role ${roleName} with login password '${rolePassword.replaceAll("'", "''")}'`
  )
  await sql.unsafe(`grant naba_app_runtime to ${roleName}`)
  await sql.unsafe(`alter role ${roleName} inherit`)
  // Mirrors the startup parameters in lib/server/db.ts. The Supabase session
  // pooler drops those, so the role carries the same limits itself.
  await sql.unsafe(`alter role ${roleName} set statement_timeout = '30s'`)
  await sql.unsafe(
    `alter role ${roleName} set idle_in_transaction_session_timeout = '60s'`
  )
  console.log(`Runtime login role ready: ${roleName}`)
} finally {
  await sql.end()
}
