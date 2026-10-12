import "server-only"

import type { TransactionSql } from "postgres"
import type { z } from "zod"
import type { GbpChangeSet, lodgingPreviewRequestSchema } from "@/lib/contracts/gbp-change-set"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { googleLodgingApi } from "@/lib/server/google"
import { resolveGbpLocationContext, stableGoogleHash, type GbpLocationContext } from "@/lib/server/gbp-management"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { authorisationAssurance } from "@/lib/server/mfa"
import { requireGbpDispatch } from "@/lib/server/pause-controls"
import { currentApprovalPolicy, requireCurrentManager, requireSecondApprover, requireUnchangedTwoPersonPolicy, secondApproverSatisfied } from "@/lib/server/authz/approval-policy"
import type { Session } from "@/lib/server/session"

type ChangeSetRow = {
  readonly id: string
  readonly location_id: string
  readonly google_account_id: string
  readonly connection_id: string
  readonly target_resource_name: string
  readonly requested_by: string
  readonly approved_by: string | null
  readonly approved_security_version: number | null
  readonly payload: Record<string, unknown>
  readonly payload_hash: string
  readonly baseline: Record<string, unknown>
  readonly baseline_hash: string
  readonly update_mask: string[]
  readonly require_two_person_approval: boolean
  readonly approval_expires_at: Date
  readonly private_payload: Buffer | null
}

type ChangeResource = "lodging" | "business_info" | "attributes" | "verification_start" | "verification_complete" | "administration_access" | "location_lifecycle" | "place_action"

const LISTING_DISPATCH = { scope: "profileWrites", paused: { code: "google_writes_paused", message: "Google writes are paused." } } as const
const PLACE_ACTION_DISPATCH = { scope: "placeActions", paused: { status: 503, code: "place_actions_paused", message: "Place Action writes are paused." } } as const

export function lodgingChangeHash(payload: unknown, updateMask: readonly string[]) {
  return stableGoogleHash({ payload, updateMask: [...new Set(updateMask)].sort() })
}

function project(row: ChangeSetRow, session: Session, locationName: string): GbpChangeSet {
  return {
    id: row.id, locationName, targetResourceName: row.target_resource_name, payloadHash: row.payload_hash, baselineHash: row.baseline_hash,
    payload: row.payload, baseline: row.baseline, updateMask: row.update_mask,
    requestedBy: row.requested_by, approvedBy: row.approved_by,
    requiresSecondApprover: row.require_two_person_approval,
    canApprove: secondApproverSatisfied(row.require_two_person_approval, row.requested_by, session.userId),
    expiresAt: new Date(row.approval_expires_at).toISOString(),
  }
}

function checkTarget(row: ChangeSetRow, linked: GbpLocationContext) {
  if (row.target_resource_name !== linked.googleLocationName || row.google_account_id !== linked.googleAccountId || row.connection_id !== linked.connectionId) {
    throw new ApiError(409, "google_target_changed", "The Google target changed. Generate a new review.")
  }
}

async function checkedRow(sql: TransactionSql, session: Session, linked: GbpLocationContext, changeSetId: string, resourceType: ChangeResource) {
  const [row] = await sql<ChangeSetRow[]>`select * from gbp_change_set where id = ${changeSetId} and location_id = ${linked.locationId} and resource_type = ${resourceType} for update`
  if (!row) throw new ApiError(404, "change_set_not_found", "The reviewed change was not found.")
  checkTarget(row, linked)
  if (new Date(row.approval_expires_at).getTime() <= Date.now()) throw new ApiError(409, "approval_expired", "This review expired. Generate a new review.")
  await requireUnchangedTwoPersonPolicy(sql, session.organisationId, row.require_two_person_approval)
  await requireCurrentManager(sql, session.organisationId, row.requested_by)
  await requireCurrentManager(sql, session.organisationId, session.userId)
  if (row.payload_hash !== lodgingChangeHash(row.payload, row.update_mask)) throw new ApiError(409, "approval_stale", "The reviewed content changed. Generate a new review.")
  return row
}

export async function listGbpChangeSets(session: Session, linked: GbpLocationContext, resourceType: ChangeResource) {
  return withTenant(session.organisationId, async (sql) => {
    const rows = await sql<ChangeSetRow[]>`
      select c.* from gbp_change_set c
      where c.location_id = ${linked.locationId} and c.resource_type = ${resourceType} and c.approval_expires_at > now()
        and not exists (select 1 from gbp_management_mutation m where m.change_set_id = c.id)
      order by c.created_at desc, c.id desc limit 20
    `
    return rows.map((row) => project(row, session, linked.locationName))
  })
}

export function listLodgingChangeSets(session: Session, linked: GbpLocationContext) {
  return listGbpChangeSets(session, linked, "lodging")
}

export async function previewLodgingChange(session: Session, locationId: string, input: z.infer<typeof lodgingPreviewRequestSchema>, requestId: string): Promise<GbpChangeSet> {
  const linked = await withTenant(session.organisationId, (sql) => resolveGbpLocationContext(sql, session, locationId))
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot manage this location.")
  const baseline = await googleLodgingApi(await linked.accessToken(), { locationName: linked.googleLocationName, operation: "get" }, { connectionKey: linked.connectionId })
  const baselineHash = stableGoogleHash(baseline)
  if (baselineHash !== input.expectedGoogleHash) throw new ApiError(409, "google_baseline_stale", "Google changed after this form was loaded. Refresh and review again.")
  const payload = { ...input.payload, metadata: { updateTime: new Date().toISOString() } }
  const updateMask = [...new Set([...input.updateMask, "metadata.updateTime"])].sort()
  return saveGbpChangeSet({ session, linked, resourceType: "lodging", baseline, payload, updateMask, requestId })
}

