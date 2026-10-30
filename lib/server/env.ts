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

const urlWithDefault = (fallback: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().default(fallback)
  )

const timeoutWithDefault = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback)

const openAiModel = z
  .preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).default("gpt-5.6-luna")
  )
  .transform((model) =>
    // OpenAI shut down both nano identifiers on 23 October 2026. Resolve
    // legacy configuration here so requests and usage reservations agree.
    model === "gpt-4.1-nano" || model === "gpt-4.1-nano-2025-04-14"
      ? "gpt-5.6-luna"
      : model
  )

/** A comma-separated list of secrets, each at least `minimumLength` long. */
const secretList = (minimumLength: number) =>
  z
    .unknown()
    .optional()
    .transform((value, context) => {
      const entries =
        typeof value === "string"
          ? value
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : []
      if (entries.some((entry) => entry.length < minimumLength)) {
        context.addIssue({
          code: "custom",
          message: `Every entry must be at least ${minimumLength} characters.`,
        })
      }
      return entries
    })

/** A comma-separated list of http(s) origins, normalised to `URL.origin`. */
const originList = z
  .unknown()
  .optional()
  .transform((value, context) => {
    const entries =
      typeof value === "string"
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : []
    const origins: string[] = []
    for (const entry of entries) {
      const url = URL.parse(entry)
      if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
        context.addIssue({
          code: "custom",
          message: `Invalid origin: ${entry}`,
        })
        continue
      }
      origins.push(url.origin)
    }
    return origins
  })

