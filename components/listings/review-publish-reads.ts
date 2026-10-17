"use client"

import { useMemo } from "react"

import type { ChangeRow } from "@/components/editors/change-diff"
import { publishHours } from "@/lib/api/location-hours"
import { publishFoodMenus } from "@/lib/api/location-menu"
import {
  runProfileOperation,
  type ProfileFieldKey,
} from "@/lib/api/location-profile"
import {
  hoursSelectionRequest,
  markHoursConflicts,
} from "@/lib/editors/hours-presentation"
import {
  NOTHING_TO_SEND,
  type PublishStep,
} from "@/lib/editors/use-publish-flow"
import type { AreaKey } from "@/lib/listings/pending-areas"
import { hoursChangeRows } from "@/lib/locations/hours-diff"
import { compareMenuReplacement } from "@/lib/locations/menu-diff"
import { useHours } from "@/lib/queries/use-location-hours"
import { useFoodMenus } from "@/lib/queries/use-location-menu"
import { useProfile } from "@/lib/queries/use-location-profile"

/**
 * The three canonical areas Review & publish reads live, each as a hook that
 * reports the area's diff rows and the publish steps that would send them
 * (split from review-publish.tsx, which draws them).
 */

const PROFILE_LABELS: Record<ProfileFieldKey, string> = {
  name: "Business name",
  description: "Description",
  phone: "Phone",
  address: "Address",
  mapsUrl: "Google Maps link",
  reviewUrl: "Review link",
  website: "Website",
}

/** The fields NabaPresence holds a copy of and can push to Google. */
const PUBLISHABLE: ProfileFieldKey[] = [
  "name",
  "description",
  "phone",
  "website",
]

export type AreaReview = {
  key: AreaKey
  label: string
  rows: ChangeRow[]
  needsAck: boolean
  steps: PublishStep[]
  blockedReason?: string
}

/**
 * Loads one canonical area live (this is the one place Google is read at
 * review time) and reports its diff rows plus the publish steps that would
 * send them. Each area keeps the exact hash-pinned call its own editor
 * makes; nothing here invents a new write.
 */
export function useProfileReview(locationId: string, enabled: boolean) {
  const query = useProfile(locationId)
  const review = useMemo<AreaReview | null>(() => {
    if (!enabled || !query.data) return null
    const profile = query.data
    const fields = profile.fields.filter(
      (field) => PUBLISHABLE.includes(field.key) && field.status !== "in_sync"
    )
    const rows: ChangeRow[] = fields.map((field) => ({
      key: field.key,
      field: PROFILE_LABELS[field.key],
      before: field.googleValue ?? "",
      after: field.canonicalValue ?? "",
      state:
        field.status === "conflict" || field.status === "google_dirty"
          ? "conflict"
          : "changed",
    }))
    const needsAck = fields.some(
      (field) => field.status === "conflict" || field.status === "google_dirty"
    )
    return {
      key: "profile",
      label: "Business profile",
      rows,
      needsAck,
      steps: rows.length
        ? [
            {
              key: "profile",
              // The endpoint reads Google back and compares before success.
              verified: true,
              label: `Business profile · ${rows
                .map((row) => row.field.toLowerCase())
                .join(", ")}`,
              run: async (intent) => {
                const selected = fields.map((field) => field.key)
                const body = {
                  direction: "to_google",
                  confirmation: "publish_nabapresence_profile_to_google",
                  selectedFields: selected,
                  expectedCanonicalRevision: profile.canonicalResource.revision,
                  expectedCanonicalHash: profile.canonicalHash,
                  expectedGoogleHash: profile.googleHash,
                  confirmOverwriteGoogleChanges: needsAck,
                } as const
                return runProfileOperation(locationId, body, {
                  intentId: intent.idFor(body),
                })
              },
            },
          ]
        : [],
    }
  }, [enabled, query.data, locationId])
  return { query, review }
}

export function useHoursReview(locationId: string, enabled: boolean) {
  const query = useHours(locationId)
  const review = useMemo<AreaReview | null>(() => {
    if (!enabled || !query.data) return null
    const hours = query.data
    // A row overwrites a Google change when its part (day, date, service)
    // changed on Google since its baseline; with no per-part baseline the
    // area's own drift status decides for every row.
    const changes = markHoursConflicts(
      hoursChangeRows({
        draft: hours.canonical,
        google: hours.google,
        canonical: hours.canonical,
        supportedHoursTypes: hours.supportedHoursTypes,
      }),
      hours
    )
    const rows: ChangeRow[] = changes
    const needsAck = rows.some((row) => row.state === "conflict")
    // Publish exactly the parts shown, pinned to the Google parts read for
    // this page; every other day, date and service stays as Google has it.
    const partial =
      changes.length > 0
        ? hoursSelectionRequest(
            hours,
            changes.map((row) => row.part)
          )
        : null
    const blockedReason = hours.reconciliationRequired
      ? "Open the hours editor to review and save the missing closing boundaries before publishing."
      : hours.publicationBlocked
        ? "Open the hours editor to resolve its schedule warnings before publishing."
        : undefined
    return {
      blockedReason,
      key: "hours",
      label: "Opening hours",
      rows,
      needsAck,
      steps:
        !blockedReason && hours.updateMask.length > 0
          ? [
              {
                key: "hours",
                // The endpoint reads Google back and compares before success.
                verified: true,
                label: "Opening hours",
                run: async (intent) => {
                  const body = {
                    expectedCanonicalRevision: hours.canonicalResource.revision,
                    expectedCanonicalHash: hours.canonicalHash,
                    expectedGoogleHash: hours.googleHash,
                    approvedUpdateMask: hours.updateMask,
                    confirmOverwriteGoogleChanges: needsAck,
                    ...partial,
                  }
                  const result = await publishHours(locationId, body, {
                    intentId: intent.idFor(body),
                  })
                  if (result.status !== "published") return NOTHING_TO_SEND
                  return result
                },
              },
            ]
          : [],
    }
  }, [enabled, query.data, locationId])
  return { query, review }
}

export function useMenuReview(locationId: string, enabled: boolean) {
  const query = useFoodMenus(locationId)
  const review = useMemo<AreaReview | null>(() => {
    if (!enabled || !query.data) return null
    const state = query.data
    const comparison = compareMenuReplacement({
      draft: state.canonicalMenus as Array<Record<string, unknown>>,
      google: state.googleMenus as Array<Record<string, unknown>>,
    })
    const rows = comparison.rows
    return {
      key: "menu",
      label: "Food menu",
      rows,
      needsAck: false,
      steps:
        rows.length === 0 || !comparison.publishable
          ? []
          : [
              {
                key: "menu",
                // The endpoint reads Google back and compares before success.
                verified: true,
                label: "Food menu · replaces the menu on Google",
                run: async (intent) => {
                  const body = {
                    expectedCanonicalRevision: state.canonicalResource.revision,
                    expectedCanonicalHash: state.canonicalHash,
                    expectedGoogleHash: state.googleHash,
                  }
                  const result = await publishFoodMenus(locationId, body, {
                    intentId: intent.idFor(body),
                  })
                  if (result.status === "in_sync") return NOTHING_TO_SEND
                  return result
                },
              },
            ],
    }
  }, [enabled, query.data, locationId])
  return { query, review }
}
