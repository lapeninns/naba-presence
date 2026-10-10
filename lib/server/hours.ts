import "server-only"

import type { TransactionSql } from "postgres"
import { ZodError } from "zod"

import {
  buildGoogleHoursPatch,
  classifyHoursDrift,
  classifyHoursPartDrift,
  hashHours,
  hoursPartHashes,
  hoursSelectionFromKeys,
  hoursSelectionKeys,
  hoursSelectionMask,
  selectedHoursMatch,
  unselectedHoursUnchanged,
  legacyHoursHash,
  hasLegacyHoursBoundaries,
  hoursBoundaryReconciliationRequired,
  supportedHoursTypes,
  normalizeGoogleHours,
  type GoogleLocationHours,
  type HoursSelection,
  type NormalizedHours,
} from "@/lib/domain/hours"
import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import type {
  HoursSelectionInput,
  HoursState,
} from "@/lib/contracts/location-hours"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { sha256 } from "@/lib/server/crypto"
import { jsonColumn, jsonColumnOrNull, withTenant } from "@/lib/server/db"
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
  getGoogleHoursCategories,
  patchGoogleLocationHours,
} from "@/lib/server/google"
import { recordHoursObservation } from "@/lib/server/hours-observations"
import { ApiError } from "@/lib/server/http"
import { operationSummary } from "@/lib/server/mutation-operations"
import {
  storeSettle,
  type RecoveryAdapter,
  type RecoveryAttempt,
} from "@/lib/server/mutation-recovery"
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

/** The GET response shape is owned by the wire contract; re-exported for server callers. */
export type { HoursState }

async function linkedHoursLocation(
  session: Session,
  locationId: string
): Promise<LinkedLocation> {
  return withTenant(session.organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId, {
      notFound: { message: "The requested location was not found." },
      notLinked: {
        message: "Link this location to Google before managing hours.",
      },
    })
  )
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

type StoredHours = NormalizedHours & {
  boundaryBaseline?: { legacyGoogleHash: string; observedGoogleHash: string }
}

