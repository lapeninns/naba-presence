/**
 * Bulk business information and categories (P09-R5): the field-mask patch
 * one change sends to each listing, and the comparisons a preview, a
 * dispatch and a readback decide by. Client-safe and pure.
 *
 * Only fields that make sense to set across many listings are offered, and
 * only fields Google lets a client write (`GOOGLE_LOCATION_FIELDS` support
 * `supported`, lib/domain/google-capabilities.ts). Provider-owned fields
 * (name, metadata, latlng, openInfo.canReopen, the address revision) and
 * per-listing identity (title, address, phone numbers, store code, service
 * area, relationships) are not offered: the contract refuses them, so a
 * batch can never write them. Services are left to the reviewed services
 * editor, which checks them against the listing's categories.
 */
import { z } from "zod"

import { httpUrl } from "@/lib/contracts/http-url"
import {
  isEmptyValue,
  isRecord,
  normalizeText,
  normalizeUri,
} from "@/lib/domain/readback/compare"

/**
 * The business-information fields a batch may change, each with the Google
 * update mask it is sent under. A clear sends the mask with the field left
 * out of the body, which Google reads as "remove this value".
 */
export const BULK_BUSINESS_INFO_FIELDS = {
  websiteUri: { mask: "websiteUri", clearable: true },
  "profile.description": { mask: "profile", clearable: true },
  labels: { mask: "labels", clearable: true },
  "openInfo.status": { mask: "openInfo.status", clearable: false },
} as const
export type BulkBusinessInfoField = keyof typeof BULK_BUSINESS_INFO_FIELDS

const clear = <F extends string>(field: F) =>
  z.strictObject({ field: z.literal(field), action: z.literal("clear") })

/**
 * One field's change: set it to a value, or clear it explicitly. A field
 * that cannot be empty on Google (the open status) has no clear. Closing a
 * listing permanently is not offered in bulk: it cannot be undone from here.
 */
export const bulkBusinessInfoChangeSchema = z.union([
  z.strictObject({
    field: z.literal("websiteUri"),
    action: z.literal("set"),
    value: httpUrl("Website links must use http or https."),
  }),
  clear("websiteUri"),
  z.strictObject({
    field: z.literal("profile.description"),
    action: z.literal("set"),
    value: z.string().trim().min(1).max(750),
  }),
  clear("profile.description"),
  z.strictObject({
    field: z.literal("labels"),
    action: z.literal("set"),
    value: z
      .array(z.string().trim().min(1).max(255))
      .min(1)
      .max(10)
      .refine(
        (labels) => new Set(labels).size === labels.length,
        "Give each label once."
      ),
  }),
  clear("labels"),
  z.strictObject({
    field: z.literal("openInfo.status"),
    action: z.literal("set"),
    value: z.enum(["OPEN", "CLOSED_TEMPORARILY"]),
  }),
])
export type BulkBusinessInfoChange = z.infer<
  typeof bulkBusinessInfoChangeSchema
>

export const bulkBusinessInfoInputSchema = z
  .strictObject({
    operation: z.literal("business_info"),
    changes: z.array(bulkBusinessInfoChangeSchema).min(1).max(4),
  })
  .refine(
    (value) =>
      new Set(value.changes.map((change) => change.field)).size ===
      value.changes.length,
    "Change each field once."
  )
export type BulkBusinessInfoInput = z.infer<typeof bulkBusinessInfoInputSchema>

/** The value of one offered field on a Google location (undefined when unset). */
export function businessInfoFieldValue(
  location: unknown,
  field: BulkBusinessInfoField
): unknown {
  if (!isRecord(location)) return undefined
  switch (field) {
    case "websiteUri":
      return location.websiteUri
    case "profile.description":
      return isRecord(location.profile)
        ? location.profile.description
        : undefined
    case "labels":
      return location.labels
    case "openInfo.status":
      return isRecord(location.openInfo) ? location.openInfo.status : undefined
  }
}

/**
 * The changed fields as the listing holds them, by field (null when unset):
 * what a preview freezes and a dispatch compares, so an edit to a field the
 * batch does not change is never a conflict.
 */
export function businessInfoCurrent(
  input: BulkBusinessInfoInput,
  location: unknown
): Record<string, unknown> {
  return Object.fromEntries(
    input.changes
      .map((change) => change.field)
      .sort()
      .map((field) => [field, businessInfoFieldValue(location, field) ?? null])
  )
}

/** What the listing will hold after the change, in the same shape (null is cleared). */
export function businessInfoProposed(
  input: BulkBusinessInfoInput
): Record<string, unknown> {
  return Object.fromEntries(
    [...input.changes]
      .sort((a, b) => a.field.localeCompare(b.field))
      .map((change) => [
        change.field,
        change.action === "set" ? change.value : null,
      ])
  )
}

/**
 * The PATCH one listing receives: the masks of the changed fields, and a
 * body that carries only the set values. A cleared field is in the mask and
 * absent from the body.
 */
