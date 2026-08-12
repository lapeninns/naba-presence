// Pure structural diff and match ladder for Google FoodMenus import review.
// IMPORTANT: this module must stay free of node:crypto (and any server-only
// imports) — the publish-preview dialog reuses it in the client bundle.
// Hashing lives in lib/domain/food-menus.ts.
import type { MenuMatchStatus, MenuPatch } from "@/lib/domain/import-review"

type MenuNode = Record<string, unknown>

export type MenuPrice = {
  currencyCode: string | null
  units: string
  nanos: number
}

export type FlatMenuItem = {
  menuIndex: number
  sectionIndex: number
  itemIndex: number
  path: string
  sectionLabel: string
  itemLabel: string
  description: string
  price: MenuPrice | null
  node: MenuNode
}

export type FlatMenuSection = {
  menuIndex: number
  sectionIndex: number
  path: string
  sectionLabel: string
  node: MenuNode
  itemCount: number
}

export type MenuItemIdentity = {
  googlePath: string
  localPath: string
  sectionLabel: string
  itemLabel: string
  priceUnits: string | null
  priceNanos: number | null
}

export type MenuMatch = {
  status: MenuMatchStatus
  confidence: number
  local: FlatMenuItem | null
  google: FlatMenuItem | null
  warnings: string[]
}

export type MenuItemDiff = {
  fields: MenuNode
  changedFields: string[]
  warnings: string[]
}

export type MenuProposalDraft = {
  kind:
    | "item_changed"
    | "item_added_on_google"
    | "item_missing_from_google"
    | "section_added_on_google"
    | "section_missing_from_google"
    | "structure_changed"
  identityKey: string
  googlePath: string | null
  sectionLabel: string | null
  itemLabel: string | null
  matchStatus: MenuMatchStatus | null
  matchConfidence: number | null
  canonicalValue: unknown
  googleValue: unknown
  suggestedPatch: MenuPatch
  warnings: string[]
}

function asNodes(value: unknown): MenuNode[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is MenuNode =>
          Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
      )
    : []
}

function nodeLabel(node: MenuNode): { displayName: string; description: string } {
  const labels = asNodes(node.labels)
  const first = labels[0] ?? {}
  return {
    displayName: typeof first.displayName === "string" ? first.displayName : "",
    description: typeof first.description === "string" ? first.description : "",
  }
}

function nodePrice(node: MenuNode): MenuPrice | null {
  const attributes =
    node.attributes && typeof node.attributes === "object" && !Array.isArray(node.attributes)
      ? (node.attributes as MenuNode)
      : {}
  const price =
    attributes.price && typeof attributes.price === "object" && !Array.isArray(attributes.price)
      ? (attributes.price as MenuNode)
      : null
  if (!price || (price.units === undefined && price.nanos === undefined)) return null
  return {
    currencyCode: typeof price.currencyCode === "string" ? price.currencyCode : null,
    units: String(price.units ?? "0"),
    nanos: typeof price.nanos === "number" ? price.nanos : 0,
  }
}

export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function priceAmount(price: MenuPrice | null): number | null {
  if (!price) return null
  const units = Number.parseInt(price.units, 10)
  if (!Number.isFinite(units)) return null
  return units + price.nanos / 1_000_000_000
}

function pricesClose(left: MenuPrice | null, right: MenuPrice | null): boolean {
  const a = priceAmount(left)
  const b = priceAmount(right)
  if (a === null || b === null) return a === b
  return Math.abs(a - b) <= 0.01
}

export function flattenMenuSections(menus: MenuNode[]): FlatMenuSection[] {
  const sections: FlatMenuSection[] = []
  menus.forEach((menu, menuIndex) => {
    asNodes(menu.sections).forEach((section, sectionIndex) => {
      sections.push({
        menuIndex,
        sectionIndex,
        path: `menus[${menuIndex}].sections[${sectionIndex}]`,
        sectionLabel: nodeLabel(section).displayName,
        node: section,
        itemCount: asNodes(section.items).length,
      })
    })
  })
  return sections
}

