import "server-only"

import {
  mergeAttributes,
  mergeHours,
  type AttributeValue,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import type { GbpLocationContext } from "@/lib/server/gbp-management"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import {
  createGooglePlaceActionLink,
  deleteGooglePlaceActionLink,
  getGoogleLocation,
  getGoogleLocationAttributes,
  listGoogleAttributeMetadata,
  listGooglePlaceActionLinks,
  patchGoogleLocationAttributes,
  patchGoogleLocationHours,
  patchGooglePlaceActionLink,
} from "@/lib/server/google"
import { listGooglePlaceActionMetadata } from "@/lib/server/google/place-action-metadata"
import { unsupportedAttributeNames } from "@/lib/domain/google-attributes"
import type { GooglePlaceActionType } from "@/lib/domain/google-contract"

/** What one listing's preview froze, and what a child re-reads to decide. */
export type TargetPlan =
  | {
      eligible: true
      current: unknown
      proposed: unknown
      updateMask: string[]
    }
  | { eligible: false; reason: string; current?: unknown }

type HoursField = "regularHours" | "specialHours" | "moreHours"
const TIME_KEYS = new Set(["openTime", "closeTime"])

/** Google omits zero fields (`{hours: 9}` for 09:00) and `closed: false`; compare values, not spellings. */
export function normaliseForComparison(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .map(normaliseForComparison)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (!value || typeof value !== "object") return value
  const entries = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, entry]): Array<[string, unknown]> => {
      if (entry === undefined || entry === null) return []
      if (TIME_KEYS.has(key) && typeof entry === "object") {
        const time = entry as { hours?: number; minutes?: number }
        return [[key, { hours: time.hours ?? 0, minutes: time.minutes ?? 0 }]]
      }
      if (key === "closed") return entry === true ? [[key, true]] : []
      return [[key, normaliseForComparison(entry)]]
    }
  )
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}
export const comparisonHash = (value: unknown) =>
  stableGoogleHash(normaliseForComparison(value))

type PlaceLink = {
  name: string
  uri: string
  placeActionType: string
  isPreferred: boolean
  isEditable: boolean
}
const placeState = (links: readonly PlaceLink[], type: string) =>
  links
    .filter((link) => link.placeActionType === type)
    .map((link) => ({
      name: link.name,
      uri: link.uri,
      isPreferred: link.isPreferred,
      isEditable: link.isEditable,
    }))

/** The part of the listing a bulk operation reads and compares. */
export async function readRelevant(
  input: BulkOperationInput,
  linked: GbpLocationContext
): Promise<{
  state: unknown
  offered?: Set<string>
  metadata?: unknown[]
  supportedTypes?: string[]
}> {
  const token = await linked.accessToken(),
    options = { connectionKey: linked.connectionId }
  if (input.operation === "attributes") {
    const current = await getGoogleLocationAttributes(
      token,
      linked.googleLocationName,
      options
    )
    // Metadata `parent` is the attribute's own name, e.g. "attributes/has_wifi".
    const offered = new Set<string>(),
      metadata: unknown[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 20; page += 1) {
      const response = await listGoogleAttributeMetadata(
        token,
        { locationName: linked.googleLocationName, pageToken },
        options
      )
      for (const item of response.attributeMetadata ?? []) {
        metadata.push(item)
        if (typeof item.parent === "string" && item.deprecated !== true)
          offered.add(item.parent)
      }
      pageToken = response.nextPageToken || undefined
      if (!pageToken) break
    }
    const attributes = (
      Array.isArray(current.attributes) ? current.attributes : []
    ) as AttributeValue[]
    const names = new Set(input.changes.map((change) => change.name))
    return {
      state: attributes.filter((attribute) => names.has(attribute.name)),
      offered,
      metadata,
    }
  }
  if (input.operation === "place_action") {
    const [metadata, collection] = await Promise.all([
      listGooglePlaceActionMetadata(token, linked.googleLocationName, options),
      listGooglePlaceActionLinks(token, linked.googleLocationName, options),
    ])
    return {
      state: placeState(collection.links, input.placeActionType),
      supportedTypes: metadata.supportedTypes,
    }
  }
  const location = await getGoogleLocation(
    token,
    linked.googleLocationName,
    ["regularHours", "specialHours", "moreHours", "categories"],
    options
  )
  return { state: location }
}

