import { z } from "zod"
import type { ObservedMerchantState, ObservedVerification } from "@/lib/contracts/google-verification-state"

const providerVerificationSchema = z.object({
  name: z.string().max(512).regex(/^locations\/[A-Za-z0-9_-]+\/verifications\/[A-Za-z0-9_-]+$/),
  method: z.string().min(1).max(64).optional(),
  state: z.string().min(1).max(64).optional(),
  createTime: z.iso.datetime({ offset: true }).optional(),
})
const pageSchema = z.object({ verifications: z.array(providerVerificationSchema).max(100).optional(), nextPageToken: z.string().max(2048).optional() })
const merchantSchema = z.object({
  hasVoiceOfMerchant: z.boolean().optional(), hasBusinessAuthority: z.boolean().optional(),
  waitForVoiceOfMerchant: z.object({}).optional(),
  verify: z.object({ hasPendingVerification: z.boolean().optional() }).optional(),
  resolveOwnershipConflict: z.object({}).optional(), complyWithGuidelines: z.object({}).optional(),
})

/** Only status/identity fields cross this boundary; credentials and provider echoes are discarded. */
export function verificationStatePage(value: unknown, locationName: string): {
  readonly verifications: readonly ObservedVerification[]; readonly nextPageToken: string | null
} | null {
  const parsed = pageSchema.safeParse(value)
  if (!parsed.success) return null
  const verifications: ObservedVerification[] = []
  for (const item of parsed.data.verifications ?? []) {
    if (!item.name.startsWith(`${locationName}/verifications/`)) return null
    const phase = item.state === "PENDING" ? "pending" : item.state === "COMPLETED" ? "completed" : item.state === "FAILED" ? "failed" : "unknown"
    verifications.push({ name: item.name, method: item.method ?? null, providerState: item.state ?? null, phase, createTime: item.createTime ?? null })
  }
  return { verifications, nextPageToken: parsed.data.nextPageToken || null }
}

export function merchantVerificationState(value: unknown): ObservedMerchantState | null {
  const parsed = merchantSchema.safeParse(value)
  if (!parsed.success) return null
  const data = parsed.data
  const actions: ObservedMerchantState["action"][] = []
  if (data.waitForVoiceOfMerchant) actions.push("wait")
  if (data.verify) actions.push("verify")
  if (data.resolveOwnershipConflict) actions.push("ownership_conflict")
  if (data.complyWithGuidelines) actions.push("guidelines")
  if (actions.length > 1 || (data.hasVoiceOfMerchant === true && actions.length > 0)) return null
  return {
    hasVoiceOfMerchant: data.hasVoiceOfMerchant ?? null,
    hasBusinessAuthority: data.hasBusinessAuthority ?? null,
    action: actions[0] ?? (data.hasVoiceOfMerchant === true ? "none" : "unknown"),
    hasPendingVerification: data.verify?.hasPendingVerification ?? null,
  }
}
