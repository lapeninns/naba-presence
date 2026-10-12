/**
 * Bulk action links by stable identity (plan P09: "explicit
 * add/update/delete by stable identity"). A listing's link is found by its
 * action type and addressed by its Google link name; a URI is content to
 * compare, never the key. Pure and client-safe.
 */
import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import { normalizeUri } from "@/lib/domain/readback/compare"

export type PlaceLink = {
  name: string
  uri: string
  isPreferred: boolean
  isEditable: boolean
}

type LinkPayload = {
  uri: string
  placeActionType: string
  isPreferred: boolean
}

/** What a child sends: create, or update / delete one named link. */
export type PlaceActionPlan =
  | { create: LinkPayload }
  | { update: string; payload: LinkPayload }
  | { delete: string }

/** The links of one action type, in the shape a preview freezes. */
export function placeActionState(
  links: ReadonlyArray<PlaceLink & { placeActionType: string }>,
  type: string
): PlaceLink[] {
  return links
    .filter((link) => link.placeActionType === type)
    .map((link) => ({
      name: link.name,
      uri: link.uri,
      isPreferred: link.isPreferred,
      isEditable: link.isEditable,
    }))
}

export type PlaceActionDecision =
  { plan: PlaceActionPlan; updateMask: string[] } | { skip: string }

/**
 * The listing's link of the type: none (create, or nothing to delete), one
 * editable one (update or delete it by name), or several editable ones,
 * which is skipped rather than guessed at. A provider-owned link is never
 * changed.
 */
export function planPlaceAction(
  input: Extract<BulkOperationInput, { operation: "place_action" }>,
  links: readonly PlaceLink[],
  supportedTypes: readonly string[]
): PlaceActionDecision {
  const editable = links.filter((link) => link.isEditable)
  if (editable.length > 1) return { skip: "multiple_links_for_type" }
  const [existing] = editable
  if (input.action === "delete") {
    if (!existing)
      return { skip: links.length ? "provider_owned" : "link_not_found" }
    return { plan: { delete: existing.name }, updateMask: [existing.name] }
  }
  if (!supportedTypes.includes(input.placeActionType))
    return { skip: "action_type_not_supported" }
  const payload = {
    uri: input.uri ?? "",
    placeActionType: input.placeActionType,
    isPreferred: input.isPreferred,
  }
  if (!existing) return { plan: { create: payload }, updateMask: [] }
  if (
    normalizeUri(existing.uri) === normalizeUri(payload.uri) &&
    existing.isPreferred === payload.isPreferred
  )
    return { skip: "already_applied" }
  return {
    plan: { update: existing.name, payload },
    updateMask: [existing.name],
  }
}

const shows = (link: PlaceLink, payload: LinkPayload) =>
  normalizeUri(link.uri) === normalizeUri(payload.uri) &&
  link.isPreferred === payload.isPreferred

/**
 * Whether the listing's links of the type show the plan: the named link
 * gone or carrying the payload, or, for a create, an editable link with a
 * name the listing did not have before (`priorNames`) carrying it.
 */
export function placeActionApplied(
  links: readonly PlaceLink[],
  plan: PlaceActionPlan,
  priorNames: readonly string[]
): boolean {
  if ("delete" in plan) return !links.some((link) => link.name === plan.delete)
  if ("update" in plan)
    return links.some(
      (link) => link.name === plan.update && shows(link, plan.payload)
    )
  const prior = new Set(priorNames)
  return links.some(
    (link) =>
      link.isEditable && !prior.has(link.name) && shows(link, plan.create)
  )
}