export function flattenMenuItems(menus: MenuNode[]): FlatMenuItem[] {
  const items: FlatMenuItem[] = []
  menus.forEach((menu, menuIndex) => {
    asNodes(menu.sections).forEach((section, sectionIndex) => {
      const sectionLabel = nodeLabel(section).displayName
      asNodes(section.items).forEach((item, itemIndex) => {
        const label = nodeLabel(item)
        items.push({
          menuIndex,
          sectionIndex,
          itemIndex,
          path: `menus[${menuIndex}].sections[${sectionIndex}].items[${itemIndex}]`,
          sectionLabel,
          itemLabel: label.displayName,
          description: label.description,
          price: nodePrice(item),
          node: item,
        })
      })
    })
  })
  return items
}

/**
 * Deterministic identity for the partial unique index: one live proposal per
 * identity. Label-based, so a re-raise after an ignore or supersede lands on
 * the same key.
 */
export function identityKeyFor(input: {
  kind: MenuProposalDraft["kind"]
  sectionLabel?: string | null
  itemLabel?: string | null
}): string {
  if (input.kind === "structure_changed") return "structure"
  const section = normalizeLabel(input.sectionLabel ?? "")
  const item = normalizeLabel(input.itemLabel ?? "")
  if (input.kind === "section_added_on_google" || input.kind === "section_missing_from_google") {
    return `section:${section}`
  }
  return `item:${section}:${item}`
}

function labelsMatch(item: FlatMenuItem, identity: MenuItemIdentity): boolean {
  return (
    normalizeLabel(item.sectionLabel) === normalizeLabel(identity.sectionLabel) &&
    normalizeLabel(item.itemLabel) === normalizeLabel(identity.itemLabel)
  )
}

/**
 * The match ladder. Google FoodMenus carry no stable ids, so matching is:
 *   1. previous_identity — a persisted googlePath<->localPath pin, trusted
 *      only after labels re-verify on BOTH sides (positions move silently).
 *   2. label_price — same (section, item) labels and price within 0.01.
 *   3. label_unique — same labels, unique candidate on both sides.
 *   4. unmatched.
 */
export function matchMenuItems(input: {
  canonicalItems: FlatMenuItem[]
  googleItems: FlatMenuItem[]
  identities: MenuItemIdentity[]
}): MenuMatch[] {
  const matches: MenuMatch[] = []
  const usedLocal = new Set<string>()
  const usedGoogle = new Set<string>()
  const localByPath = new Map(input.canonicalItems.map((item) => [item.path, item]))
  const googleByPath = new Map(input.googleItems.map((item) => [item.path, item]))

  // Tier 1: previous identities, re-verified before trust.
  for (const identity of input.identities) {
    const google = googleByPath.get(identity.googlePath)
    const local = localByPath.get(identity.localPath)
    if (!google || !local || usedGoogle.has(google.path) || usedLocal.has(local.path)) continue
    if (!labelsMatch(google, identity) || !labelsMatch(local, identity)) continue
    usedGoogle.add(google.path)
    usedLocal.add(local.path)
    matches.push({ status: "previous_identity", confidence: 1, local, google, warnings: [] })
  }

  const key = (item: FlatMenuItem) =>
    `${normalizeLabel(item.sectionLabel)}:${normalizeLabel(item.itemLabel)}`
  const remainingLocal = input.canonicalItems.filter((item) => !usedLocal.has(item.path))
  const remainingGoogle = input.googleItems.filter((item) => !usedGoogle.has(item.path))
  const localByKey = new Map<string, FlatMenuItem[]>()
  for (const item of remainingLocal) {
    const bucket = localByKey.get(key(item))
    if (bucket) bucket.push(item)
    else localByKey.set(key(item), [item])
  }

  for (const google of remainingGoogle) {
    const candidates = (localByKey.get(key(google)) ?? []).filter(
      (item) => !usedLocal.has(item.path)
    )
    if (candidates.length === 0) continue
    // Tier 2: disambiguate by price.
    const priced = candidates.filter((item) => pricesClose(item.price, google.price))
    if (priced.length === 1) {
      usedGoogle.add(google.path)
      usedLocal.add(priced[0].path)
      matches.push({
        status: "label_price",
        confidence: 0.9,
        local: priced[0],
        google,
        warnings: [],
      })
      continue
    }
    // Tier 3: labels alone, only when unambiguous.
    if (candidates.length === 1) {
      usedGoogle.add(google.path)
      usedLocal.add(candidates[0].path)
      matches.push({
        status: "label_unique",
        confidence: 0.7,
        local: candidates[0],
        google,
        warnings: [],
      })
    }
  }

  for (const google of input.googleItems) {
    if (!usedGoogle.has(google.path)) {
      matches.push({ status: "unmatched", confidence: 0, local: null, google, warnings: [] })
    }
  }
  for (const local of input.canonicalItems) {
    if (!usedLocal.has(local.path)) {
      matches.push({ status: "unmatched", confidence: 0, local, google: null, warnings: [] })
    }
  }
  return matches
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as MenuNode)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entry]) => [entryKey, canonicalize(entry)])
    )
  }
  return value
}

function isEmptyGoogleValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Minimal diff between a matched local and Google item. A field is included
 * only when Google's value is present AND differs; an empty/absent value on
 * Google never blanks local data — it becomes a warning instead.
 *
 * `fields` is a flat record of dotted item paths -> replacement values, merged
 * by applyFoodMenuPatch.
 */
export function diffMenuItem(local: FlatMenuItem, google: FlatMenuItem): MenuItemDiff | null {
  const fields: MenuNode = {}
  const changedFields: string[] = []
  const warnings: string[] = []

  if (google.itemLabel !== local.itemLabel) {
    if (isEmptyGoogleValue(google.itemLabel)) {
      warnings.push("Google removed this item's name; the local name is kept.")
    } else {
      fields["labels.displayName"] = google.itemLabel
      changedFields.push("name")
    }
  }
  if (google.description !== local.description) {
    if (isEmptyGoogleValue(google.description)) {
      warnings.push("Google removed this item's description; the local description is kept.")
    } else {
      fields["labels.description"] = google.description
      changedFields.push("description")
    }
  }
  if (!pricesClose(local.price, google.price) || !jsonEqual(local.price, google.price)) {
    if (google.price === null) {
      if (local.price !== null) {
        warnings.push("Google removed this item's price; the local price is kept.")
      }
    } else if (!jsonEqual(local.price, google.price)) {
      fields["attributes.price"] = {
        currencyCode: google.price.currencyCode ?? local.price?.currencyCode ?? "GBP",
        units: google.price.units,
        nanos: google.price.nanos,
      }
      changedFields.push("price")
    }
  }

  const localAttributes =
    local.node.attributes && typeof local.node.attributes === "object"
      ? (local.node.attributes as MenuNode)
      : {}
  const googleAttributes =
    google.node.attributes && typeof google.node.attributes === "object"
      ? (google.node.attributes as MenuNode)
      : {}
  for (const [attributeKey, googleValue] of Object.entries(googleAttributes)) {
    if (attributeKey === "price") continue
    if (jsonEqual(localAttributes[attributeKey], googleValue)) continue
    if (isEmptyGoogleValue(googleValue)) {
      warnings.push(`Google cleared "${attributeKey}"; the local value is kept.`)
      continue
    }
    fields[`attributes.${attributeKey}`] = googleValue
    changedFields.push(attributeKey)
  }
  for (const attributeKey of Object.keys(localAttributes)) {
    if (attributeKey === "price") continue
    if (!(attributeKey in googleAttributes) && !isEmptyGoogleValue(localAttributes[attributeKey])) {
      warnings.push(`Google no longer reports "${attributeKey}"; the local value is kept.`)
    }
  }

  const localOptions = asNodes(local.node.options)
  const googleOptions = asNodes(google.node.options)
  if (!jsonEqual(localOptions, googleOptions)) {
    if (googleOptions.length === 0 && localOptions.length > 0) {
      warnings.push("Google removed this item's options; the local options are kept.")
    } else if (googleOptions.length > 0) {
      fields.options = googleOptions
      changedFields.push("options")
    }
  }

  if (changedFields.length === 0 && warnings.length === 0) return null
  return { fields, changedFields, warnings }
}

/** Displayed summary values for a proposal row (kept small on purpose). */
function itemSummary(item: FlatMenuItem | null): unknown {
  if (!item) return null
  return {
    sectionLabel: item.sectionLabel,
    itemLabel: item.itemLabel,
    description: item.description || null,
    price: item.price,
  }
}

