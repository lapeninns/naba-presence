import "server-only"

import type { TransactionSql } from "postgres"

import {
  placeActionInputSchema,
  type PlaceActionInput,
  type PlaceActionLink,
} from "@/lib/contracts/location-place-actions"
import {
  GOOGLE_PLACE_ACTION_TYPES,
  type GooglePlaceActionType,
} from "@/lib/domain/google-contract"
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
  type GbpAuditSpec,
  type GbpReadback,
  type GbpWriteSuccess,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import {
  createGooglePlaceActionLink,
  deleteGooglePlaceActionLink,
  getGooglePlaceActionLink,
  GoogleMutationAmbiguousError,
  listGooglePlaceActionLinks,
  patchGooglePlaceActionLink,
  type GooglePlaceActionLink,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

// Request/response shapes live in the contract; the old names stay exported
// from here for one sprint so existing imports keep working.
export { placeActionInputSchema, type PlaceActionInput }

type PlaceActionOperation = "create" | "update" | "delete"

type GoogleRecord = Record<string, unknown>

/** A `PlaceActionLink` row before `observedAt` is serialised to ISO. */
type StoredLink = Omit<PlaceActionLink, "placeActionType" | "observedAt"> & {
  placeActionType: GooglePlaceActionType
  observedAt: Date
}

/**
 * place_action_mutation as an AttemptStore. Its CHECK constraint only knows
 * started/succeeded/failed/ambiguous, so every in-flight status maps to
 * `started`.
 */
const placeActionAttempts = attemptStore({
  table: "place_action_mutation",
  statuses: {
    validating: "started",
    validated: "started",
    publishing: "started",
  },
  columns: { errorCode: "last_error_code", response: "google_response" },
})

function placeActionHash(input: PlaceActionInput) {
  return sha256(
    JSON.stringify({
      uri: input.uri,
      placeActionType: input.placeActionType,
      isPreferred: input.isPreferred,
    })
  )
}

function inputFromGoogle(value: GoogleRecord): PlaceActionInput | null {
  const parsed = placeActionInputSchema.safeParse({
    uri: value.uri,
    placeActionType: value.placeActionType,
    isPreferred: value.isPreferred === true,
  })
  return parsed.success ? parsed.data : null
}

/** True when a Google link record carries exactly the approved values. */
function matchesPayload(value: GoogleRecord, payload: PlaceActionInput) {
  const parsed = inputFromGoogle(value)
  return parsed !== null && placeActionHash(parsed) === placeActionHash(payload)
}

function linkNameOf(value: GoogleRecord | undefined) {
  return typeof value?.name === "string" ? value.name : undefined
}

function linkedLocation(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId, {
      notLinked: {
        message: "Link this location to Google before managing Place Actions.",
      },
    })
  )
}

/** Linked location plus the write gates (kill switch, then publish grant). */
async function linkedForWrite(session: Session, locationId: string) {
  const linked = await linkedLocation(session, locationId)
  requireGbpWrite(getServerEnv(), "placeActions", {
    status: 503,
    code: "place_actions_paused",
    message: "Place Action writes are paused.",
  })
  requirePublishGrant(linked, {
    code: "publish_not_allowed",
    message: "You cannot publish for this location.",
  })
  return linked
}

