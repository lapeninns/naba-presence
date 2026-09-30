import { expect, it } from "vitest"
import { additionalPhonesMatch, assertBusinessInformationMask, assertCompletePhoneNumbers, businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { buildLocationUpdate, draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { parseListingDraft } from "@/lib/locations/forms/listing-draft"

const initial = draftFromLocation({ phoneNumbers: { primaryPhone: "+44 20 1111 1111", additionalPhones: ["+44 20 2222 2222", "+44 20 3333 3333"] } })
it("uses Google's required parent mask and preserves the primary number", () => {
  const draft = { ...initial, additionalPhones: ["+44 20 2222 2222"] }
  const update = buildLocationUpdate(initial, draft)
  expect(update).toEqual({ updateMask: ["phoneNumbers"], payload: { phoneNumbers: { primaryPhone: initial.primaryPhone, additionalPhones: draft.additionalPhones } } })
  expect(() => assertBusinessInformationMask(update.payload, update.updateMask)).not.toThrow()
  expect(locationDiffRows(update.updateMask, initial, draft)[0]).toMatchObject({ label: "Phone", nextValue: "+44 20 1111 1111, +44 20 2222 2222" })
})
it("preserves additional numbers when the draft builder changes the primary number", () => {
  expect(buildLocationUpdate(initial, { ...initial, primaryPhone: "+44 20 4444 4444" }).payload).toEqual({ phoneNumbers: { primaryPhone: "+44 20 4444 4444", additionalPhones: initial.additionalPhones } })
})
it("represents clearing explicitly and keeps absent untouched fields absent", () => {
  expect(buildLocationUpdate(initial, { ...initial, additionalPhones: [] })).toEqual({ updateMask: ["phoneNumbers"], payload: { phoneNumbers: { primaryPhone: initial.primaryPhone, additionalPhones: [] } } })
  const empty = draftFromLocation({})
  expect(empty.additionalPhones).toBeUndefined()
  expect(buildLocationUpdate(empty, { ...empty, additionalPhones: [] }).updateMask).toEqual([])
})
it("retains additional phones in restored drafts and enforces the provider count limit", () => {
  expect(parseListingDraft(initial)?.additionalPhones).toEqual(initial.additionalPhones)
  expect(businessInformationPayloadSchema.safeParse({ phoneNumbers: { additionalPhones: ["1", "2", "3"] } }).success).toBe(false)
})
it("compares independent readback without confusing an absent list and retained numbers", () => {
  expect(additionalPhonesMatch(undefined, [])).toBe(true)
  expect(additionalPhonesMatch(["2", "1"], ["1", "2"])).toBe(true)
  expect(additionalPhonesMatch(["1"], [])).toBe(false)
  expect(additionalPhonesMatch(["1", "1"], ["1", "2"])).toBe(false)
  expect(additionalPhonesMatch({}, [])).toBe(false)
})
it("requires both fields for new phone collection writes without accepting an empty primary number", () => {
  expect(() => assertCompletePhoneNumbers({ phoneNumbers: { primaryPhone: "111" } }, ["phoneNumbers"])).toThrow()
  expect(() => assertCompletePhoneNumbers({ phoneNumbers: { primaryPhone: "", additionalPhones: [] } }, ["phoneNumbers"])).toThrow()
  expect(() => assertCompletePhoneNumbers({ phoneNumbers: { primaryPhone: "111", additionalPhones: [] } }, ["phoneNumbers"])).not.toThrow()
  expect(() => assertCompletePhoneNumbers({}, ["title"])).not.toThrow()
})
