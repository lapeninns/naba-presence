import { expect, type Page } from "@playwright/test"
import type { z } from "zod"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import type { OnboardingMatchLinkOperation, onboardingMatchLinkReviewSchema } from "@/lib/contracts/google-onboarding-match-link"
import { readJourneyState } from "./stub-bridge"

export const matchLinkIds = {
  connection: "20000000-0000-4000-8000-000000000001", account: "20000000-0000-4000-8000-000000000002",
  draft: "20000000-0000-4000-8000-000000000003", actor: "20000000-0000-4000-8000-000000000004",
  review: "20000000-0000-4000-8000-000000000005", operation: "20000000-0000-4000-8000-000000000006",
} as const

export async function setupMatchLink(page: Page, baseURL: string | undefined, options: { readonly secondApprover?: boolean; readonly lostResponse?: boolean; readonly failLink?: boolean; readonly initialState?: OnboardingMatchLinkOperation["state"]; readonly statusError?: boolean } = {}) {
  const state = await readJourneyState()
  const [name, value] = state.cookie.split("=", 2)
  if (!baseURL || !name || !value) throw new Error("Missing local browser fixture context")
  await page.context().addCookies([{ name, value, url: baseURL }])
  const now = new Date().toISOString()
  let draft: GoogleOnboardingDraft = {
    id: matchLinkIds.draft, accountId: matchLinkIds.account, accountName: "accounts/selected-business", connectionId: matchLinkIds.connection,
    clientId: state.clientId, requestedBy: matchLinkIds.actor, providerRequestId: matchLinkIds.actor, revision: 1,
    payload: { title: "Saved business", languageCode: "en-GB", storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"] } },
    payloadHash: "a".repeat(64), createdAt: now, updatedAt: now, expiresAt: "2030-01-01T00:00:00.000Z",
    matchResult: { accountId: matchLinkIds.account, connectionId: matchLinkIds.connection, checkedAt: now, matches: [
      { name: "googleLocations/owned", location: { title: "Existing business with a long but readable name" }, requestAdminRightsUri: "https://business.google.com/request" },
      { name: "googleLocations/other", location: { title: "Another account's business" } },
      { name: "googleLocations/unknown", location: { title: "Unconfirmed business" } },
      { name: "googleLocations/ambiguous", location: { title: "Ambiguous business" } },
    ] },
  }
  let review: z.infer<typeof onboardingMatchLinkReviewSchema> | null = options.initialState ? makeReview("Saved business") : null
  if (review && options.initialState) review = { ...review, approvedBy: matchLinkIds.actor }
  let operation: OnboardingMatchLinkOperation | null = options.initialState ? makeOperation(options.initialState) : null
  let discoveryFailure = false
  let statusFailure = Boolean(options.statusError)
  let conflicts: NonNullable<typeof review>["conflicts"] = []
  let staleReview = false
  let submissions = 0
  let previews = 0
  let approvals = 0
  let statusReads = 0
  let discoveries = 0
  let statusGate: Promise<void> | undefined
  let releaseStatus: (() => void) | undefined
  function makeReview(localName: string): z.infer<typeof onboardingMatchLinkReviewSchema> {
    return { id: matchLinkIds.review, draftId: draft.id, revision: draft.revision, payloadHash: draft.payloadHash,
      accountId: draft.accountId, accountName: draft.accountName, connectionId: draft.connectionId, clientId: draft.clientId,
      matchCheckedAt: now, matchName: "googleLocations/owned", provider: { name: "locations/exact-owned", title: "Existing business with a long but readable name", placeId: "place:owned", address: { regionCode: "GB", addressLines: ["2 High Street"], locality: "London", postalCode: "SW1A 1AA" }, verified: null },
      localName, externalLocationId: null, conflicts: [], reviewHash: "b".repeat(64), requestedBy: matchLinkIds.actor,
      approvedBy: null, requiresSecondApprover: Boolean(options.secondApprover), canApprove: !options.secondApprover,
      observedAt: now, approvalExpiresAt: "2030-01-01T00:00:00.000Z" }
  }
  function makeOperation(status: OnboardingMatchLinkOperation["state"]): OnboardingMatchLinkOperation {
    return { id: matchLinkIds.operation, draftId: draft.id, reviewId: matchLinkIds.review, state: status, attemptGeneration: 1,
      locationId: status === "linked" ? state.primaryLocationId : null, externalLocationId: status === "linked" ? matchLinkIds.account : null,
      errorCode: status === "failed" ? "onboarding_match_link_interrupted" : null, updatedAt: now }
  }
  await page.route(`**/api/clients/${state.clientId}/setup`, (route) => route.fulfill({ json: { setup: { clientId: state.clientId, hasClient: true, connection: { id: matchLinkIds.connection, status: "active" }, accountsActive: 1, locationsLinked: 0, backfill: "not_started", notificationsEnabled: false, teamInvited: false, nextStep: "locations" } } }))
  await page.route("**/api/google/connections", (route) => route.fulfill({ json: { connections: [{ id: matchLinkIds.connection, googleEmail: "operator@example.test", status: "active", notificationsEnabled: false, lastRefreshAt: null, lastErrorCode: null, reconnectRequired: false, createdAt: now }] } }))
  await page.route(/\/api\/google\/accounts(?:\?.*)?$/, (route) => route.fulfill({ json: { accounts: [{ id: matchLinkIds.account, googleAccountName: draft.accountName, accountName: "Selected business account", googleConnectionId: matchLinkIds.connection, type: "PERSONAL", role: "OWNER", permissionLevel: "OWNER_LEVEL", isActive: true }] } }))
  await page.route(/\/api\/google\/locations(?:\?.*)?$/, (route) => route.fulfill({ json: { locations: [] } }))
  await page.route(`**/api/google/accounts/${matchLinkIds.account}/drafts**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path.endsWith("/match-link")) {
      if (request.method() === "POST") {
        submissions++
        expect(request.postDataJSON()).toEqual({ reviewId: matchLinkIds.review, expectedReviewHash: "b".repeat(64) })
        operation = makeOperation(options.failLink && submissions === 1 ? "failed" : "linked")
        if (options.lostResponse) return route.fulfill({ status: 503, json: { error: "response_lost", message: "Submission response was interrupted." } })
      } else {
        statusReads++
        if (statusGate) await statusGate
        if (statusFailure) return route.fulfill({ status: 503, json: { error: "status_unavailable", message: "Link status could not be restored." } })
      }
      return operation ? route.fulfill({ json: operation }) : route.fulfill({ status: 404, json: { error: "onboarding_match_link_not_found", message: "No operation has started." } })
    }
    if (path.endsWith("/creation")) return route.fulfill({ status: 404, json: { error: "onboarding_creation_not_found", message: "Creation has not started." } })
    if (path.endsWith("/accessible-matches")) {
      discoveries++
      expect(url.searchParams.get("expectedRevision")).toBe("1")
      expect(url.searchParams.get("expectedMatchCheckedAt")).toBe(now)
      if (discoveryFailure) { discoveryFailure = false; return route.fulfill({ status: 502, json: { error: "onboarding_accessible_locations_invalid", message: "Account discovery failed." } }) }
      return route.fulfill({ json: { draftId: draft.id, revision: 1, payloadHash: draft.payloadHash, matchCheckedAt: now, observedAt: now, matches: [
        { matchName: "googleLocations/owned", status: "accessible", location: { name: "locations/exact-owned", title: "Existing business with a long but readable name", placeId: "place:owned" } },
        { matchName: "googleLocations/other", status: "not_accessible" }, { matchName: "googleLocations/unknown", status: "identity_unconfirmed" }, { matchName: "googleLocations/ambiguous", status: "ambiguous" },
      ] } })
    }
    if (path.endsWith("/match-link-reviews")) {
      previews++
      expect(request.postDataJSON()).toEqual({ expectedRevision: 1, expectedMatchCheckedAt: now, matchName: "googleLocations/owned", localName: "Distinct local business" })
      review = { ...makeReview("Distinct local business"), conflicts }
      return route.fulfill({ json: review })
    }
    if (path.includes("/match-link-reviews/")) {
      if (staleReview) return route.fulfill({ status: 409, json: { error: "approval_expired", message: "This saved review expired. Generate a new link review." } })
      if (request.method() === "POST") {
        approvals++
        expect(request.postDataJSON()).toEqual({ expectedReviewHash: "b".repeat(64) })
        if (review) review = { ...review, approvedBy: matchLinkIds.actor }
      }
      return route.fulfill({ json: review })
    }
    if (path.endsWith("/drafts")) return route.fulfill({ json: { drafts: [draft] } })
    expect(path).toBe(`/api/google/accounts/${draft.accountId}/drafts/${draft.id}`)
    expect(request.method()).toBe("GET")
    return route.fulfill({ json: draft })
  })
  const setupUrl = `/setup?client=${state.clientId}&step=locations&onboardingAccount=${draft.accountId}&onboardingDraft=${draft.id}`
  await page.goto(setupUrl)
  return {
    setupUrl, draft, read: () => ({ submissions, approvals, previews, statusReads, discoveries }),
    failDiscovery: () => { discoveryFailure = true }, setConflicts: (next: typeof conflicts) => { conflicts = next },
    approveElsewhere: () => { if (review) review = { ...review, approvedBy: matchLinkIds.account, canApprove: true } },
    expireReview: () => { staleReview = true }, restoreStatus: () => { statusFailure = false },
    clearSearch: () => { draft = { ...draft, matchResult: null }; staleReview = true },
    setOperation: (next: OnboardingMatchLinkOperation["state"]) => { operation = makeOperation(next) },
    blockStatus: () => { statusGate = new Promise<void>((resolve) => { releaseStatus = resolve }) },
    releaseStatus: () => { releaseStatus?.(); statusGate = undefined },
  }
}
