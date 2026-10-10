import "server-only"

import type { GbpMutationWithResponseResult } from "@/lib/contracts/gbp-management"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { settleGbpMutation, stableGoogleHash } from "@/lib/server/gbp-management"
import { GoogleMutationAmbiguousError } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"

function pathValue(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined
  }, record)
}

export function matchesGoogleUpdateMask(expected: unknown, observed: unknown, paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((path) =>
    stableGoogleHash({ value: pathValue(expected, path) }) === stableGoogleHash({ value: pathValue(observed, path) })
  )
}

export async function executeAndConfirmGbpMutation(input: {
  readonly organisationId: string
  readonly mutationId: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly updateMask: readonly string[]
  readonly matches?: (observed: Record<string, unknown>) => boolean
  readonly execute: () => Promise<Record<string, unknown>>
  readonly observe: () => Promise<Record<string, unknown>>
  readonly onObserved: (response: Record<string, unknown>) => Promise<unknown>
}): Promise<GbpMutationWithResponseResult> {
  await withTenant(input.organisationId, (sql) => sql`
    update gbp_management_mutation set execution_state = 'pending', confirmation_state = 'pending'
    where id = ${input.mutationId}
  `)
  let response: Record<string, unknown> | undefined
  let executionState: "accepted" | "unknown" = "accepted"
  try {
    response = await input.execute()
  } catch (error) {
    if (error instanceof ApiError && !(error instanceof GoogleMutationAmbiguousError)) {
      await withTenant(input.organisationId, (sql) => sql`
        update gbp_management_mutation set execution_state = 'rejected', confirmation_state = 'unrecorded'
        where id = ${input.mutationId}
      `)
      await settleGbpMutation({ organisationId: input.organisationId, mutationId: input.mutationId, status: "failed", errorCode: error.code })
      throw error
    }
    executionState = "unknown"
  }
  await withTenant(input.organisationId, (sql) => sql`
    update gbp_management_mutation set execution_state = ${executionState},
      google_response = ${response === undefined ? null : jsonColumn(sql, response)}
    where id = ${input.mutationId}
  `)
  return observeAndConfirmGbpMutation({ ...input, executionState, response })
}

export async function observeAndConfirmGbpMutation(input: Omit<Parameters<typeof executeAndConfirmGbpMutation>[0], "execute"> & {
  readonly executionState: "accepted" | "unknown"
  readonly response?: Record<string, unknown>
}): Promise<GbpMutationWithResponseResult> {
  let observed: Record<string, unknown> | undefined
  let confirmationError: string | null = null
  try {
    observed = await input.observe()
  } catch (error) {
    confirmationError = error instanceof ApiError ? error.code : "google_readback_failed"
  }
  const confirmed = observed !== undefined && (input.matches ? input.matches(observed) : matchesGoogleUpdateMask(input.payload, observed, input.updateMask))
  const confirmationState = confirmed ? "confirmed" : "unresolved"
  if (observed !== undefined && !confirmed) confirmationError = "google_readback_mismatch"
  await withTenant(input.organisationId, (sql) => sql`
    update gbp_management_mutation set execution_state = ${input.executionState}, confirmation_state = ${confirmationState},
      confirmation_response = ${observed === undefined ? null : jsonColumn(sql, observed)},
      confirmation_observed_at = ${observed === undefined ? null : new Date()},
      confirmation_error_code = ${confirmationError}
    where id = ${input.mutationId}
  `)
  if (observed !== undefined) await input.onObserved(observed)
  const status = confirmed ? "succeeded" : "ambiguous"
  await settleGbpMutation({ organisationId: input.organisationId, mutationId: input.mutationId, status, response: input.response, errorCode: confirmationError ?? undefined })
  return { id: input.mutationId, status, idempotent: false, executionState: input.executionState, confirmationState, response: observed }
}
