import "server-only"
import type { TransactionSql } from "postgres"
import type { PlaceActionInput, PlaceActionLink } from "@/lib/contracts/location-place-actions"
import type { GooglePlaceActionType } from "@/lib/domain/google-contract"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import { loadLinkedLocation, type LinkedLocation } from "@/lib/server/gbp-write"
import { listGooglePlaceActionLinks, type GooglePlaceActionLink } from "@/lib/server/google"
import { listGooglePlaceActionMetadata } from "@/lib/server/google/place-action-metadata"
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

function linkedLocation(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId, {
      notLinked: {
        message: "Link this location to Google before managing Place Actions.",
      },
    })
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
  const { links, unsupportedLinks } = await listGooglePlaceActionLinks(
    await linked.accessToken(),
    linked.googleLocationName,
    { connectionKey: linked.googleConnectionId }
  )
  const stored = await withTenant(organisationId, (sql) =>
    persistLiveLinks(sql, organisationId, linked, links)
  )
  return { stored, unsupportedLinks }
}

export async function loadPlaceActions(
  organisationId: string,
  session: Session,
  locationId: string
) {
  const linked = await linkedLocation(session, locationId)
  const metadata = await listGooglePlaceActionMetadata(await linked.accessToken(), linked.googleLocationName, { connectionKey: linked.googleConnectionId })
  const { stored, unsupportedLinks } = await readLiveLinks(organisationId, linked)
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
    supportedTypes: metadata.supportedTypes,
    unsupportedTypes: metadata.unsupportedTypes,
    metadataObservedAt: metadata.observedAt,
    links: stored.map((link) => ({
      ...link,
      observedAt: link.observedAt.toISOString(),
    })),
    unsupportedLinks,
    latestMutation: latestMutation
      ? {
          ...latestMutation,
          createdAt: latestMutation.createdAt.toISOString(),
          finishedAt: latestMutation.finishedAt?.toISOString() ?? null,
        }
      : null,
  }
}