/** A listing's frozen plan: eligibility, current value, merged value and update mask. */
export async function planTarget(
  input: BulkOperationInput,
  linked: GbpLocationContext
): Promise<TargetPlan> {
  const read = await readRelevant(input, linked)
  if (input.operation === "attributes") {
    const merged = mergeAttributes(
      input,
      read.state as AttributeValue[],
      read.offered ?? new Set()
    )
    if ("skip" in merged)
      return {
        eligible: false,
        reason: merged.skip ?? "attribute_not_offered",
        current: read.state,
      }
    if (unsupportedAttributeNames(read.metadata ?? [], merged.proposed, merged.attributeMask).length)
      return { eligible: false, reason: "attribute_value_not_supported", current: merged.current }
    if (comparisonHash(merged.current) === comparisonHash(merged.proposed))
      return {
        eligible: false,
        reason: "already_applied",
        current: merged.current,
      }
    return {
      eligible: true,
      current: merged.current,
      proposed: merged.proposed,
      updateMask: merged.attributeMask,
    }
  }
  if (input.operation === "place_action") {
    const links = read.state as ReturnType<typeof placeState>
    if (input.action === "delete") {
      const target = links.find((link) => link.uri === input.uri)
      if (!target)
        return { eligible: false, reason: "link_not_found", current: links }
      if (!target.isEditable)
        return { eligible: false, reason: "provider_owned", current: links }
      return {
        eligible: true,
        current: links,
        proposed: { delete: target.name },
        updateMask: [target.name],
      }
    }
    if (!(read.supportedTypes ?? []).includes(input.placeActionType))
      return {
        eligible: false,
        reason: "action_type_not_supported",
        current: links,
      }
    const existing = links.find(
      (link) => link.uri === input.uri && link.isEditable
    )
    if (existing?.isPreferred === input.isPreferred)
      return { eligible: false, reason: "already_applied", current: links }
    const payload = {
      uri: input.uri,
      placeActionType: input.placeActionType,
      isPreferred: input.isPreferred,
    }
    return existing
      ? {
          eligible: true,
          current: links,
          proposed: { update: existing.name, payload },
          updateMask: [existing.name],
        }
      : {
          eligible: true,
          current: links,
          proposed: { create: payload },
          updateMask: [],
        }
  }
  const location = read.state as Record<string, unknown>
  const merged = mergeHours(input, location)
  if ("skip" in merged) return { eligible: false, reason: merged.skip }
  if (comparisonHash(merged.current) === comparisonHash(merged.proposed))
    return {
      eligible: false,
      reason: "already_applied",
      current: merged.current,
    }
  return {
    eligible: true,
    current: merged.current,
    proposed: merged.proposed,
    updateMask: [merged.updateMask],
  }
}

/** The relevant current value in the same shape `planTarget` froze as `current`. */
export async function currentFor(
  input: BulkOperationInput,
  linked: GbpLocationContext,
  updateMask: readonly string[]
) {
  const read = await readRelevant(input, linked)
  if (input.operation === "attributes" || input.operation === "place_action")
    return read.state
  return (
    (read.state as Record<string, unknown>)[updateMask[0] as HoursField] ??
    (updateMask[0] === "moreHours" ? [] : {})
  )
}

/** Whether this listing already shows the proposed change. */
export function isApplied(
  input: BulkOperationInput,
  current: unknown,
  proposed: unknown
) {
  if (input.operation !== "place_action")
    return comparisonHash(current) === comparisonHash(proposed)
  const links = current as ReturnType<typeof placeState>,
    plan = proposed as {
      create?: { uri: string; isPreferred: boolean }
      update?: string
      delete?: string
      payload?: { isPreferred: boolean }
    }
  if (plan.delete) return !links.some((link) => link.name === plan.delete)
  if (plan.update)
    return links.some(
      (link) =>
        link.name === plan.update &&
        link.isPreferred === plan.payload?.isPreferred
    )
  return links.some(
    (link) =>
      link.isEditable &&
      link.uri === plan.create?.uri &&
      link.isPreferred === plan.create?.isPreferred
  )
}

/** The single provider write for one child. */
export async function applyTarget(
  input: BulkOperationInput,
  linked: GbpLocationContext,
  proposed: unknown,
  updateMask: readonly string[]
) {
  const token = await linked.accessToken(),
    options = { connectionKey: linked.connectionId }
  if (input.operation === "attributes") {
    return patchGoogleLocationAttributes(
      token,
      {
        locationName: linked.googleLocationName,
        attributeMask: [...updateMask],
        attributes: proposed as Array<Record<string, unknown>>,
      },
      options
    )
  }
  if (input.operation === "place_action") {
    const plan = proposed as {
      create?: { uri: string; placeActionType: string; isPreferred: boolean }
      update?: string
      delete?: string
      payload?: { uri: string; placeActionType: string; isPreferred: boolean }
    }
    if (plan.delete)
      return deleteGooglePlaceActionLink(token, plan.delete, options)
    if (plan.update && plan.payload)
      return patchGooglePlaceActionLink(
        token,
        {
          name: plan.update,
          payload: {
            ...plan.payload,
            placeActionType: plan.payload
              .placeActionType as GooglePlaceActionType,
          },
        },
        options
      )
    const create = plan.create!
    return createGooglePlaceActionLink(
      token,
      {
        locationName: linked.googleLocationName,
        payload: {
          ...create,
          placeActionType: create.placeActionType as GooglePlaceActionType,
        },
      },
      options
    )
  }
  const field = updateMask[0] as HoursField
  return patchGoogleLocationHours(
    token,
    {
      locationName: linked.googleLocationName,
      updateMask: [field],
      validateOnly: false,
      payload: { [field]: proposed },
    },
    options
  )
}
