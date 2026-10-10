// Client-safe readback adapter for location attribute PATCHes
// (lib/server/business-information.ts updateBusinessAttributes). Attributes
// are compared by their stable id over the attributeMask only, and a `false`
// is never confused with an attribute that is not set.
import { isRecord, normalizeUri, sameSet } from "./compare"

/**
 * One attribute's value, normalised. `unset` is an attribute Google does not
 * hold (or holds with no value at all), which is what a masked attribute
 * missing from the payload asks for.
 */
export type NormalizedAttribute =
  | { kind: "unset" }
  | { kind: "values"; values: readonly unknown[] }
  | { kind: "repeated_enum"; set: readonly string[]; unset: readonly string[] }
  | { kind: "uri"; uris: readonly string[] }

/**
 * The stable id of an attribute: `attributes/{id}`. Google names attributes
 * that way in both the request and the response, but the full resource form
 * `locations/{l}/attributes/{id}` is accepted too.
 */
export function attributeId(name: unknown): string {
  if (typeof name !== "string") return ""
  const trimmed = name.trim()
  const index = trimmed.lastIndexOf("attributes/")
  return index >= 0 ? trimmed.slice(index) : `attributes/${trimmed}`
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string"
  )
}

export function normalizeAttribute(attribute: unknown): NormalizedAttribute {
  if (!isRecord(attribute)) return { kind: "unset" }
  const repeated = attribute.repeatedEnumValue
  if (isRecord(repeated)) {
    const set = strings(repeated.setValues)
    const unset = strings(repeated.unsetValues)
    if (set.length || unset.length) {
      return { kind: "repeated_enum", set, unset }
    }
  }
  const uriValues = Array.isArray(attribute.uriValues)
    ? attribute.uriValues
    : []
  const uris = uriValues
    .map((entry) => (isRecord(entry) ? normalizeUri(entry.uri) : ""))
    .filter(Boolean)
  if (uris.length) return { kind: "uri", uris }
  const values = Array.isArray(attribute.values) ? attribute.values : []
  if (values.length) return { kind: "values", values }
  return { kind: "unset" }
}

/**
 * Attributes keyed by stable id. Accepts the Attributes resource
 * (`{ name, attributes: [...] }`) as Google returns it, or a bare list as the
 * PATCH body carries it.
 */
export function normalizeAttributes(
  source: unknown
): Map<string, NormalizedAttribute> {
  const list = Array.isArray(source)
    ? source
    : isRecord(source) && Array.isArray(source.attributes)
      ? source.attributes
      : []
  const out = new Map<string, NormalizedAttribute>()
  for (const attribute of list) {
    if (!isRecord(attribute)) continue
    const id = attributeId(attribute.name)
    if (id) out.set(id, normalizeAttribute(attribute))
  }
  return out
}

function valuesEqual(left: readonly unknown[], right: readonly unknown[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const other = right[index]
      if (typeof value === "string" && typeof other === "string") {
        return value.trim() === other.trim()
      }
      return value === other
    })
  )
}

export function attributeValuesEqual(
  actual: NormalizedAttribute,
  expected: NormalizedAttribute
): boolean {
  if (actual.kind !== expected.kind) return false
  switch (expected.kind) {
    case "unset":
      return true
    case "values":
      return valuesEqual(
        (actual as Extract<NormalizedAttribute, { kind: "values" }>).values,
        expected.values
      )
    case "repeated_enum": {
      const live = actual as Extract<
        NormalizedAttribute,
        { kind: "repeated_enum" }
      >
      return (
        sameSet(live.set, expected.set) && sameSet(live.unset, expected.unset)
      )
    }
    case "uri":
      return sameSet(
        (actual as Extract<NormalizedAttribute, { kind: "uri" }>).uris,
        expected.uris
      )
  }
}

/**
 * The masked attribute ids the readback does not confirm. A masked id with
 * no entry in the payload is a deletion, confirmed only when Google no
 * longer holds a value for it. Attributes outside the mask are ignored, so
 * unrelated drift on Google cannot fail a write that applied.
 */
export function attributeMismatches(
  attributeMask: readonly string[],
  payload: unknown,
  readback: unknown
): string[] {
  const wanted = normalizeAttributes(payload)
  const live = normalizeAttributes(readback)
  const unset: NormalizedAttribute = { kind: "unset" }
  return [...new Set(attributeMask.map(attributeId))].filter(
    (id) =>
      !attributeValuesEqual(live.get(id) ?? unset, wanted.get(id) ?? unset)
  )
}

/** True when every masked attribute reads back as the payload asked. */
export function attributesMatch(
  attributeMask: readonly string[],
  payload: unknown,
  readback: unknown
): boolean {
  return attributeMismatches(attributeMask, payload, readback).length === 0
}

/**
 * The masked attributes of `current`, normalised and in a stable order: the
 * input to a field-scoped baseline hash (lib/server/business-information.ts
 * attributeBaselineHash), so a change to an attribute outside the mask does
 * not make the write stale.
 */
export function maskedAttributeBaseline(
  attributeMask: readonly string[],
  current: unknown
): Array<[string, NormalizedAttribute]> {
  const live = normalizeAttributes(current)
  return [...new Set(attributeMask.map(attributeId))]
    .sort()
    .map((id) => [id, live.get(id) ?? { kind: "unset" }])
}
