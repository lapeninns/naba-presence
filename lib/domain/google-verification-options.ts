import { z } from "zod"

import { verificationAddressSchema, type VerificationChoice, type VerificationStartPayload } from "@/lib/contracts/google-verification-options"

const rawOptionSchema = z.object({
  verificationMethod: z.string().min(1).max(100), phoneNumber: z.string().optional(),
  emailData: z.strictObject({ user: z.string(), domain: z.string(), isUserNameEditable: z.boolean().optional() }).optional(),
  addressData: z.strictObject({ business: z.string().max(1000).optional(), address: z.unknown().optional(), expectedDeliveryDaysRegion: z.number().int().min(0).optional() }).optional(),
  announcement: z.string().optional(),
}).catchall(z.unknown())
const emailSchema = z.email().max(320)
type WithoutId<T> = T extends { readonly id: string } ? Omit<T, "id"> : never
export type VerificationChoiceDetails = WithoutId<VerificationChoice>

/** Unknown/malformed options remain visible as a handoff, never an eligible mutation. */
export function verificationChoiceDetails(value: unknown): VerificationChoiceDetails | null {
  const parsed = rawOptionSchema.safeParse(value)
  if (!parsed.success) {
    const method = z.object({ verificationMethod: z.string().min(1).max(100) }).safeParse(value)
    return method.success ? { kind: "external", method: method.data.verificationMethod, reason: "unusable_destination" } : null
  }
  const option = parsed.data
  const method = option.verificationMethod
  const extraKeys = Object.keys(option).filter((key) => !["verificationMethod", "phoneNumber", "emailData", "addressData", "announcement"].includes(key))
  const displayCount = [option.phoneNumber, option.emailData, option.addressData, option.announcement].filter((entry) => entry !== undefined).length
  if (extraKeys.length || displayCount > 1) return { kind: "external", method, reason: "unknown_display_data" }
  if (method === "EMAIL" && option.emailData && displayCount === 1) {
    const { user, domain, isUserNameEditable } = option.emailData
    if (emailSchema.safeParse(`${user}@${domain}`).success) return { kind: "email", method, user, domain, userNameEditable: isUserNameEditable ?? null }
  }
  if ((method === "PHONE_CALL" || method === "SMS") && option.phoneNumber && displayCount === 1 && option.phoneNumber.length <= 64 && /\d/.test(option.phoneNumber) && /^[+\d][\d ()+.-]*$/.test(option.phoneNumber)) {
    return { kind: "phone", method, phoneNumber: option.phoneNumber }
  }
  if (method === "ADDRESS" && option.addressData && displayCount === 1) {
    const address = verificationAddressSchema.safeParse(option.addressData.address)
    if (address.success) return { kind: "address", method, address: address.data, business: option.addressData.business ?? "", expectedDeliveryDays: option.addressData.expectedDeliveryDaysRegion ?? null }
  }
  if (method === "AUTO" && displayCount === 0) return { kind: "auto", method }
  if (method === "VETTED_PARTNER") return { kind: "external", method, reason: "partner_required" }
  return { kind: "external", method, reason: ["EMAIL", "PHONE_CALL", "SMS", "ADDRESS", "AUTO"].includes(method) ? "unusable_destination" : "unknown_method" }
}

/** The caller supplies the freshly discovered choice for the same language/context. */
export function verificationDestinationMatches(choice: VerificationChoice, payload: VerificationStartPayload): boolean {
  if (choice.method !== payload.method) return false
  if (choice.kind === "email" && payload.method === "EMAIL") {
    const separator = payload.emailAddress.lastIndexOf("@")
    const user = payload.emailAddress.slice(0, separator)
    const domain = payload.emailAddress.slice(separator + 1)
    return domain.toLowerCase() === choice.domain.toLowerCase() && (choice.userNameEditable === true || user === choice.user)
  }
  if (choice.kind === "phone" && (payload.method === "PHONE_CALL" || payload.method === "SMS")) return payload.phoneNumber === choice.phoneNumber
  return (choice.kind === "address" && payload.method === "ADDRESS") || (choice.kind === "auto" && payload.method === "AUTO")
}
