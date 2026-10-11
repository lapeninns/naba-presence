import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import nextEnv from "@next/env"
import postgres from "postgres"

import { describeDatabaseTarget } from "./migration-rules.mjs"

// Usage:
//   DIRECT_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     pnpm ops:mfa-recover --email person@example.com \
//     --operator you@example.com --reason "Lost phone; identity checked on call, ticket 123" \
//     [--dry-run] [--skip-provider]
//
// Operator MFA recovery (P02-S9) for a person who lost every authenticator
// app. It runs outside the application on purpose: the app never holds the
// service-role key and has no route that removes a factor without a code.
//
//   1. recover_user_mfa(user, operator, reason) (migration 0201), in the
//      database: bumps app_user.security_version (every session the person
//      holds stops resolving and every dispatch they queued is refused by
//      recheckAuthorisation), deletes their sessions and pending MFA tickets,
//      zeroes mfa_factor_count, and writes one `user.mfa_recovered` audit row
//      per organisation they belong to, naming the operator and the reason.
//   2. At the auth provider (Supabase Auth admin API, service-role key):
//      deletes every TOTP factor, so the person signs in with their password
//      alone and must enroll afresh before the next sensitive action.
//
// The database step runs first: if the provider step then fails, the person
// is signed out everywhere but still needs a code, which is the safe side.
// Re-running is safe (the version is bumped again; factors already gone are
// skipped). --dry-run reports what would change and changes nothing.
// --skip-provider does only the database step (for a person whose factors
// were removed by other means); without it a missing key refuses to start.
//
// Identity must be verified out of band before this is run, and running it
// against production is a release operation that needs approval
// (docs/runbook.md, "MFA recovery"). The key is the operator's to hold; it is
// read from the environment and never printed.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "user-id": { type: "string" },
    operator: { type: "string" },
    reason: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "skip-provider": { type: "boolean", default: false },
  },
})

const email = values.email?.trim().toLowerCase()
const userId = values["user-id"]?.trim()
const operator = values.operator?.trim()
const reason = values.reason?.trim()
const dryRun = values["dry-run"]
const skipProvider = values["skip-provider"]
if (!email === !userId) {
  throw new Error("Pass exactly one of --email or --user-id.")
}
if (!operator) throw new Error("--operator is required.")
if (!reason || reason.length < 10) {
  throw new Error("--reason is required (at least 10 characters).")
}

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error("DIRECT_DATABASE_URL is required.")

const providerUrl = process.env.SUPABASE_URL?.replace(/\/$/, "")
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!skipProvider && (!providerUrl || !serviceRoleKey)) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to delete the factors (or pass --skip-provider)."
  )
}

async function provider(path, init = {}) {
  const response = await fetch(`${providerUrl}/auth/v1${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Auth provider ${init.method ?? "GET"} ${path.replace(/[0-9a-f-]{36}/g, ":id")} answered ${response.status}.`
    )
  }
  return { status: response.status, payload }
}

/** The person's TOTP factors at the provider (verified or not). */
async function listFactors(subject) {
  const { status, payload } = await provider(`/admin/users/${subject}`)
  if (status === 404) return []
  const factors = Array.isArray(payload?.factors) ? payload.factors : []
  return factors
    .filter((factor) => factor?.factor_type === "totp" && factor?.id)
    .map((factor) => ({ id: String(factor.id), status: factor.status }))
}

const sql = postgres(url, { max: 1, prepare: false })
try {
  console.log(`Database: ${describeDatabaseTarget(url)}`)
  const [user] = await sql`
    select
      u.id::text as id,
      u.auth_provider as "authProvider",
      u.auth_subject as "authSubject",
      u.security_version as "securityVersion",
      u.mfa_factor_count as "factorCount",
      (select count(*)::integer from member m where m.user_id = u.id)
        as organisations,
      (select count(*)::integer from app_session s where s.user_id = u.id)
        as sessions
    from app_user u
    where ${userId ? sql`u.id = ${userId}::uuid` : sql`lower(u.email) = ${email}`}
  `
  if (!user) throw new Error("No such user.")
  console.log(
    `User ${user.id}: security version ${user.securityVersion}, ` +
      `${user.factorCount} factor(s) on record, ${user.sessions} session(s), ` +
      `${user.organisations} organisation(s).`
  )

  const atProvider =
    !skipProvider && user.authProvider === "supabase" && user.authSubject
  if (!skipProvider && !atProvider) {
    console.log("No Supabase identity: nothing to delete at the provider.")
  }
  const factors = atProvider ? await listFactors(user.authSubject) : []
  if (atProvider) {
    console.log(`Provider factors: ${factors.length}.`)
  }

  if (dryRun) {
    console.log("Dry run: nothing changed.")
  } else {
    const [result] = await sql`
      select * from recover_user_mfa(${user.id}::uuid, ${operator}, ${reason})
    `
    console.log(
      `Recovered: security version ${result.security_version}, ` +
        `${result.revoked_sessions} session(s) revoked, audited in ` +
        `${result.organisations} organisation(s) as user.mfa_recovered.`
    )
    let deleted = 0
    for (const factor of factors) {
      await provider(`/admin/users/${user.authSubject}/factors/${factor.id}`, {
        method: "DELETE",
      })
      deleted += 1
    }
    if (atProvider) {
      const left = await listFactors(user.authSubject)
      console.log(`Deleted ${deleted} provider factor(s); ${left.length} left.`)
      if (left.length > 0) {
        process.exitCode = 1
        console.error("Some factors remain at the provider. Re-run to retry.")
      }
    }
  }
} finally {
  await sql.end()
}
