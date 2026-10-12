import "server-only"

import Stripe from "stripe"

import { getServerEnv, type ServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

/**
 * The Stripe client (plan P07-S4). Server-only, and fails closed: nothing
 * talks to Stripe unless BILLING_ENABLED is on, the secret key and the
 * webhook signing secret are both set, and the key's mode is the
 * BILLING_ENVIRONMENT this deployment bills in. A live key on a test
 * deployment (or the reverse) is a configuration fault, not a fallback.
 *
 * The API version is pinned to the one the installed SDK's types describe,
 * so a Stripe dashboard default can never change the shapes this code reads.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const

/** Stripe calls are bounded: a hung call must not hold the billing lock. */
const STRIPE_TIMEOUT_MS = 10_000

export type BillingEnvironment = "test" | "live"

export type BillingConfig =
  | {
      ok: true
      secretKey: string
      webhookSecret: string
      environment: BillingEnvironment
    }
  | {
      ok: false
      reason:
        | "billing_disabled"
        | "secret_key_missing"
        | "webhook_secret_missing"
        | "secret_key_unrecognised"
        | "secret_key_mode_mismatch"
    }

/** The mode a Stripe secret or restricted key belongs to, or null. */
export function stripeKeyMode(key: string): BillingEnvironment | null {
  const match = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(key)
  return match ? (match[1] as BillingEnvironment) : null
}

export function billingConfig(
  env: Pick<
    ServerEnv,
    | "BILLING_ENABLED"
    | "BILLING_ENVIRONMENT"
    | "STRIPE_SECRET_KEY"
    | "STRIPE_WEBHOOK_SECRET"
  > = getServerEnv()
): BillingConfig {
  if (!env.BILLING_ENABLED) return { ok: false, reason: "billing_disabled" }
  if (!env.STRIPE_SECRET_KEY) return { ok: false, reason: "secret_key_missing" }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return { ok: false, reason: "webhook_secret_missing" }
  }
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY)
  if (!mode) return { ok: false, reason: "secret_key_unrecognised" }
  if (mode !== env.BILLING_ENVIRONMENT) {
    return { ok: false, reason: "secret_key_mode_mismatch" }
  }
  return {
    ok: true,
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    environment: env.BILLING_ENVIRONMENT,
  }
}

/** The 503 every billing entry point answers while billing is unavailable. */
export function billingUnavailable(reason: string): ApiError {
  return new ApiError(
    503,
    "billing_unavailable",
    "Billing is not available right now.",
    { details: { reason } }
  )
}

/** Throws billingUnavailable unless billing is fully configured. */
export function requireBillingConfig(
  env?: Parameters<typeof billingConfig>[0]
): Extract<BillingConfig, { ok: true }> {
  const config = billingConfig(env)
  if (!config.ok) throw billingUnavailable(config.reason)
  return config
}

/**
 * A client for `secretKey`. `httpClient` exists for tests, which hand the
 * SDK a mocked fetch (Stripe.createFetchHttpClient) so no request leaves the
 * process.
 */
export function createStripeClient(
  secretKey: string,
  options: { httpClient?: ReturnType<typeof Stripe.createFetchHttpClient> } = {}
): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: STRIPE_TIMEOUT_MS,
    maxNetworkRetries: 1,
    typescript: true,
    appInfo: { name: "nabapresence" },
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  })
}

let cached: { key: string; client: Stripe } | undefined

/** The configured client; throws 503 billing_unavailable otherwise. */
export function getStripe(): Stripe {
  const config = requireBillingConfig()
  if (cached?.key !== config.secretKey) {
    cached = {
      key: config.secretKey,
      client: createStripeClient(config.secretKey),
    }
  }
  return cached.client
}