export function buildFoodMenuProposals(input: {
  canonicalMenus: MenuNode[]
  googleMenus: MenuNode[]
  identities: MenuItemIdentity[]
}): MenuProposalDraft[] {
  // The editor (and publish path) treat the payload as a single menu; a
  // multi-menu payload on either side cannot be reviewed item-by-item with
  // fidelity, so it collapses into one whole-payload proposal.
  if (input.canonicalMenus.length > 1 || input.googleMenus.length > 1) {
    return [
      {
        kind: "structure_changed",
        identityKey: identityKeyFor({ kind: "structure_changed" }),
        googlePath: null,
        sectionLabel: null,
        itemLabel: null,
        matchStatus: null,
        matchConfidence: null,
        canonicalValue: { menus: input.canonicalMenus.length },
        googleValue: { menus: input.googleMenus.length },
        suggestedPatch: { op: "replace_all", menus: input.googleMenus },
        warnings: [
          "This location has more than one Google menu, so changes can only be reviewed as a whole.",
        ],
      },
    ]
  }

  const proposals: MenuProposalDraft[] = []
  const canonicalItems = flattenMenuItems(input.canonicalMenus)
  const googleItems = flattenMenuItems(input.googleMenus)
  const matches = matchMenuItems({ canonicalItems, googleItems, identities: input.identities })

  const canonicalSections = flattenMenuSections(input.canonicalMenus)
  const googleSections = flattenMenuSections(input.googleMenus)
  const canonicalSectionKeys = new Set(
    canonicalSections.map((section) => normalizeLabel(section.sectionLabel))
  )
  const googleSectionKeys = new Set(
    googleSections.map((section) => normalizeLabel(section.sectionLabel))
  )

  // Empty sections cannot be represented by item rows; non-empty added
  // sections are covered by their items' item_added_on_google rows.
  for (const section of googleSections) {
    if (canonicalSectionKeys.has(normalizeLabel(section.sectionLabel))) continue
    if (section.itemCount > 0) continue
    proposals.push({
      kind: "section_added_on_google",
      identityKey: identityKeyFor({
        kind: "section_added_on_google",
        sectionLabel: section.sectionLabel,
      }),
      googlePath: section.path,
      sectionLabel: section.sectionLabel,
      itemLabel: null,
      matchStatus: null,
      matchConfidence: null,
      canonicalValue: null,
      googleValue: { sectionLabel: section.sectionLabel, items: section.itemCount },
      suggestedPatch: {
        op: "insert_section",
        sectionLabel: section.sectionLabel,
        node: section.node,
      },
      warnings: [],
    })
  }
  for (const section of canonicalSections) {
    if (googleSectionKeys.has(normalizeLabel(section.sectionLabel))) continue
    if (section.itemCount > 0) continue
    proposals.push({
      kind: "section_missing_from_google",
      identityKey: identityKeyFor({
        kind: "section_missing_from_google",
        sectionLabel: section.sectionLabel,
      }),
      googlePath: null,
      sectionLabel: section.sectionLabel,
      itemLabel: null,
      matchStatus: null,
      matchConfidence: null,
      canonicalValue: { sectionLabel: section.sectionLabel, items: section.itemCount },
      googleValue: null,
      suggestedPatch: {
        op: "remove_section",
        localPath: section.path,
        sectionLabel: section.sectionLabel,
      },
      warnings: [],
    })
  }

  for (const match of matches) {
    if (match.local && match.google) {
      const diff = diffMenuItem(match.local, match.google)
      if (!diff || diff.changedFields.length === 0) continue
      proposals.push({
        kind: "item_changed",
        identityKey: identityKeyFor({
          kind: "item_changed",
          sectionLabel: match.google.sectionLabel,
          itemLabel: match.google.itemLabel,
        }),
        googlePath: match.google.path,
        sectionLabel: match.google.sectionLabel,
        itemLabel: match.google.itemLabel,
        matchStatus: match.status,
        matchConfidence: match.confidence,
        canonicalValue: itemSummary(match.local),
        googleValue: itemSummary(match.google),
        suggestedPatch: {
          op: "merge_item",
          localPath: match.local.path,
          sectionLabel: match.local.sectionLabel,
          itemLabel: match.local.itemLabel,
          fields: diff.fields,
        },
        warnings: diff.warnings,
      })
      continue
    }
    if (match.google && !match.local) {
      if (!match.google.itemLabel.trim()) continue
      proposals.push({
        kind: "item_added_on_google",
        identityKey: identityKeyFor({
          kind: "item_added_on_google",
          sectionLabel: match.google.sectionLabel,
          itemLabel: match.google.itemLabel,
        }),
        googlePath: match.google.path,
        sectionLabel: match.google.sectionLabel,
        itemLabel: match.google.itemLabel,
        matchStatus: "unmatched",
        matchConfidence: 0,
        canonicalValue: null,
        googleValue: itemSummary(match.google),
        suggestedPatch: {
          op: "insert_item",
          sectionLabel: match.google.sectionLabel,
          node: match.google.node,
        },
        warnings: match.google.price === null ? ["This Google item has no price."] : [],
      })
      continue
    }
    if (match.local && !match.google) {
      proposals.push({
        kind: "item_missing_from_google",
        identityKey: identityKeyFor({
          kind: "item_missing_from_google",
          sectionLabel: match.local.sectionLabel,
          itemLabel: match.local.itemLabel,
        }),
        googlePath: null,
        sectionLabel: match.local.sectionLabel,
        itemLabel: match.local.itemLabel,
        matchStatus: "unmatched",
        matchConfidence: 0,
        canonicalValue: itemSummary(match.local),
        googleValue: null,
        suggestedPatch: {
          op: "remove_item",
          localPath: match.local.path,
          sectionLabel: match.local.sectionLabel,
          itemLabel: match.local.itemLabel,
        },
        warnings: [],
      })
    }
  }
  return proposals
}

