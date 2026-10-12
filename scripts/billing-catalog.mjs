import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import { describeDatabaseTarget } from "./migration-rules.mjs"

// Usage:
//   pnpm billing:catalog --file billing-catalog.test.json --validate
//   DIRECT_DATABASE_URL=... pnpm billing:catalog --file billing-catalog.test.json
//   DIRECT_DATABASE_URL=... pnpm billing:catalog --file billing-catalog.test.json --apply
//   DIRECT_DATABASE_URL=... pnpm billing:catalog --file billing-catalog.live.json \
//     --apply --allow-live
//
// Seeds the plan catalog (`billing_plan`, migration 0220) of ONE Stripe
// environment from a reviewed JSON file (plan P07-S7). Repeatable: each run
// compares the file with the database and changes only what differs.
//
// - A plan version (code + version) that is missing is inserted.
// - One that exists with the same terms only has its `active` flag set to
//   the file's value. A published version's terms never change (the
//   billing_plan_terms_immutable trigger refuses it), so a version whose
//   terms differ is a conflict: add a new version instead. Any conflict or
//   invalid entry stops the run before anything is written.
// - An active plan of the same environment that the file does not list is
//   reported, and deactivated only with --deactivate-unlisted. Nothing is
//   ever deleted: organisations keep naming the versions they bought.
//
// Without --apply this is a dry run that prints the changes. --validate
// checks the file alone, without a database. A live catalog is refused
// unless --allow-live is passed, and only with --apply does anything change.
// Writes need the owner/operator connection in DIRECT_DATABASE_URL (the
// runtime role may only read the catalog); DATABASE_URL is never used.
// Catalog values (prices, limits, allowances) are a product-owner decision:
// commit nothing here but reviewed files (docs/runbook.md, "Billing catalog").

export const ENVIRONMENTS = ["test", "live"]
export const WORKSPACE_MODES = ["business", "agency"]

const CODE = /^[a-z][a-z0-9_]{0,63}$/
const PRICE = /^price_[A-Za-z0-9]{1,250}$/

/** The term columns, in a stable order: everything but `active`. */
const TERMS = [
  "workspaceMode",
  "name",
  "stripePriceId",
  "locationLimit",
  "memberLimit",
  "aiDraftCreditsPerPeriod",
  "isTestOffer",
]

const isInt = (value, min) => Number.isInteger(value) && value >= min

/**
 * Validates a parsed catalog file against the same rules as the table's
 * checks, plus the file's own consistency. Returns the normalised plans, or
 * the problems found (never both).
 */
