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

// The route mutation envelope lives in the wire contract; re-exported here so
// existing form-side imports keep resolving.
export {
  ADMINISTRATION_CONFIRMATIONS,
  administrationMutationSchema,
  administrationOperationSchema,
  type AdministrationMutation,
  type AdministrationOperation,
} from "@/lib/contracts/location-administration"
