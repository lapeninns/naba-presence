import { z } from "zod"
import type { googleLocationMatchSchema } from "@/lib/contracts/google-onboarding"
import type { OnboardingAccessibleLocation, OnboardingAccessibleMatch } from "@/lib/contracts/google-onboarding-accessible-matches"

const providerIdentitySchema = z.object({
  name: z.string().regex(/^locations\/[^/\s]+$/).optional(),
  metadata: z.object({ placeId: z.string().optional() }).optional(),
})

export const onboardingAccessibleLocationsPageSchema = z.object({
  locations: z.array(providerIdentitySchema.extend({
    name: z.string().regex(/^locations\/[^/\s]+$/),
    title: z.string().optional(),
  })).max(100).optional(),
  nextPageToken: z.string().optional(),
})

export function correlateOnboardingMatch(
  match: z.infer<typeof googleLocationMatchSchema>,
  locations: readonly OnboardingAccessibleLocation[],
): OnboardingAccessibleMatch {
  const identity = providerIdentitySchema.safeParse(match.location)
  if (!identity.success) return { matchName: match.name, status: "identity_unconfirmed" }
  const name = identity.data.name
  const placeId = identity.data.metadata?.placeId || undefined
  if (!name && !placeId) return { matchName: match.name, status: "identity_unconfirmed" }
  const candidates = locations.filter((location) => name ? location.name === name : location.placeId === placeId)
  if (candidates.length > 1) return { matchName: match.name, status: "ambiguous" }
  const candidate = candidates[0]
  if (!candidate && name && placeId && locations.some((location) => location.placeId === placeId)) return { matchName: match.name, status: "identity_unconfirmed" }
  if (!candidate) return { matchName: match.name, status: "not_accessible" }
  if (name && placeId && candidate.placeId !== placeId) return { matchName: match.name, status: "identity_unconfirmed" }
  return { matchName: match.name, status: "accessible", location: candidate }
}
