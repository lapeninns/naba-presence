import postgres from "postgres"

import { resetPlatformState } from "./platform-state"

/**
 * Vitest globalSetup for the integration suites: resets platform-wide state
 * (pauses, fleet leases, test billing plans; ./platform-state.ts) before the
 * first file and after the last, on a throwaway cluster only. A run that is
 * killed outright skips the teardown, which is why the cluster itself is
 * throwaway by default (scripts/run-test-command.mjs).
 */
async function reset() {
  const url = process.env.DIRECT_DATABASE_URL
  if (process.env.RUN_DB_TESTS !== "true" || !url) return
  const admin = postgres(url, { max: 1, onnotice() {} })
  try {
    await resetPlatformState(admin)
  } finally {
    await admin.end({ timeout: 5 })
  }
}

export default async function setup() {
  await reset()
  return reset
}