const emailList = z
  .unknown()
  .optional()
  .transform((value, context) => {
    const entries =
      typeof value === "string"
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : []
    for (const entry of entries) {
      if (!z.email().safeParse(entry).success) {
        context.addIssue({ code: "custom", message: "Invalid email address." })
      }
    }
    return entries
  })

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.unknown().optional().transform(parseDatabasePoolMax),
  // Session-mode connection for advisory locks only (withSessionConnection).
  // Required when DATABASE_URL is a transaction pooler; unset falls back to
  // DATABASE_URL, which locally is a direct connection.
  DATABASE_SESSION_URL: optionalText,
  DIRECT_DATABASE_URL: optionalText,
  NEXTAUTH_URL: optionalUrl,
  // Extra browser origins the same-origin guard (lib/server/route.ts)
  // accepts besides the request's own origin and NEXTAUTH_URL's: a
  // comma-separated list such as a proxy's public origin. Unset adds none.
  APP_ALLOWED_ORIGINS: originList,
  NEXTAUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  // Rotation (lib/server/crypto.ts): the first entry encrypts, every entry
  // (and TOKEN_ENCRYPTION_KEY) decrypts. Unset keeps the original format.
  TOKEN_ENCRYPTION_KEYS: secretList(32),
  // Signs the Google OAuth state cookie. Unset falls back to NEXTAUTH_SECRET.
  OAUTH_STATE_SECRET: optionalSecret(32),
  OAUTH_STATE_ACCEPT_LEGACY: featureFlag(true),
  CRON_SECRET: z.string().min(16),
  SUPPORT_IMPERSONATION_SECRET: optionalSecret(32),
  // Support impersonation is off unless explicitly enabled: off refuses
  // issuance (404) and stops any outstanding support session from resolving,
  // deleting the row it presents (lib/server/session.ts). The secret alone
  // no longer turns it on.
  SUPPORT_IMPERSONATION_ENABLED: featureFlag(false),
  // Central billing enforcement (plan P07-S3): read-only organisations get
  // 402 billing_read_only on new work, the job runner holds their new
  // provider dispatch, and the location limit binds new links. Off by
  // default and a hard override for the app: off, nothing the app does is
  // enforced whatever an organisation's own
  // organisation_billing.enforcement_enabled says. On, only organisations
  // with that flag (or with no billing row at all) are enforced
  // (lib/server/entitlement-policy.ts). The location-limit trigger sees this
  // flag only through withTenant (app.billing_enforcement, lib/server/db.ts);
  // a link written outside withTenant (operator SQL, scripts) follows the
  // organisation's own flag alone (docs/runbook.md).
  BILLING_ENFORCEMENT_ENABLED: featureFlag(false),
  // Stripe billing (plan P07-S4). Off by default. Off, the webhook receiver
  // answers 503 (Stripe keeps retrying), no event is processed and the
  // hourly reconciliation does nothing. On, the values below must also be
  // set and agree, or billing stays unavailable (lib/server/billing/stripe.ts
  // billingConfig). The operator `billing` pause scope
  // (lib/server/pause-controls.ts) holds processing off without a redeploy.
  BILLING_ENABLED: featureFlag(false),
  // The Stripe environment this deployment bills in. The secret key's mode
  // (sk_test_/rk_test_ or sk_live_/rk_live_) must match it, and webhook
  // events from the other mode are refused.
  BILLING_ENVIRONMENT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["test", "live"]).default("test")
  ),
  STRIPE_SECRET_KEY: optionalText,
  // Signing secret (whsec_…) of the /api/webhooks/stripe endpoint.
  STRIPE_WEBHOOK_SECRET: optionalText,
  // Checkout (plan P07-S5). Live checkout fails closed until the approved
  // terms of service are published here (Checkout then requires the
  // customer to accept them) and Stripe Tax is configured and switched on
  // with BILLING_AUTOMATIC_TAX (lib/server/billing/checkout.ts
  // checkoutReadiness). The test environment may run without either; its
  // plans are always marked as test offers.
  BILLING_TERMS_URL: optionalUrl,
  BILLING_AUTOMATIC_TAX: featureFlag(false),
  // Optional Customer Portal configuration (bpc_…). The configuration must
  // not allow plan switching: plan changes are app-controlled.
  STRIPE_PORTAL_CONFIGURATION_ID: optionalText,
  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: optionalText,
  // Private photo assets for bulk changes (lib/server/storage). Off unless
  // MEDIA_ASSET_STORAGE=supabase and the server-only secret key and the
  // private bucket are both set: without them every asset route answers 503
  // asset_storage_unavailable and no bulk photo is sent. The secret key never
  // reaches the browser; uploads go to signed, single-object URLs.
  MEDIA_ASSET_STORAGE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["disabled", "supabase"]).default("disabled")
  ),
  SUPABASE_SECRET_KEY: optionalText,
  MEDIA_ASSETS_BUCKET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.-]{2,62}$/)
      .optional()
  ),
  AUTH_PROVIDER_TIMEOUT_MS: timeoutWithDefault(10_000),
  // Two-step verification (TOTP through Supabase Auth, lib/server/mfa.ts).
  // Off by default: sign-in ignores enrolled factors and the MFA routes
  // answer 404. Turn on only once TOTP is enabled in the Supabase project.
  MFA_ENABLED: featureFlag(false),
  REGISTRATION_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["open", "invite_only"]).default("open")
  ),
  // Lets a new owner choose a business or an agency workspace at
  // registration (plan P06-5). Off: the choice is hidden, the register route
  // ignores it and provider metadata cannot pick agency, so every new
  // organisation is a business. Product approval of agency self-sign-up is
  // outstanding (ledger D-13).
  REGISTRATION_WORKSPACE_CHOICE_ENABLED: featureFlag(false),
  OPENAI_API_KEY: optionalText,
  OPENAI_ORG_ID: optionalText,
  OPENAI_MODEL_DRAFT: openAiModel,
  OPENAI_MODEL_VERIFY: openAiModel,
  OPENAI_BASE_URL: urlWithDefault("https://api.openai.com"),
  // Stay below the database connection's 60-second idle transaction limit.
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
  // Fleet-wide Google budget, shared by every instance through Postgres
  // (lib/server/google/rate-budget.ts). Business Profile allows 300 requests
  // per minute per API and 10 edits per minute per profile; the defaults
  // leave headroom under both.
  GOOGLE_RATE_BUDGET_ENABLED: featureFlag(true),
  // Application abuse limits (lib/server/abuse-limits.ts): fixed windows per
  // hashed client IP, email, user or token, counted in Postgres so every
  // instance shares them. Off stops counting entirely; for a suspected
  // limiter fault, not an attack.
  ABUSE_LIMITS_ENABLED: featureFlag(true),
  // The request header carrying the client IP, trusted only because the
  // platform in front of the app overwrites it. Unset means
  // x-vercel-forwarded-for on Vercel and no IP limits anywhere else (a
  // self-hosted build behind its own proxy names that proxy's header).
  CLIENT_IP_HEADER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .transform((value) => value.toLowerCase())
      .optional()
  ),
  GOOGLE_API_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(240),
  GOOGLE_LOCATION_EDITS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(8),
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
  // AI-written drafts per pilot month (one credit per draft); an
  // organisation.ai_monthly_draft_credits override wins. Trial and paid
  // periods take their allowance from billing (ai_credit_period), never from
  // here. The token backstop is a runaway-loop guard across draft and verify
  // calls within a credit period, not a product limit.
  AI_MONTHLY_DRAFT_CREDITS: z.coerce.number().int().min(0).default(100),
  AI_MONTHLY_TOKEN_BACKSTOP: z.coerce.number().int().min(0).default(20_000_000),
  // The output cap sent as `max_output_tokens` with every OpenAI call
  // (lib/server/ai.ts), and the per-call share of the backstop a reservation
  // holds until its real token counts arrive (lib/server/ai-credits.ts
  // callTokenBudget).
  AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(32_768)
    .default(4096),
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
  // Refuses a new password (sign-up, invitation, reset) found in Pwned
  // Passwords (lib/server/breached-password.ts). On when unset; the check
  // fails open when the service does not answer. "false" turns it off.
  BREACHED_PASSWORD_CHECK_ENABLED: featureFlag(true),
  LOCAL_BOOTSTRAP_ENABLED: featureFlag(false),
  // The /design-system route is internal evidence, not a product surface: it
  // renders the contrast pairs and the component hierarchy the accessibility
  // sweep walks. Off in production by construction, on in development, and
  // switched on explicitly by the e2e harness (playwright.config.ts), which
  // serves a production build and so would otherwise 404 the very page the
  // sweep measures.
  DESIGN_SYSTEM_EVIDENCE_ENABLED: featureFlag(
    process.env.NODE_ENV !== "production"
  ),
  GBP_PERFORMANCE_ENABLED: featureFlag(true),
  GBP_KEYWORDS_ENABLED: featureFlag(true),
  GBP_POSTS_ENABLED: featureFlag(true),
  GBP_MEDIA_ENABLED: featureFlag(true),
  GBP_FOOD_MENUS_ENABLED: featureFlag(true),
  GBP_PLACE_ACTIONS_ENABLED: featureFlag(true),
  GBP_PROFILE_WRITES_ENABLED: featureFlag(true),
  IMPORT_REVIEW_ENABLED: featureFlag(true),
  // Operational notifications (lib/server/notifications). Evaluation and
  // in-app incidents run whenever this is on; email needs a provider too.
  NOTIFICATIONS_ENABLED: featureFlag(true),
  EMAIL_PROVIDER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["none", "resend"]).default("none")
  ),
  EMAIL_API_KEY: optionalText,
  EMAIL_FROM: optionalText,
  // Operator alerts can be enabled without mailing every tenant incident.
  TENANT_EMAIL_ENABLED: featureFlag(true),
  EMAIL_API_BASE_URL: urlWithDefault("https://api.resend.com"),
  // Signing secret (whsec_…) for Resend delivery webhooks at
  // /api/webhooks/email. Unset: the receiver answers 404 and delivery
  // evidence stops at provider acceptance.
  EMAIL_WEBHOOK_SECRET: optionalText,
  // Where infrastructure alerts (stale cron heartbeats) go.
  OPS_ALERT_EMAILS: emailList,
  LISTING_STALE_AFTER_HOURS: z.coerce.number().int().min(1).max(168).default(6),
  // Platform sign-in, independent of the Google grant: a session ends after
  // this many idle days, and in any case this many days after sign-in.
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  // Google Cross-Account Protection receiver (/api/webhooks/google/risc).
  RISC_ENABLED: featureFlag(true),
  // The commit this deployment was built from, stamped into the build and
  // runtime environment by `pnpm release:promote` (scripts/release/promote.mjs).
  // Reported by the platform health scope (lib/server/release.ts). A value
  // that is not a full lowercase SHA fails validation rather than report a
  // release nobody can match to a commit.
  NABA_RELEASE_SHA: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional()
  ),
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

/**
 * The configured application origins: NEXTAUTH_URL's origin (APP_ORIGIN)
 * followed by APP_ALLOWED_ORIGINS. The same-origin guard also accepts the
 * request's own origin, but self-hosted Next builds `request.url` from the
 * bound hostname and port rather than the Host header, so do not rely on it:
 * the E2E harness on :3100 passes because it sets NEXTAUTH_URL, and preview
 * deployments are unverified (SEC-04).
 */
export function appOrigins(
  env: Pick<ServerEnv, "NEXTAUTH_URL" | "APP_ALLOWED_ORIGINS">
): string[] {
  const origins = env.NEXTAUTH_URL ? [new URL(env.NEXTAUTH_URL).origin] : []
  return [...origins, ...(env.APP_ALLOWED_ORIGINS ?? [])]
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
