import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import nextEnv from "@next/env"
import postgres from "postgres"

import { describeDatabaseTarget } from "./migration-rules.mjs"

// Usage:
//   DIRECT_DATABASE_URL=... pnpm ops:pause status
//   DIRECT_DATABASE_URL=... pnpm ops:pause pause --scope publish \
//     --operator you@example.com --reason "Google incident: stop all writes"
//   DIRECT_DATABASE_URL=... pnpm ops:pause resume --scope publish \
//     --operator you@example.com --reason "Google incident resolved"
//   DIRECT_DATABASE_URL=... pnpm ops:pause feature --organisation <uuid> \
//     --feature post_scheduling --enable|--disable --operator you@example.com
//
// Hot pause controls (migration 0071, lib/server/pause-controls.ts). `pause`
// and `resume` call set_ops_pause, which updates ops_pause_control and
// appends one ops_pause_event row naming the operator and the reason. Every
// instance picks the change up within the pause cache TTL (5 seconds); no
// redeploy. An env flag that is off still pauses its scope whatever this
// says: `resume` cannot lift an env pause, and `status` shows only this table
// (the deployment's env flags are not visible from here).
//
// `feature` switches one organisation_feature row (per-organisation product
// flags, lib/server/org-features.ts).
//
// Neither table is writable by naba_app_runtime, so this needs the
// owner/operator connection in DIRECT_DATABASE_URL; DATABASE_URL is never
// used. Pausing production is an incident action; resuming it, or turning a
// feature on for a production organisation, is a release operation that
// needs approval (docs/runbook.md, "Kill switches").

const root = dirname(dirname(fileURLToPath(import.meta.url)))
nextEnv.loadEnvConfig(root)

// Node >= 22.18 strips TypeScript syntax on import; the module is
// dependency-free, so the script and the app share one feature list.
const { ORG_FEATURES } = await import(
  new URL("../lib/contracts/org-features.ts", import.meta.url).href
)

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scope: { type: "string" },
    operator: { type: "string" },
    reason: { type: "string" },
    organisation: { type: "string" },
    feature: { type: "string" },
    enable: { type: "boolean", default: false },
    disable: { type: "boolean", default: false },
  },
})

const command = positionals[0] ?? "status"
if (!["status", "pause", "resume", "feature"].includes(command)) {
  throw new Error(
    `Unknown command ${command}: status | pause | resume | feature`
  )
}

const operator = values.operator?.trim()
const reason = values.reason?.trim()
if (command !== "status" && !operator)
  throw new Error("--operator is required.")
if ((command === "pause" || command === "resume") && !values.scope) {
  throw new Error("--scope is required.")
}
if (
  (command === "pause" || command === "resume") &&
  (!reason || reason.length < 10)
) {
  throw new Error("--reason is required (at least 10 characters).")
}

const organisation = values.organisation?.trim()
const feature = values.feature?.trim()
if (command === "feature") {
  if (values.enable === values.disable) {
    throw new Error("Pass exactly one of --enable or --disable.")
  }
  if (!organisation || !feature) {
    throw new Error("--organisation and --feature are required.")
  }
  // The table checks only the name's format, so a typo would be recorded
  // as "enabled" for a feature nothing reads.
  if (!ORG_FEATURES.includes(feature)) {
    throw new Error(
      `Unknown feature ${feature}: one of ${ORG_FEATURES.join(" | ")}.`
    )
  }
}

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error("DIRECT_DATABASE_URL is required.")

const sql = postgres(url, { max: 1, prepare: false })
try {
  console.log(`Database: ${describeDatabaseTarget(url)}`)
  if (command === "pause" || command === "resume") {
    const [row] = await sql`
      select scope, paused, previously_paused as "previouslyPaused"
      from set_ops_pause(
        ${values.scope}, ${command === "pause"}, ${reason}, ${operator}
      )
    `
    console.log(
      row.paused === row.previouslyPaused
        ? `${row.scope}: already ${row.paused ? "paused" : "running"} (recorded).`
        : `${row.scope}: ${row.paused ? "paused" : "resumed"}.`
    )
  } else if (command === "feature") {
    // organisation_feature forces RLS, so even the owner writes it inside
    // the organisation's tenant setting.
    await sql.begin(async (tx) => {
      await tx`select set_config('app.organisation_id', ${organisation}, true)`
      await tx`
        insert into organisation_feature (
          organisation_id, feature, enabled, changed_by, changed_at
        )
        values (${organisation}, ${feature}, ${values.enable}, ${operator}, now())
        on conflict (organisation_id, feature) do update
        set
          enabled = excluded.enabled,
          changed_by = excluded.changed_by,
          changed_at = excluded.changed_at
      `
    })
    console.log(
      `${organisation}: ${feature} ${values.enable ? "enabled" : "disabled"}.`
    )
  }

  const scopes = await sql`
    select scope, paused, reason, changed_by as "changedBy", changed_at as "changedAt"
    from ops_pause_control
    order by scope
  `
  console.log(
    "Operator pauses (env flags still override; see docs/runbook.md):"
  )
  for (const row of scopes) {
    console.log(
      row.paused
        ? `  ${row.scope}: PAUSED since ${row.changedAt.toISOString()} by ${row.changedBy}: ${row.reason}`
        : `  ${row.scope}: running`
    )
  }
} finally {
  await sql.end()
}
