import { expect, it } from "vitest"
import { googleAccountMatchInputSchema, googleLocationSearchResultSchema, googleOnboardingDraftCreateSchema, googleOnboardingDraftSaveSchema, googleOnboardingReviewInputSchema } from "@/lib/contracts/google-onboarding"

const connectionId = "00000000-0000-4000-8000-000000000001"

it("requires an explicit creation decision against an observed search", () => {
  const input = { expectedRevision: 1, expectedMatchCheckedAt: "2026-09-29T10:00:00.000Z", decision: { action: "create_new", acknowledgedMatchNames: [], reason: "A separate new premises." } }
  expect(googleOnboardingReviewInputSchema.safeParse(input).success).toBe(true)
  for (const decision of [{ ...input.decision, action: "auto_create" }, { ...input.decision, reason: " " }, { ...input.decision, acknowledgedMatchNames: ["googleLocations/a", "googleLocations/a"] }, { ...input.decision, acknowledgedMatchNames: ["locations/a"] }]) expect(googleOnboardingReviewInputSchema.safeParse({ ...input, decision }).success).toBe(false)
  expect(googleOnboardingReviewInputSchema.safeParse({ ...input, payload: {} }).success).toBe(false)
})

it("allows incomplete typed drafts but rejects provider state and caller-selected request identities", () => {
  const input = { draftId: connectionId, connectionId, payload: {} }
  expect(googleOnboardingDraftCreateSchema.safeParse(input).success).toBe(true)
  expect(googleOnboardingDraftCreateSchema.parse({ ...input, payload: { title: " Example ", languageCode: "en-GB" } }).payload.title).toBe("Example")
  for (const payload of [{ languageCode: "not_a_tag" }, { name: "locations/already-created" }, { metadata: {} }]) expect(googleOnboardingDraftCreateSchema.safeParse({ ...input, payload }).success).toBe(false)
  expect(googleOnboardingDraftCreateSchema.safeParse({ ...input, providerRequestId: connectionId }).success).toBe(false)
  expect(googleOnboardingDraftSaveSchema.safeParse({ payload: {} }).success).toBe(false)
  expect(googleOnboardingDraftSaveSchema.safeParse({ expectedRevision: 1, payload: {}, connectionId }).success).toBe(false)
})

it("requires one bounded matching query with an explicit connection", () => {
  expect(googleAccountMatchInputSchema.parse({ connectionId, search: { kind: "query", query: "  Example London  " } })).toMatchObject({ pageSize: 10, search: { query: "Example London" } })
  expect(googleAccountMatchInputSchema.safeParse({ connectionId, search: { kind: "location", location: { title: "Example", storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } } } }).success).toBe(true)
  for (const search of [{ kind: "query", query: "" }, { kind: "query", query: "Example", location: {} }, { kind: "location", location: {} }]) expect(googleAccountMatchInputSchema.safeParse({ connectionId, search }).success).toBe(false)
  expect(googleAccountMatchInputSchema.safeParse({ connectionId, pageSize: 11, search: { kind: "query", query: "Example" } }).success).toBe(false)
})

it("distinguishes empty results from malformed or unsafe provider matches", () => {
  expect(googleLocationSearchResultSchema.parse({})).toEqual({})
  const match = { name: "googleLocations/match", location: { title: "Example", futureField: "preserved" }, requestAdminRightsUri: "https://business.google.com/request" }
  expect(googleLocationSearchResultSchema.parse({ googleLocations: [match] }).googleLocations?.[0]).toEqual(match)
  for (const value of [null, [], { error: "failure" }, { googleLocations: null }, { googleLocations: [{ ...match, name: "locations/wrong" }] }, { googleLocations: [{ ...match, requestAdminRightsUri: "javascript:alert(1)" }] }]) expect(googleLocationSearchResultSchema.safeParse(value).success).toBe(false)
})
