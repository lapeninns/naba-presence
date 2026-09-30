import { z } from "zod"

export const googleAdvertisingSchema = z.union([
  z.object({ adPhone: z.string().trim().min(1).max(50) }).strict(),
  z.object({}).strict(),
])

export function advertisingBaselineSupported(value: unknown): boolean {
  return value === undefined || z.object({ adPhone: z.string().max(50).optional() }).strict().safeParse(value).success
}

export function advertisingMatches(observed: unknown, expected: unknown): boolean {
  const wanted = googleAdvertisingSchema.safeParse(expected)
  if (!wanted.success) return false
  if (!("adPhone" in wanted.data)) {
    if (observed === undefined) return true
    const empty = z.object({ adPhone: z.literal("").optional() }).strict()
    return empty.safeParse(observed).success
  }
  const found = googleAdvertisingSchema.safeParse(observed)
  return found.success && "adPhone" in found.data && found.data.adPhone === wanted.data.adPhone
}
