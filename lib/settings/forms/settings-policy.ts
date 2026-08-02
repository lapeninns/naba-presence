import { z } from "zod"

function supportedTimezones(): string[] {
  const withValues = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    return withValues.supportedValuesOf ? withValues.supportedValuesOf("timeZone") : ["Europe/London", "UTC"]
  } catch {
    return ["Europe/London", "UTC"]
  }
}

export const TIMEZONE_OPTIONS: readonly string[] = supportedTimezones()
const TIMEZONE_SET = new Set(TIMEZONE_OPTIONS)

export function isValidTimezone(value: string): boolean {
  return TIMEZONE_SET.has(value)
}

export const settingsPolicyFormSchema = z.object({
  approvalRequired: z.boolean(),
  requireTwoPersonApproval: z.boolean().optional(),
  rawContentRetentionDays: z.number().int().min(1).max(30),
  defaultLanguageCode: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "Use a language code such as en or en-GB."),
  defaultTimezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => isValidTimezone(value), "Choose a valid timezone."),
  directPublishConsent: z.boolean().default(false),
})

export type SettingsPolicyFormValues = z.infer<typeof settingsPolicyFormSchema>
