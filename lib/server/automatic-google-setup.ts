import "server-only"

import { discoverAutomaticGoogleCandidate } from "@/lib/server/automatic-google-discovery"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"

export type AutomaticGoogleSetup =
  | {
      readonly kind: "automatic"
      readonly accountName: string
      readonly locationName: string
      readonly externalLocationId: string
    }
  | { readonly kind: "manual_accounts"; readonly accountCount: number }
  | {
      readonly kind: "manual_locations"
      readonly accountName: string
      readonly locationCount: number
    }
  | { readonly kind: "manual_error" }

type AutomaticGoogleSetupInput = {
  readonly organisationId: string
  readonly userId: string
  readonly connectionId: string
  readonly accessToken: string
  readonly requestId: string
}

export async function prepareAutomaticGoogleReviewSetup(
  input: AutomaticGoogleSetupInput
): Promise<AutomaticGoogleSetup> {
  const candidate = await discoverAutomaticGoogleCandidate({
    accessToken: input.accessToken,
    connectionId: input.connectionId,
  })
  if (candidate.kind !== "candidate") return candidate
  const { account, location } = candidate
  await withTenant(input.organisationId, async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into google_account (
        organisation_id,
        google_connection_id,
        google_account_name,
        account_name,
        account_type,
        role,
        permission_level,
        is_active,
        raw_payload,
        raw_content_expires_at
      )
      values (
        ${input.organisationId},
        ${input.connectionId},
        ${account.name},
        ${account.accountName ?? account.name},
        ${account.type ?? null},
        ${account.role ?? null},
        ${account.permissionLevel ?? null},
        true,
        ${sql.json(account)},
        now() + interval '30 days'
      )
      on conflict (organisation_id, google_account_name) do update
      set
        google_connection_id = excluded.google_connection_id,
        account_name = excluded.account_name,
        account_type = excluded.account_type,
        role = excluded.role,
        permission_level = excluded.permission_level,
        is_active = true,
        raw_payload = excluded.raw_payload,
        raw_content_expires_at = excluded.raw_content_expires_at
      returning id::text as id
    `
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.userId,
      action: "google.accounts.activated",
      subjectType: "google_account",
      subjectId: row.id,
      requestId: `${input.requestId}:account`,
      metadata: { automatic: true, accountName: account.name },
    })
  })

  const title = location.title ?? location.name
  const verified = location.metadata?.hasVoiceOfMerchant === true
  const externalLocationId = await withTenant(
    input.organisationId,
    async (sql) => {
      const [external] = await sql<{ id: string }[]>`
        insert into external_location (
          organisation_id,
          google_connection_id,
          google_account_name,
          google_location_name,
          title,
          address_json,
          verified,
          raw_payload,
          raw_content_expires_at
        )
        values (
          ${input.organisationId},
          ${input.connectionId},
          ${account.name},
          ${location.name},
          ${title},
          ${location.storefrontAddress ? sql.json(location.storefrontAddress) : null},
          ${verified},
          ${sql.json(location)},
          now() + interval '30 days'
        )
        on conflict (organisation_id, google_location_name) do update
        set
          google_connection_id = excluded.google_connection_id,
          google_account_name = excluded.google_account_name,
          title = excluded.title,
          address_json = excluded.address_json,
          verified = excluded.verified,
          raw_payload = excluded.raw_payload,
          raw_content_expires_at = excluded.raw_content_expires_at
        returning id::text as id
      `
      await sql`
        insert into webhook_route (
          google_location_name,
          organisation_id,
          external_location_id
        )
        values (${location.name}, ${input.organisationId}, ${external.id})
        on conflict (google_location_name) do update
        set
          organisation_id = excluded.organisation_id,
          external_location_id = excluded.external_location_id,
          updated_at = now()
      `
      const [existingLink] = await sql<{ id: string }[]>`
        select id::text as id
        from location_link
        where external_location_id = ${external.id}
          and is_active = true
        limit 1
      `
      if (!existingLink) {
        const [managedLocation] = await sql<{ id: string }[]>`
          insert into location (organisation_id, name, address_json, timezone)
          values (
            ${input.organisationId},
            ${title},
            ${location.storefrontAddress ? sql.json(location.storefrontAddress) : null},
            'Europe/London'
          )
          on conflict (organisation_id, name) do update
          set
            address_json = coalesce(location.address_json, excluded.address_json)
          returning id::text as id
        `
        const [link] = await sql<{ id: string }[]>`
          insert into location_link (
            organisation_id,
            location_id,
            external_location_id,
            is_active
          )
          values (
            ${input.organisationId},
            ${managedLocation.id},
            ${external.id},
            true
          )
          on conflict (organisation_id, external_location_id) do update
          set location_id = excluded.location_id, is_active = true
          returning id::text as id
        `
        await writeAudit(sql, {
          organisationId: input.organisationId,
          actorUserId: input.userId,
          action: "location.linked",
          subjectType: "location_link",
          subjectId: link.id,
          requestId: `${input.requestId}:location`,
          metadata: {
            automatic: true,
            locationId: managedLocation.id,
            externalLocationId: external.id,
          },
        })
      }
      await sql`
        insert into sync_checkpoint (
          organisation_id,
          external_location_id,
          sync_type,
          status,
          next_attempt_at
        )
        values (
          ${input.organisationId},
          ${external.id},
          'backfill',
          'pending',
          now()
        )
        on conflict (organisation_id, external_location_id, sync_type)
        do update set
          status = 'pending',
          next_attempt_at = now(),
          last_error_code = null,
          finished_at = null
        where sync_checkpoint.status not in ('pending', 'running')
      `
      await writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.userId,
        action: "sync.backfill.started",
        subjectType: "external_location",
        subjectId: external.id,
        requestId: `${input.requestId}:backfill`,
        metadata: { automatic: true },
      })
      return external.id
    }
  )

  return {
    kind: "automatic",
    accountName: account.name,
    locationName: location.name,
    externalLocationId,
  }
}
