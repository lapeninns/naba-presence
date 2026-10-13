import { z } from "zod"

export const createAdminSchema = z.object({
  scope: z.enum(["account", "location"]),
  admin: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["OWNER", "MANAGER"]),
})
export type CreateAdminValues = z.infer<typeof createAdminSchema>

export const updateAdminSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["OWNER", "MANAGER"]),
})
export const transferLocationSchema = z.object({
  destinationAccount: z
    .string()
    .trim()
    .min(1, "Enter the destination Google account."),
})

/**
 * Keyboard hints for a typed identifier (a Google resource name, an email
 * address, a typed listing name): no auto-capitalisation, autocorrect,
 * spellcheck or autofill, so a phone keyboard never turns `accounts/123`
 * into `Accounts/123` or "Camden Hotel" into something else.
 */
export const IDENTIFIER_INPUT_PROPS = {
  autoCapitalize: "none",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
} as const

/**
 * A typed Google account resource name, normalised only where the server
 * contract (googleAccountNameSchema, `^accounts\/[A-Za-z0-9_-]+$`) would
 * otherwise reject what the person clearly meant: surrounding whitespace
 * (a keyboard's trailing space) and the case of the fixed `accounts/`
 * prefix (a phone's auto-capitalised first letter). The account id itself
 * is never changed, so nothing is sent that Google would read as a
 * different account; anything else still fails the contract and is shown
 * as an error.
 */
export function normaliseAccountName(input: string): string {
  const trimmed = input.trim()
  return /^accounts\//i.test(trimmed)
    ? `accounts/${trimmed.slice("accounts/".length)}`
    : trimmed
}

/**
 * The one typed-name rule for a destructive Google request (removing an
 * administrator, transferring or deleting the location), checked at the
 * SEND step: the typed text must equal the listing name exactly, ignoring
 * only leading and trailing whitespace (a keyboard's trailing space or a
 * QuickType suggestion). Case matters: the name is the evidence that the
 * person is looking at the right listing, and "exact" is the rule the
 * lifecycle send always had. An empty or unknown name never matches.
 *
 * This is client-side friction only. The send routes accept nothing but
 * `{ expectedPayloadHash }` (administrationAccessApprovalSchema,
 * lifecycleApprovalSchema are strict objects); the server's safety comes
 * from the saved review, its approval and its payload hash.
 */
export function typedNameMatches(typed: string, expected: string): boolean {
  const name = expected.trim()
  return name.length > 0 && typed.trim() === name
}

// The route mutation envelope lives in the wire contract; re-exported here so
// existing form-side imports keep resolving.
export {
  ADMINISTRATION_CONFIRMATIONS,
  administrationMutationSchema,
  administrationOperationSchema,
  type AdministrationMutation,
  type AdministrationOperation,
} from "@/lib/contracts/location-administration"
