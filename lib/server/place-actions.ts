import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"

import {
  GOOGLE_PLACE_ACTION_TYPES,
  type GooglePlaceActionType,
} from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  createGooglePlaceActionLink,
  deleteGooglePlaceActionLink,
  getGooglePlaceActionLink,
  GoogleMutationAmbiguousError,
  listGooglePlaceActionLinks,
  patchGooglePlaceActionLink,
  type GooglePlaceActionLink,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

export const placeActionInputSchema = z.object({
  uri: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Place Action links must use http or https.",
  }),
  placeActionType: z.enum(GOOGLE_PLACE_ACTION_TYPES),
  isPreferred: z.boolean().default(false),
})

export type PlaceActionInput = z.infer<typeof placeActionInputSchema>

type PlaceActionContext = {
  locationId: string
  externalLocationId: string
  googleLocationName: string
  googleConnectionId: string
  canPublish: boolean
}

type StoredLink = {
  id: string
  googleLinkName: string
  providerType: string
  isEditable: boolean
  uri: string
  placeActionType: GooglePlaceActionType
  isPreferred: boolean
  googleHash: string
  observedAt: Date
}

function placeActionHash(input: PlaceActionInput) {
  return sha256(
    JSON.stringify({
      uri: input.uri,
      placeActionType: input.placeActionType,
      isPreferred: input.isPreferred,
    })
  )
}

function inputFromGoogle(value: Record<string, unknown>): PlaceActionInput | null {
  const parsed = placeActionInputSchema.safeParse({
    uri: value.uri,
    placeActionType: value.placeActionType,
    isPreferred: value.isPreferred === true,
  })
  return parsed.success ? parsed.data : null
}

async function loadContext(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<PlaceActionContext> {
  const [row] = await sql<Omit<PlaceActionContext, "canPublish">[]>`
    select
      l.id::text as "locationId",
      el.id::text as "externalLocationId",
      el.google_location_name as "googleLocationName",
      el.google_connection_id::text as "googleConnectionId"
    from location l
    left join location_link ll
      on ll.location_id = l.id
     and ll.is_active = true
    left join external_location el on el.id = ll.external_location_id
    where l.id = ${locationId}
    limit 1
  `
  if (!row) throw new ApiError(404, "location_not_found", "Location not found.")
  await requireLocationAccess(sql, session, locationId)
  if (!row.externalLocationId || !row.googleLocationName || !row.googleConnectionId) {
    throw new ApiError(
      409,
      "google_location_not_linked",
      "Link this location to Google before managing Place Actions."
    )
  }
  return {
    ...row,
    canPublish: await canPublishLocation(sql, session, locationId),
  }
}

function contextFor(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    loadContext(sql, session, locationId)
  )
}

async function persistLiveLinks(
  organisationId: string,
  context: PlaceActionContext,
  links: GooglePlaceActionLink[]
) {
  return withTenant(organisationId, async (sql) => {
    await sql`
      update place_action_link
      set deleted_at = now(), observed_at = now()
      where location_id = ${context.locationId}
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
          ${organisationId}, ${context.locationId}, ${context.externalLocationId},
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
      where location_id = ${context.locationId}
        and deleted_at is null
      order by place_action_type, is_preferred desc, uri
    `
  })
}

async function readLiveLinks(
  organisationId: string,
  context: PlaceActionContext
) {
  const accessToken = await connectionAccessToken(
    getDatabase(),
    organisationId,
    context.googleConnectionId
  )
  const links = await listGooglePlaceActionLinks(
    accessToken,
    context.googleLocationName,
    { connectionKey: context.googleConnectionId }
  )
  return {
    accessToken,
    links,
    stored: await persistLiveLinks(organisationId, context, links),
  }
}

