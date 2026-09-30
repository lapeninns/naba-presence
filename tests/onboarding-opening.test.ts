import { expect, it } from "vitest"
import { googleOnboardingPayloadSchema } from "@/lib/contracts/google-onboarding"
import {
  openingDraftFromPayload,
  openingPayloadFromDraft,
} from "@/lib/locations/onboarding-opening"

it("leaves omitted opening information omitted", () => {
  const draft = openingDraftFromPayload(undefined)
  expect(draft).toEqual({ status: "omit", date: null })
  expect(openingPayloadFromDraft(draft, undefined)).toBeUndefined()
})

it("preserves an unknown-day sentinel while changing only opening state or month", () => {
  const original = {
    status: "OPEN" as const,
    openingDate: { year: 2020, month: 2, day: 0 },
  }
  const draft = openingDraftFromPayload(original)
  expect(draft.date?.day).toBe("")
  expect(
    openingPayloadFromDraft(
      { ...draft, status: "CLOSED_TEMPORARILY" },
      original
    )
  ).toEqual({ ...original, status: "CLOSED_TEMPORARILY" })
  expect(
    openingPayloadFromDraft(
      { ...draft, date: { year: "2020", month: "3", day: "" } },
      original
    )?.openingDate
  ).toEqual({ year: 2020, month: 3, day: 0 })
})

it("creates a month/year proposal without inventing a day", () => {
  const payload = openingPayloadFromDraft(
    { status: "OPEN", date: { year: "2024", month: "02", day: "" } },
    undefined
  )
  expect(
    googleOnboardingPayloadSchema.parse({ openInfo: payload }).openInfo
  ).toEqual({ status: "OPEN", openingDate: { year: 2024, month: 2 } })
})

it("rejects incomplete, non-integer and impossible dates before saving", () => {
  for (const date of [
    { year: "", month: "2", day: "" },
    { year: "2024", month: "1e1", day: "" },
    { year: "2024", month: "2.5", day: "" },
    { year: "2023", month: "2", day: "29" },
    { year: "2024", month: "13", day: "1" },
  ]) {
    const payload = openingPayloadFromDraft({ status: "OPEN", date }, undefined)
    expect(
      googleOnboardingPayloadSchema.safeParse({ openInfo: payload }).success
    ).toBe(false)
  }
  expect(
    googleOnboardingPayloadSchema.safeParse({
      openInfo: openingPayloadFromDraft(
        { status: "OPEN", date: { year: "2024", month: "2", day: "29" } },
        undefined
      ),
    }).success
  ).toBe(true)
})

it("clears the date independently of state and omits the whole object only by choice", () => {
  const original = {
    status: "CLOSED_TEMPORARILY" as const,
    openingDate: { year: 2020, month: 2, day: 3 },
  }
  expect(
    openingPayloadFromDraft({ status: original.status, date: null }, original)
  ).toEqual({ status: original.status, openingDate: undefined })
  expect(
    openingPayloadFromDraft({ status: "omit", date: null }, original)
  ).toBeUndefined()
})