export function businessInfoPatch(input: BulkBusinessInfoInput): {
  updateMask: string[]
  payload: Record<string, unknown>
} {
  const payload: Record<string, unknown> = {}
  for (const change of input.changes) {
    if (change.action !== "set") continue
    switch (change.field) {
      case "websiteUri":
        payload.websiteUri = change.value
        break
      case "profile.description":
        payload.profile = { description: change.value }
        break
      case "labels":
        payload.labels = change.value
        break
      case "openInfo.status":
        payload.openInfo = { status: change.value }
        break
    }
  }
  return {
    updateMask: [
      ...new Set(
        input.changes.map(
          (change) => BULK_BUSINESS_INFO_FIELDS[change.field].mask
        )
      ),
    ].sort(),
    payload,
  }
}

/** Whether a listing shows one change, compared the way Google echoes values. */
export function businessInfoChangeApplied(
  location: unknown,
  change: BulkBusinessInfoChange
): boolean {
  const observed = businessInfoFieldValue(location, change.field)
  if (change.action === "clear") return isEmptyValue(observed)
  switch (change.field) {
    case "websiteUri":
      return normalizeUri(observed) === normalizeUri(change.value)
    case "profile.description":
      return normalizeText(observed) === normalizeText(change.value)
    case "labels":
      return (
        Array.isArray(observed) &&
        observed.length === change.value.length &&
        change.value.every(
          (label, index) => normalizeText(observed[index]) === label
        )
      )
    case "openInfo.status":
      return observed === change.value
  }
}

/** Every change of the input shows on the listing. */
export const businessInfoApplied = (
  location: unknown,
  changes: readonly BulkBusinessInfoChange[]
) => changes.every((change) => businessInfoChangeApplied(location, change))

// --- Categories ---------------------------------------------------------------

const categoryName = z
  .string()
  .regex(
    /^categories\/gcid:[a-z0-9_]{1,100}$/,
    "Use a Google category ID such as categories/gcid:pub."
  )

/**
 * A category change: a new primary category, and/or additional categories
 * to add or remove by stable ID. Additional categories the change does not
 * name stay as each listing has them. Google allows at most 9 additional
 * categories; a listing that would exceed that is skipped.
 */
export const bulkCategoriesInputSchema = z
  .strictObject({
    operation: z.literal("categories"),
    primaryCategory: categoryName.optional(),
    addAdditional: z.array(categoryName).max(9).default([]),
    removeAdditional: z.array(categoryName).max(20).default([]),
  })
  .superRefine((value, context) => {
    if (
      !value.primaryCategory &&
      !value.addAdditional.length &&
      !value.removeAdditional.length
    )
      context.addIssue({
        code: "custom",
        message: "Choose a primary category or categories to add or remove.",
      })
    const named = [...value.addAdditional, ...value.removeAdditional]
    if (new Set(named).size !== named.length)
      context.addIssue({
        code: "custom",
        path: ["addAdditional"],
        message: "Name each category once.",
      })
    if (
      value.primaryCategory &&
      (named.includes(value.primaryCategory) ||
        value.removeAdditional.includes(value.primaryCategory))
    )
      context.addIssue({
        code: "custom",
        path: ["primaryCategory"],
        message:
          "The primary category cannot also be added or removed as an additional one.",
      })
  })
export type BulkCategoriesInput = z.infer<typeof bulkCategoriesInputSchema>

export const BULK_MAX_ADDITIONAL_CATEGORIES = 9

/** A listing's categories by stable ID: what is frozen and compared. */
export type CategoryIds = { primary: string | null; additional: string[] }

export function categoryIds(location: unknown): CategoryIds {
  const categories = isRecord(location) ? location.categories : undefined
  if (!isRecord(categories)) return { primary: null, additional: [] }
  const name = (value: unknown) =>
    isRecord(value) && typeof value.name === "string" ? value.name : null
  return {
    primary: name(categories.primaryCategory),
    additional: (Array.isArray(categories.additionalCategories)
      ? categories.additionalCategories
      : []
    )
      .map(name)
      .filter((value): value is string => value !== null)
      .sort(),
  }
}

/**
 * One listing's categories after the change: the new primary (or the
 * current one), and the current additional categories minus the removed
 * ones plus the added ones. The primary is never also an additional one;
 * a former primary is dropped, not demoted.
 */
export function mergeCategories(
  input: BulkCategoriesInput,
  current: CategoryIds
):
  | { ok: true; categories: CategoryIds }
  | { ok: false; reason: "category_missing" | "too_many_categories" } {
  const primary = input.primaryCategory ?? current.primary
  if (!primary) return { ok: false, reason: "category_missing" }
  const removed = new Set(input.removeAdditional)
  const additional = [
    ...new Set([
      ...current.additional.filter((name) => !removed.has(name)),
      ...input.addAdditional,
    ]),
  ]
    .filter((name) => name !== primary)
    .sort()
  if (additional.length > BULK_MAX_ADDITIONAL_CATEGORIES)
    return { ok: false, reason: "too_many_categories" }
  return { ok: true, categories: { primary, additional } }
}

export const sameCategories = (left: CategoryIds, right: CategoryIds) =>
  left.primary === right.primary &&
  left.additional.length === right.additional.length &&
  [...left.additional]
    .sort()
    .every((name, index) => name === [...right.additional].sort()[index])

/** The `categories` body Google takes under the `categories` mask. */
export function categoriesPayload(categories: CategoryIds) {
  return {
    categories: {
      primaryCategory: { name: categories.primary },
      additionalCategories: categories.additional.map((name) => ({ name })),
    },
  }
}
