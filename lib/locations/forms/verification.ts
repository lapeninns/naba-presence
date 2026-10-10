import { verificationStartPayloadSchema, type VerificationChoice, type VerificationOptionsInput } from "@/lib/contracts/google-verification-options"
import { verificationDestinationMatches } from "@/lib/domain/google-verification-options"

export type VerificationDestinationDraft = { readonly emailUser: string; readonly mailerContact: string }

export function verificationStartDraft(choice: VerificationChoice, input: VerificationOptionsInput, draft: VerificationDestinationDraft) {
  const base = { languageCode: input.languageCode, ...(input.context ? { context: input.context } : {}) }
  switch (choice.kind) {
    case "email": {
      const user = choice.userNameEditable === true ? draft.emailUser.trim() : choice.user
      const parsed = verificationStartPayloadSchema.safeParse({ ...base, method: choice.method, emailAddress: `${user}@${choice.domain}` })
      return parsed.success && verificationDestinationMatches(choice, parsed.data) ? parsed.data : null
    }
    case "phone": return verificationStartPayloadSchema.parse({ ...base, method: choice.method, phoneNumber: choice.phoneNumber })
    case "address": {
      const parsed = verificationStartPayloadSchema.safeParse({ ...base, method: choice.method, mailerContact: draft.mailerContact })
      return parsed.success ? parsed.data : null
    }
    case "auto": return verificationStartPayloadSchema.parse({ ...base, method: choice.method })
    case "external": return null
    default: return choice satisfies never
  }
}

export function verificationChoiceDestination(choice: VerificationChoice): string {
  switch (choice.kind) {
    case "email": return `${choice.user}@${choice.domain}`
    case "phone": return choice.phoneNumber
    case "address": return [choice.business, ...choice.address.addressLines, choice.address.locality, choice.address.postalCode, choice.address.regionCode].filter(Boolean).join(", ")
    case "auto": return "Google offers automatic verification for this listing."
    case "external": return "Continue with the method and instructions offered in Google Business Profile."
    default: return choice satisfies never
  }
}