export class MenuPatchTargetMissingError extends Error {
  readonly code = "proposal_target_missing"
}

function findSection(
  menus: MenuNode[],
  sectionLabel: string
): { menuIndex: number; sectionIndex: number } | null {
  const target = normalizeLabel(sectionLabel)
  for (let menuIndex = 0; menuIndex < menus.length; menuIndex += 1) {
    const sections = asNodes(menus[menuIndex].sections)
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      if (normalizeLabel(nodeLabel(sections[sectionIndex]).displayName) === target) {
        return { menuIndex, sectionIndex }
      }
    }
  }
  return null
}

function findItem(
  menus: MenuNode[],
  sectionLabel: string,
  itemLabel: string
): { menuIndex: number; sectionIndex: number; itemIndex: number } | null {
  const flat = flattenMenuItems(menus)
  const matchesByLabel = flat.filter(
    (item) =>
      normalizeLabel(item.sectionLabel) === normalizeLabel(sectionLabel) &&
      normalizeLabel(item.itemLabel) === normalizeLabel(itemLabel)
  )
  if (matchesByLabel.length !== 1) return null
  const [only] = matchesByLabel
  return {
    menuIndex: only.menuIndex,
    sectionIndex: only.sectionIndex,
    itemIndex: only.itemIndex,
  }
}

function mergeFieldsIntoItem(item: MenuNode, fields: MenuNode): MenuNode {
  let next: MenuNode = { ...item }
  for (const [fieldKey, value] of Object.entries(fields)) {
    if (fieldKey === "labels.displayName" || fieldKey === "labels.description") {
      const labels = asNodes(next.labels)
      const first: MenuNode = { ...(labels[0] ?? {}) }
      if (fieldKey === "labels.displayName") first.displayName = value
      else first.description = value
      next = { ...next, labels: [first, ...labels.slice(1)] }
    } else if (fieldKey.startsWith("attributes.")) {
      const attributeKey = fieldKey.slice("attributes.".length)
      const attributes =
        next.attributes && typeof next.attributes === "object" && !Array.isArray(next.attributes)
          ? { ...(next.attributes as MenuNode) }
          : {}
      attributes[attributeKey] = value
      next = { ...next, attributes }
    } else {
      next = { ...next, [fieldKey]: value }
    }
  }
  return next
}

function replaceItem(
  menus: MenuNode[],
  location: { menuIndex: number; sectionIndex: number; itemIndex: number },
  replace: (item: MenuNode) => MenuNode | null
): MenuNode[] {
  return menus.map((menu, menuIndex) => {
    if (menuIndex !== location.menuIndex) return menu
    const sections = asNodes(menu.sections)
    return {
      ...menu,
      sections: sections.map((section, sectionIndex) => {
        if (sectionIndex !== location.sectionIndex) return section
        const items = asNodes(section.items)
        const nextItems: MenuNode[] = []
        items.forEach((item, itemIndex) => {
          if (itemIndex !== location.itemIndex) {
            nextItems.push(item)
            return
          }
          const replaced = replace(item)
          if (replaced !== null) nextItems.push(replaced)
        })
        return { ...section, items: nextItems }
      }),
    }
  })
}

