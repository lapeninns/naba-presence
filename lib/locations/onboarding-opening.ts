import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"

type OpenInfo = NonNullable<GoogleOnboardingDraft["payload"]["openInfo"]>
export type OnboardingOpeningDraft = {
  status: OpenInfo["status"] | "omit"
  date: { year: string; month: string; day: string } | null
}

export function openingDraftFromPayload(
  value: OpenInfo | undefined
): OnboardingOpeningDraft {
  return {
    status: value?.status ?? "omit",
    date: value?.openingDate
      ? {
          year: String(value.openingDate.year),
          month: String(value.openingDate.month),
          day: value.openingDate.day ? String(value.openingDate.day) : "",
        }
      : null,
  }
}

function dateNumber(value: string): number {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

export function openingPayloadFromDraft(
  value: OnboardingOpeningDraft,
  original: OpenInfo | undefined
): OpenInfo | undefined {
  if (value.status === "omit") return undefined
  const savedDate = openingDraftFromPayload(original).date
  const dateUnchanged = JSON.stringify(value.date) === JSON.stringify(savedDate)
  return {
    ...original,
    status: value.status,
    openingDate: dateUnchanged
      ? original?.openingDate
      : value.date
        ? {
            year: dateNumber(value.date.year),
            month: dateNumber(value.date.month),
            ...(value.date.day.trim()
              ? { day: dateNumber(value.date.day) }
              : original?.openingDate?.day === 0
                ? { day: 0 }
                : {}),
          }
        : undefined,
  }
}
