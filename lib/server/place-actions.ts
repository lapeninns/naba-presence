import "server-only"
import type { TransactionSql } from "postgres"
import type { PlaceActionInput, PlaceActionLink } from "@/lib/contracts/location-place-actions"
import type { GooglePlaceActionType } from "@/lib/domain/google-contract"
import type { EditorReadSource } from "@/lib/contracts/editor-freshness"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { shouldReadLive } from "@/lib/server/editor-freshness"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import { loadLinkedLocation, type LinkedLocation } from "@/lib/server/gbp-write"
import { listGooglePlaceActionLinks, type GooglePlaceActionLink } from "@/lib/server/google"
import { listGooglePlaceActionMetadata } from "@/lib/server/google/place-action-metadata"
import {
  readObservedGooglePayload,
  recordResourceObservation,
} from "@/lib/server/resource-observations"
import type { Session } from "@/lib/server/session"

type StoredLink = Omit<PlaceActionLink, "placeActionType" | "observedAt"> & { placeActionType: GooglePlaceActionType; observedAt: Date }

function placeActionHash(input: PlaceActionInput) {
  return sha256(
    JSON.stringify({
      uri: input.uri,
      placeActionType: input.placeActionType,
      isPreferred: input.isPreferred,
    })
  )
}

const LINKED_PLACE_ACTIONS = {
  notLinked: {
    message: "Link this location to Google before managing Place Actions.",
  },
}

function linkedLocation(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId, LINKED_PLACE_ACTIONS)
  )
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
}

type LatestMutation = {
  id: string
  operation: string
  status: string
  createdAt: Date
  finishedAt: Date | null
}

async function storedLinks(sql: TransactionSql, locationId: string) {
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
    where location_id = ${locationId}
      and deleted_at is null
    order by place_action_type, is_preferred desc, uri
  `
}

async function latestMutation(sql: TransactionSql, locationId: string) {
  const [row] = await sql<LatestMutation[]>`
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
  return row ?? null
}

/**
 * What a successful Place Actions read keeps as its observation
 * (`observed_google_payload`): Google's action-type metadata and the links
 * this editor cannot show, for which Google location, and when. The links
 * it can show are the `place_action_link` rows the same read wrote.
 */
type ObservedPlaceActionsPayload = {
  observedAt: string
  googleLocationName: string
  metadata: Awaited<ReturnType<typeof listGooglePlaceActionMetadata>>
  unsupportedLinks: Awaited<
    ReturnType<typeof listGooglePlaceActionLinks>
  >["unsupportedLinks"]
}

/**
 * The editor's state from the latest observation, in ONE read-only tenant
 * transaction and no Google call (W3-2). `stored` is null when Google must
 * be read (the `linked` location loaded here is reused for it): nothing is
 * stored, the read is past the budget or was of another Google location, a
 * read or the sweep failed since, or a link write has not settled. Google
 * writes to the location's links drop the observation first
 * (`forgetObservedGooglePayload`).
 */
async function readStoredPlaceActions(session: Session, locationId: string) {
  return withTenant(session.organisationId, async (sql) => {
    const linked = await loadLinkedLocation(sql, session, locationId, LINKED_PLACE_ACTIONS)
    const [observation, mutation] = await Promise.all([
      readObservedGooglePayload(sql, {
        organisationId: session.organisationId,
        locationId,
        resource: "placeActions",
      }),
      latestMutation(sql, locationId),
    ])
    const payload = observation?.payload as ObservedPlaceActionsPayload | null
    if (
      !payload?.metadata ||
      observation?.failed ||
      payload.googleLocationName !== linked.googleLocationName ||
      (mutation && !mutation.finishedAt) ||
      shouldReadLive({ observedAt: payload.observedAt })
    )
      return { linked, stored: null }
    return {
      linked,
      stored: {
        payload,
        links: await storedLinks(sql, locationId),
        mutation,
      },
    }
  })
}

/**
 * The Place Actions editor: served from the latest observation within the
 * editor's staleness budget, read from Google otherwise (`refresh` always
 * reads). A live read refreshes the local links, records the observation
 * and reads the latest mutation in one transaction. Executing a reviewed
 * change always reads Google itself.
 */
export async function loadPlaceActions(
  organisationId: string,
  session: Session,
  locationId: string,
  options: { refresh?: boolean } = {}
) {
  const read = options.refresh
    ? null
    : await readStoredPlaceActions(session, locationId)
  if (read?.stored)
    return placeActionsState({
      locationId,
      canPublish: read.linked.canPublish,
      ...read.stored,
      source: "stored",
    })
  const linked = read?.linked ?? (await linkedLocation(session, locationId))
  const observedAt = new Date()
  const metadata = await listGooglePlaceActionMetadata(await linked.accessToken(), linked.googleLocationName, { connectionKey: linked.googleConnectionId })
  const { links, unsupportedLinks } = await listGooglePlaceActionLinks(
    await linked.accessToken(),
    linked.googleLocationName,
    { connectionKey: linked.googleConnectionId }
  )
  const payload: ObservedPlaceActionsPayload = {
    observedAt: observedAt.toISOString(),
    googleLocationName: linked.googleLocationName,
    metadata,
    unsupportedLinks,
  }
  const observed = await withTenant(organisationId, async (sql) => {
    await persistLiveLinks(sql, organisationId, linked, links)
    await recordResourceObservation(sql, {
      organisationId,
      locationId,
      resource: "placeActions",
      attemptedAt: observedAt,
      googlePayload: payload,
    })
    return {
      links: await storedLinks(sql, locationId),
      mutation: await latestMutation(sql, locationId),
    }
  })
  return placeActionsState({
    locationId,
    canPublish: linked.canPublish,
    payload,
    ...observed,
    source: "live",
  })
}

function placeActionsState(input: {
  locationId: string
  canPublish: boolean
  payload: ObservedPlaceActionsPayload
  links: StoredLink[]
  mutation: LatestMutation | null
  source: EditorReadSource
}) {
  const { payload, mutation } = input
  const env = getServerEnv()
  return {
    locationId: input.locationId,
    canPublish: input.canPublish,
    writesEnabled: gbpWritesEnabled(env, "placeActions"),
    supportedTypes: payload.metadata.supportedTypes,
    unsupportedTypes: payload.metadata.unsupportedTypes,
    metadataObservedAt: payload.metadata.observedAt,
    links: input.links.map((link) => ({
      ...link,
      observedAt: link.observedAt.toISOString(),
    })),
    unsupportedLinks: payload.unsupportedLinks,
    latestMutation: mutation
      ? {
          ...mutation,
          createdAt: mutation.createdAt.toISOString(),
          finishedAt: mutation.finishedAt?.toISOString() ?? null,
        }
      : null,
    observedAt: payload.observedAt,
    source: input.source,
  }
}
