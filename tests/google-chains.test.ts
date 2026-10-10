import { expect, it } from "vitest"
import { chainSearchChoices } from "@/lib/domain/google-chains"

it("uses Google's exact resource IDs and prefers English display names", () => {
  expect(chainSearchChoices({ chains: [{ name: "chains/123", chainNames: [{ displayName: "Nom", languageCode: "fr" }, { displayName: "Name", languageCode: "en-GB" }], locationCount: 4 }] })).toEqual([{ name: "chains/123", label: "Name" }])
  expect(chainSearchChoices({ chains: [{ name: "chains/123", chainNames: [{ displayName: "Nom" }] }, { name: "chains/456" }] })).toEqual([{ name: "chains/123", label: "Nom" }, { name: "chains/456", label: "chains/456" }])
})

it("distinguishes empty searches from malformed and duplicated provider data", () => {
  expect(chainSearchChoices({})).toEqual([])
  expect(chainSearchChoices({ chains: [] })).toEqual([])
  for (const value of [null, [], { chains: null }, { chains: [{ name: "invented" }] }, { chains: [{ name: "chains/1" }, { name: "chains/1" }] }]) expect(chainSearchChoices(value)).toBeNull()
})