async function readLiveHours(session: Session, locationId: string) {
  const linked = await linkedHoursLocation(session, locationId)
  const attemptedAt = new Date()
  let accessToken: string
  let googleLocation: GoogleLocationHours
  try {
    accessToken = await linked.accessToken()
    googleLocation = await fetchGoogleHours(linked, accessToken)
  } catch (error) {
    await withTenant(session.organisationId, (sql) =>
      recordHoursObservation(sql, {
        organisationId: session.organisationId,
        locationId,
        attemptedAt,
        outcome: "failed",
        errorCode:
          error instanceof ApiError ? error.code : "google_hours_read_failed",
      })
    )
    throw error
  }
  const metadataWarnings: string[] = []
  const categoryNames = [
    googleLocation.categories?.primaryCategory,
    ...(googleLocation.categories?.additionalCategories ?? []),
  ].flatMap((category) => (category?.name ? [category.name] : []))
  if (categoryNames.length > 0) {
    try {
      const categories = await getGoogleHoursCategories(
        accessToken,
        {
          names: categoryNames,
          languageCode: googleLocation.languageCode ?? "en",
        },
        { connectionKey: linked.googleConnectionId }
      )
      googleLocation = {
        ...googleLocation,
        categories: {
          primaryCategory: categories[0],
          additionalCategories: categories.slice(1),
        },
      }
    } catch (error) {
      if (
        !(error instanceof ApiError) &&
        !(error instanceof ZodError) &&
        !(error instanceof TypeError) &&
        !(
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        )
      )
        throw error
      googleLocation = { ...googleLocation, categories: undefined }
      metadataWarnings.push(
        "Google service-type metadata could not be loaded. Existing services are preserved; adding services is unavailable until the lookup succeeds."
      )
    }
  }
  const google = normalizeGoogleHours(googleLocation)
  const resource = await withTenant(session.organisationId, (sql) =>
    ensureCanonicalResource<StoredHours>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "hours",
      initialPayload: google,
      actorUserId: session.userId,
    })
  )
  const { boundaryBaseline, ...canonical } = resource.payload
  const patch = buildGoogleHoursPatch({ canonical, googleLocation })
  patch.warnings.push(...metadataWarnings)
  const canonicalHash = hashHours(canonical)
  const googleHash = hashHours(google)
  const canonicalParts = hoursPartHashes(canonical)
  const googleParts = hoursPartHashes(google)
  const comparisonBaseline =
    boundaryBaseline?.legacyGoogleHash === resource.baselineGoogleHash
      ? boundaryBaseline
      : hasLegacyHoursBoundaries(canonical) &&
          resource.baselineGoogleHash === legacyHoursHash(google)
        ? {
            legacyGoogleHash: resource.baselineGoogleHash,
            observedGoogleHash: googleHash,
          }
        : undefined
  const observation = await withTenant(session.organisationId, (sql) =>
    recordHoursObservation(sql, {
      organisationId: session.organisationId,
      locationId,
      attemptedAt,
      outcome: "observed",
      canonicalHash,
      googleHash,
      baselineCanonicalHash: resource.baselineCanonicalHash,
      baselineGoogleHash:
        comparisonBaseline?.observedGoogleHash ?? resource.baselineGoogleHash,
      blocked: patch.blockingIssues.length > 0,
      canonicalParts,
      googleParts,
    })
  )
  const partStatus = classifyHoursPartDrift({
    canonicalParts,
    googleParts,
    baseline: observation.comparisonParts ?? null,
  })
  return {
    observation,
    comparisonBaseline,
    linked,
    accessToken,
    googleLocation,
    google,
    resource,
    canonical,
    canonicalHash,
    googleHash,
    canonicalParts,
    googleParts,
    partStatus,
    patch,
    status: classifyHoursDrift({
      canonicalHash,
      googleHash,
      baselineCanonicalHash: observation.comparisonCanonicalHash,
      baselineGoogleHash: observation.comparisonGoogleHash,
      parts: partStatus,
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
    googlePartHashes: live.googleParts,
    ...(live.partStatus ? { partStatus: live.partStatus } : {}),
    warnings: live.patch.warnings,
    supportedHoursTypes: supportedHoursTypes(live.googleLocation),
    reconciliationRequired: hoursBoundaryReconciliationRequired(
      live.canonical,
      live.googleLocation
    ),
    publicationBlocked: live.patch.blockingIssues.length > 0,
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
  const stored = await withTenant(input.session.organisationId, async (sql) => {
    const [row] = await sql<{ payload: StoredHours; revision: string }[]>`
      select payload, revision::text as revision from presence_canonical_resource
      where organisation_id = ${input.session.organisationId}
        and location_id = ${input.locationId} and resource_type = 'hours'
    `
    return row
  })
  if (!stored || stored.revision !== input.expectedCanonicalRevision) {
    throw new ApiError(
      409,
      "canonical_resource_stale",
      "The canonical resource changed after it was loaded. Refresh and try again."
    )
  }
  const existing = new Set(
    stored.payload.moreHours.map((entry) => entry.hoursTypeId)
  )
  const added = input.hours.moreHours.filter(
    (entry) => !existing.has(entry.hoursTypeId)
  )
  let boundaryBaseline = stored.payload.boundaryBaseline
  if (added.length > 0 || hasLegacyHoursBoundaries(stored.payload)) {
    try {
      const live = await readLiveHours(input.session, input.locationId)
      const supported = new Set([
        ...supportedHoursTypes(live.googleLocation).map(
          (type) => type.hoursTypeId
        ),
        ...live.google.moreHours.map((entry) => entry.hoursTypeId),
      ])
      if (added.some((entry) => !supported.has(entry.hoursTypeId))) {
        throw new ApiError(
          400,
          "hours_service_type_unsupported",
          "Only service types advertised by Google or already present on this listing can be added."
        )
      }
      boundaryBaseline = live.comparisonBaseline
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      // An existing local schedule remains saveable during a Google outage.
      // New service creation still requires a verified provider capability.
      if (added.length > 0) throw error
    }
  }
  const payload: StoredHours = {
    ...input.hours,
    ...(boundaryBaseline ? { boundaryBaseline } : {}),
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
        payload,
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
  /** Absent: publish the whole saved schedule. */
  selection?: HoursSelectionInput
  requestId: string
}

type HoursPatch = ReturnType<typeof buildGoogleHoursPatch>

/** What a publish will write: the whole schedule, or the changed selected parts. */
type PublishPlan = {
  patch: HoursPatch
  /** The parts written, or null for a whole-schedule publish. */
  selection: HoursSelection | null
}

function snapshotStale(): ApiError {
  return new ApiError(
    409,
    "hours_snapshot_stale",
    "The schedule changed after review. Refresh first."
  )
}

/**
 * The pre-flight snapshot checks, in order: the reviewed snapshot must still
 * match the live one (stale -> 409), an in-sync schedule short-circuits, and
 * overwriting independent Google changes needs an explicit confirmation.
 *
 * A selective publish pins the saved schedule by revision and hash and each
 * selected part's Google hash; unselected parts may have changed on Google
 * since review, because they are re-read and written back as they are now.
 * Its approved mask must lie within the selection's fields and cover every
 * field its changed parts write, which must be in the whole-schedule mask;
 * selected parts that already match Google are left out. When every selected
 * part already matches, nothing is sent: `selection_in_sync` (other parts
 * may still differ) or `in_sync` (the whole schedule matches). The overwrite confirmation is needed when a part it
 * writes changed on Google (per-part drift), or, with no part baseline yet,
 * when the whole schedule did.
 */
function checkPublishSnapshot(
  live: LiveHours,
  input: PublishHoursInput
):
  | { kind: "in_sync" | "selection_in_sync" }
  | { kind: "proceed"; plan: PublishPlan } {
  const approvedMask = [...new Set(input.approvedUpdateMask)].sort()
  if (
    live.resource.revision !== input.expectedCanonicalRevision ||
    live.canonicalHash !== input.expectedCanonicalHash
  ) {
    throw snapshotStale()
  }
  const requireConfirmation = (statuses: string[]) => {
    if (
      statuses.some((status) =>
        ["google_dirty", "conflict"].includes(status)
      ) &&
      !input.confirmOverwriteGoogleChanges
    ) {
      throw new ApiError(
        409,
        "google_hours_overwrite_confirmation_required",
        "Google changed independently. Confirm that NabaPresence should overwrite it."
      )
    }
  }

  if (!input.selection) {
    if (
      live.googleHash !== input.expectedGoogleHash ||
      approvedMask.join(",") !== [...live.patch.updateMask].sort().join(",")
    ) {
      throw snapshotStale()
    }
    if (live.patch.blockingIssues.length > 0) {
      throw new ApiError(
        409,
        "hours_reconciliation_required",
        live.patch.blockingIssues.join(" ")
      )
    }
    if (live.status === "in_sync") return { kind: "in_sync" }
    requireConfirmation([live.status])
    return { kind: "proceed", plan: { patch: live.patch, selection: null } }
  }

  const selectedKeys = hoursSelectionKeys(input.selection)
  for (const key of selectedKeys) {
    if (
      (live.googleParts[key] ?? null) !==
      (input.selection.expectedGoogleParts[key] ?? null)
    ) {
      throw snapshotStale()
    }
  }
  const requested = buildGoogleHoursPatch({
    canonical: live.canonical,
    googleLocation: live.googleLocation,
    selection: input.selection,
  })
  if (requested.blockingIssues.length > 0) {
    throw new ApiError(
      409,
      "hours_reconciliation_required",
      requested.blockingIssues.join(" ")
    )
  }
  const changedKeys = selectedKeys.filter(
    (key) => live.canonicalParts[key] !== live.googleParts[key]
  )
  if (changedKeys.length === 0) {
    return { kind: live.status === "in_sync" ? "in_sync" : "selection_in_sync" }
  }
  const selection = hoursSelectionFromKeys(changedKeys)
  const patch = buildGoogleHoursPatch({
    canonical: live.canonical,
    googleLocation: live.googleLocation,
    selection,
  })
  if (patch.blockingIssues.length > 0) {
    throw new ApiError(
      409,
      "hours_reconciliation_required",
      patch.blockingIssues.join(" ")
    )
  }
  // The approval may name fields of selected parts that have since come to
  // match Google (another publish sent them); the write is then narrower
  // than the review, never wider.
  const selectionMask = hoursSelectionMask(input.selection)
  if (
    approvedMask.some((field) => !selectionMask.includes(field)) ||
    patch.updateMask.some(
      (field) =>
        !approvedMask.includes(field) || !live.patch.updateMask.includes(field)
    )
  ) {
    throw snapshotStale()
  }
  requireConfirmation(
    live.partStatus
      ? changedKeys.map((key) => live.partStatus?.[key] ?? "in_sync")
      : [live.status]
  )
  return { kind: "proceed", plan: { patch, selection } }
}

/** durable intent -> validateOnly -> PATCH -> readback -> settle + reconcile + audit */
async function publishHoursToGoogle(
  live: LiveHours,
  input: PublishHoursInput,
  plan: PublishPlan
) {
  const { session, locationId } = input
  const { linked, accessToken } = live
  const { patch, selection } = plan
  const selectedKeys = selection ? hoursSelectionKeys(selection) : null
  const payloadHash = sha256(JSON.stringify(patch.payload))
  const key = idempotencyKey([
    session.organisationId,
    linked.externalLocationId,
    "hours_publish",
    live.resource.revision,
    live.googleHash,
    payloadHash,
    selectedKeys ? selectedKeys.join(",") : "all",
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
    surface: "profileWrites",
    paused: HOURS_PUBLISHING_DISABLED,
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
      selection: (sql: TransactionSql) => jsonColumnOrNull(sql, selection),
    },
    inProgress: {
      code: "hours_publish_in_progress",
      message: "This publish is already in progress.",
    },
    failureCode: "google_hours_publish_failed",
    operation: {
      surface: "hours",
      action: "publish",
      locationId,
      targetType: "location",
      targetRef: linked.googleLocationName,
      payloadHash,
      expectedRevision: live.resource.revision,
      googleConnectionId: linked.googleConnectionId,
    },
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
      // A selective publish verifies the parts it wrote and that every
      // other day, date and service is still what Google held before.
      verify: ({ readback }) =>
        selection
          ? selectedHoursMatch({
              readback,
              intended: patch.intended,
              selection,
            }) &&
            unselectedHoursUnchanged({
              readback,
              before: live.google,
              selection,
            })
          : hashHours(readback) === live.canonicalHash,
      hash: hashHours,
    },
    onSuccess: async (sql, ctx) => {
      await reconcileCanonicalResource({
        sql,
        organisationId: session.organisationId,
        locationId,
        resourceType: "hours",
        canonicalHash: live.canonicalHash,
        googleHash: ctx.readbackHash as string,
      })
      await recordHoursObservation(sql, {
        organisationId: session.organisationId,
        locationId,
        attemptedAt: new Date(),
        outcome: "observed",
        canonicalHash: live.canonicalHash,
        googleHash: ctx.readbackHash as string,
        baselineCanonicalHash: live.canonicalHash,
        baselineGoogleHash: ctx.readbackHash as string,
        blocked: false,
        canonicalParts: live.canonicalParts,
        googleParts: ctx.readback
          ? hoursPartHashes(ctx.readback)
          : live.googleParts,
        establish: { keys: selectedKeys ?? "all", priorStatus: live.status },
      })
    },
    audit: (ctx) => ({
      action: "hours.publish.succeeded",
      subjectType: "hours_sync_attempt",
      subjectId: ctx.attemptId,
      metadata: {
        locationId,
        canonicalRevision: live.resource.revision,
        updateMask: patch.updateMask,
        selectedParts: selectedKeys,
      },
    }),
  })
}

const HOURS_PUBLISHING_DISABLED = {
  status: 409,
  code: "hours_publishing_disabled",
  message: "Hours publishing is currently disabled.",
}

export async function publishCanonicalHours(input: PublishHoursInput) {
  requireGbpWrite(getServerEnv(), "profileWrites", HOURS_PUBLISHING_DISABLED)
  const live = await readLiveHours(input.session, input.locationId)
  requirePublishGrant(live.linked, {
    code: "publish_permission_required",
    message: "You cannot publish this location.",
  })
  const checked = checkPublishSnapshot(live, input)
  if (checked.kind !== "proceed") {
    return { status: checked.kind, idempotent: true }
  }
  const result = await publishHoursToGoogle(live, input, checked.plan)
  return {
    status: "published" as const,
    attemptId: result.attemptId,
    idempotent: result.idempotent,
    operation: operationSummary(result),
  }
}

// ---------------------------------------------------------------------------
// Recovery (lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

type HoursRecoveryAttempt = RecoveryAttempt & {
  externalLocationId: string
  intendedPayload: GoogleLocationHours
  pinnedCanonicalHash: string
  selection: HoursSelection | null
}

/**
 * Reads an uncertain hours publish back against the intent its attempt row
 * pinned. A whole-schedule publish landed when the live schedule hashes to
 * the pinned canonical hash; a selective publish (0087 `selection`) landed
 * when every part it selected equals the payload it sent, which for a
 * selective publish carries exactly the merged selected parts. Parts the
 * publish did not select are not evidence either way: Google or a person may
 * have changed them since, and the write never touched them.
 */
export const hoursRecoveryAdapter: RecoveryAdapter<HoursRecoveryAttempt> = {
  surface: "hours",
  attemptTable: "hours_sync_attempt",
  async load(sql, attemptId) {
    const [row] = await sql<HoursRecoveryAttempt[]>`
      select
        id::text as id,
        status as "rawStatus",
        started_at as "startedAt",
        provider_error_code as "errorCode",
        external_location_id::text as "externalLocationId",
        intended_payload as "intendedPayload",
        pinned_canonical_hash as "pinnedCanonicalHash",
        selection
      from hours_sync_attempt
      where id = ${attemptId}
    `
    return row ?? null
  },
  async readback({ attempt, link }) {
    if (attempt.externalLocationId !== link.externalLocationId) {
      return { kind: "unverifiable", errorCode: "target_changed" }
    }
    const readback = normalizeGoogleHours(
      await fetchGoogleHours(link, await link.accessToken(), {
        maxAttempts: 3,
      })
    )
    const landed = attempt.selection
      ? selectedHoursMatch({
          readback,
          intended: normalizeGoogleHours(attempt.intendedPayload),
          selection: attempt.selection,
        })
      : hashHours(readback) === attempt.pinnedCanonicalHash
    return landed
      ? {
          kind: "landed",
          confirmed: true,
          responseHash: hashHours(readback),
        }
      : { kind: "not_landed", errorCode: "google_readback_mismatch" }
  },
  settle: storeSettle(hoursAttempts),
}
