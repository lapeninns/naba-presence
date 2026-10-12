import "server-only"

import {
  mergeAttributes,
  type AttributeValue,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import {
  googleAttributesMatch,
  unsupportedAttributeNames,
} from "@/lib/domain/google-attributes"
import { comparisonHash } from "@/lib/server/bulk-families/compare"
import {
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type {
  BulkFamily,
  ProposedCategories,
} from "@/lib/server/bulk-families/types"
import { runBulkWrite } from "@/lib/server/bulk-families/write-attempts"
import type { GbpLocationContext } from "@/lib/server/gbp-management"
import {
  getGoogleLocationAttributes,
  listGoogleAttributeMetadata,
  patchGoogleLocationAttributes,
} from "@/lib/server/google"

type AttributesInput = Extract<BulkOperationInput, { operation: "attributes" }>

async function readAttributes(linked: GbpLocationContext) {
  return getGoogleLocationAttributes(
    await linked.accessToken(),
    linked.googleLocationName,
    { connectionKey: linked.connectionId }
  )
}

/**
 * Every attribute metadata page Google offers (at most 20 pages): for the
 * listing, or for the primary category a batch's earlier category change
 * gives it (in the listing's region).
 */
async function readAttributeMetadata(
  linked: GbpLocationContext,
  categories?: ProposedCategories
) {
  const token = await linked.accessToken(),
    options = { connectionKey: linked.connectionId }
  const scope = categories
    ? {
        categoryName: categories.primary,
        regionCode: categories.regionCode,
        languageCode: categories.languageCode,
      }
    : { locationName: linked.googleLocationName }
  const metadata: Array<Record<string, unknown>> = []
  let pageToken: string | undefined
  for (let page = 0; page < 20; page += 1) {
    const response = await listGoogleAttributeMetadata(
      token,
      { ...scope, pageToken },
      options
    )
    metadata.push(...(response.attributeMetadata ?? []))
    pageToken = response.nextPageToken || undefined
    if (!pageToken) break
  }
  return metadata
}

/** The named attributes of a listing, sorted: what a preview freezes and a dispatch compares. */
function named(observed: Record<string, unknown>, names: ReadonlySet<string>) {
  return (
    (Array.isArray(observed.attributes)
      ? observed.attributes
      : []) as AttributeValue[]
  )
    .filter((attribute) => names.has(attribute.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Attributes by stable ID (`attributes/<name>`). The listing's attribute
 * metadata must offer each one and accept the typed value; already applied,
 * and the readback, use the attribute editor's comparison
 * (`googleAttributesMatch`), where `[false]` is an answer and a masked name
 * left out is a clear.
 */
export const attributesFamily: BulkFamily<AttributesInput> = {
  operations: ["attributes"],
  resourceKey: "attributes",
  writeSurface: "profileWrites",
  accountLock: false,
  async plan(input, linked, reads) {
    // Under an earlier category change of the batch at this listing (which
    // this change waits for), the attributes its new primary category offers.
    const categories = reads.proposed<ProposedCategories>("categories")
    const [observed, metadata] = await Promise.all([
      reads.once("attributes:values", () => readAttributes(linked)),
      reads.once(
        categories
          ? `attributes:metadata:${categories.primary}:${categories.regionCode}`
          : "attributes:metadata",
        () => readAttributeMetadata(linked, categories)
      ),
    ])
    // Metadata `parent` is the attribute's own name, e.g. "attributes/has_wifi".
    const offered = new Set<string>()
    for (const item of metadata)
      if (typeof item.parent === "string" && item.deprecated !== true)
        offered.add(item.parent)
    const names = new Set(input.changes.map((change) => change.name))
    const current = named(observed, names)
    const merged = mergeAttributes(input, current, offered)
    if ("skip" in merged)
      return {
        eligible: false,
        reason: merged.skip ?? "attribute_not_offered",
        current,
      }
    if (
      unsupportedAttributeNames(metadata, merged.proposed, merged.attributeMask)
        .length
    )
      return {
        eligible: false,
        reason: "attribute_value_not_supported",
        current,
      }
    if (googleAttributesMatch(observed, merged.proposed, merged.attributeMask))
      return { eligible: false, reason: "already_applied", current }
    return {
      eligible: true,
      current,
      proposed: merged.proposed,
      updateMask: merged.attributeMask,
    }
  },
  async dispatch(context) {
    const { linked } = context
    const attributes = context.proposed as Array<Record<string, unknown>>
    const mask = context.updateMask
    const names = new Set(mask)
    let observed: Record<string, unknown>
    try {
      observed = await readAttributes(linked)
    } catch (error) {
      return outcomeOfThrownWrite(
        context.organisationId,
        context.intentId,
        error
      )
    }
    const current = named(observed, names)
    if (googleAttributesMatch(observed, attributes, mask))
      return { kind: "succeeded", confirmation: "confirmed", observed: current }
    if (comparisonHash(current) !== comparisonHash(context.current))
      return {
        kind: "conflict",
        code: "google_baseline_changed",
        observed: current,
      }
    if (!context.stillOpen()) return { kind: "expired" }
    return runBulkWrite(context, {
      family: "attributes",
      surface: "attributes",
      action: "update",
      writeSurface: "profileWrites",
      intended: { attributes, attributeMask: mask },
      mutate: async () => {
        const token = await linked.accessToken()
        return patchGoogleLocationAttributes(
          token,
          {
            locationName: linked.googleLocationName,
            attributeMask: [...mask],
            attributes,
          },
          { connectionKey: linked.connectionId }
        )
      },
      read: () => readAttributes(linked),
      verify: (readback) => googleAttributesMatch(readback, attributes, mask),
    })
  },
  reconcile: reconcileFromReceipt,
}
