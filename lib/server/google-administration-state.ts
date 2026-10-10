import "server-only"
import { z } from "zod"
import type { AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"
import { googleAdminNameSchema, googleInvitationNameSchema } from "@/lib/contracts/google-administration-review"
import { administrationAccessTarget } from "@/lib/domain/google-administration"
import { withTenant } from "@/lib/server/db"
import { resolveGbpLocationContext } from "@/lib/server/gbp-management"
import { googleAccountManagementApi } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const adminSchema = z.looseObject({ name: googleAdminNameSchema, admin: z.string().optional(), account: z.string().optional(), role: z.string().optional(), pendingInvitation: z.boolean().optional() })
const invitationSchema = z.looseObject({ name: googleInvitationNameSchema, role: z.string().optional(), targetType: z.string().optional(), targetAccount: z.record(z.string(), z.unknown()).optional(), targetLocation: z.record(z.string(), z.unknown()).optional() })
export const administrationBaselineSchema = z.object({ collection: z.string(), rows: z.array(z.record(z.string(), z.unknown())) })

export async function currentAdministrationContext(session: Session, locationId: string, requireConnection = true) {
  return withTenant(session.organisationId, async (sql) => {
    const linked = await resolveGbpLocationContext(sql, session, locationId)
    if (session.role !== "owner" && session.role !== "admin") throw new ApiError(403, "administration_access_denied", "Only an owner or administrator can manage Google access.")
    if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot manage this location's Google access.")
    const [connection] = await sql<{ generation: number; status: string; active: boolean }[]>`
      select c.credential_generation as generation, c.status, a.is_active as active
      from google_connection c join google_account a on a.google_connection_id = c.id
      where c.id = ${linked.connectionId} and a.id = ${linked.googleAccountId}
    `
    if (!connection || (requireConnection && (!connection.active || !["active", "expired"].includes(connection.status)))) throw new ApiError(409, "google_reconnect_required", "Reconnect the linked Google account before checking administration.")
    return { ...linked, credentialGeneration: connection.generation }
  })
}

export function scopedAdministrationTarget(request: AdministrationAccessRequest, linked: Awaited<ReturnType<typeof currentAdministrationContext>>) {
  try { return administrationAccessTarget(request, linked) }
  catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw new ApiError(409, "administration_target_changed", "The administrator or invitation is outside this listing's linked Google target.")
  }
}

export async function observeAdministrationAccess(linked: Awaited<ReturnType<typeof currentAdministrationContext>>, request: AdministrationAccessRequest) {
  const target = scopedAdministrationTarget(request, linked)
  const response = await googleAccountManagementApi(await linked.accessToken(), { path: target.collection }, { connectionKey: linked.connectionId })
  const invitations = request.operation === "accept_invitation" || request.operation === "decline_invitation"
  const key = invitations ? "invitations" : target.resourceType === "account_admin" ? "accountAdmins" : "admins"
  const otherKey = target.resourceType === "account_admin" ? "admins" : "accountAdmins"
  if (!invitations && response && Object.hasOwn(response, otherKey)) throw new ApiError(409, "administration_observation_unreadable", "Google administration returned a different collection shape.")
  const parsed = z.looseObject({ [key]: z.array(invitations ? invitationSchema : adminSchema).default([]) }).safeParse(response)
  if (!parsed.success) throw new ApiError(409, "administration_observation_unreadable", "Google administration could not be read safely. Refresh or continue in Google.")
  const rows = parsed.data[key]
  if (!Array.isArray(rows)) throw new ApiError(409, "administration_observation_unreadable", "Google administration returned an unknown collection.")
  const names = rows.map((row) => row.name)
  if (new Set(names).size !== names.length || rows.some((row) => !row.name.startsWith(`${target.collection}/`))) throw new ApiError(409, "administration_observation_unreadable", "Google administration returned duplicate or unrelated identities.")
  return { target, baseline: { collection: target.collection, rows: [...rows].sort((left, right) => left.name.localeCompare(right.name)) }, observedAt: new Date().toISOString() }
}
