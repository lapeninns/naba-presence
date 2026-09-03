import "server-only"

import { z } from "zod"

export function parseFeatureFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`Feature flag must be "true" or "false", got: ${value}`)
}

export function parseDatabasePoolMax(value: unknown): number {
  if (value === undefined || value === "") return 10
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(
      `DATABASE_POOL_MAX must be an integer from 1 to 100, got: ${value}`
    )
  }
  return parsed
}

const featureFlag = (fallback: boolean) =>
  z
    .unknown()
    .optional()
    .transform((value) => parseFeatureFlag(value, fallback))

const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
)

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional()
)

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.email().optional()
)

const optionalSecret = (minimumLength: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(minimumLength).optional()
  )

const optionalTextWithDefault = (fallback: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).default(fallback)
  )

const urlWithDefault = (fallback: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().default(fallback)
  )

const timeoutWithDefault = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback)

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.unknown().optional().transform(parseDatabasePoolMax),
  DIRECT_DATABASE_URL: optionalText,
  NEXTAUTH_URL: optionalUrl,
  NEXTAUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  CRON_SECRET: z.string().min(16),
  SUPPORT_IMPERSONATION_SECRET: optionalSecret(32),
  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: optionalText,
  AUTH_PROVIDER_TIMEOUT_MS: timeoutWithDefault(10_000),
  OPENAI_API_KEY: optionalText,
  OPENAI_ORG_ID: optionalText,
  OPENAI_MODEL_DRAFT: optionalTextWithDefault("gpt-5-mini"),
  OPENAI_MODEL_VERIFY: optionalTextWithDefault("gpt-5-mini"),
  OPENAI_BASE_URL: urlWithDefault("https://api.openai.com"),
  // Capped below the connection's idle_in_transaction_session_timeout (60s,
  // lib/server/db.ts) so a slow provider can never outlast a transaction the
  // request still holds; Postgres would kill the backend mid-statement and the
  // caller would see an opaque 500 instead of a provider timeout.
  OPENAI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(55_000)
    .default(30_000),
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  GOOGLE_PLACES_API_KEY: optionalText,
  GOOGLE_PUBSUB_AUDIENCE: optionalText,
  GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: optionalEmail,
  GOOGLE_PUBSUB_VERIFICATION_TOKEN: optionalSecret(16),
  GOOGLE_REQUESTS_PER_SECOND: z.coerce.number().min(1).max(100).default(8),
  GOOGLE_TIMEOUT_MS: timeoutWithDefault(15_000),
  GOOGLE_MUTATION_TIMEOUT_MS: timeoutWithDefault(20_000),
  JOBS_INTERVAL_SECONDS: timeoutWithDefault(60),
  // Job runner batching. Concurrency is additionally bounded by
  // DATABASE_POOL_MAX (one tenant transaction per in-flight item) and, for
  // provider-bound work, by GOOGLE_REQUESTS_PER_SECOND.
  JOBS_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  JOBS_PER_ORGANISATION: z.coerce.number().int().min(1).max(100).default(3),
  DRAFTS_ENABLED: featureFlag(true),
  PUBLISH_ENABLED: featureFlag(true),
  SYNC_ENABLED: featureFlag(true),
  WEBHOOKS_ENABLED: featureFlag(true),
  // Pauses the background runner wholesale. PUBLISH_ENABLED and SYNC_ENABLED
  // gate the interactive routes only, so without this the runner keeps draining
  // its backlog to Google after an operator believes writes are stopped.
  JOBS_ENABLED: featureFlag(true),
  // Degraded mode for the human boundary: off, verification runs its
  // deterministic checks alone so a hand-written reply is still saved while the
  // AI provider is down.
  SEMANTIC_VERIFY_ENABLED: featureFlag(true),
  // Two switches because the halves have different costs. RETENTION_ENABLED
  // stops the sweep entirely; RETENTION_DELETES_ENABLED stops only the
  // irreversible deletes, so redaction of expired provider content keeps
  // meeting its obligation during an incident.
  RETENTION_ENABLED: featureFlag(true),
  RETENTION_DELETES_ENABLED: featureFlag(true),
  PASSWORD_AUTH_ENABLED: featureFlag(true),
  LOCAL_BOOTSTRAP_ENABLED: featureFlag(false),
  GBP_PERFORMANCE_ENABLED: featureFlag(true),
  GBP_KEYWORDS_ENABLED: featureFlag(true),
  GBP_POSTS_ENABLED: featureFlag(true),
  GBP_MEDIA_ENABLED: featureFlag(true),
  GBP_FOOD_MENUS_ENABLED: featureFlag(true),
  GBP_PLACE_ACTIONS_ENABLED: featureFlag(true),
  GBP_PROFILE_WRITES_ENABLED: featureFlag(true),
  IMPORT_REVIEW_ENABLED: featureFlag(true),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

// Parsed once per process, so every flag above is a restart-scoped control, not
// a hot kill switch. docs/runbook.md states this for on-call.
let cachedEnv: ServerEnv | undefined

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = serverEnvSchema.parse(process.env)
  }
  return cachedEnv
}

// Per-surface Google Business Profile kill switches (docs/architecture.md,
// "Standalone canonical resources"). A provider mutation runs only when both
// the global publish control and the surface's own flag are on; ingestion
// surfaces (performance, keywords) are read-only and answer to their flag
// alone. Modules call these at their provider-mutation/ingestion boundary and
// lib/server/capabilities.ts mirrors them so the UI can show its paused-write
// notice without hiding the surface.
export type GbpWriteSurface =
  "profileWrites" | "posts" | "media" | "placeActions" | "foodMenus"

export type GbpIngestionSurface = "performance" | "keywords"

export type GbpFlags = Pick<
  ServerEnv,
  | "PUBLISH_ENABLED"
  | "GBP_PROFILE_WRITES_ENABLED"
  | "GBP_POSTS_ENABLED"
  | "GBP_MEDIA_ENABLED"
  | "GBP_PLACE_ACTIONS_ENABLED"
  | "GBP_FOOD_MENUS_ENABLED"
  | "GBP_PERFORMANCE_ENABLED"
  | "GBP_KEYWORDS_ENABLED"
>

const GBP_SURFACE_FLAG: Record<
  GbpWriteSurface | GbpIngestionSurface,
  keyof GbpFlags
> = {
  profileWrites: "GBP_PROFILE_WRITES_ENABLED",
  posts: "GBP_POSTS_ENABLED",
  media: "GBP_MEDIA_ENABLED",
  placeActions: "GBP_PLACE_ACTIONS_ENABLED",
  foodMenus: "GBP_FOOD_MENUS_ENABLED",
  performance: "GBP_PERFORMANCE_ENABLED",
  keywords: "GBP_KEYWORDS_ENABLED",
}

export function gbpWritesEnabled(
  env: GbpFlags,
  surface: GbpWriteSurface
): boolean {
  return env.PUBLISH_ENABLED && env[GBP_SURFACE_FLAG[surface]]
}

export function gbpIngestionEnabled(
  env: GbpFlags,
  surface: GbpIngestionSurface
): boolean {
  return env[GBP_SURFACE_FLAG[surface]]
}
