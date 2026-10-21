import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  PRIVACY_WITHDRAWAL_MAX_ATTEMPTS,
  withdrawalRetryDelayMs,
} from "@/lib/server/privacy/fulfil"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

describe("privacy withdrawal backoff", () => {
  it("doubles from a minute to a six-hour cap", () => {
    expect(withdrawalRetryDelayMs(1)).toBe(60_000)
    expect(withdrawalRetryDelayMs(2)).toBe(120_000)
    expect(withdrawalRetryDelayMs(5)).toBe(16 * 60_000)
    expect(withdrawalRetryDelayMs(20)).toBe(6 * 60 * 60_000)
  })

  it("spans about a day before the budget is spent", () => {
    let total = 0
    for (
      let attempt = 1;
      attempt < PRIVACY_WITHDRAWAL_MAX_ATTEMPTS;
      attempt++
    ) {
      total += withdrawalRetryDelayMs(attempt)
    }
    expect(total).toBeGreaterThan(12 * 60 * 60_000)
    expect(total).toBeLessThan(48 * 60 * 60_000)
  })
})

describe("0101 privacy request retry migration", () => {
  const migration = read("supabase/migrations/0101_privacy_request_retry.sql")

  it("adds the retry columns and a partial due index", () => {
    for (const column of [
      "withdrawal_actor_id uuid",
      "withdrawal_attempts integer not null default 0",
      "next_attempt_at timestamptz",
      "last_error_code text",
      "withdrawal_lease_expires_at timestamptz",
    ]) {
      expect(migration).toContain(column)
    }
    expect(migration).toMatch(
      /on privacy_request \(next_attempt_at\)\s+where status = 'in_progress'/
    )
    expect(migration).toContain("'0101_privacy_request_retry'")
    expect(REQUIRED_MIGRATIONS).toContain("0101_privacy_request_retry")
  })

  it("claims through its own definer function and leaves claim_due_jobs alone", () => {
    expect(migration).toMatch(
      /create or replace function claim_due_privacy_withdrawals\([\s\S]*security definer set search_path = public/
    )
    expect(migration).toMatch(
      /grant execute on function claim_due_privacy_withdrawals\(integer, integer, integer\)\s+to naba_app_runtime;/
    )
    expect(migration).not.toMatch(/function claim_due_jobs/)
    // The final update re-checks the lease so two concurrent claims cannot
    // both take a row.
    const update = migration.slice(
      migration.indexOf("update privacy_request pr")
    )
    expect(update).toMatch(/withdrawal_lease_expires_at < now\(\)/)
  })
})

// Job-tick dispatch, the pause switch, the owner re-check and the PATCH
// actor are behavioural in tests/integration/routes/privacy-fulfilment.test.ts
// ("retries a parked withdrawal on the job tick...", "keeps a withdrawal
// pending ... while publishing is off", "stops retrying as an owner who lost
// the owner role", and the successor-owner case reading withdrawal_actor_id).
// No integration case covers a read-only organisation, so this guard stays.
describe("privacy withdrawal worker", () => {
  const worker = read("lib/server/privacy/withdrawals.ts")

  it("honours erasures for read-only organisations: no entitlement gate", () => {
    expect(worker).not.toMatch(/entitlement:/)
  })
})