export function parseCatalog(input) {
  const problems = []
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { problems: ["the file must be a JSON object"], catalog: null }
  }
  const { environment, plans } = input
  if (!ENVIRONMENTS.includes(environment)) {
    problems.push(`environment must be one of ${ENVIRONMENTS.join(" | ")}`)
  }
  if (!Array.isArray(plans) || plans.length === 0) {
    problems.push("plans must be a non-empty array")
    return { problems, catalog: null }
  }
  const keys = new Set()
  const prices = new Set()
  const normalised = plans.map((plan, index) => {
    const at = `plans[${index}]`
    const p = plan && typeof plan === "object" ? plan : {}
    const out = {
      code: p.code,
      version: p.version,
      workspaceMode: p.workspaceMode,
      name: typeof p.name === "string" ? p.name.trim() : p.name,
      stripePriceId: p.stripePriceId ?? null,
      locationLimit: p.locationLimit,
      memberLimit: p.memberLimit ?? null,
      aiDraftCreditsPerPeriod: p.aiDraftCreditsPerPeriod,
      isTestOffer: p.isTestOffer,
      active: p.active,
    }
    if (typeof out.code !== "string" || !CODE.test(out.code)) {
      problems.push(`${at}.code must match ${CODE}`)
    }
    if (!isInt(out.version, 1))
      problems.push(`${at}.version must be an integer >= 1`)
    if (!WORKSPACE_MODES.includes(out.workspaceMode)) {
      problems.push(
        `${at}.workspaceMode must be one of ${WORKSPACE_MODES.join(" | ")}`
      )
    }
    if (
      typeof out.name !== "string" ||
      out.name.length < 1 ||
      out.name.length > 120
    ) {
      problems.push(`${at}.name must be 1 to 120 characters`)
    }
    if (
      out.stripePriceId !== null &&
      (typeof out.stripePriceId !== "string" || !PRICE.test(out.stripePriceId))
    ) {
      problems.push(
        `${at}.stripePriceId must be null or a Stripe price id (price_...)`
      )
    }
    if (!isInt(out.locationLimit, 1))
      problems.push(`${at}.locationLimit must be an integer >= 1`)
    if (out.memberLimit !== null && !isInt(out.memberLimit, 1)) {
      problems.push(`${at}.memberLimit must be null or an integer >= 1`)
    }
    if (!isInt(out.aiDraftCreditsPerPeriod, 0)) {
      problems.push(`${at}.aiDraftCreditsPerPeriod must be an integer >= 0`)
    }
    if (typeof out.isTestOffer !== "boolean")
      problems.push(`${at}.isTestOffer must be true or false`)
    if (typeof out.active !== "boolean")
      problems.push(`${at}.active must be true or false`)
    if (environment === "test" && out.isTestOffer !== true) {
      problems.push(
        `${at}: every test-environment plan is a test offer (isTestOffer: true)`
      )
    }
    // Allowed by the table, but a live plan marked as a test offer is shown
    // to paying customers as "Test offer": never seed one by accident.
    if (environment === "live" && out.isTestOffer === true) {
      problems.push(`${at}: a live plan cannot be a test offer`)
    }
    if (out.active === true && out.stripePriceId === null) {
      problems.push(`${at}: an active plan needs its stripePriceId`)
    }
    const key = `${out.code}@${out.version}`
    if (keys.has(key)) problems.push(`${at}: ${key} is listed twice`)
    keys.add(key)
    if (out.stripePriceId) {
      if (prices.has(out.stripePriceId)) {
        problems.push(`${at}: ${out.stripePriceId} is used by two plans`)
      }
      prices.add(out.stripePriceId)
    }
    return out
  })
  if (problems.length > 0) return { problems, catalog: null }
  return { problems: [], catalog: { environment, plans: normalised } }
}

/**
 * Compares the desired catalog with the environment's rows in the database.
 * Pure. Each action is one of insert | activate | deactivate | unchanged |
 * conflict | unlisted. `existing` rows use the same field names as the file.
 */
export function planCatalogChanges(catalog, existing, options = {}) {
  const byKey = new Map(
    existing
      .filter((row) => row.environment === catalog.environment)
      .map((row) => [`${row.code}@${row.version}`, row])
  )
  const actions = []
  const listed = new Set()
  for (const plan of catalog.plans) {
    const key = `${plan.code}@${plan.version}`
    listed.add(key)
    const row = byKey.get(key)
    if (!row) {
      actions.push({ type: "insert", key, plan })
      continue
    }
    const differs = TERMS.filter((field) => row[field] !== plan[field])
    if (differs.length > 0) {
      actions.push({ type: "conflict", key, plan, fields: differs })
    } else if (row.active !== plan.active) {
      actions.push({ type: plan.active ? "activate" : "deactivate", key, plan })
    } else {
      actions.push({ type: "unchanged", key, plan })
    }
  }
  for (const [key, row] of byKey) {
    if (listed.has(key) || !row.active) continue
    actions.push(
      options.deactivateUnlisted
        ? { type: "deactivate", key, plan: { ...row, active: false } }
        : { type: "unlisted", key, plan: row }
    )
  }
  const conflicts = actions.filter((action) => action.type === "conflict")
  return {
    actions,
    problems: conflicts.map(
      (action) =>
        `${action.key}: terms differ in the database (${action.fields.join(", ")}); published terms are immutable, add a new version`
    ),
    writes: actions.filter((action) =>
      ["insert", "activate", "deactivate"].includes(action.type)
    ),
  }
}

/** One line per action, for the dry run and the applied report. */
export function describeActions(actions) {
  return actions.map((action) => {
    const plan = action.plan
    const terms = `${plan.workspaceMode}, ${plan.locationLimit} location(s), ${plan.aiDraftCreditsPerPeriod} AI credits, ${plan.stripePriceId ?? "no price"}`
    switch (action.type) {
      case "insert":
        return `  + insert ${action.key} "${plan.name}" (${terms})${plan.active ? " active" : ""}`
      case "activate":
        return `  ^ activate ${action.key}`
      case "deactivate":
        return `  v deactivate ${action.key}`
      case "unchanged":
        return `  = ${action.key} unchanged`
      case "unlisted":
        return `  ? ${action.key} is active but not in the file (kept; --deactivate-unlisted retires it)`
      default:
        return `  ! ${action.key} conflict: ${action.fields.join(", ")}`
    }
  })
}