async function persistLiveLinks(
  sql: TransactionSql,
  organisationId: string,
  linked: LinkedLocation,
  links: GooglePlaceActionLink[]
) {
  await sql`
    update place_action_link
    set deleted_at = now(), observed_at = now()
    where location_id = ${linked.locationId}
      and deleted_at is null
  `
  for (const link of links) {
    const input: PlaceActionInput = {
      uri: link.uri,
      placeActionType: link.placeActionType,
      isPreferred: link.isPreferred,
    }
    await sql`
      insert into place_action_link (
        organisation_id, location_id, external_location_id,
        google_link_name, provider_type, is_editable, uri,
        place_action_type, is_preferred, google_hash,
        google_create_time, google_update_time, observed_at, deleted_at
      ) values (
        ${organisationId}, ${linked.locationId}, ${linked.externalLocationId},
        ${link.name}, ${link.providerType}, ${link.isEditable}, ${link.uri},
        ${link.placeActionType}, ${link.isPreferred}, ${placeActionHash(input)},
        ${link.createTime}, ${link.updateTime}, now(), null
      )
      on conflict (organisation_id, google_link_name) do update set
        provider_type = excluded.provider_type,
        is_editable = excluded.is_editable,
        uri = excluded.uri,
        place_action_type = excluded.place_action_type,
        is_preferred = excluded.is_preferred,
        google_hash = excluded.google_hash,
        google_create_time = excluded.google_create_time,
        google_update_time = excluded.google_update_time,
        observed_at = now(),
        deleted_at = null
    `
  }
  return sql<StoredLink[]>`
    select
      id::text as id,
      google_link_name as "googleLinkName",
      provider_type as "providerType",
      is_editable as "isEditable",
      uri,
      place_action_type as "placeActionType",
      is_preferred as "isPreferred",
      google_hash as "googleHash",
      observed_at as "observedAt"
    from place_action_link
    where location_id = ${linked.locationId}
      and deleted_at is null
    order by place_action_type, is_preferred desc, uri
  `
}

/** Lists the live Google links and refreshes the local cache from them. */
async function readLiveLinks(organisationId: string, linked: LinkedLocation) {
  const links = await listGooglePlaceActionLinks(
    await linked.accessToken(),
    linked.googleLocationName,
    { connectionKey: linked.googleConnectionId }
  )
  return withTenant(organisationId, (sql) =>
    persistLiveLinks(sql, organisationId, linked, links)
  )
}

export async function loadPlaceActions(
  organisationId: string,
  session: Session,
  locationId: string
) {
  const linked = await linkedLocation(session, locationId)
  const stored = await readLiveLinks(organisationId, linked)
  const [latestMutation] = await withTenant(
    organisationId,
    (sql) => sql<
      Array<{
        id: string
        operation: string
        status: string
        createdAt: Date
        finishedAt: Date | null
      }>
    >`
    select
      id::text as id,
      operation,
      status,
      created_at as "createdAt",
      finished_at as "finishedAt"
    from place_action_mutation
    where location_id = ${locationId}
    order by created_at desc
    limit 1
  `
  )
  const env = getServerEnv()
  return {
    locationId,
    canPublish: linked.canPublish,
    writesEnabled: gbpWritesEnabled(env, "placeActions"),
    supportedTypes: GOOGLE_PLACE_ACTION_TYPES,
    links: stored.map((link) => ({
      ...link,
      observedAt: link.observedAt.toISOString(),
    })),
    latestMutation: latestMutation
      ? {
          ...latestMutation,
          createdAt: latestMutation.createdAt.toISOString(),
          finishedAt: latestMutation.finishedAt?.toISOString() ?? null,
        }
      : null,
  }
}

async function storedLink(
  organisationId: string,
  locationId: string,
  linkId: string
) {
  const [link] = await withTenant(
    organisationId,
    (sql) => sql<StoredLink[]>`
    select
      id::text as id,
      google_link_name as "googleLinkName",
      provider_type as "providerType",
      is_editable as "isEditable",
      uri,
      place_action_type as "placeActionType",
      is_preferred as "isPreferred",
      google_hash as "googleHash",
      observed_at as "observedAt"
    from place_action_link
    where id = ${linkId}
      and location_id = ${locationId}
      and deleted_at is null
    limit 1
  `
  )
  if (!link)
    throw new ApiError(
      404,
      "place_action_not_found",
      "Place Action link not found."
    )
  // Aggregator-owned links are immutable on Google's side; this is a module
  // pre-flight check (like the stale-hash check), not a pipeline concern.
  if (!link.isEditable) {
    throw new ApiError(
      409,
      "place_action_not_editable",
      "Google reports that this provider link cannot be edited by the merchant."
    )
  }
  return link
}

/** Pre-flight for update/delete: Google must still hold the reviewed values. */
async function requireGoogleUnchanged(
  read: () => Promise<GoogleRecord>,
  expectedGoogleHash: string
) {
  const current = inputFromGoogle(await read())
  if (!current || placeActionHash(current) !== expectedGoogleHash) {
    throw new ApiError(
      409,
      "place_action_stale",
      "Google changed this link. Refresh and review it again."
    )
  }
}

