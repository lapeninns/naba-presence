import "server-only"
import { administrationAccessReviewSchema, reviewedAdministrationPayloadSchema, type AdministrationAccessRequest, type AdministrationAccessReview } from "@/lib/contracts/google-administration-review"
import { approveGbpChange, listGbpChangeSets, readGbpChangeSet, saveGbpChangeSet } from "@/lib/server/gbp-change-sets"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { administrationBaselineSchema, currentAdministrationContext, observeAdministrationAccess, scopedAdministrationTarget } from "@/lib/server/google-administration-state"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

function projectReview(changeSet: AdministrationAccessReview["changeSet"], linked: Awaited<ReturnType<typeof currentAdministrationContext>>) {
  const payload = reviewedAdministrationPayloadSchema.safeParse(changeSet.payload)
  if (!payload.success) throw new ApiError(409, "administration_review_unreadable", "This administration review cannot be restored safely. Create a fresh review.")
  const target = scopedAdministrationTarget(payload.data.request, linked)
  return administrationAccessReviewSchema.parse({ changeSet, request: payload.data.request, target: target.target, parent: target.parent, observedAt: payload.data.observedAt })
}

function requireProposedChange(request: AdministrationAccessRequest, baseline: ReturnType<typeof administrationBaselineSchema.parse>) {
  if ((request.operation === "create_admin" || request.operation === "update_admin") && request.payload.role === "PRIMARY_OWNER") throw new ApiError(409, "primary_ownership_transfer_required", "Review a dedicated primary ownership transfer before assigning the primary owner role.")
  if (request.operation === "create_admin") {
    const invitee = request.payload
    const duplicate = baseline.rows.some((row) => invitee.account ? row.account === invitee.account : typeof row.admin === "string" && row.admin.toLowerCase() === invitee.admin?.toLowerCase())
    if (duplicate) throw new ApiError(409, "google_admin_already_present", "This invitee is already listed by Google. Refresh their current access instead.")
    return
  }
  const name = request.payload.name
  const row = baseline.rows.find((item) => item.name === name)
  if (!row) throw new ApiError(409, "administration_target_missing", "Google no longer lists this administrator or invitation. Refresh before reviewing another change.")
  if (request.operation === "update_admin" && row.role === request.payload.role) throw new ApiError(409, "administration_no_change", "Google already reports this administrator role.")
  if ((request.operation === "update_admin" || request.operation === "delete_admin") && row.role === "PRIMARY_OWNER") throw new ApiError(409, "primary_ownership_transfer_required", "Review a primary ownership transfer before changing this administrator.")
  const demotesOwner = request.operation === "delete_admin" || (request.operation === "update_admin" && !["OWNER", "PRIMARY_OWNER"].includes(request.payload.role))
  if (row.role === "OWNER" && demotesOwner && baseline.rows.filter((item) => item.role === "OWNER" || item.role === "PRIMARY_OWNER").length <= 1) throw new ApiError(409, "last_google_owner_required", "Keep an owner on this Google target. Make another eligible administrator an owner before removing or demoting the last owner.")
  if ((request.operation === "update_admin" || request.operation === "delete_admin") && !["PRIMARY_OWNER", "OWNER", "MANAGER", "SITE_MANAGER"].includes(String(row.role))) throw new ApiError(409, "admin_role_unknown", "Google has not supplied a supported current role for this administrator. Refresh or continue in Google.")
}

export async function previewAdministrationAccess(session: Session, locationId: string, request: AdministrationAccessRequest, requestId: string): Promise<AdministrationAccessReview> {
  const linked = await currentAdministrationContext(session, locationId)
  const observation = await observeAdministrationAccess(linked, request)
  requireProposedChange(request, observation.baseline)
  const current = await currentAdministrationContext(session, locationId)
  if (current.connectionId !== linked.connectionId || current.googleAccountId !== linked.googleAccountId || current.googleLocationName !== linked.googleLocationName || current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google target changed during review. Refresh before continuing.")
  const payload = reviewedAdministrationPayloadSchema.parse({ request, connectionId: linked.connectionId, credentialGeneration: linked.credentialGeneration, observedAt: observation.observedAt })
  const changeSet = await saveGbpChangeSet({ session, linked: current, resourceType: "administration_access", baseline: observation.baseline, payload, updateMask: [], requestId })
  return projectReview(changeSet, current)
}

export async function readAdministrationAccessReview(session: Session, locationId: string, reviewId: string) {
  const linked = await currentAdministrationContext(session, locationId, false)
  const { changeSet } = await readGbpChangeSet(session, locationId, reviewId, "administration_access")
  return projectReview(changeSet, linked)
}

export async function listAdministrationAccessReviews(session: Session, locationId: string) {
  const linked = await currentAdministrationContext(session, locationId, false)
  const changeSets = await listGbpChangeSets(session, linked, "administration_access")
  return changeSets.map((changeSet) => projectReview(changeSet, linked))
}

export async function assertAdministrationAccessCurrent(session: Session, locationId: string, review: AdministrationAccessReview) {
  const linked = await currentAdministrationContext(session, locationId)
  const payload = reviewedAdministrationPayloadSchema.parse(review.changeSet.payload)
  if (payload.connectionId !== linked.connectionId || payload.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_connection_changed", "The Google connection changed after review. Create a fresh review.")
  const observation = await observeAdministrationAccess(linked, payload.request)
  if (stableGoogleHash(observation.baseline) !== review.changeSet.baselineHash) throw new ApiError(409, "google_baseline_stale", "Google administration changed after review. Refresh and review again.")
  requireProposedChange(payload.request, observation.baseline)
  return { linked, observation, payload }
}

export async function approveAdministrationAccessReview(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string) {
  const review = await readAdministrationAccessReview(session, locationId, reviewId)
  const { linked } = await assertAdministrationAccessCurrent(session, locationId, review)
  const changeSet = await approveGbpChange({ session, locationId, changeSetId: reviewId, expectedPayloadHash, requestId, resourceType: "administration_access" })
  return projectReview(changeSet, linked)
}
