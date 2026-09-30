import { z } from "zod"

export const googleRelevantLocationSchema = z.object({
  placeId: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/, "Enter a Google place ID without spaces or URL characters."),
  relationType: z.enum(["DEPARTMENT_OF", "INDEPENDENT_ESTABLISHMENT_IN"]),
}).strict()

export const googleRelationshipSchema = z.object({
  parentChain: z.string().trim().regex(/^(?:chains\/[^/\s]+)?$/, "Select a chain resource or explicitly clear the affiliation.").optional(),
  parentLocation: z.union([googleRelevantLocationSchema, z.object({}).strict()]).optional(),
  childrenLocations: z.array(googleRelevantLocationSchema).refine((children) => new Set(children.map((child) => child.placeId)).size === children.length, "Each related location must have a different place ID.").optional(),
}).strict()

export type GoogleRelationship = z.infer<typeof googleRelationshipSchema>
export type RelationshipField = keyof GoogleRelationship
export const RELATIONSHIP_FIELDS = ["parentChain", "parentLocation", "childrenLocations"] as const

export function editableRelationships(observed: unknown): GoogleRelationship | undefined {
  const parsed = z.record(z.string(), z.unknown()).safeParse(observed)
  if (!parsed.success) return undefined
  let result: GoogleRelationship | undefined
  for (const field of RELATIONSHIP_FIELDS) {
    if (!Object.hasOwn(parsed.data, field)) continue
    const selected = googleRelationshipSchema.safeParse({ [field]: parsed.data[field] })
    if (selected.success) result = { ...result, ...selected.data }
  }
  return result
}

export function unsupportedRelationshipBaseline(observed: unknown, masks: readonly string[]): boolean {
  if (!masks.some((mask) => mask === "relationshipData" || mask.startsWith("relationshipData.")) || observed === undefined) return false
  if (masks.includes("relationshipData")) return !googleRelationshipSchema.safeParse(observed).success
  const parsed = z.record(z.string(), z.unknown()).safeParse(observed)
  if (!parsed.success) return true
  return RELATIONSHIP_FIELDS.some((field) => masks.includes(`relationshipData.${field}`) && !googleRelationshipSchema.safeParse({ [field]: parsed.data[field] }).success)
}

export function relationshipFieldMatches(observed: unknown, expected: GoogleRelationship, field: RelationshipField): boolean {
  const parsed = z.record(z.string(), z.unknown()).safeParse(observed === undefined ? {} : observed)
  if (!parsed.success) return false
  const actual = parsed.data[field]
  if (field === "parentChain") return (actual === undefined ? "" : actual) === (expected.parentChain ?? "")
  if (field === "parentLocation") {
    const wanted = expected.parentLocation
    if (!wanted || !Object.keys(wanted).length) return actual === undefined || (typeof actual === "object" && actual !== null && !Array.isArray(actual) && Object.keys(actual).length === 0)
    const value = googleRelevantLocationSchema.safeParse(wanted)
    const found = googleRelevantLocationSchema.safeParse(actual)
    return value.success && found.success && value.data.placeId === found.data.placeId && value.data.relationType === found.data.relationType
  }
  const wanted = expected.childrenLocations ?? []
  const found = z.array(googleRelevantLocationSchema).safeParse(actual === undefined ? [] : actual)
  return found.success && wanted.length === found.data.length && new Set(found.data.map((child) => child.placeId)).size === found.data.length && wanted.every((child) => found.data.some((item) => item.placeId === child.placeId && item.relationType === child.relationType))
}

export function relationshipsMatch(observed: unknown, expected: GoogleRelationship, mask: string): boolean {
  const fields = mask === "relationshipData" ? RELATIONSHIP_FIELDS : RELATIONSHIP_FIELDS.filter((field) => mask === `relationshipData.${field}`)
  return fields.length > 0 && fields.every((field) => relationshipFieldMatches(observed, expected, field))
}