type PlaceActionWrite<TResponse, TReadback> = {
  organisationId: string
  session: Session
  requestId: string
  linked: LinkedLocation
  operation: PlaceActionOperation
  linkId?: string
  expectedGoogleHash?: string
  payload?: PlaceActionInput
  validate?: () => Promise<void>
  mutate: () => Promise<TResponse>
  readback?: GbpReadback<TResponse, TReadback>
  /** Stored in place_action_mutation.google_link_name on success. */
  googleLinkName: (
    ctx: GbpWriteSuccess<TResponse, TReadback>
  ) => string | undefined
  onSuccess?: (
    sql: TransactionSql,
    ctx: GbpWriteSuccess<TResponse, TReadback>
  ) => Promise<void>
  audit: (ctx: GbpWriteSuccess<TResponse, TReadback>) => GbpAuditSpec
}

/**
 * One place-action mutation through the shared pipeline. Keys include the
 * request id, so any existing row for the key is replayed as idempotent.
 */
async function runPlaceActionWrite<TResponse, TReadback>(
  input: PlaceActionWrite<TResponse, TReadback>
) {
  const { organisationId, linked, operation, linkId, payload } = input
  const result = await runGbpWrite<TResponse, TReadback>({
    organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: placeActionAttempts,
    key: idempotencyKey([
      organisationId,
      linked.locationId,
      operation,
      linkId ?? null,
      payload ? placeActionHash(payload) : null,
      input.requestId,
    ]),
    intent: {
      location_id: linked.locationId,
      external_location_id: linked.externalLocationId,
      place_action_link_id: linkId ?? null,
      operation,
      expected_google_hash: input.expectedGoogleHash ?? null,
      requested_payload: payload
        ? (sql: TransactionSql) => jsonColumn(sql, payload)
        : null,
    },
    onExisting: "replay",
    failureCode: `place_action_${operation}_failed`,
    validate: input.validate,
    mutate: input.mutate,
    onAmbiguous: "fail",
    readback: input.readback,
    onSuccess: async (sql, ctx) => {
      // TODO(gbp-write): attemptStore has no per-module success column; the
      // link name is written here, inside the settle transaction.
      await sql`
        update place_action_mutation
        set google_link_name = ${input.googleLinkName(ctx) ?? null}
        where id = ${ctx.attemptId}
      `
      if (input.onSuccess) await input.onSuccess(sql, ctx)
    },
    audit: input.audit,
  })
  return result.idempotent
    ? { id: result.attemptId, status: result.rawStatus, idempotent: true }
    : { id: result.attemptId, status: "succeeded", idempotent: false }
}

export async function createPlaceAction(input: {
  organisationId: string
  session: Session
  locationId: string
  payload: PlaceActionInput
  requestId: string
}) {
  const linked = await linkedForWrite(input.session, input.locationId)
  const { payload } = input
  const google = { connectionKey: linked.googleConnectionId }
  const result = await runPlaceActionWrite<GoogleRecord, GoogleRecord>({
    ...input,
    linked,
    operation: "create",
    mutate: async () => {
      const accessToken = await linked.accessToken()
      try {
        return await createGooglePlaceActionLink(
          accessToken,
          { locationName: linked.googleLocationName, payload },
          google
        )
      } catch (error) {
        // An ambiguous create may have applied: recover it from the list, or
        // hand the original ambiguity back to the pipeline.
        if (!(error instanceof GoogleMutationAmbiguousError)) throw error
        const live = await listGooglePlaceActionLinks(
          accessToken,
          linked.googleLocationName,
          google
        )
        const recovered = live.find(
          (link) =>
            link.uri === payload.uri &&
            link.placeActionType === payload.placeActionType
        )
        if (!recovered) throw error
        return recovered
      }
    },
    // The create response is Google's echo of the new link; it is verified
    // as the readback (no further read).
    readback: {
      read: async ({ response }) => response ?? {},
      verify: ({ readback }) => matchesPayload(readback, payload),
      mismatch: {
        code: "place_action_readback_mismatch",
        message: "Google did not return the approved Place Action values.",
      },
    },
    googleLinkName: ({ response }) => linkNameOf(response),
    audit: ({ response }) => ({
      action: "place_action.created",
      subjectType: "location",
      subjectId: input.locationId,
      metadata: { googleLinkName: linkNameOf(response), ...payload },
    }),
  })
  if (!result.idempotent) await readLiveLinks(input.organisationId, linked)
  return result
}

