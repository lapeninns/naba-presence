import { afterEach, expect, it, vi } from "vitest"
import { fetchOnboardingMatchLink } from "@/lib/api/google-onboarding-match-link"

const target = { accountId: "10000000-0000-4000-8000-000000000001", draftId: "10000000-0000-4000-8000-000000000002" } as const
afterEach(() => vi.unstubAllGlobals())

it("treats only the explicit no-operation response as an absent link", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "onboarding_match_link_not_found" }), { status: 404 })))
  expect(await fetchOnboardingMatchLink(target)).toBeNull()
})

it.each([{ status: 404, code: "onboarding_draft_not_found" }, { status: 403, code: "permission_denied" }, { status: 503, code: "status_unavailable" }])("preserves $code rather than enabling another operation", async ({ status, code }) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: code, message: "Status unavailable" }), { status })))
  await expect(fetchOnboardingMatchLink(target)).rejects.toMatchObject({ name: "ApiClientError", code, status })
})

it("parses and restores the recorded operation with its same identity", async () => {
  const value = { id: target.accountId, draftId: target.draftId, reviewId: target.accountId, state: "linked", attemptGeneration: 2, locationId: target.draftId, externalLocationId: target.accountId, errorCode: null, updatedAt: "2026-09-30T00:00:00.000Z" }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(value))))
  expect(await fetchOnboardingMatchLink(target)).toEqual(value)
})
