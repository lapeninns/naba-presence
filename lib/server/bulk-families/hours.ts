import "server-only"

import {
  applyBulkHours,
  bulkHoursField,
  bulkHoursSelection,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import {
  buildGoogleHoursPatch,
  hoursPartHashes,
  hoursSelectionKeys,
  normalizeGoogleHours,
  selectedHoursMatch,
  type GoogleLocationHours,
} from "@/lib/domain/hours"
import {
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import { getGoogleLocation } from "@/lib/server/google"
import { publishHoursSelectionLocked } from "@/lib/server/hours"

type HoursInput = Extract<
  BulkOperationInput,
  { operation: "regular_hours" | "special_hours" | "more_hours" }
>

const emptyField = (field: ReturnType<typeof bulkHoursField>) =>
  field === "moreHours" ? [] : {}

/** The listing's value of the family's field, as the preview froze it. */
const fieldOf = (input: HoursInput, location: GoogleLocationHours) =>
  location[bulkHoursField(input.operation)] ??
  emptyField(bulkHoursField(input.operation))

/**
 * The hash of each selected part as Google held it at preview (null when
 * absent), from the frozen field value: what the publish pins, so a part
 * that moved on Google since is a conflict and nothing is sent.
 */
export function previewedParts(
  input: HoursInput,
  current: unknown
): Record<string, string | null> {
  const parts = hoursPartHashes(
    normalizeGoogleHours({
      [bulkHoursField(input.operation)]: current,
    } as GoogleLocationHours)
  )
  return Object.fromEntries(
    hoursSelectionKeys(bulkHoursSelection(input)).map((key) => [
      key,
      parts[key] ?? null,
    ])
  )
}

/**
 * Regular, special and more hours. Planned as a selective publish (P09-S1):
 * the chosen weekdays, dates or service type, with the rest of the field
 * written back as Google holds it. Sent through the hours editor's own
 * publish path (`publishHoursSelectionLocked`), so the saved schedule is
 * updated in the same step and the write has the editor's receipt,
 * readback and recovery (hours_sync_attempt).
 */
export const hoursFamily: BulkFamily<HoursInput> = {
  operations: ["regular_hours", "special_hours", "more_hours"],
  resourceKey: "hours",
  writeSurface: "profileWrites",
  accountLock: false,
  async plan(input, linked) {
    const location = (await getGoogleLocation(
      await linked.accessToken(),
      linked.googleLocationName,
      ["regularHours", "specialHours", "moreHours", "categories"],
      { connectionKey: linked.connectionId }
    )) as GoogleLocationHours
    const field = bulkHoursField(input.operation)
    const current = fieldOf(input, location)
    if (input.operation === "more_hours") {
      const offered = [
        location.categories?.primaryCategory,
        ...(location.categories?.additionalCategories ?? []),
      ]
        .flatMap((category) => category?.moreHoursTypes ?? [])
        .some((type) => type.hoursTypeId === input.hoursTypeId)
      const present = (location.moreHours ?? []).some(
        (entry) => entry.hoursTypeId === input.hoursTypeId
      )
      if (!offered && !present)
        return { eligible: false, reason: "hours_type_not_supported", current }
    }
    const google = normalizeGoogleHours(location)
    const selection = bulkHoursSelection(input)
    const patch = buildGoogleHoursPatch({
      canonical: applyBulkHours(input, google),
      googleLocation: location,
      selection,
    })
    if (patch.blockingIssues.length > 0)
      return {
        eligible: false,
        reason: "hours_reconciliation_required",
        current,
      }
    if (
      selectedHoursMatch({
        readback: google,
        intended: patch.intended,
        selection,
      })
    )
      return { eligible: false, reason: "already_applied", current }
    return {
      eligible: true,
      current,
      proposed: patch.payload[field] ?? emptyField(field),
      updateMask: [field],
    }
  },
  async dispatch(context) {
    const { input } = context
    try {
      const result = await publishHoursSelectionLocked({
        session: context.session,
        locationId: context.locationId,
        selection: bulkHoursSelection(input),
        apply: (hours) => applyBulkHours(input, hours),
        expectedGoogleParts: previewedParts(input, context.current),
        intentId: context.intentId,
        approvalRef: context.approvalRef,
        requestId: context.requestId,
        stillOpen: context.stillOpen,
      })
      const observed = fieldOf(input, result.google)
      switch (result.status) {
        case "applied":
          return { kind: "succeeded", confirmation: "confirmed", observed }
        case "conflict":
          return { kind: "conflict", code: "google_baseline_changed", observed }
        case "closed":
          return { kind: "expired" }
        case "published":
          return result.outcome === "confirmed_applied"
            ? { kind: "succeeded", confirmation: "confirmed" }
            : { kind: "succeeded", confirmation: "unrecorded" }
      }
    } catch (error) {
      return outcomeOfThrownWrite(
        context.organisationId,
        context.intentId,
        error
      )
    }
  },
  reconcile: reconcileFromReceipt,
}