/**
 * Decides whether the run may proceed. Returns the reason it may not, or
 * null. A live catalog needs --allow-live to be applied.
 */
export function refusal(catalog, options) {
  if (catalog.environment === "live" && options.apply && !options.allowLive) {
    return "refusing to change the live catalog without --allow-live"
  }
  return null
}

const COLUMNS = `
  code, version, workspace_mode as "workspaceMode", environment, name,
  stripe_price_id as "stripePriceId", location_limit as "locationLimit",
  member_limit as "memberLimit",
  ai_draft_credits_per_period as "aiDraftCreditsPerPeriod",
  is_test_offer as "isTestOffer", active
`

async function applyActions(tx, environment, writes) {
  for (const { type, plan } of writes) {
    if (type === "insert") {
      await tx`
        insert into billing_plan (
          code, version, workspace_mode, environment, name, stripe_price_id,
          location_limit, member_limit, ai_draft_credits_per_period,
          is_test_offer, active
        )
        values (
          ${plan.code}, ${plan.version}, ${plan.workspaceMode}, ${environment},
          ${plan.name}, ${plan.stripePriceId}, ${plan.locationLimit},
          ${plan.memberLimit}, ${plan.aiDraftCreditsPerPeriod},
          ${plan.isTestOffer}, ${plan.active}
        )
      `
    } else {
      await tx`
        update billing_plan set active = ${type === "activate"}
        where code = ${plan.code} and version = ${plan.version}
          and environment = ${environment}
      `
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      apply: { type: "boolean", default: false },
      validate: { type: "boolean", default: false },
      "allow-live": { type: "boolean", default: false },
      "deactivate-unlisted": { type: "boolean", default: false },
    },
  })
  if (!values.file) throw new Error("--file is required.")
  if (values.validate && values.apply) {
    throw new Error("--validate never writes; drop --apply.")
  }
  const parsed = parseCatalog(
    JSON.parse(readFileSync(resolve(values.file), "utf8"))
  )
  if (parsed.problems.length > 0) {
    throw new Error(`invalid catalog:\n  ${parsed.problems.join("\n  ")}`)
  }
  const catalog = parsed.catalog
  const options = {
    apply: values.apply,
    allowLive: values["allow-live"],
    deactivateUnlisted: values["deactivate-unlisted"],
  }
  const refused = refusal(catalog, options)
  if (refused) throw new Error(refused)
  console.log(
    `Catalog ${values.file}: ${catalog.plans.length} plan(s) for ${catalog.environment}.`
  )
  if (values.validate) {
    console.log("Valid. No database was read.")
    return
  }

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error("DIRECT_DATABASE_URL is required.")
  const { default: postgres } = await import("postgres")
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    console.log(`Database: ${describeDatabaseTarget(url)}`)
    await sql.begin(async (tx) => {
      // One writer at a time: a concurrent run waits, then sees our rows.
      await tx`lock table billing_plan in share row exclusive mode`
      const existing = await tx.unsafe(
        `select ${COLUMNS} from billing_plan where environment = $1`,
        [catalog.environment]
      )
      const plan = planCatalogChanges(catalog, existing, options)
      for (const line of describeActions(plan.actions)) console.log(line)
      if (plan.problems.length > 0) {
        throw new Error(`nothing written:\n  ${plan.problems.join("\n  ")}`)
      }
      if (!options.apply) {
        console.log(
          `Dry run: ${plan.writes.length} change(s) would be written. Re-run with --apply.`
        )
        return
      }
      await applyActions(tx, catalog.environment, plan.writes)
      console.log(`Applied ${plan.writes.length} change(s).`)
    })
  } finally {
    await sql.end()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const { default: nextEnv } = await import("@next/env")
  nextEnv.loadEnvConfig(root)
  main().catch((error) => {
    console.error(`billing:catalog failed: ${error?.message ?? error}`)
    process.exitCode = 1
  })
}