/**
 * Applies a decided menu patch to the CURRENT canonical payload. Targets are
 * re-resolved by labels at apply time — the stored localPath is a hint from
 * raise time and the menu may have been edited since.
 */
export function applyFoodMenuPatch(menus: MenuNode[], patch: MenuPatch): MenuNode[] {
  if (patch.op === "replace_all") {
    return patch.menus
  }
  if (patch.op === "insert_section") {
    if (findSection(menus, patch.sectionLabel)) {
      throw new MenuPatchTargetMissingError("The section already exists locally.")
    }
    if (menus.length === 0) return [{ sections: [patch.node] }]
    return menus.map((menu, menuIndex) =>
      menuIndex === 0
        ? { ...menu, sections: [...asNodes(menu.sections), patch.node] }
        : menu
    )
  }
  if (patch.op === "remove_section") {
    const location = findSection(menus, patch.sectionLabel)
    if (!location) {
      throw new MenuPatchTargetMissingError("The section no longer exists locally.")
    }
    return menus.map((menu, menuIndex) =>
      menuIndex === location.menuIndex
        ? {
            ...menu,
            sections: asNodes(menu.sections).filter(
              (_, sectionIndex) => sectionIndex !== location.sectionIndex
            ),
          }
        : menu
    )
  }
  if (patch.op === "insert_item") {
    const location = findSection(menus, patch.sectionLabel)
    if (location) {
      return menus.map((menu, menuIndex) => {
        if (menuIndex !== location.menuIndex) return menu
        const sections = asNodes(menu.sections)
        return {
          ...menu,
          sections: sections.map((section, sectionIndex) =>
            sectionIndex === location.sectionIndex
              ? { ...section, items: [...asNodes(section.items), patch.node] }
              : section
          ),
        }
      })
    }
    // Section absent locally: create it alongside the new item.
    const newSection: MenuNode = {
      labels: [{ displayName: patch.sectionLabel }],
      items: [patch.node],
    }
    if (menus.length === 0) return [{ sections: [newSection] }]
    return menus.map((menu, menuIndex) =>
      menuIndex === 0
        ? { ...menu, sections: [...asNodes(menu.sections), newSection] }
        : menu
    )
  }
  if (patch.op === "remove_item") {
    const location = findItem(menus, patch.sectionLabel, patch.itemLabel)
    if (!location) {
      throw new MenuPatchTargetMissingError("The menu item no longer exists locally.")
    }
    return replaceItem(menus, location, () => null)
  }
  // merge_item
  const location = findItem(menus, patch.sectionLabel, patch.itemLabel)
  if (!location) {
    throw new MenuPatchTargetMissingError("The menu item no longer exists locally.")
  }
  return replaceItem(menus, location, (item) => mergeFieldsIntoItem(item, patch.fields))
}

/**
 * Locates a single item by its (section, item) labels in the current payload,
 * or null when absent or ambiguous. Used to re-derive identity pins after an
 * applied decision.
 */
export function locateMenuItem(
  menus: MenuNode[],
  sectionLabel: string,
  itemLabel: string
): FlatMenuItem | null {
  const matches = flattenMenuItems(menus).filter(
    (item) =>
      normalizeLabel(item.sectionLabel) === normalizeLabel(sectionLabel) &&
      normalizeLabel(item.itemLabel) === normalizeLabel(itemLabel)
  )
  return matches.length === 1 ? matches[0] : null
}

/**
 * Identity pins derived from an in-sync or just-published payload: canonical
 * and Google payloads are identical at that moment, so local and Google paths
 * coincide.
 */
export function identitiesFromAlignedMenus(menus: MenuNode[]): MenuItemIdentity[] {
  return flattenMenuItems(menus).map((item) => ({
    googlePath: item.path,
    localPath: item.path,
    sectionLabel: item.sectionLabel,
    itemLabel: item.itemLabel,
    priceUnits: item.price?.units ?? null,
    priceNanos: item.price?.nanos ?? null,
  }))
}