export async function saveGbpChangeSet(input: {
  readonly session: Session
  readonly linked: GbpLocationContext
  readonly resourceType: ChangeResource
  readonly baseline: Record<string, unknown>
  readonly payload: Record<string, unknown>
  readonly updateMask: string[]
  readonly requestId: string
  readonly privatePayload?: Buffer
}): Promise<GbpChangeSet> {
  const { session, linked, resourceType, baseline, payload, updateMask, requestId } = input
  const locationId = linked.locationId
  const baselineHash = stableGoogleHash(baseline)
  const payloadHash = lodgingChangeHash(payload, updateMask)
  return withTenant(session.organisationId, async (sql) => {
    await requireCurrentManager(sql, session.organisationId, session.userId)
    // Current policy, current manager and the second-approver rule come from
    // the shared approval-policy helper, as bulk listing batches do.
    const policy = (await currentApprovalPolicy(sql, session.organisationId)).requireTwoPersonApproval
    const [row] = await sql<ChangeSetRow[]>`
      insert into gbp_change_set (organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by, payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload, approval_expires_at)
      values (${session.organisationId}, ${locationId}, ${linked.googleAccountId}, ${linked.connectionId}, ${linked.googleLocationName}, ${resourceType}, ${session.userId}, ${jsonColumn(sql, payload)}, ${payloadHash}, ${updateMask}, ${jsonColumn(sql, baseline)}, ${baselineHash}, ${policy}, ${input.privatePayload ?? null}, now() + case when ${resourceType} in ('verification_start', 'verification_complete') then interval '20 minutes' else interval '24 hours' end) returning *
    `
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.change_set.reviewed", subjectType: "location", subjectId: locationId, requestId, metadata: { changeSetId: row.id, payloadHash, baselineHash } })
    return project(row, session, linked.locationName)
  })
}

export async function approveLodgingChange(session: Session, locationId: string, changeSetId: string, expectedPayloadHash: string, requestId: string): Promise<GbpChangeSet> {
  return approveGbpChange({ session, locationId, changeSetId, expectedPayloadHash, requestId, resourceType: "lodging" })
}

export async function readGbpChangeSet(session: Session, locationId: string, changeSetId: string, resourceType: ChangeResource) {
  return withTenant(session.organisationId, async (sql) => {
    const linked = await resolveGbpLocationContext(sql, session, locationId)
    if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot review changes for this location.")
    const row = await checkedRow(sql, session, linked, changeSetId, resourceType)
    if (row.approved_by) await requireCurrentManager(sql, session.organisationId, row.approved_by, { securityVersion: row.approved_security_version })
    return { changeSet: project(row, session, linked.locationName), privatePayload: row.private_payload }
  })
}

export async function approveGbpChange(input: {
  readonly session: Session; readonly locationId: string; readonly changeSetId: string
  readonly expectedPayloadHash: string; readonly requestId: string; readonly resourceType: ChangeResource
}): Promise<GbpChangeSet> {
  const { session, locationId, changeSetId, expectedPayloadHash, requestId, resourceType } = input
  return withTenant(session.organisationId, async (sql) => {
    const linked = await resolveGbpLocationContext(sql, session, locationId)
    if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot approve for this location.")
    const row = await checkedRow(sql, session, linked, changeSetId, resourceType)
    if (row.payload_hash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed content changed. Generate a new review.")
    requireSecondApprover(row.require_two_person_approval, row.requested_by, session.userId, "A different authorised user must review and approve this change.")
    if (row.approved_by) return project(row, session, linked.locationName)
    // The assurance the approval was given with (0106), as evidence.
    const assurance = authorisationAssurance(session)
    const [approved] = await sql<ChangeSetRow[]>`update gbp_change_set set approved_by = ${session.userId}, approved_at = now(), approved_aal = ${assurance.aal}, approved_mfa_verified_at = ${assurance.mfaVerifiedAt}, approved_security_version = ${assurance.securityVersion} where id = ${row.id} returning *`
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.change_set.approved", subjectType: "location", subjectId: locationId, requestId, metadata: { changeSetId, payloadHash: row.payload_hash } })
    return project(approved, session, linked.locationName)
  })
}

export async function approvedLodgingChange(session: Session, linked: GbpLocationContext, changeSetId: string, payload: unknown, updateMask: readonly string[]) {
  return approvedGbpChange({ session, linked, changeSetId, payload, updateMask, resourceType: "lodging" })
}

export async function approvedGbpChange(input: {
  readonly session: Session; readonly linked: GbpLocationContext; readonly changeSetId: string
  readonly payload: unknown; readonly updateMask: readonly string[]; readonly resourceType: ChangeResource
}) {
  const { session, linked, changeSetId, payload, updateMask, resourceType } = input
  // Every reviewed change set dispatches through here, so the operator pause
  // table (lib/server/pause-controls.ts) holds them off as well as the env,
  // under the surface that resource writes to: pausing placeActions must stop
  // a reviewed Place Action link, not only the booking capability.
  const surface = resourceType === "place_action" ? PLACE_ACTION_DISPATCH : LISTING_DISPATCH
  await requireGbpDispatch(surface.scope, surface.paused)
  return withTenant(session.organisationId, async (sql) => {
    const row = await checkedRow(sql, session, linked, changeSetId, resourceType)
    if (!row.approved_by) throw new ApiError(409, "approval_required", "Review and approve the exact change before publishing.")
    await requireCurrentManager(sql, session.organisationId, row.approved_by, { securityVersion: row.approved_security_version })
    if (row.payload_hash !== lodgingChangeHash(payload, updateMask)) throw new ApiError(409, "approval_stale", "The payload or selected fields changed after review.")
    return row
  })
}
