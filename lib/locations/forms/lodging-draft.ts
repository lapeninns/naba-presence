import { lodgingSchema } from "@/lib/contracts/google-lodging"
import type { z } from "zod"
import { LODGING_EDITOR_GROUPS, LODGING_FIELD_GUIDANCE, lodgingCataloguePath, lodgingEditorCoverage, lodgingFieldLabel, type LodgingEditorNode } from "./lodging-catalogue"

const coverage = lodgingEditorCoverage()
const TYPE_GUIDANCE: Readonly<Record<string, string>> = {
  int: "enter a whole number", number: "enter a number", string: "enter text",
  boolean: "choose Yes or No", array: "add items to this list", object: "fill in or clear these details",
}

/** Where an issue is shown: a time component reports on its single time control. */
function issueKey(path: readonly PropertyKey[]) {
  const parent = path.slice(0, -1)
  return parent.length && coverage.get(lodgingCataloguePath(parent))?.kind === "time" ? parent.map(String).join(".") : path.map(String).join(".")
}

function correction(issue: z.core.$ZodIssue, payload: unknown): string {
  const parent = issue.path.slice(0, -1), timeNode = parent.length ? coverage.get(lodgingCataloguePath(parent)) : undefined
  if (timeNode?.kind === "time") return `${timeNode.label}: enter a time between 00:00 and 23:59.`
  const node = coverage.get(lodgingCataloguePath(issue.path)), key = issue.path.at(-1)
  const label = node && node.key !== "item" ? node.label : typeof key === "string" ? lodgingFieldLabel(key) : parent.length ? coverage.get(lodgingCataloguePath(parent))?.label ?? "This detail" : "This detail"
  const guidance = node ? LODGING_FIELD_GUIDANCE[node.path] : undefined
  const missing = issue.path.reduce<unknown>((current, part) => current !== null && typeof current === "object" && Object.hasOwn(current, part) ? Reflect.get(current, part) : undefined, payload) === undefined
  if (issue.code === "custom") return issue.message
  if (guidance && (missing || issue.code === "too_small" || issue.code === "invalid_type")) return guidance.missing
  if (issue.code === "invalid_type" && missing) return `${label}: ${node?.kind === "enum" ? "choose one of the listed options" : node?.kind === "boolean" ? "choose Yes or No" : "this detail is required"}.`
  if (issue.code === "too_big") return `${label} must be ${issue.inclusive ? "at most" : "less than"} ${issue.maximum}.`
  if (issue.code === "too_small") {
    if (issue.origin === "string") return `${label}: enter a value or remove it.`
    if (issue.origin === "array") return `${label}: add at least ${issue.minimum} ${issue.minimum === 1 ? "item" : "items"}.`
    return `${label} must be ${issue.inclusive ? "at least" : "greater than"} ${issue.minimum}.`
  }
  if (issue.code === "invalid_type") return `${label}: ${node?.kind === "integer" ? TYPE_GUIDANCE.int : TYPE_GUIDANCE[issue.expected] ?? "enter a value this detail accepts"}.`
  if (issue.code === "invalid_value") return `${label}: choose one of the listed options.`
  if (issue.code === "unrecognized_keys") return "Remove unsupported fields or review this item in Google before changing it."
  return `${label}: correct this value before preparing a review.`
}

export function lodgingRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

export function lodgingValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined
    return Object.hasOwn(current, key) ? Reflect.get(current, key) : undefined
  }, value)
}

export function setLodgingValue(value: unknown, path: string, next: unknown): Record<string, unknown> {
  const [key, ...rest] = path.split(".")
  if (!key || key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Invalid lodging field path")
  const record = lodgingRecord(value)
  if (rest.length) record[key] = setLodgingValue(record[key], rest.join("."), next)
  else if (next === undefined) delete record[key]
  else record[key] = next
  return record
}

export function lodgingEditableFields(nodes: readonly LodgingEditorNode[] = LODGING_EDITOR_GROUPS): readonly LodgingEditorNode[] {
  return nodes.flatMap((node) => node.kind === "group" ? lodgingEditableFields(node.children) : [node])
}

export function buildLodgingProposal(before: unknown, after: unknown) {
  const changed = lodgingEditableFields().filter((node) => JSON.stringify(lodgingValue(before, node.path)) !== JSON.stringify(lodgingValue(after, node.path)))
  const updateMask = changed.map((node) => node.updatePath).sort()
  const payload = changed.reduce<Record<string, unknown>>((result, node) => setLodgingValue(result, node.updatePath, lodgingValue(after, node.path)), {})
  const checked = lodgingSchema.safeParse(payload)
  return { payload, updateMask, valid: checked.success,
    fieldErrors: checked.success ? {} : Object.fromEntries(checked.error.issues.map((issue) => [issueKey(issue.path), correction(issue, payload)])),
  }
}

/** Field errors at a draft path or anywhere beneath it, e.g. every invalid detail in "guestUnits". */
export function lodgingErrorsWithin(errors: Readonly<Record<string, string>>, path: string): readonly string[] {
  return Object.keys(errors).filter((key) => key === path || key.startsWith(`${path}.`))
}
