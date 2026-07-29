import { z } from "zod"

const notificationSchema = z
  .object({
    type: z.string().optional(),
    notificationType: z.string().optional(),
    review: z.string().optional(),
    reviewName: z.string().optional(),
    location: z.string().optional(),
    locationName: z.string().optional(),
  })
  .passthrough()

function locationResourceName(value: string | undefined): string | null {
  return value?.match(/locations\/[^/]+/)?.[0] ?? null
}

export function parsePubSubNotification(decoded: unknown): {
  type: string
  locationName: string | null
  reviewName: string | null
} {
  const parsed = notificationSchema.safeParse(decoded)
  if (!parsed.success) {
    return {
      type: "review_update",
      locationName: null,
      reviewName: null,
    }
  }
  const payload = parsed.data
  const reviewName = payload.reviewName ?? payload.review ?? null
  return {
    type: payload.type ?? payload.notificationType ?? "review_update",
    locationName:
      locationResourceName(payload.locationName ?? payload.location) ??
      locationResourceName(reviewName ?? undefined),
    reviewName,
  }
}
