import "server-only"
import { z } from "zod"
import type { ReviewedPlaceActionRequest } from "@/lib/contracts/place-action-review"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import { placeActionBaselineSchema } from "@/lib/contracts/place-action-observation"
import { withTenant } from "@/lib/server/db"
import { resolveGbpLocationContext, stableGoogleHash } from "@/lib/server/gbp-management"
import { requireGbpWrite } from "@/lib/server/gbp-write"
import { getServerEnv } from "@/lib/server/env"
import { listGooglePlaceActionLinks } from "@/lib/server/google"
import { listGooglePlaceActionMetadata } from "@/lib/server/google/place-action-metadata"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

export { placeActionBaselineSchema }
export async function currentPlaceActionContext(session: Session, locationId: string, requireWrite = true) {
  return withTenant(session.organisationId, async (sql) => {
    const linked = await resolveGbpLocationContext(sql, session, locationId)
    if (!["owner", "admin"].includes(session.role) || (requireWrite && !linked.canPublish)) throw new ApiError(403, "publish_not_allowed", "Only an authorised owner or administrator can change this listing's action links.")
    const [connection] = await sql<{ generation: number; status: string; active: boolean }[]>`
      select c.credential_generation as generation, c.status, a.is_active as active
      from google_connection c join google_account a on a.google_connection_id = c.id
      where c.id = ${linked.connectionId} and a.id = ${linked.googleAccountId}`
    if (!connection || !connection.active || !["active", "expired"].includes(connection.status)) throw new ApiError(409, "google_reconnect_required", "Reconnect the linked Google account before checking action links.")
    if (requireWrite) requireGbpWrite(getServerEnv(), "placeActions", { status: 503, code: "place_actions_paused", message: "Place Action writes are paused." })
    return { ...linked, credentialGeneration: connection.generation }
  })
}
export async function observePlaceActions(linked: Awaited<ReturnType<typeof currentPlaceActionContext>>) {
  const token = await linked.accessToken(), options = { connectionKey: linked.connectionId }
  const metadata = await listGooglePlaceActionMetadata(token, linked.googleLocationName, options)
  const { links, unsupportedLinks } = await listGooglePlaceActionLinks(token, linked.googleLocationName, options)
  const baseline = placeActionBaselineSchema.parse({ collection: `${linked.googleLocationName}/placeActionLinks`,
    supportedTypes: [...metadata.supportedTypes].sort(), unsupportedTypes: [...metadata.unsupportedTypes].sort(),
    links: [...links].sort((a, b) => a.name.localeCompare(b.name)),
    unsupportedLinks: [...unsupportedLinks].sort((a, b) => a.name.localeCompare(b.name)) })
  const names = [...links, ...unsupportedLinks].map((link) => link.name)
  if (new Set(names).size !== names.length || names.some((name) => !name.startsWith(`${baseline.collection}/`))) throw new ApiError(502, "place_action_observation_unreadable", "Google returned duplicate or unrelated action links. Refresh before reviewing a change.")
  return { baseline, observedAt: new Date().toISOString() }
}
export function requirePlaceActionProposal(request: ReviewedPlaceActionRequest, baseline: z.infer<typeof placeActionBaselineSchema>) {
  if (request.operation !== "delete" && !baseline.supportedTypes.includes(request.payload.placeActionType)) throw new ApiError(409, "place_action_not_supported", "Google no longer offers this action type for this listing. Refresh or continue in Google.")
  if (request.operation === "create") {
    if (baseline.links.some((link) => link.uri === request.payload.uri && link.placeActionType === request.payload.placeActionType)) throw new ApiError(409, "place_action_already_present", "Google already lists this action link. Review its existing values instead.")
    return
  }
  if (baseline.unsupportedLinks.some((row) => row.name === request.name)) throw new ApiError(409, "place_action_not_editable", "Google uses an action type for this link that NabaPresence cannot edit. Manage it in Google.")
  const link = baseline.links.find((row) => row.name === request.name)
  if (!link) throw new ApiError(409, "place_action_target_missing", "Google no longer lists this action link. Refresh before continuing.")
  if (!link.isEditable) throw new ApiError(409, "place_action_not_editable", "Google reports that this provider link cannot be changed by the merchant.")
  if (request.operation === "update" && matchesPlaceAction(link, request.payload)) throw new ApiError(409, "place_action_no_change", "Google already reports these action link values.")
}
export function matchesPlaceAction(link: unknown, payload: z.infer<typeof placeActionInputSchema>) {
  const parsed = placeActionInputSchema.safeParse(link)
  return parsed.success && stableGoogleHash(parsed.data) === stableGoogleHash(payload)
}
export function placeActionPostcondition(request: ReviewedPlaceActionRequest, baseline: z.infer<typeof placeActionBaselineSchema>, current: z.infer<typeof placeActionBaselineSchema>) {
  if (current.collection !== baseline.collection) return false
  if (request.operation === "delete") return ![...current.links, ...current.unsupportedLinks].some((link) => link.name === request.name)
  if (request.operation === "update") return current.links.some((link) => link.name === request.name && link.isEditable && matchesPlaceAction(link, request.payload))
  const prior = new Set([...baseline.links, ...baseline.unsupportedLinks].map((link) => link.name))
  return current.links.filter((link) => !prior.has(link.name) && link.isEditable && matchesPlaceAction(link, request.payload)).length === 1
}