export async function loadPlaceActions(
  organisationId: string,
  session: Session,
  locationId: string
) {
  const context = await contextFor(session, locationId)
  const live = await readLiveLinks(organisationId, context)
  const [latestMutation] = await withTenant(organisationId, (sql) => sql<
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
  `)
  const env = getServerEnv()
  return {
    locationId,
    canPublish: context.canPublish,
    writesEnabled: gbpWritesEnabled(env, "placeActions"),
    supportedTypes: GOOGLE_PLACE_ACTION_TYPES,
    links: live.stored.map((link) => ({
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

function requireWrites(context: PlaceActionContext) {
  if (!gbpWritesEnabled(getServerEnv(), "placeActions")) {
    throw new ApiError(503, "place_actions_paused", "Place Action writes are paused.")
  }
  if (!context.canPublish) {
    throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  }
}

async function createMutation(input: {
  organisationId: string
  session: Session
  context: PlaceActionContext
  operation: "create" | "update" | "delete"
  requestId: string
  linkId?: string
  expectedGoogleHash?: string
  payload?: PlaceActionInput
}) {
  return withTenant(input.organisationId, async (sql) => {
    const idempotencyKey = [
      input.context.locationId,
      input.operation,
      input.linkId ?? "new",
      input.payload ? placeActionHash(input.payload) : "none",
      input.requestId,
    ].join(":")
    const [existing] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status
      from place_action_mutation
      where idempotency_key = ${idempotencyKey}
      limit 1
    `
    if (existing) return { ...existing, idempotent: true }
    const [created] = await sql<{ id: string; status: string }[]>`
      insert into place_action_mutation (
        organisation_id, location_id, external_location_id,
        place_action_link_id, actor_user_id, operation, status,
        idempotency_key, expected_google_hash, requested_payload
      ) values (
        ${input.organisationId}, ${input.context.locationId},
        ${input.context.externalLocationId}, ${input.linkId ?? null},
        ${input.session.userId}, ${input.operation}, 'started',
        ${idempotencyKey}, ${input.expectedGoogleHash ?? null},
        ${input.payload ? sql.json(input.payload) : null}
      )
      returning id::text as id, status
    `
    return { ...created, idempotent: false }
  })
}

async function settleMutation(input: {
  organisationId: string
  mutationId: string
  status: "succeeded" | "failed" | "ambiguous"
  googleLinkName?: string
  response?: Record<string, unknown> | null
  errorCode?: string
}) {
  await withTenant(input.organisationId, async (sql) => {
    await sql`
      update place_action_mutation
      set
        status = ${input.status},
        google_link_name = ${input.googleLinkName ?? null},
        google_response = ${input.response ? sql.json(JSON.parse(JSON.stringify(input.response))) : null},
        last_error_code = ${input.errorCode ?? null},
        finished_at = now()
      where id = ${input.mutationId}
    `
  })
}

async function storedLink(
  organisationId: string,
  locationId: string,
  linkId: string
) {
  const [link] = await withTenant(organisationId, (sql) => sql<StoredLink[]>`
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
  `)
  if (!link) throw new ApiError(404, "place_action_not_found", "Place Action link not found.")
  if (!link.isEditable) {
    throw new ApiError(
      409,
      "place_action_not_editable",
      "Google reports that this provider link cannot be edited by the merchant."
    )
  }
  return link
}

