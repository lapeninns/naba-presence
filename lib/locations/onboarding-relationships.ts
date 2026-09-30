import { googleRelevantLocationSchema, type GoogleRelationship } from "@/lib/domain/google-relationships"

export const relationshipLabels = {
  DEPARTMENT_OF: "Department",
  INDEPENDENT_ESTABLISHMENT_IN: "Independent business at the same address",
} as const

export function removeOnboardingChain(value: GoogleRelationship): GoogleRelationship | undefined {
  const next = { ...value }
  delete next.parentChain
  return Object.keys(next).length ? next : undefined
}

export function removeOnboardingRelationship(value: GoogleRelationship, target: { readonly parent: boolean; readonly placeId?: string }): GoogleRelationship | undefined {
  const next = { ...value }
  if (target.parent) delete next.parentLocation
  else {
    const children = next.childrenLocations?.filter((child) => child.placeId !== target.placeId) ?? []
    if (children.length) next.childrenLocations = children
    else delete next.childrenLocations
  }
  return Object.keys(next).length ? next : undefined
}

export function onboardingRelationshipReviewRows(value: GoogleRelationship) {
  const rows: Array<{ label: string; value: string }> = []
  if (value.parentChain !== undefined) rows.push({ label: "Chain affiliation", value: value.parentChain || "Not supplied" })
  const parent = googleRelevantLocationSchema.safeParse(value.parentLocation)
  if (parent.success) {
    rows.push({ label: "Parent business place ID", value: parent.data.placeId }, { label: "Relationship to parent", value: relationshipLabels[parent.data.relationType] })
  } else if (value.parentLocation) rows.push({ label: "Parent business", value: "Not supplied" })
  if (value.childrenLocations) {
    if (!value.childrenLocations.length) rows.push({ label: "Child businesses", value: "None" })
    value.childrenLocations.forEach((child, index) => rows.push({ label: `Child ${index + 1} place ID`, value: child.placeId }, { label: `Child ${index + 1} relationship`, value: relationshipLabels[child.relationType] }))
  }
  return rows.length ? rows : [{ label: "Business relationships", value: "Not supplied" }]
}