export async function updatePlaceAction(input: {
  organisationId: string
  session: Session
  locationId: string
  linkId: string
  payload: PlaceActionInput
  expectedGoogleHash: string
  requestId: string
}) {
  const linked = await linkedForWrite(input.session, input.locationId)
  const link = await storedLink(
    input.organisationId,
    input.locationId,
    input.linkId
  )
  if (link.googleHash !== input.expectedGoogleHash) {
    throw new ApiError(
      409,
      "place_action_stale",
      "Refresh before overwriting newer Google changes."
    )
  }
  const { payload } = input
  const google = { connectionKey: linked.googleConnectionId }
  const readLink = async () =>
    getGooglePlaceActionLink(
      await linked.accessToken(),
      link.googleLinkName,
      google
    )
  const result = await runPlaceActionWrite<GoogleRecord, GoogleRecord>({
    ...input,
    linked,
    operation: "update",
    validate: () => requireGoogleUnchanged(readLink, input.expectedGoogleHash),
    mutate: async () =>
      patchGooglePlaceActionLink(
        await linked.accessToken(),
        { name: link.googleLinkName, payload },
        google
      ),
    readback: {
      read: readLink,
      verify: ({ readback }) => matchesPayload(readback, payload),
      mismatch: {
        code: "place_action_readback_mismatch",
        message: "Google did not apply the approved link values.",
      },
    },
    googleLinkName: () => link.googleLinkName,
    audit: () => ({
      action: "place_action.updated",
      subjectType: "place_action_link",
      subjectId: input.linkId,
      metadata: payload,
    }),
  })
  if (!result.idempotent) await readLiveLinks(input.organisationId, linked)
  return result
}

export async function removePlaceAction(input: {
  organisationId: string
  session: Session
  locationId: string
  linkId: string
  expectedGoogleHash: string
  requestId: string
}) {
  const linked = await linkedForWrite(input.session, input.locationId)
  const link = await storedLink(
    input.organisationId,
    input.locationId,
    input.linkId
  )
  if (link.googleHash !== input.expectedGoogleHash) {
    throw new ApiError(
      409,
      "place_action_stale",
      "Refresh before deleting a changed Google link."
    )
  }
  const google = { connectionKey: linked.googleConnectionId }
  const readLink = async () =>
    getGooglePlaceActionLink(
      await linked.accessToken(),
      link.googleLinkName,
      google
    )
  return runPlaceActionWrite<null, GooglePlaceActionLink[]>({
    ...input,
    linked,
    operation: "delete",
    validate: () => requireGoogleUnchanged(readLink, input.expectedGoogleHash),
    mutate: async () =>
      deleteGooglePlaceActionLink(
        await linked.accessToken(),
        link.googleLinkName,
        google
      ),
    readback: {
      read: async () =>
        listGooglePlaceActionLinks(
          await linked.accessToken(),
          linked.googleLocationName,
          google
        ),
      verify: ({ readback }) =>
        !readback.some((candidate) => candidate.name === link.googleLinkName),
      mismatch: {
        code: "place_action_delete_mismatch",
        message: "Google still returns the deleted link.",
      },
    },
    googleLinkName: () => link.googleLinkName,
    // The delete readback is the full live list, so the cache refresh rides
    // in the settle transaction.
    onSuccess: async (sql, ctx) => {
      if (ctx.readback) {
        await persistLiveLinks(sql, input.organisationId, linked, ctx.readback)
      }
    },
    audit: () => ({
      action: "place_action.deleted",
      subjectType: "place_action_link",
      subjectId: input.linkId,
      metadata: { googleLinkName: link.googleLinkName },
    }),
  })
}
