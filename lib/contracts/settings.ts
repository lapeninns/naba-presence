/**
 * Wire contract for `/api/settings`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The route parses
 * the PATCH body with `settingsPatchSchema`; `lib/api/settings.ts` parses
 * responses with `settingsResponseSchema`.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** PATCH `/api/settings` body. */
export const settingsPatchSchema = z.object({
  approvalRequired: z.boolean(),
  requireTwoPersonApproval: z.boolean().optional(),
  rawContentRetentionDays: z.number().int().min(1).max(30),
  defaultLanguageCode: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
  defaultTimezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value })
        return true
      } catch {
        return false
      }
    }, "Use a valid IANA timezone."),
  directPublishConsent: z.boolean().default(false),
})
export type SettingsPatchInput = z.input<typeof settingsPatchSchema>

/**
 * Whether a settings save turns approval OFF, the one change that needs an
 * owner's explicit direct-publish consent. Leaving an already-off policy off
 * while editing another field does not. Shared by the route (against the
 * stored row) and the forms (against the loaded settings).
 */
export function requiresDirectPublishConsent(
  storedApprovalRequired: boolean,
  input: { approvalRequired: boolean }
): boolean {
  return storedApprovalRequired && !input.approvalRequired
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const orgSettingsSchema = z.object({
  approvalRequired: z.boolean(),
  requireTwoPersonApproval: z.boolean(),
  rawContentRetentionDays: z.number(),
  defaultLanguageCode: z.string(),
  defaultTimezone: z.string(),
  directPublishConsentAt: z.string().nullable(),
})
export type OrgSettings = z.infer<typeof orgSettingsSchema>

/** GET and PATCH `/api/settings` response. */
export const settingsResponseSchema = z.object({ settings: orgSettingsSchema })
export type SettingsResponse = z.infer<typeof settingsResponseSchema>