export async function createPlaceAction(input: {
  organisationId: string
  session: Session
  locationId: string
  payload: PlaceActionInput
  requestId: string
}) {
  const context = await contextFor(input.session, input.locationId)
  requireWrites(context)
  const mutation = await createMutation({
    ...input,
    context,
    operation: "create",
  })
  if (mutation.idempotent) return mutation
  const accessToken = await connectionAccessToken(
    getDatabase(),
    input.organisationId,
    context.googleConnectionId
  )
  try {
    let response: Record<string, unknown>
    try {
      response = await createGooglePlaceActionLink(
        accessToken,
        { locationName: context.googleLocationName, payload: input.payload },
        { connectionKey: context.googleConnectionId }
      )
    } catch (error) {
      if (!(error instanceof GoogleMutationAmbiguousError)) throw error
      const live = await listGooglePlaceActionLinks(
        accessToken,
        context.googleLocationName,
        { connectionKey: context.googleConnectionId }
      )
      const recovered = live.find(
        (link) =>
          link.uri === input.payload.uri &&
          link.placeActionType === input.payload.placeActionType
      )
      if (!recovered) throw error
      response = recovered as unknown as Record<string, unknown>
    }
    const parsed = inputFromGoogle(response)
    if (!parsed || placeActionHash(parsed) !== placeActionHash(input.payload)) {
      throw new ApiError(
        502,
        "place_action_readback_mismatch",
        "Google did not return the approved Place Action values."
      )
    }
    const name = typeof response.name === "string" ? response.name : undefined
    await settleMutation({
      organisationId: input.organisationId,
      mutationId: mutation.id,
      status: "succeeded",
      googleLinkName: name,
      response,
    })
    await readLiveLinks(input.organisationId, context)
    await withTenant(input.organisationId, (sql) =>
      writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action: "place_action.created",
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: { googleLinkName: name, ...input.payload },
      })
    )
    return { id: mutation.id, status: "succeeded", idempotent: false }
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError
    await settleMutation({
      organisationId: input.organisationId,
      mutationId: mutation.id,
      status: ambiguous ? "ambiguous" : "failed",
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "place_action_create_failed",
    })
    throw error
  }
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
  const context = await contextFor(input.session, input.locationId)
  requireWrites(context)
  const link = await storedLink(input.organisationId, input.locationId, input.linkId)
  if (link.googleHash !== input.expectedGoogleHash) {
    throw new ApiError(409, "place_action_stale", "Refresh before overwriting newer Google changes.")
  }
  const mutation = await createMutation({
    ...input,
    context,
    operation: "update",
  })
  if (mutation.idempotent) return mutation
  const accessToken = await connectionAccessToken(
    getDatabase(),
    input.organisationId,
    context.googleConnectionId
  )
  try {
    const current = await getGooglePlaceActionLink(
      accessToken,
      link.googleLinkName,
      { connectionKey: context.googleConnectionId }
    )
    const currentInput = inputFromGoogle(current)
    if (!currentInput || placeActionHash(currentInput) !== input.expectedGoogleHash) {
      throw new ApiError(409, "place_action_stale", "Google changed this link. Refresh and review it again.")
    }
    await patchGooglePlaceActionLink(
      accessToken,
      { name: link.googleLinkName, payload: input.payload },
      { connectionKey: context.googleConnectionId }
    )
    const readback = await getGooglePlaceActionLink(
      accessToken,
      link.googleLinkName,
      { connectionKey: context.googleConnectionId }
    )
    const readbackInput = inputFromGoogle(readback)
    if (!readbackInput || placeActionHash(readbackInput) !== placeActionHash(input.payload)) {
      throw new ApiError(502, "place_action_readback_mismatch", "Google did not apply the approved link values.")
    }
    await settleMutation({
      organisationId: input.organisationId,
      mutationId: mutation.id,
      status: "succeeded",
      googleLinkName: link.googleLinkName,
      response: readback,
    })
    await readLiveLinks(input.organisationId, context)
    await withTenant(input.organisationId, (sql) =>
      writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action: "place_action.updated",
        subjectType: "place_action_link",
        subjectId: input.linkId,
        requestId: input.requestId,
        metadata: input.payload,
      })
    )
    return { id: mutation.id, status: "succeeded", idempotent: false }
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError
    await settleMutation({
      organisationId: input.organisationId,
      mutationId: mutation.id,
      status: ambiguous ? "ambiguous" : "failed",
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "place_action_update_failed",
    })
    throw error
  }
}

export async function removePlaceAction(input: {
  organisationId: string
  session: Session
  locationId: string
  linkId: string
  expectedGoogleHash: string
  requestId: string
}) {
  const context = await contextFor(input.session, input.locationId)
  requireWrites(context)
  const link = await storedLink(input.organisationId, input.locationId, input.linkId)
  if (link.googleHash !== input.expectedGoogleHash) {
    throw new ApiError(409, "place_action_stale", "Refresh before deleting a changed Google link.")
  }
  const mutation = await createMutation({
    ...input,
    context,
    operation: "delete",
  })
  if (mutation.idempotent) return mutation
  const accessToken = await connectionAccessToken(
    getDatabase(),
    input.organisationId,
    context.googleConnectionId
  )
  try {
    const current = await getGooglePlaceActionLink(
      accessToken,
      link.googleLinkName,
      { connectionKey: context.googleConnectionId }
    )
    const currentInput = inputFromGoogle(current)
    if (!currentInput || placeActionHash(currentInput) !== input.expectedGoogleHash) {
      throw new ApiError(409, "place_action_stale", "Google changed this link. Refresh and review it again.")
    }
    await deleteGooglePlaceActionLink(
      accessToken,
      link.googleLinkName,
      { connectionKey: context.googleConnectionId }
    )
    const live = await listGooglePlaceActionLinks(
      accessToken,
      context.googleLocationName,
      { connectionKey: context.googleConnectionId }
    )
    if (live.some((candidate) => candidate.name === link.googleLinkName)) {
      throw new ApiError(502, "place_action_delete_mismatch", "Google still returns the deleted link.")
    }
    await persistLiveLinks(input.organisationId, context, live)
    await settleMutation({
      organisationId: input.organisationId,
      mutationId: mutation.id,
      status: "succeeded",
      googleLinkName: link.googleLinkName,
    })
    await withTenant(input.organisationId, (sql) =>
      writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action: "place_action.deleted",
        subjectType: "place_action_link",
        subjectId: input.linkId,
        requestId: input.requestId,
        metadata: { googleLinkName: link.googleLinkName },
      })
    )
    return { id: mutation.id, status: "succeeded", idempotent: false }
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError
    await settleMutation({
      organisationId: input.organisationId,
      mutationId: mutation.id,
      status: ambiguous ? "ambiguous" : "failed",
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "place_action_delete_failed",
    })
    throw error
  }
}
