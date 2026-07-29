import "server-only"

import { z } from "zod"

export function parseFeatureFlag(
  value: unknown,
  fallback: boolean
): boolean {
  if (value === undefined || value === "") return fallback
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(
    `Feature flag must be "true" or "false", got: ${value}`
  )
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

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: optionalText,
  NEXTAUTH_URL: optionalUrl,
  NEXTAUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  CRON_SECRET: z.string().min(16),
  SUPPORT_IMPERSONATION_SECRET: optionalSecret(32),
  OPENAI_API_KEY: optionalText,
  OPENAI_ORG_ID: optionalText,
  OPENAI_MODEL_DRAFT: optionalTextWithDefault("gpt-5-mini"),
  OPENAI_MODEL_VERIFY: optionalTextWithDefault("gpt-5-mini"),
  OPENAI_BASE_URL: urlWithDefault("https://api.openai.com"),
  OPENAI_TIMEOUT_MS: timeoutWithDefault(30_000),
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
  DRAFTS_ENABLED: featureFlag(true),
  PUBLISH_ENABLED: featureFlag(true),
  SYNC_ENABLED: featureFlag(true),
  WEBHOOKS_ENABLED: featureFlag(true),
  LOCAL_BOOTSTRAP_ENABLED: featureFlag(false),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cachedEnv: ServerEnv | undefined

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = serverEnvSchema.parse(process.env)
  }
  return cachedEnv
}
