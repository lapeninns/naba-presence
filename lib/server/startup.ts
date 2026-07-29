import "server-only"

import { getDatabase } from "@/lib/server/db"
import {
  getServerEnv,
  type ServerEnv,
} from "@/lib/server/env"
import { log } from "@/lib/server/logger"

export type DbIdentity = {
  rolSuper: boolean
  rolBypassRls: boolean
  rowSecurity: string
}

// A high-entropy shared token is a strong webhook-auth option for controlled
// harness deployments. Staging and production still use Google OIDC identity
// verification as defined by the parallel operations track.
export function collectSafetyViolations(
  env: ServerEnv,
  identity: DbIdentity
): string[] {
  const violations: string[] = []
  if (identity.rolSuper) {
    violations.push(
      "DATABASE_URL connects as a superuser; row-level security is inert."
    )
  }
  if (identity.rolBypassRls) {
    violations.push(
      "The runtime role has BYPASSRLS; tenant isolation is off."
    )
  }
  if (identity.rowSecurity !== "on") {
    violations.push(
      `row_security is '${identity.rowSecurity}', expected 'on'.`
    )
  }
  const hasStrongWebhookToken =
    (env.GOOGLE_PUBSUB_VERIFICATION_TOKEN?.length ?? 0) >= 32
  if (
    env.WEBHOOKS_ENABLED &&
    !env.GOOGLE_PUBSUB_AUDIENCE &&
    !hasStrongWebhookToken
  ) {
    violations.push(
      "WEBHOOKS_ENABLED requires GOOGLE_PUBSUB_AUDIENCE (OIDC push verification) in production."
    )
  }
  if (env.LOCAL_BOOTSTRAP_ENABLED) {
    const hostname = env.NEXTAUTH_URL
      ? new URL(env.NEXTAUTH_URL).hostname
      : ""
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      violations.push(
        "LOCAL_BOOTSTRAP_ENABLED must not be set on a non-localhost deployment."
      )
    }
  }
  return violations
}

export async function readDbIdentity(): Promise<DbIdentity> {
  const [row] = await getDatabase()<
    {
      rolSuper: boolean
      rolBypassRls: boolean
      rowSecurity: string
    }[]
  >`
    select
      r.rolsuper as "rolSuper",
      r.rolbypassrls as "rolBypassRls",
      current_setting('row_security') as "rowSecurity"
    from pg_roles r
    where r.rolname = current_user
  `
  return row
}

export async function assertProductionSafety(
  options: { enforce?: boolean } = {}
): Promise<void> {
  const enforce =
    options.enforce ??
    (process.env.NODE_ENV === "production" ||
      process.env.ENFORCE_DB_SAFETY === "true")
  const violations = collectSafetyViolations(
    getServerEnv(),
    await readDbIdentity()
  )
  if (violations.length === 0) {
    log.info("startup.safety_ok", { enforce })
    return
  }
  if (enforce) {
    throw new Error(
      `Unsafe deployment configuration:\n- ${violations.join("\n- ")}`
    )
  }
  log.warn("startup.safety_violations_ignored", { violations })
}
