import { z } from "zod"

export const PRIVACY_REQUEST_TYPES = ["access", "rectification", "erasure", "restriction"] as const
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number]

const TYPE_LABELS: Record<PrivacyRequestType, string> = {
  access: "Access",
  rectification: "Rectification",
  erasure: "Erasure",
  restriction: "Restriction",
}

export function requestTypeLabel(type: string): string {
  return (TYPE_LABELS as Record<string, string>)[type] ?? type
}

export const REQUEST_TYPE_OPTIONS = PRIVACY_REQUEST_TYPES.map((value) => ({
  value,
  label: TYPE_LABELS[value],
}))

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Rejected",
}

export function requestStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export const privacyRequestFormSchema = z.object({
  requestType: z.enum(PRIVACY_REQUEST_TYPES),
  subjectReference: z.string().trim().min(3, "Enter at least 3 characters.").max(240),
  reason: z.string().trim().max(2000).optional(),
})

export type PrivacyRequestFormValues = z.infer<typeof privacyRequestFormSchema>
