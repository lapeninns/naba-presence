import { z } from "zod"

export const verificationLanguageSchema = z.string().trim().min(2).max(35).refine((value) => {
  try { return Intl.getCanonicalLocales(value).length === 1 } catch { return false }
}, "Use a valid language tag, such as en-GB.")

export const verificationAddressSchema = z.strictObject({
  revision: z.literal(0).optional(), languageCode: verificationLanguageSchema.optional(),
  regionCode: z.string().regex(/^[A-Z]{2}$/),
  postalCode: z.string().trim().max(40).optional(), sortingCode: z.string().trim().max(40).optional(),
  administrativeArea: z.string().trim().max(200).optional(), locality: z.string().trim().max(200).optional(),
  sublocality: z.string().trim().max(200).optional(),
  addressLines: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  recipients: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  organization: z.string().trim().max(200).optional(),
})
export const verificationContextSchema = z.strictObject({ address: verificationAddressSchema })
export const verificationOptionsInputSchema = z.strictObject({
  languageCode: verificationLanguageSchema.default("en"), context: verificationContextSchema.optional(),
})
export type VerificationOptionsInput = z.infer<typeof verificationOptionsInputSchema>

const base = { id: z.string().length(64), method: z.string().min(1).max(100) }
export const verificationChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("email"), method: z.literal("EMAIL"), user: z.string(), domain: z.string(), userNameEditable: z.boolean().nullable() }),
  z.object({ ...base, kind: z.literal("phone"), method: z.enum(["PHONE_CALL", "SMS"]), phoneNumber: z.string().min(1).max(64) }),
  z.object({ ...base, kind: z.literal("address"), method: z.literal("ADDRESS"), business: z.string(), address: verificationAddressSchema, expectedDeliveryDays: z.number().int().min(0).nullable() }),
  z.object({ ...base, kind: z.literal("auto"), method: z.literal("AUTO") }),
  z.object({ ...base, kind: z.literal("external"), reason: z.enum(["partner_required", "unknown_method", "unusable_destination", "unknown_display_data"]) }),
])
export type VerificationChoice = z.infer<typeof verificationChoiceSchema>
export const verificationOptionsResponseSchema = z.object({
  locationId: z.uuid(), googleLocationName: z.string(), languageCode: verificationLanguageSchema,
  customerLocationOnly: z.boolean().nullable(), contextProvided: z.boolean(), contextHash: z.string().length(64),
  checkedAt: z.iso.datetime(), options: z.array(verificationChoiceSchema).max(100),
})
export type VerificationOptionsResponse = z.infer<typeof verificationOptionsResponseSchema>

const startBase = { languageCode: verificationLanguageSchema, context: verificationContextSchema.optional() }
export const verificationStartPayloadSchema = z.discriminatedUnion("method", [
  z.strictObject({ ...startBase, method: z.literal("EMAIL"), emailAddress: z.email().max(320) }),
  z.strictObject({ ...startBase, method: z.literal("PHONE_CALL"), phoneNumber: z.string().trim().min(1).max(64) }),
  z.strictObject({ ...startBase, method: z.literal("SMS"), phoneNumber: z.string().trim().min(1).max(64) }),
  z.strictObject({ ...startBase, method: z.literal("ADDRESS"), mailerContact: z.string().trim().min(1).max(200) }),
  z.strictObject({ ...startBase, method: z.literal("AUTO") }),
])
export type VerificationStartPayload = z.infer<typeof verificationStartPayloadSchema>
