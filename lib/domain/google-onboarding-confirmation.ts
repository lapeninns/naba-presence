import { googleOpeningDateSchema, openingDatesMatch } from "./business-information"
import { googleRelationshipSchema, RELATIONSHIP_FIELDS, relationshipFieldMatches } from "./google-relationships"
import { onboardingHoursMatch, onboardingMoreHoursMatch } from "./google-onboarding-hours"

export function onboardingPayloadMatches(expected: unknown, observed: unknown, path = ""): boolean {
  if (path === "moreHours") return onboardingMoreHoursMatch(expected, observed)
  if (path === "regularHours" || path === "specialHours") return onboardingHoursMatch(expected, observed, path === "specialHours")
  if (path === "relationshipData") {
    const relationships = googleRelationshipSchema.safeParse(expected)
    return relationships.success && observed !== null && typeof observed === "object" && !Array.isArray(observed) && RELATIONSHIP_FIELDS.filter((field) => Object.hasOwn(relationships.data, field)).every((field) => relationshipFieldMatches(observed, relationships.data, field))
  }
  if (path === "openInfo.openingDate") {
    const date = googleOpeningDateSchema.safeParse(expected)
    return date.success && openingDatesMatch(observed, date.data)
  }
  if (Array.isArray(expected)) {
    return Array.isArray(observed) && expected.length === observed.length && expected.every((value, index) => onboardingPayloadMatches(value, observed[index], `${path}.${index}`))
  }
  if (expected !== null && typeof expected === "object") {
    if (!observed || typeof observed !== "object" || Array.isArray(observed)) return false
    return Object.entries(expected).every(([key, value]) => Object.hasOwn(observed, key) && onboardingPayloadMatches(value, Reflect.get(observed, key), path ? `${path}.${key}` : key))
  }
  return expected === observed
}
