import "server-only"

import type { TransactionSql } from "postgres"

import {
  buildGoogleHoursPatch,
  classifyHoursDrift,
  hashHours,
  normalizeGoogleHours,
  type GoogleLocationHours,
  type HoursDriftStatus,
  type NormalizedHours,
} from "@/lib/domain/hours"
import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { sha256 } from "@/lib/server/crypto"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  attemptStore,
  idempotencyKey,
  loadLinkedLocation,
  requireGbpWrite,
  requirePublishGrant,
  runGbpWrite,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import {
  getGoogleLocation,
  patchGoogleLocationHours,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const HOURS_READ_MASK = [
  "name",
  "title",
  "regularHours",
  "specialHours",
  "moreHours",
  "categories",
  "metadata",
] as const

/** hours_sync_attempt already carries the full canonical status vocabulary. */
const hoursAttempts = attemptStore({
  table: "hours_sync_attempt",
  columns: {
    httpStatus: "provider_http_status",
    responseHash: "provider_response_hash",
    validatedAt: "validated_at",
    startedAt: "started_at",
  },
})

export type HoursState = {
  location: {
    id: string
    name: string
    googleLocationName: string
    timezone: string
  }
  canonicalResource: {
    revision: string
    updatedAt: string
  }
  status: HoursDriftStatus
  canonical: NormalizedHours
  google: NormalizedHours
  canonicalHash: string
  googleHash: string
  updateMask: GoogleHoursUpdateMask[]
  warnings: string[]
  canPublish: boolean
  writesEnabled: boolean
  lastReconciledAt: string | null
  latestAttempt: {
    id: string
    status: string
    createdAt: string
    finishedAt: string | null
  } | null
}

async function linkedHoursLocation(
  session: Session,
  locationId: string
): Promise<LinkedLocation> {
  try {
    return await withTenant(session.organisationId, (sql) =>
      loadLinkedLocation(sql, session, locationId, {
        notLinked: {
          message: "Link this location to Google before managing hours.",
        },
      })
    )
  } catch (error) {
    // TODO(gbp-write): loadLinkedLocation has no `notFound` message override, and
    // hours' 404 body has always read "The requested location was not found."
    // Add a `notFound: { message }` option to the helper and delete this catch.
    if (
      error instanceof ApiError &&
      error.status === 404 &&
      error.code === "location_not_found"
    ) {
      throw new ApiError(
        404,
        "location_not_found",
        "The requested location was not found."
      )
    }
    throw error
  }
}

async function fetchGoogleHours(
  linked: LinkedLocation,
  accessToken: string,
  options: { maxAttempts?: number } = {}
) {
  return (await getGoogleLocation(
    accessToken,
    linked.googleLocationName,
    [...HOURS_READ_MASK],
    { connectionKey: linked.googleConnectionId, ...options }
  )) as GoogleLocationHours
}

async function readLiveHours(session: Session, locationId: string) {
  const linked = await linkedHoursLocation(session, locationId)
  const accessToken = await linked.accessToken()
  const googleLocation = await fetchGoogleHours(linked, accessToken)
  const google = normalizeGoogleHours(googleLocation)
  const resource = await withTenant(session.organisationId, (sql) =>
    ensureCanonicalResource<NormalizedHours>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "hours",
      initialPayload: google,
      actorUserId: session.userId,
    })
  )
  const canonical = resource.payload
  const patch = buildGoogleHoursPatch({ canonical, googleLocation })
  const canonicalHash = hashHours(canonical)
  const googleHash = hashHours(google)
  return {
    linked,
    accessToken,
    googleLocation,
    google,
    resource,
    canonical,
    canonicalHash,
    googleHash,
    patch,
    status: classifyHoursDrift({
      canonicalHash,
      googleHash,
      baselineCanonicalHash: resource.baselineCanonicalHash,
      baselineGoogleHash: resource.baselineGoogleHash,
    }),
  }
}

type LiveHours = Awaited<ReturnType<typeof readLiveHours>>

export async function getHoursState(
  session: Session,
  locationId: string
): Promise<HoursState> {
  const live = await readLiveHours(session, locationId)
  const latestAttempt = await withTenant(
    session.organisationId,
    async (sql) => {
      const [attempt] = await sql<
        {
          id: string
          status: string
          createdAt: Date
          finishedAt: Date | null
        }[]
      >`
      select
        id::text as id,
        status,
        created_at as "createdAt",
        finished_at as "finishedAt"
      from hours_sync_attempt
      where location_id = ${locationId}
      order by created_at desc
      limit 1
    `
      return attempt ?? null
    }
  )
  return {
    location: {
      id: live.linked.locationId,
      name: live.linked.locationName,
      googleLocationName: live.linked.googleLocationName,
      timezone: live.linked.timezone,
    },
    canonicalResource: {
      revision: live.resource.revision,
      updatedAt: live.resource.updatedAt.toISOString(),
    },
    status: live.status,
    canonical: live.canonical,
    google: live.google,
    canonicalHash: live.canonicalHash,
    googleHash: live.googleHash,
    updateMask: live.patch.updateMask,
    warnings: live.patch.warnings,
    canPublish: live.linked.canPublish,
    writesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites"),
    lastReconciledAt: live.resource.lastReconciledAt?.toISOString() ?? null,
    latestAttempt: latestAttempt
      ? {
          ...latestAttempt,
          createdAt: latestAttempt.createdAt.toISOString(),
          finishedAt: latestAttempt.finishedAt?.toISOString() ?? null,
        }
      : null,
  }
}

