import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import nextEnv from "@next/env"
import postgres from "postgres"

import { describeDatabaseTarget } from "./migration-rules.mjs"

// Usage:
//   DIRECT_DATABASE_URL=... pnpm ops:revoke-support-sessions \
//     --operator you@example.com --reason "Pilot launch: impersonation off" [--dry-run]
//
// Deletes every outstanding support impersonation session in every
// organisation through revoke_support_sessions (0084), which writes one
// `support.sessions_revoked` audit row per affected organisation naming the
// operator and the reason. --dry-run counts what would be revoked and changes
// nothing.
//
// The function is not executable by naba_app_runtime, so this needs the
// owner/operator connection in DIRECT_DATABASE_URL; DATABASE_URL is never
// used. Running it against production is a release operation that needs
// approval (docs/runbook.md, "Support impersonation").

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

const { values } = parseArgs({
  options: {
    operator: { type: "string" },
    reason: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
})

const operator = values.operator?.trim()
const reason = values.reason?.trim()
if (!operator) throw new Error("--operator is required.")
if (!reason || reason.length < 10) {
  throw new Error("--reason is required (at least 10 characters).")
}

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error("DIRECT_DATABASE_URL is required.")

const sql = postgres(url, { max: 1, prepare: false })
try {
  console.log(`Database: ${describeDatabaseTarget(url)}`)
  const outstanding = await sql`
    select organisation_id::text as "organisationId", count(*)::integer as sessions
    from app_session
    where support_actor is not null
    group by organisation_id
    order by organisation_id
  `
  const total = outstanding.reduce((sum, row) => sum + row.sessions, 0)
  console.log(
    `Outstanding support sessions: ${total} in ${outstanding.length} organisation(s).`
  )
  for (const row of outstanding) {
    console.log(`  ${row.organisationId}: ${row.sessions}`)
  }
  if (values["dry-run"]) {
    console.log("Dry run: nothing revoked.")
  } else {
    const [result] = await sql`
      select revoke_support_sessions(${operator}, ${reason}) as revoked
    `
    console.log(
      `Revoked ${result.revoked} support session(s); audited as support.sessions_revoked.`
    )
  }
} finally {
  await sql.end()
}
