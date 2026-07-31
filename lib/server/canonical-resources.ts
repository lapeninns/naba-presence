import "server-only"

import type { TransactionSql } from "postgres"

import { ApiError } from "@/lib/server/http"

export type CanonicalResourceType =
  | "profile"
  | "hours"
  | "food_menus"
  | "business_info"
  | "attributes"
  | "lodging"
  | "business_calls"
  | "healthcare"

export type CanonicalResource<T> = {
  id: string
  revision: string
  payload: T
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
  lastReconciledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ResourceRow = Omit<CanonicalResource<unknown>, "payload"> & {
  payload: unknown
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function ensureCanonicalResource<T>(input: {
  sql: TransactionSql
  organisationId: string
  locationId: string
  resourceType: CanonicalResourceType
  initialPayload: T
  actorUserId: string
}): Promise<CanonicalResource<T>> {
  await input.sql`
    insert into presence_canonical_resource (
      organisation_id,
      location_id,
      resource_type,
      payload,
      created_by
    )
    values (
      ${input.organisationId},
      ${input.locationId},
      ${input.resourceType},
      ${input.sql.json(clone(input.initialPayload) as never)},
      ${input.actorUserId}
    )
    on conflict (organisation_id, location_id, resource_type) do nothing
  `
  const [row] = await input.sql<ResourceRow[]>`
    select
      id::text as id,
      revision::text as revision,
      payload,
      baseline_canonical_hash as "baselineCanonicalHash",
      baseline_google_hash as "baselineGoogleHash",
      last_reconciled_at as "lastReconciledAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from presence_canonical_resource
    where organisation_id = ${input.organisationId}
      and location_id = ${input.locationId}
      and resource_type = ${input.resourceType}
    limit 1
  `
  if (!row) {
    throw new ApiError(
      500,
      "canonical_resource_unavailable",
      "The NabaPresence canonical resource could not be initialized."
    )
  }
  return { ...row, payload: row.payload as T }
}

export async function updateCanonicalResource<T>(input: {
  sql: TransactionSql
  organisationId: string
  locationId: string
  resourceType: CanonicalResourceType
  expectedRevision: string
  payload: T
}): Promise<CanonicalResource<T>> {
  const [row] = await input.sql<ResourceRow[]>`
    update presence_canonical_resource
    set
      payload = ${input.sql.json(clone(input.payload) as never)},
      revision = revision + 1
    where organisation_id = ${input.organisationId}
      and location_id = ${input.locationId}
      and resource_type = ${input.resourceType}
      and revision = ${input.expectedRevision}
    returning
      id::text as id,
      revision::text as revision,
      payload,
      baseline_canonical_hash as "baselineCanonicalHash",
      baseline_google_hash as "baselineGoogleHash",
      last_reconciled_at as "lastReconciledAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `
  if (!row) {
    throw new ApiError(
      409,
      "canonical_resource_stale",
      "The canonical resource changed after it was loaded. Refresh and try again."
    )
  }
  return { ...row, payload: row.payload as T }
}

export async function reconcileCanonicalResource(input: {
  sql: TransactionSql
  organisationId: string
  locationId: string
  resourceType: CanonicalResourceType
  canonicalHash: string
  googleHash: string
}) {
  await input.sql`
    update presence_canonical_resource
    set
      baseline_canonical_hash = ${input.canonicalHash},
      baseline_google_hash = ${input.googleHash},
      last_reconciled_at = now()
    where organisation_id = ${input.organisationId}
      and location_id = ${input.locationId}
      and resource_type = ${input.resourceType}
  `
}