export async function saveCanonicalHours(input: {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  hours: NormalizedHours
  requestId: string
}) {
  const linked = await linkedHoursLocation(input.session, input.locationId)
  if (!linked.canPublish) {
    throw new ApiError(
      403,
      "canonical_edit_permission_required",
      "You cannot edit this location."
    )
  }
  const resource = await withTenant(
    input.session.organisationId,
    async (sql) => {
      const updated = await updateCanonicalResource({
        sql,
        organisationId: input.session.organisationId,
        locationId: input.locationId,
        resourceType: "hours",
        expectedRevision: input.expectedCanonicalRevision,
        payload: input.hours,
      })
      await writeAudit(sql, {
        organisationId: input.session.organisationId,
        actorUserId: input.session.userId,
        action: "hours.canonical.updated",
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: {
          revision: updated.revision,
          canonicalHash: hashHours(input.hours),
        },
      })
      return updated
    }
  )
  return { saved: true as const, revision: resource.revision }
}

type PublishHoursInput = {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  approvedUpdateMask: GoogleHoursUpdateMask[]
  confirmOverwriteGoogleChanges: boolean
  requestId: string
}

/**
 * The pre-flight snapshot checks, in order: the reviewed snapshot must still
 * match the live one (stale -> 409), an in-sync schedule short-circuits, and
 * overwriting independent Google changes needs an explicit confirmation.
 */
function checkPublishSnapshot(
  live: LiveHours,
  input: PublishHoursInput
): "in_sync" | "proceed" {
  const approvedMask = [...new Set(input.approvedUpdateMask)].sort()
  if (
    live.resource.revision !== input.expectedCanonicalRevision ||
    live.canonicalHash !== input.expectedCanonicalHash ||
    live.googleHash !== input.expectedGoogleHash ||
    approvedMask.join(",") !== [...live.patch.updateMask].sort().join(",")
  ) {
    throw new ApiError(
      409,
      "hours_snapshot_stale",
      "The schedule changed after review. Refresh first."
    )
  }
  if (live.status === "in_sync") return "in_sync"
  if (
    ["google_dirty", "conflict"].includes(live.status) &&
    !input.confirmOverwriteGoogleChanges
  ) {
    throw new ApiError(
      409,
      "google_hours_overwrite_confirmation_required",
      "Google changed independently. Confirm that NabaPresence should overwrite it."
    )
  }
  return "proceed"
}

/** durable intent -> validateOnly -> PATCH -> readback -> settle + reconcile + audit */
async function publishHoursToGoogle(live: LiveHours, input: PublishHoursInput) {
  const { session, locationId } = input
  const { linked, accessToken, patch } = live
  const payloadHash = sha256(JSON.stringify(patch.payload))
  const key = idempotencyKey([
    session.organisationId,
    linked.externalLocationId,
    "hours_publish",
    live.resource.revision,
    live.googleHash,
    payloadHash,
  ])
  const patchHours = (validateOnly: boolean) =>
    patchGoogleLocationHours(
      accessToken,
      {
        locationName: linked.googleLocationName,
        updateMask: patch.updateMask,
        validateOnly,
        payload: patch.payload,
      },
      { connectionKey: linked.googleConnectionId }
    )

  return runGbpWrite({
    organisationId: session.organisationId,
    actorUserId: session.userId,
    requestId: input.requestId,
    store: hoursAttempts,
    key,
    intent: {
      location_id: locationId,
      external_location_id: linked.externalLocationId,
      operation: "publish",
      pinned_canonical_revision: live.resource.revision,
      pinned_canonical_hash: live.canonicalHash,
      pinned_google_hash: live.googleHash,
      update_mask: patch.updateMask,
      intended_payload: (sql: TransactionSql) => jsonColumn(sql, patch.payload),
      warnings: (sql: TransactionSql) => jsonColumn(sql, patch.warnings),
    },
    inProgress: {
      code: "hours_publish_in_progress",
      message: "This publish is already in progress.",
    },
    failureCode: "google_hours_publish_failed",
    validate: async () => {
      await patchHours(true)
    },
    mutate: () => patchHours(false),
    onAmbiguous: "readback",
    readback: {
      read: async () =>
        normalizeGoogleHours(
          await fetchGoogleHours(linked, accessToken, { maxAttempts: 3 })
        ),
      verify: ({ readback }) => hashHours(readback) === live.canonicalHash,
      hash: hashHours,
    },
    onSuccess: (sql, ctx) =>
      reconcileCanonicalResource({
        sql,
        organisationId: session.organisationId,
        locationId,
        resourceType: "hours",
        canonicalHash: live.canonicalHash,
        googleHash: ctx.readbackHash as string,
      }),
    audit: (ctx) => ({
      action: "hours.publish.succeeded",
      subjectType: "hours_sync_attempt",
      subjectId: ctx.attemptId,
      metadata: { locationId, canonicalRevision: live.resource.revision },
    }),
  })
}

export async function publishCanonicalHours(input: PublishHoursInput) {
  requireGbpWrite(getServerEnv(), "profileWrites", {
    status: 409,
    code: "hours_publishing_disabled",
    message: "Hours publishing is currently disabled.",
  })
  const live = await readLiveHours(input.session, input.locationId)
  requirePublishGrant(live.linked, {
    code: "publish_permission_required",
    message: "You cannot publish this location.",
  })
  if (checkPublishSnapshot(live, input) === "in_sync") {
    return { status: "in_sync" as const, idempotent: true }
  }
  const result = await publishHoursToGoogle(live, input)
  return {
    status: "published" as const,
    attemptId: result.attemptId,
    idempotent: result.idempotent,
  }
}
