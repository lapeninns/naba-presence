import { expect, test, type Page } from "@playwright/test"
import { locationFieldCapabilities } from "@/lib/domain/google-capabilities"
import AxeBuilder from "@axe-core/playwright"
import { draftFromLocation } from "@/lib/locations/business-information-draft"

// These three tests mock the app's OWN API routes via page.route (a single
// owner session, no DB/Google stub) — they render the M8 field editors
// against a fixed GET fixture, not a live backend. The GET fixture bodies
// below are reused verbatim from the pre-M8 version of this file (each
// sub-resource's `{ data, error }` envelope, 64-char locationHash/
// attributesHash, canManage/canPublish/writesEnabled booleans already match
// the real shapes returned by lib/server/business-information.ts,
// lib/server/industry-management.ts, and lib/server/location-administration.ts)
// — only the routes and assertions below are new, pointed at the real
// editors instead of the deleted raw-JSON console.
async function mockShell(page: Page) {
  await page.route(/\/api\/session(?:\?.*)?$/, (route) => route.fulfill({ json: { session: { sessionId: "session-management", userId: "user-management", organisationId: "org-management", organisationName: "Naba Presence", displayName: "Alex Morgan", email: "alex@example.com", role: "owner", canPublish: true } } }))
  // ONE endpoint, TWO payload shapes, and both are fetched on these pages.
  // LocationWorkspace renders with the SERVER session's role, which is null
  // here (no session cookie is minted -- see the activity note below), so it
  // asks for the default view: `{ id, name, linked }` per locationEntrySchema.
  // The Administration console reads the role from the /api/session stub above
  // ("owner") and asks for `?view=management`, whose entry is the raw
  // directory row (directoryRowSchema, `locationId` + link columns). Answering
  // both with the management row alone -- as this fixture did -- fails
  // locationsResponseSchema in lib/api/client.ts, and LocationWorkspace then
  // sits on its "does this location exist?" skeleton and never renders a tab.
  const managementLocation = { locationId: "location-management", name: "Camden Hotel", timezone: "Europe/London", address: { addressLines: ["10 Camden High Street"], locality: "London", postalCode: "NW1 0JH", regionCode: "GB" }, linkId: "link-management", externalLocationId: "external-management", googleLocationName: "locations/camden", googleTitle: "Camden Hotel", verified: true, clientId: "client-management", clientName: "Camden Group" }
  await page.route(/\/api\/location-links(?:\?.*)?$/, (route) => route.fulfill({ json: { locations: [new URL(route.request().url()).searchParams.get("view") === "management" ? managementLocation : { id: "location-management", name: "Camden Hotel", linked: true, clientId: "client-management", clientName: "Camden Group" }] } }))
  await page.route(/\/api\/google\/connections(?:\?.*)?$/, (route) => route.fulfill({ json: { connections: [{ id: "connection-management", googleEmail: "owner@example.com", status: "active", notificationsEnabled: true, lastRefreshAt: "2026-07-31T09:00:00Z", lastErrorCode: null, reconnectRequired: false, createdAt: "2026-07-01T09:00:00Z" }] } }))
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, (route) => route.fulfill({ json: { total: 0, byStatus: {}, byQueue: { needs_reply: 0, approval: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 } } }))
  // The shell reads the client list for its sidebar, its breadcrumbs and its
  // health chip. Leaving it unstubbed is fatal for the same reason the
  // activity route below is: the real route answers 401 and lib/api/client.ts
  // hard-navigates the page to /sign-in mid-assertion.
  await page.route(/\/api\/clients(?:\?.*)?$/, (route) => route.fulfill({ json: { items: [{ id: "client-management", name: "Camden Group", slug: "camden-group", colour: null, logoUrl: null, notes: null, archivedAt: null, createdAt: "2026-07-01T09:00:00Z", locationCount: 1, linkedCount: 1, verifiedCount: 1, health: "healthy", connections: [], openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 }, backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 }, lastSyncAt: "2026-07-31T09:00:00Z" }], unassignedLocationCount: 0 } }))
  await page.route(/\/api\/organisations(?:\?.*)?$/, (route) => route.fulfill({ json: { items: [] } }))
  // All three consoles gate their editors on this capability (owner/admin
  // only); Business info also reads it for the field-level disabled state.
  await page.route(/\/api\/locations\/location-management\/capabilities(?:\?.*)?$/, (route) => route.fulfill({ json: { capabilities: { canEditCanonical: true, canPublish: true } } }))
  // Every listing page reads the DB-only summary for its status pill
  // (components/listings/area-frame.tsx); unstubbed it 401s and the client
  // hard-navigates to /sign-in mid-assertion.
  await page.route(/\/api\/locations\/location-management\/summary(?:\?.*)?$/, (route) => route.fulfill({ json: { summary: { locationId: "location-management", linked: true, verified: true, connection: { status: "active", reconnectRequired: false, googleEmail: "owner@example.com" }, profile: { status: "in_sync", dirtyCount: 0, observedAt: null }, hours: { status: "unknown", dirtyCount: 0, observedAt: null }, menu: { status: "unknown", dirtyCount: 0, observedAt: null, eligible: null }, booking: { count: 0, observedAt: null }, photos: { count: 0, observedAt: null }, posts: { drafts: 0, awaitingApproval: 0, failed: 0, published: 0 }, suggestions: { profile: 0, foodMenus: 0 }, lastPublish: null } } }))
  await page.route(/\/api\/import-review\/counts(?:\?.*)?$/, (route) => route.fulfill({ json: { counts: [] } }))
  // The activity drawer only fetches once opened, but the route stays stubbed:
  // leaving it unstubbed would be fatal rather than cosmetic if anything did
  // request it, because stubbing /api/session above means the shell
  // bootstrap never mints the local-bootstrap cookie
  // (components/app-shell/app-shell.tsx), so the real route answers 401
  // `authentication_required` and lib/api/client.ts hard-navigates the whole
  // page to /sign-in mid-assertion.
  await page.route(/\/api\/locations\/location-management\/activity(?:\?.*)?$/, (route) => route.fulfill({ json: { activity: { items: [], total: 0, page: 1, pageSize: 10 } } }))
  // The business profile editor reads BOTH halves of the listing and, for an
  // owner, the industry sections too. Every one of these must answer, for the
  // same reason as the activity route above: an unstubbed route 401s and
  // lib/api/client.ts navigates the whole page to /sign-in mid-assertion.
  // Tests below register their own narrower stubs afterwards, which win.
  await page.route(/\/api\/locations\/location-management\/profile(?:\?.*)?$/, (route) => route.fulfill({ json: { profile: { location: { id: "location-management", name: "Camden Hotel", googleLocationName: "locations/camden" }, canonicalResource: { revision: "1", updatedAt: "2026-08-01T00:00:00.000Z" }, canonicalHash: "c".repeat(64), googleHash: "d".repeat(64), canPublish: true, googleWritesEnabled: true, fields: [{ key: "name", policy: "bidirectional", status: "in_sync", canonicalValue: "Camden Hotel", googleValue: "Camden Hotel", canonicalHash: "c", googleHash: "g", lastReconciledAt: null }], googleDetails: { primaryCategory: "Hotel", additionalCategories: [] }, latestAttempt: null } } }))
  await page.route(/\/api\/locations\/location-management\/industry(?:\?.*)?$/, (route) => route.fulfill({ json: { industry: { lodging: { data: null, error: null }, lodgingUpdated: { data: null, error: null }, calls: { data: null, error: null }, callInsights: { data: null, error: null }, healthcareServices: { data: null, error: null }, providerAttributes: { data: null, error: null }, insuranceNetworks: { data: null, error: null }, canManage: true, writesEnabled: true } } }))
  // The Listing is one scroll: the hours, booking links and suggested updates
  // editors mount beside the profile, so their GETs fire too. Answering with
  // a Google error keeps each in its own honest retry state without the 401
  // hard-navigation the unstubbed routes would cause.
  for (const resource of ["hours", "place-actions", "import-review"]) {
    await page.route(new RegExp(`/api/locations/location-management/${resource}(?:[/?].*)?$`), (route) => route.fulfill({ status: 502, json: { error: { code: "google_unavailable", message: "Google request failed." } } }))
  }
}

async function mockServiceAreaRead(page: Page, location: Record<string, unknown>) {
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET")
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: [] } })
    return route.fulfill({ json: { businessInformation: { location, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
}

for (const width of [375, 768, 1280]) test(`Additional address details review exact set and clear fields at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1100 })
  await mockShell(page)
  const baseline = { storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], languageCode: "en", organization: "Original", recipients: ["Reception"], sortingCode: "old", futureField: "preserved" } }
  let clearing = false
  let saved: Record<string, unknown> | null = null
  let writes = 0
  const masks = ["storefrontAddress.languageCode", "storefrontAddress.organization", "storefrontAddress.sortingCode", "storefrontAddress.recipients"]
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(masks)
      expect(body.payload).toEqual({ storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], languageCode: clearing ? "" : "cy", organization: clearing ? "" : "New organisation", sortingCode: clearing ? "" : "new", recipients: clearing ? [] : ["Reception", "Manager"] } })
      saved = { id: "00000000-0000-4000-8000-000000000034", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ payload: { storefrontAddress: { languageCode: "", organization: "", sortingCode: "", recipients: [] } }, updateMask: masks, changeSetId: "00000000-0000-4000-8000-000000000034" })
      return route.fulfill({ json: { id: "address-details-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const details = page.locator("#profile-address-details")
  await details.getByText("Additional address details", { exact: true }).click()
  const language = details.getByLabel("Address language (optional)", { exact: true })
  const organization = details.getByLabel("Address organisation (optional)", { exact: true })
  const recipients = details.getByLabel("Address recipients (optional)", { exact: true })
  const sorting = details.getByLabel("Postal sorting code (optional)", { exact: true })
  await language.fill("not a tag")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
  await language.fill("cy")
  await organization.fill("New organisation")
  await recipients.fill("")
  await page.keyboard.type("Reception")
  await recipients.press("Enter")
  await page.keyboard.type("Manager")
  await expect(recipients).toHaveValue("Reception\nManager")
  await sorting.fill("new")
  expect((await new AxeBuilder({ page }).include("#profile-address-details").analyze()).violations).toEqual([])
  await details.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
  await details.screenshot({ path: testInfo.outputPath(`address-details-${width}.png`), animations: "disabled" })
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("Reception; Manager", { exact: true })).toBeVisible()
  await expect(review.getByText("New organisation", { exact: true })).toBeVisible()
  await expect(review.getByText("10 High Street", { exact: true })).toHaveCount(0)
  await review.getByRole("button", { name: "Keep editing", exact: true }).click()
  clearing = true
  for (const field of [language, organization, recipients, sorting]) await field.fill("")
  await expect(sorting).toBeVisible()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(review.getByText("Cleared", { exact: true })).toHaveCount(4)
  await review.screenshot({ path: testInfo.outputPath("address-details-clear-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

test("Additional address details omit unknown language and UK sorting controls", async ({ page }) => {
  await mockShell(page)
  await mockServiceAreaRead(page, { storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], recipients: ["valid", 1] } })
  await page.goto("/listings/location-management/profile")
  const details = page.locator("#profile-address-details")
  await details.getByText("Additional address details", { exact: true }).click()
  await expect(details.getByLabel("Address language (optional)", { exact: true })).toHaveValue("")
  await expect(details.getByLabel("Postal sorting code (optional)", { exact: true })).toHaveCount(0)
  await expect(details.getByLabel("Address recipients (optional)", { exact: true })).toBeDisabled()
  await expect(details.getByRole("link", { name: "Manage address details in Google" })).toHaveAttribute("href", "https://business.google.com/locations")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
})

for (const width of [375, 768, 1280]) test(`Google Ads phone reviews an isolated change and clear at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const baseline = { phoneNumbers: { primaryPhone: "+44 20 7946 0100", additionalPhones: ["+44 20 7946 0101"] }, adWordsLocationExtensions: { adPhone: "+44 20 7946 0123" } }
  let clearing = false
  let writes = 0
  let saved: Record<string, unknown> | null = null
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(["adWordsLocationExtensions"])
      expect(body.payload).toEqual({ adWordsLocationExtensions: clearing ? {} : { adPhone: "+44 20 7946 0124" } })
      saved = { id: "00000000-0000-4000-8000-000000000033", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ payload: { adWordsLocationExtensions: {} }, updateMask: ["adWordsLocationExtensions"], changeSetId: "00000000-0000-4000-8000-000000000033" })
      return route.fulfill({ json: { id: "ads-phone-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-advertising")
  const phone = section.getByLabel("Google Ads phone number", { exact: true })
  await expect(phone).toHaveValue("+44 20 7946 0123")
  await phone.fill("+44 20 7946 0124")
  expect((await new AxeBuilder({ page }).include("#section-advertising").analyze()).violations).toEqual([])
  await section.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
  await section.screenshot({ path: testInfo.outputPath(`ads-phone-${width}.png`), animations: "disabled" })
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("+44 20 7946 0124", { exact: true })).toBeVisible()
  await expect(review.getByText("+44 20 7946 0100", { exact: true })).toHaveCount(0)
  await review.getByRole("button", { name: "Keep editing", exact: true }).click()
  clearing = true
  await phone.fill("")
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(review.getByText("Cleared", { exact: true })).toBeVisible()
  await review.screenshot({ path: testInfo.outputPath("ads-phone-clear-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

test("Google Ads phone protects unsupported advertising fields", async ({ page }) => {
  await mockShell(page)
  await mockServiceAreaRead(page, { adWordsLocationExtensions: { adPhone: "+44 20 7946 0123", futureField: "preserved" } })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-advertising")
  await expect(section.getByLabel("Google Ads phone number", { exact: true })).toBeDisabled()
  await expect(section.getByRole("link", { name: "Manage advertising details in Google" })).toHaveAttribute("href", "https://business.google.com/locations")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
})

for (const width of [375, 768, 1280]) test(`Chain affiliation searches, reviews and clears without replacing siblings at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const baseline = { relationshipData: { parentChain: "chains/123", parentLocation: { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF", futureField: "preserved" } } }
  let saved: Record<string, unknown> | null = null
  let expectedChain = "chains/456"
  let writes = 0
  let failedSearches = 0
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    const url = new URL(route.request().url())
    if (method === "GET" && url.searchParams.get("type") === "chains") {
      const query = url.searchParams.get("query")
      if (query === "missing") return route.fulfill({ json: { result: { chains: [] } } })
      if (query === "broken") {
        failedSearches += 1
        return route.fulfill({ json: { result: { chains: [{ name: "invalid-resource" }] } } })
      }
      expect(query).toBe("Example")
      return route.fulfill({ json: { result: { chains: [{ name: "chains/456", chainNames: [{ displayName: "Example Hotels", languageCode: "en" }] }] } } })
    }
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(["relationshipData.parentChain"])
      expect(body.payload).toEqual({ relationshipData: { parentChain: expectedChain } })
      saved = { id: "00000000-0000-4000-8000-000000000031", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ payload: { relationshipData: { parentChain: "" } }, updateMask: ["relationshipData.parentChain"], changeSetId: "00000000-0000-4000-8000-000000000031" })
      return route.fulfill({ json: { id: "chain-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (url.searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-chain")
  const search = section.getByLabel("Search Google chains", { exact: true })
  await search.fill("missing")
  await search.press("Enter")
  await expect(section.getByRole("status")).toContainText("No chains found")
  await search.fill("broken")
  await search.press("Enter")
  await expect(section.getByRole("alert")).toContainText("could not be loaded")
  await search.press("Enter")
  await expect.poll(() => failedSearches).toBe(2)
  await expect(section.getByRole("alert")).toContainText("could not be loaded")
  await search.fill("Example")
  await search.press("Enter")
  const choose = section.getByRole("button", { name: "Select Example Hotels", exact: true })
  await choose.focus()
  await page.keyboard.press("Enter")
  await expect(choose).toBeDisabled()
  expect((await new AxeBuilder({ page }).include("#section-chain").analyze()).violations).toEqual([])
  await section.evaluate((element) => element.scrollIntoView({ block: "start" }))
  await section.screenshot({ path: testInfo.outputPath(`chain-controls-${width}.png`), animations: "disabled" })
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("chains/123", { exact: true })).toBeVisible()
  await expect(review.getByText("chains/456", { exact: true })).toBeVisible()
  await expect(review.getByText(/ChIJ_parent/)).toHaveCount(0)
  await review.getByRole("button", { name: "Keep editing", exact: true }).click()
  expectedChain = ""
  await section.getByRole("button", { name: "Remove affiliation", exact: true }).click()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(review.getByText("Cleared", { exact: true })).toBeVisible()
  await review.screenshot({ path: testInfo.outputPath("chain-clear-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

test("Chain affiliation restores an exact selection without a fresh search", async ({ page }) => {
  await mockShell(page)
  const baseline = { relationshipData: { parentChain: "chains/123" } }
  const draft = { ...draftFromLocation(baseline), relationshipData: { parentChain: "chains/456" } }
  await page.addInitScript((value) => sessionStorage.setItem("naba:draft:location-listing-location-management", JSON.stringify(value)), draft)
  await mockServiceAreaRead(page, baseline)
  await page.goto("/listings/location-management/profile")
  await page.getByRole("button", { name: "Restore unsaved edits", exact: true }).click()
  const section = page.locator("#section-chain")
  await expect(section.getByText("chains/456", { exact: true })).toBeVisible()
  await expect(section.getByLabel("Search Google chains", { exact: true })).toHaveValue("")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeEnabled()
})

test("Chain affiliation protects an unsupported provider resource with a Google handoff", async ({ page }) => {
  await mockShell(page)
  await mockServiceAreaRead(page, { relationshipData: { parentChain: { futureResource: "preserved" } } })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-chain")
  await expect(section.getByLabel("Search Google chains", { exact: true })).toBeDisabled()
  await expect(section.getByRole("link", { name: "Manage it in Google" })).toHaveAttribute("href", "https://business.google.com/locations")
  await expect(section.getByRole("status")).toContainText("cannot be edited safely")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
})

for (const width of [375, 768, 1280]) test(`Related businesses review exact parent and child changes at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1100 })
  await mockShell(page)
  const baseline = { relationshipData: { parentChain: "chains/123", parentLocation: { placeId: "ChIJ_old_parent", relationType: "DEPARTMENT_OF" }, childrenLocations: [{ placeId: "ChIJ_old_child", relationType: "DEPARTMENT_OF" }], futureField: "preserved" } }
  let clearing = false
  let writes = 0
  let saved: Record<string, unknown> | null = null
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(["relationshipData.parentLocation", "relationshipData.childrenLocations"])
      expect(body.payload).toEqual({ relationshipData: clearing ? { parentLocation: {}, childrenLocations: [] } : {
        parentLocation: { placeId: "ChIJ_new_parent", relationType: "INDEPENDENT_ESTABLISHMENT_IN" },
        childrenLocations: [{ placeId: "ChIJ_new_child", relationType: "DEPARTMENT_OF" }],
      } })
      saved = { id: "00000000-0000-4000-8000-000000000032", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ payload: { relationshipData: { parentLocation: {}, childrenLocations: [] } }, updateMask: ["relationshipData.parentLocation", "relationshipData.childrenLocations"], changeSetId: "00000000-0000-4000-8000-000000000032" })
      return route.fulfill({ json: { id: "relationships-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-related-businesses")
  const parent = section.getByRole("group", { name: "Parent business", exact: true })
  const child = section.getByRole("group", { name: "Child businesses", exact: true })
  await parent.getByLabel("Parent business place ID", { exact: true }).fill("invalid place URL")
  const parentType = parent.getByRole("combobox")
  await parentType.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeVisible()
  await expect(page.getByRole("option", { name: "Choose relationship", exact: true })).toBeFocused()
  await page.keyboard.press("End")
  await expect(page.getByRole("option", { name: "Independent business at the same address", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(parentType).toHaveText("Independent business at the same address")
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await parent.getByRole("button", { name: "Set parent business", exact: true }).click()
  await expect(parent.getByText(/Enter a Google place ID without/)).toBeVisible()
  await parent.getByLabel("Parent business place ID", { exact: true }).fill("ChIJ_new_parent")
  await parent.getByRole("button", { name: "Set parent business", exact: true }).click()
  await child.getByLabel("New child business place ID", { exact: true }).fill("ChIJ_old_child")
  await child.getByRole("combobox").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
  await child.getByRole("combobox").click()
  await expect(page.getByRole("option", { name: "Choose relationship", exact: true })).toBeFocused()
  await page.getByRole("option", { name: "Department", exact: true }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await child.getByRole("button", { name: "Add child business", exact: true }).click()
  await expect(child.getByText(/already in the draft/)).toBeVisible()
  await child.getByLabel("New child business place ID", { exact: true }).fill("ChIJ_new_child")
  await child.getByRole("button", { name: "Add child business", exact: true }).click()
  await child.getByRole("button", { name: "Remove child business ChIJ_old_child", exact: true }).click()
  expect((await new AxeBuilder({ page }).include("#section-related-businesses").analyze()).violations).toEqual([])
  for (const [name, group] of [["parent", parent], ["child", child]] as const) {
    await group.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
    await group.screenshot({ path: testInfo.outputPath(`related-businesses-${name}-${width}.png`), animations: "disabled" })
  }
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText(/ChIJ_new_parent/)).toBeVisible()
  await expect(review.getByText(/ChIJ_new_child/)).toBeVisible()
  await expect(review.getByText(/chains\/123/)).toHaveCount(0)
  await review.getByRole("button", { name: "Keep editing", exact: true }).click()
  clearing = true
  await parent.getByRole("button", { name: "Remove parent business ChIJ_new_parent", exact: true }).click()
  await child.getByRole("button", { name: "Remove child business ChIJ_new_child", exact: true }).click()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(review.getByText("Cleared", { exact: true })).toHaveCount(2)
  await review.screenshot({ path: testInfo.outputPath("related-businesses-clear-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

test("Related businesses preserve an unsupported parent while allowing child edits", async ({ page }) => {
  await mockShell(page)
  await mockServiceAreaRead(page, { relationshipData: { parentLocation: { placeId: "ChIJ_unknown", relationType: "DEPARTMENT_OF", futureField: "preserved" } } })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-related-businesses")
  await expect(section.getByLabel("Parent business place ID", { exact: true })).toBeDisabled()
  await expect(section.getByRole("link", { name: "Manage parent businesses in Google" })).toHaveAttribute("href", "https://business.google.com/locations")
  await expect(section.getByLabel("New child business place ID", { exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
})

test("Related businesses restore exact IDs and relationship types", async ({ page }) => {
  await mockShell(page)
  const draft = { ...draftFromLocation({}), relationshipData: {
    parentLocation: { placeId: "ChIJ_restored_parent", relationType: "INDEPENDENT_ESTABLISHMENT_IN" },
    childrenLocations: [{ placeId: "ChIJ_restored_child", relationType: "DEPARTMENT_OF" }],
  } }
  await page.addInitScript((value) => sessionStorage.setItem("naba:draft:location-listing-location-management", JSON.stringify(value)), draft)
  await mockServiceAreaRead(page, {})
  await page.goto("/listings/location-management/profile")
  await page.getByRole("button", { name: "Restore unsaved edits", exact: true }).click()
  const section = page.locator("#section-related-businesses")
  await expect(section.getByText("ChIJ_restored_parent", { exact: true })).toBeVisible()
  await expect(section.getByText("ChIJ_restored_child", { exact: true })).toBeVisible()
  await expect(section.getByRole("group", { name: "Parent business", exact: true }).getByText("Independent business at the same address", { exact: true })).toBeVisible()
  await expect(section.getByRole("group", { name: "Child businesses", exact: true }).getByText("Department", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeEnabled()
})

test("Service areas support keyboard-only initial setup without inventing a country or place ID", async ({ page }) => {
  await mockShell(page)
  await mockServiceAreaRead(page, {})
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-service-area")
  const type = section.getByRole("combobox")
  await expect(type).toHaveText("No service area configured")
  await type.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(type).toHaveText("Customer locations only")
  await expect(type).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(section.getByLabel("Service-area country code", { exact: true })).toBeFocused()
  await expect(section.getByLabel("Service-area country code", { exact: true })).toHaveValue("")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
  await page.keyboard.type("GB")
  await page.keyboard.press("Tab")
  await expect(section.getByRole("checkbox")).toBeFocused()
  await page.keyboard.press("Space")
  await page.keyboard.press("Tab")
  await expect(section.getByLabel("New area name", { exact: true })).toBeFocused()
  await page.keyboard.type("Cambridge")
  await page.keyboard.press("Tab")
  await expect(section.getByLabel("New area place ID", { exact: true })).toBeFocused()
  await expect(section.getByLabel("New area place ID", { exact: true })).toHaveValue("")
  await page.keyboard.type("ChIJ_keyboard")
  await page.keyboard.press("Tab")
  await expect(section.getByRole("button", { name: "Add service area", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(section.getByText("ChIJ_keyboard", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeEnabled()
})

test("Service areas restore exact identifiers and storefront-removal intent", async ({ page }) => {
  await mockShell(page)
  const baseline = { storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } }
  const draft = { ...draftFromLocation(baseline), serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB", places: { placeInfos: [{ placeName: "Ely", placeId: "ChIJ_restored" }] } }, clearStorefrontAddress: true }
  await page.addInitScript((value) => sessionStorage.setItem("naba:draft:location-listing-location-management", JSON.stringify(value)), draft)
  await mockServiceAreaRead(page, baseline)
  await page.goto("/listings/location-management/profile")
  await page.getByRole("button", { name: "Restore unsaved edits", exact: true }).click()
  const section = page.locator("#section-service-area")
  await expect(section.getByRole("combobox")).toHaveText("Customer locations only")
  await expect(section.getByLabel("Service-area country code", { exact: true })).toHaveValue("GB")
  await expect(section.getByText("ChIJ_restored", { exact: true })).toBeVisible()
  await expect(section.getByRole("checkbox")).toBeChecked()
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeEnabled()
})

test("Service areas preserve unsupported provider data and offer a Google handoff", async ({ page }) => {
  await mockShell(page)
  await mockServiceAreaRead(page, { serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB", futureField: "must-preserve" } })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-service-area")
  await expect(section.getByRole("combobox")).toBeDisabled()
  await expect(section.getByRole("link", { name: "Manage service areas in Google" })).toHaveAttribute("href", "https://business.google.com/locations")
  await expect(section.getByRole("status")).toContainText("cannot preserve")
  await expect(section.getByRole("button", { name: "Add service area", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
})

for (const width of [375, 768, 1280]) test(`Service areas review conversion and exact places at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const baseline = { serviceArea: { businessType: "CUSTOMER_AND_BUSINESS_LOCATION", regionCode: "GB", places: { placeInfos: [{ placeName: "Cambridge", placeId: "ChIJ_existing" }] } }, storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } }
  let saved: Record<string, unknown> | null = null
  let writes = 0
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(["serviceArea", "storefrontAddress"])
      expect(body.payload).toEqual({ serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB", places: { placeInfos: [{ placeName: "Ely", placeId: "ChIJ_ely" }] } }, storefrontAddress: {} })
      saved = { id: "00000000-0000-4000-8000-000000000021", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON().changeSetId).toBe("00000000-0000-4000-8000-000000000021")
      return route.fulfill({ json: { id: "area-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-service-area")
  await expect(section.getByText("ChIJ_existing", { exact: true })).toBeVisible()
  await expect(section.getByLabel("Service-area country code", { exact: true })).toBeDisabled()
  await section.getByLabel("New area name", { exact: true }).fill("Cambridge again")
  await section.getByLabel("New area place ID", { exact: true }).fill("ChIJ_existing")
  await section.getByRole("button", { name: "Add service area", exact: true }).click()
  await expect(section.getByText("Each service area must have a different place ID.")).toBeVisible()
  await section.getByRole("button", { name: "Remove service area Cambridge", exact: true }).click()
  await section.getByLabel("New area name", { exact: true }).fill("Ely")
  await section.getByLabel("New area place ID", { exact: true }).fill("ChIJ_ely")
  await section.getByRole("button", { name: "Add service area", exact: true }).focus()
  await page.keyboard.press("Enter")
  await section.getByRole("combobox").click()
  await page.getByRole("option", { name: "Customer locations only", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
  await section.getByRole("checkbox", { name: "Remove the storefront address from this profile" }).check()
  await expect(section.getByRole("combobox")).toHaveText("Customer locations only")
  expect((await new AxeBuilder({ page }).include("#section-service-area").analyze()).violations).toEqual([])
  await section.screenshot({ path: testInfo.outputPath(`service-area-${width}.png`), animations: "disabled" })
  await section.getByLabel("New area place ID", { exact: true }).evaluate((element) => element.scrollIntoView({ block: "center" }))
  await page.screenshot({ path: testInfo.outputPath(`service-area-entry-${width}.png`), animations: "disabled" })
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("Customer locations only; GB; Ely (ChIJ_ely)", { exact: true })).toBeVisible()
  await expect(review.getByText("10 High Street", { exact: true })).toBeVisible()
  await expect(review.getByText("Cleared", { exact: true })).toBeVisible()
  await review.screenshot({ path: testInfo.outputPath("service-area-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

for (const width of [375, 768, 1280]) test(`Address components review editing and clearing at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const baseline = { storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], locality: "Cambridge", postalCode: "CB1 1AA", administrativeArea: "Cambridgeshire", sublocality: "Centre", languageCode: "en" } }
  let saved: Record<string, unknown> | null = null
  let writes = 0
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(["storefrontAddress.administrativeArea", "storefrontAddress.sublocality"])
      expect(body.payload.storefrontAddress).toMatchObject({ locality: "Cambridge", administrativeArea: "", sublocality: "North" })
      saved = { id: "00000000-0000-4000-8000-000000000020", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ updateMask: ["storefrontAddress.administrativeArea", "storefrontAddress.sublocality"], changeSetId: "00000000-0000-4000-8000-000000000020" })
      return route.fulfill({ json: { id: "address-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const address = page.locator("#section-address")
  await address.getByLabel("District or neighbourhood (optional)").fill("North")
  await address.getByLabel("County or region (optional)").click()
  await address.getByLabel("County or region (optional)").fill("")
  await address.getByLabel("County or region (optional)").scrollIntoViewIfNeeded()
  expect((await new AxeBuilder({ page }).include("#section-address").analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`address-controls-${width}.png`), animations: "disabled" })
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("District or neighbourhood", { exact: true })).toBeVisible()
  await expect(review.getByText("North", { exact: true })).toBeVisible()
  await expect(review.getByText("Centre", { exact: true })).toBeVisible()
  await expect(review.getByText("Cambridgeshire", { exact: true })).toBeVisible()
  await expect(review.getByText("Cleared", { exact: true })).toBeVisible()
  await expect(review.getByText("Cambridge", { exact: true })).toHaveCount(0)
  await review.screenshot({ path: testInfo.outputPath("address-leaf-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

for (const width of [375, 768, 1280]) test(`Additional phones preserve the primary and review removal at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const primaryPhone = "+44 20 1111 1111"
  const baseline = { phoneNumbers: { primaryPhone, additionalPhones: ["+44 20 2222 2222", "+44 20 3333 3333"] } }
  let saved: Record<string, unknown> | null = null
  let writes = 0
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      const body = route.request().postDataJSON()
      expect(body.updateMask).toEqual(["phoneNumbers"])
      expect(body.payload.phoneNumbers.primaryPhone).toBe(primaryPhone)
      saved = { id: "00000000-0000-4000-8000-000000000019", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ changeSetId: "00000000-0000-4000-8000-000000000019", payload: { phoneNumbers: { primaryPhone, additionalPhones: [] } } })
      return route.fulfill({ json: { id: "phone-attempt", status: "ambiguous", idempotent: false, executionState: "accepted", confirmationState: "unresolved" } })
    }
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    return route.fulfill({ json: { businessInformation: { location: baseline, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  const section = page.locator("#section-additional-phones")
  await expect(section.getByRole("button", { name: "Add number" })).toHaveCount(0)
  await section.getByRole("button", { name: "Remove additional phone 1" }).click()
  await expect(section.getByLabel("Additional phone 1", { exact: true })).toHaveValue("+44 20 3333 3333")
  await section.getByLabel("New additional phone").fill("+44 20 4444 4444")
  await section.getByRole("button", { name: "Add number" }).focus()
  await page.screenshot({ path: testInfo.outputPath(`additional-phones-add-${width}.png`), animations: "disabled" })
  await page.keyboard.press("Enter")
  await expect(section.getByLabel("Additional phone 2", { exact: true })).toHaveValue("+44 20 4444 4444")
  await section.getByLabel("Additional phone 2", { exact: true }).fill("")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
  await section.getByLabel("Additional phone 2", { exact: true }).fill("+44 20 4444 4444")
  await section.scrollIntoViewIfNeeded()
  expect((await new AxeBuilder({ page }).include("#section-additional-phones").analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`additional-phones-${width}.png`), animations: "disabled" })
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText(`${primaryPhone}, +44 20 3333 3333, +44 20 4444 4444`, { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await section.getByRole("button", { name: "Remove additional phone 2" }).click()
  await section.getByRole("button", { name: "Remove additional phone 1" }).click()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(review.getByText(primaryPhone, { exact: true })).toBeVisible()
  await review.screenshot({ path: testInfo.outputPath(`additional-phones-clear-${width}.png`), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("confirmed")
  expect(writes).toBe(1)
})

for (const width of [375, 768, 1280]) test(`Services review preserves siblings and cleared prices at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const sibling = { freeFormServiceItem: { category: "gcid:plumber", label: { displayName: "Emergency visit", languageCode: "cy" } } }
  let items: unknown[] = [{ structuredServiceItem: { serviceTypeId: "repair", description: "Repairs" }, price: { currencyCode: "GBP", units: "35" } }, sibling]
  let hash = "a".repeat(64)
  let saved: Record<string, unknown> | null = null
  let published = 0
  if (width === 375) await page.addInitScript((draft) => {
    sessionStorage.setItem("naba:draft:services:location-management", JSON.stringify(draft))
  }, [{ item: { structuredServiceItem: { serviceTypeId: "repair", description: "Recovered repairs" }, price: { currencyCode: "GBP", units: "35" } }, priceEdit: { mode: "keep" } }, { item: sibling, priceEdit: { mode: "keep" } }])
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, async (route) => {
    const request = route.request()
    const type = new URL(request.url()).searchParams.get("type")
    if (request.method() === "PUT") {
      const body = request.postDataJSON()
      expect(body.payload.serviceItems).toEqual([{ structuredServiceItem: width === 375 ? { serviceTypeId: "repair" } : { serviceTypeId: "repair", description: "Same-day repairs" } }, sibling])
      saved = { id: "00000000-0000-4000-8000-000000000012", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline: { serviceItems: items }, baselineHash: hash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2026-10-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (request.method() === "POST") {
      saved = { ...saved, approvedBy: "owner" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON()
      expect(body.changeSetId).toBe("00000000-0000-4000-8000-000000000012")
      expect(body.payload).toEqual(saved?.payload)
      items = body.payload.serviceItems
      hash = "b".repeat(64)
      saved = null
      published += 1
      return route.fulfill({ json: { id: "attempt", status: "succeeded", idempotent: false } })
    }
    if (type === "services") return route.fulfill({ json: { serviceMetadata: { categories: [{ name: "gcid:plumber", displayName: "Plumber", serviceTypes: [{ serviceTypeId: "repair", displayName: "Repair fittings" }] }], languageCode: "en", regionCode: "GB", locationHash: hash, observedAt: "2026-09-29T15:00:00Z" } } })
    if (type === "reviews") return route.fulfill({ json: { changeSets: saved ? [saved] : [] } })
    const location = { title: "Camden Hotel", metadata: { canModifyServiceList: true }, serviceItems: items }
    return route.fulfill({ json: { businessInformation: { location, attributes: {}, attributeMetadata: [], locationHash: hash, attributesHash: "d".repeat(64), canPublish: true, writesEnabled: true, capabilityDetails: locationFieldCapabilities({ location, canPublish: true, writesEnabled: true, observedAt: "2026-09-29T15:00:00Z" }) } } })
  })
  await page.goto("/listings/location-management/profile")
  const services = page.getByRole("region", { name: "Services", exact: true })
  await expect(services.getByRole("heading", { name: "Repair fittings" })).toBeVisible()
  if (width === 375) {
    await expect(services.getByLabel("Description", { exact: true }).first()).toHaveValue("Repairs")
    const restore = services.getByRole("button", { name: "Restore unsaved edits" })
    await restore.focus()
    await page.keyboard.press("Enter")
    await expect(services.getByLabel("Description", { exact: true }).first()).toHaveValue("Recovered repairs")
  }
  await services.getByLabel("Description", { exact: true }).first().fill("Same-day repairs")
  if (width === 375) {
    await services.getByRole("button", { name: "Clear description", exact: true }).first().focus()
    await page.keyboard.press("Enter")
    await expect(services.getByLabel("Description", { exact: true }).first()).toHaveValue("")
  }
  await services.getByRole("button", { name: "Clear price", exact: true }).first().click()
  await expect(page.getByText("Everything on this page matches Google.")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Review services", exact: true })).toBeEnabled()
  await services.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath(`services-${width}.png`) })
  await services.getByRole("button", { name: "Review service changes" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath(`services-bottom-${width}.png`) })
  expect((await new AxeBuilder({ page }).include("#section-services").analyze()).violations).toEqual([])
  await services.getByRole("button", { name: "Review service changes" }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText(width === 375 ? /No description.*No price/ : /Same-day repairs.*No price/)).toBeVisible()
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`service-review-${width}.png`) })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(services.getByText("Services confirmed by Google.")).toBeVisible()
  await expect(services.getByRole("button", { name: "Review service changes" })).toBeDisabled()
  expect(published).toBe(1)
})

for (const outcome of ["confirmed", "stale", "awaiting_confirmation"] as const) test(`Saved service review keeps its frozen payload when ${outcome}`, async ({ page }) => {
  await mockShell(page)
  const original = [{ structuredServiceItem: { serviceTypeId: "repair", description: "Original repairs" } }]
  const payload = { serviceItems: [{ structuredServiceItem: { serviceTypeId: "repair", description: "Approved repairs" } }] }
  let saved = {
    id: "00000000-0000-4000-8000-000000000013", locationName: "Camden Hotel", payload,
    updateMask: ["serviceItems"], baseline: { serviceItems: original }, baselineHash: "a".repeat(64),
    payloadHash: "c".repeat(64), requestedBy: "other-owner", approvedBy: null as string | null,
    requiresSecondApprover: true, canApprove: true, expiresAt: "2026-10-01T00:00:00Z",
  }
  let writes = 0
  let approvals = 0
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, async (route) => {
    const request = route.request()
    const type = new URL(request.url()).searchParams.get("type")
    if (request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ changeSetId: saved.id, expectedPayloadHash: saved.payloadHash })
      approvals += 1
      saved = { ...saved, approvedBy: "user-management" }
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (request.method() === "PATCH") {
      writes += 1
      expect(request.postDataJSON()).toEqual({ operation: "update_location", confirmation: "publish_business_information_to_google", payload, updateMask: ["serviceItems"], expectedGoogleHash: saved.baselineHash, changeSetId: saved.id })
      if (outcome === "stale") return route.fulfill({ status: 409, json: { error: "approval_stale", message: "Google changed since this review. Refresh and review again." } })
      return route.fulfill({ json: { id: "attempt-saved", status: outcome === "confirmed" ? "succeeded" : "awaiting_confirmation", idempotent: false } })
    }
    if (request.method() !== "GET") throw new Error("Reopening a saved review must not create a replacement preview")
    if (type === "reviews") return route.fulfill({ json: { changeSets: writes && outcome !== "stale" ? [] : [saved] } })
    if (type === "services") return route.fulfill({ json: { serviceMetadata: { categories: [{ name: "gcid:plumber", displayName: "Plumber", serviceTypes: [{ serviceTypeId: "repair", displayName: "Repair fittings" }] }], languageCode: "en", regionCode: "GB", locationHash: "a".repeat(64), observedAt: "2026-09-29T15:00:00Z" } } })
    const location = { title: "Camden Hotel", metadata: { canModifyServiceList: true }, serviceItems: writes && outcome === "confirmed" ? payload.serviceItems : original }
    return route.fulfill({ json: { businessInformation: { location, attributes: {}, attributeMetadata: [], locationHash: (writes && outcome === "confirmed" ? "b" : "a").repeat(64), attributesHash: "d".repeat(64), canPublish: true, writesEnabled: true, capabilityDetails: locationFieldCapabilities({ location, canPublish: true, writesEnabled: true, observedAt: "2026-09-29T15:00:00Z" }) } } })
  })
  await page.goto("/listings/location-management/profile")
  const services = page.getByRole("region", { name: "Services", exact: true })
  await services.getByLabel("Description", { exact: true }).fill("Unreviewed local edit")
  await services.getByRole("button", { name: "Open saved service review" }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText(/Approved repairs/)).toBeVisible()
  await expect(review.getByText(/Unreviewed local edit/)).toHaveCount(0)
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  if (outcome === "stale") {
    await expect(review.getByText("Google changed since this review. Refresh and review again.")).toBeVisible()
    await review.getByRole("button", { name: "Keep editing" }).click()
  } else {
    await expect(services.getByText(outcome === "confirmed" ? "Services confirmed by Google." : "The recorded attempt is not confirmed. Check activity before submitting another change.")).toBeVisible()
  }
  await expect(services.getByLabel("Description", { exact: true })).toHaveValue("Unreviewed local edit")
  expect(approvals).toBe(1)
  expect(writes).toBe(1)
})

for (const width of [375, 1280]) test(`Opening date review and clearing at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  let writes = 0
  let dateReview: Record<string, unknown> | null = null
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON()
      dateReview = { id: "00000000-0000-4000-8000-000000000014", locationName: "Camden Hotel", payload: body.payload, updateMask: body.updateMask, baseline: { openInfo: { status: "OPEN", openingDate: { year: 2000, month: 3, day: 1 } } }, baselineHash: body.expectedGoogleHash, payloadHash: "c".repeat(64), requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
      return route.fulfill({ json: { changeSet: dateReview } })
    }
    if (route.request().method() === "POST") return route.fulfill({ json: { changeSet: { ...dateReview, approvedBy: "owner" } } })
    if (new URL(route.request().url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: dateReview ? [dateReview] : [] } })
    if (route.request().method() === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON().updateMask).toEqual(["openInfo.openingDate"])
      expect(route.request().postDataJSON().changeSetId).toBe("00000000-0000-4000-8000-000000000014")
      return route.fulfill({ json: { id: "opening-date-attempt", status: "ambiguous", idempotent: false, executionState: "unknown", confirmationState: "unresolved" } })
    }
    return route.fulfill({ json: { businessInformation: {
    location: { title: "Camden Hotel", openInfo: { status: "OPEN", openingDate: { year: 2000, month: 3, day: 1 } } },
    attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true,
  } } }) })
  await page.goto("/listings/location-management/profile")
  const opening = page.locator("#section-opening")
  await opening.getByLabel("Year", { exact: true }).fill("2001")
  await opening.getByLabel("Month", { exact: true }).fill("2")
  await opening.getByLabel("Day (optional)").fill("30")
  await expect(opening.getByRole("alert")).toContainText("valid day")
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled()
  await opening.getByLabel("Day (optional)").fill("")
  await opening.getByRole("button", { name: "Clear opening date" }).scrollIntoViewIfNeeded()
  await opening.getByRole("button", { name: "Clear opening date" }).focus()
  await page.screenshot({ path: testInfo.outputPath(`opening-date-${width}.png`), animations: "disabled" })
  expect((await new AxeBuilder({ page }).include("#section-opening").analyze()).violations).toEqual([])
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("February 2001", { exact: true })).toBeVisible()
  await expect(review.getByText("1 March 2000", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await opening.getByRole("button", { name: "Clear opening date" }).click()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  await expect(review.getByText("Not set", { exact: true })).toBeVisible()
  await review.screenshot({ path: testInfo.outputPath(`opening-date-clear-${width}.png`), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review.getByText("Not confirmed", { exact: true })).toBeVisible()
  await expect(review.getByRole("button", { name: "Try again" })).toBeDisabled()
  await expect(review.getByRole("alert")).toContainText("Activity")
  expect(writes).toBe(1)
  await review.screenshot({ path: testInfo.outputPath(`opening-date-unresolved-${width}.png`), animations: "disabled" })
})

test("Saved opening-date review publishes its frozen date while another draft is retained", async ({ page }, testInfo) => {
  await mockShell(page)
  let writes = 0
  let approvals = 0
  const change = { id: "00000000-0000-4000-8000-000000000015", locationName: "Camden Hotel", baselineHash: "a".repeat(64), payloadHash: "c".repeat(64),
    baseline: { openInfo: { status: "OPEN", openingDate: { year: 2000, month: 3, day: 1 } } }, payload: { openInfo: { status: "OPEN", openingDate: { year: 2001, month: 4 } } },
    updateMask: ["openInfo.openingDate"], requestedBy: "other-manager", approvedBy: null, requiresSecondApprover: true, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const request = route.request()
    if (request.method() === "POST") { approvals += 1; return route.fulfill({ json: { changeSet: { ...change, approvedBy: "reviewer" } } }) }
    if (request.method() === "PATCH") {
      expect(request.postDataJSON()).toMatchObject({ changeSetId: change.id, payload: change.payload, expectedGoogleHash: change.baselineHash })
      writes += 1
      return route.fulfill({ json: { id: "attempt", status: "succeeded", idempotent: false, confirmationState: "confirmed", executionState: "accepted" } })
    }
    if (new URL(request.url()).searchParams.get("type") === "reviews") return route.fulfill({ json: { changeSets: writes ? [] : [change] } })
    return route.fulfill({ json: { businessInformation: { location: writes ? change.payload : change.baseline, attributes: {}, attributeMetadata: [], locationHash: (writes ? "b" : "a").repeat(64), attributesHash: "d".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  await page.locator("#section-opening").getByLabel("Year", { exact: true }).fill("2002")
  await page.getByRole("button", { name: "Review 1 saved profile field", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("April 2001", { exact: true })).toBeVisible()
  await review.screenshot({ path: testInfo.outputPath("saved-opening-date-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google", exact: true }).click()
  await expect(review).toBeHidden()
  expect(approvals).toBe(1)
  expect(writes).toBe(1)
  await expect(page.locator("#section-opening").getByLabel("Year", { exact: true })).toHaveValue("2002")
})

test("Business profile editor renders live Google data with humanised fields", async ({ page }) => {
  await mockShell(page)
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { capabilityDetails: locationFieldCapabilities({ location: {}, canPublish: true, writesEnabled: true, observedAt: "2026-09-29T12:00:00.000Z" }), location: { title: "Camden Hotel", storeCode: "CAMDEN-1", labels: ["hotel"], openInfo: { status: "OPEN" }, categories: { primaryCategory: { name: "categories/gcid:hotel" } }, serviceItems: [{ foo: 1 }] }, attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [true] }] }, attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  await page.goto("/listings/location-management/profile")
  // The raw title, editable in place — never a read-only "approved payload".
  await expect(page.getByRole("textbox", { name: "Business name" })).toHaveValue("Camden Hotel")
  // The primary category humanises from the gcid (categories/gcid:hotel ->
  // "Hotel"); the raw gcid string never reaches the page.
  await expect(page.getByText("Hotel", { exact: true })).toBeVisible()
  await expect(page.getByText(/gcid:/)).toHaveCount(0)
  // Regression lock (spec §7, sibling fix to the Calls select below): the
  // Open status trigger must read its humanised label on first paint too,
  // never the raw Google enum ("OPEN").
  await expect(page.getByRole("combobox", { name: "Open status" })).toHaveText("Open")
  // One primary action for the whole listing; publishing happens inside the
  // review sheet it opens.
  await expect(page.getByRole("button", { name: "Review changes" })).toBeVisible()
  // serviceItems has no typed control (spec §12 pressure valve) -> a
  // read-only note naming it, never raw JSON.
  await expect(page.getByText(/can edit yet/i)).toBeVisible()
  await expect(page.getByText(/Services: Google eligibility has not been confirmed/)).toBeVisible()
})

for (const width of [375, 1280]) test(`Attribute metadata controls and enum clear at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await mockShell(page)
  const saved = { id: "00000000-0000-4000-8000-000000000016", locationName: "Camden Hotel", payloadHash: "c".repeat(64), baselineHash: "b".repeat(64), payload: { attributes: [] }, baseline: { attributes: [{ name: "attributes/wifi", values: ["FREE"] }] }, updateMask: ["attributes/wifi"], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" }
  let writes = 0
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      expect(route.request().postDataJSON()).toMatchObject({ operation: "update_attributes", attributes: [], attributeMask: saved.updateMask })
      return route.fulfill({ json: { changeSet: saved } })
    }
    if (method === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ changeSetId: saved.id, resourceType: "attributes" })
      return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "owner" } } })
    }
    if (method === "PATCH") {
      writes += 1
      expect(route.request().postDataJSON()).toMatchObject({ changeSetId: saved.id, attributes: [], attributeMask: saved.updateMask, expectedGoogleHash: saved.baselineHash })
      return route.fulfill({ json: { id: "attempt", status: "succeeded", idempotent: false, confirmationState: "confirmed" } })
    }
    if (route.request().url().includes("type=")) return route.fulfill({ json: { changeSets: [] } })
    return route.fulfill({ json: { businessInformation: {
    location: {}, attributes: { attributes: [{ name: "attributes/wifi", values: ["FREE"] }, { name: "attributes/old", values: [true] }] },
    attributeMetadata: [
      { parent: "attributes/wifi", displayName: "Wi-Fi price", valueType: "ENUM", valueMetadata: [{ value: "FREE", displayName: "Free" }] },
      { parent: "attributes/old", displayName: "Old amenity", valueType: "BOOL", deprecated: true },
    ], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true,
  } } })
  })
  await page.goto("/listings/location-management/profile")
  await expect(page.getByText("Google no longer accepts changes to this attribute.")).toBeVisible()
  await expect(page.getByRole("switch", { name: "Old amenity" })).toHaveCount(0)
  await page.getByRole("button", { name: "Clear Wi-Fi price" }).click()
  await expect(page.getByRole("combobox", { name: "Wi-Fi price" })).toHaveText("Not set")
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("Free", { exact: true })).toBeVisible()
  await expect(review.getByText("Not set", { exact: true })).toBeVisible()
  await expect(review.getByText("Old amenity", { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("attribute-clear-review.png"), animations: "disabled" })
  await review.getByRole("button", { name: "Publish to Google" }).click()
  await expect(review).not.toBeVisible()
  expect(writes).toBe(1)
})

for (const canApprove of [false, true]) test(`Saved attribute review preserves drafts with canApprove=${canApprove}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await mockShell(page)
  const name = "attributes/wifi"
  const saved = { id: "00000000-0000-4000-8000-000000000017", locationName: "Camden Hotel", payloadHash: "c".repeat(64), baselineHash: "b".repeat(64), payload: { attributes: [] }, baseline: { attributes: [{ name, values: [false] }] }, updateMask: [name], requestedBy: "requester", approvedBy: null, requiresSecondApprover: true, canApprove, expiresAt: "2027-01-01T00:00:00Z" }
  const methods: string[] = []
  let published = false
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    const method = route.request().method()
    if (method !== "GET") methods.push(method)
    if (method === "POST") {
      expect(route.request().postDataJSON()).toEqual({ changeSetId: saved.id, expectedPayloadHash: saved.payloadHash, resourceType: "attributes" })
      return route.fulfill({ json: { changeSet: { ...saved, approvedBy: "reviewer" } } })
    }
    if (method === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({ operation: "update_attributes", confirmation: "publish_business_attributes_to_google", attributes: [], attributeMask: [name], changeSetId: saved.id, expectedGoogleHash: saved.baselineHash })
      published = true
      return route.fulfill({ json: { id: "attempt", status: "succeeded", idempotent: false, confirmationState: "confirmed" } })
    }
    if (route.request().url().includes("type=attribute_reviews")) return route.fulfill({ json: { changeSets: published ? [] : [saved] } })
    if (route.request().url().includes("type=reviews")) return route.fulfill({ json: { changeSets: [] } })
    return route.fulfill({ json: { businessInformation: { location: {}, attributes: { attributes: published ? [] : [{ name, values: [false] }] }, attributeMetadata: [{ parent: name, displayName: "Wi-Fi", valueType: "BOOL" }], locationHash: "a".repeat(64), attributesHash: (published ? "d" : "b").repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  await page.getByRole("textbox", { name: "Business name" }).fill("Unpublished local name")
  await page.getByRole("button", { name: "Review 1 saved attribute", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("No", { exact: true })).toBeVisible()
  await expect(review.getByText("Not set", { exact: true })).toBeVisible()
  await expect(review.getByText("Unpublished local name")).toHaveCount(0)
  const publish = review.getByRole("button", { name: "Publish to Google" })
  await page.screenshot({ path: testInfo.outputPath("saved-attribute-review.png"), animations: "disabled" })
  if (canApprove) {
    await publish.click()
    await expect(review).not.toBeVisible()
    expect(methods).toEqual(["POST", "PATCH"])
  } else {
    await expect(publish).toBeDisabled()
    await expect(review.getByText("A different authorised user must approve this saved review.")).toBeVisible()
    expect(methods).toEqual([])
    await review.getByRole("button", { name: "Keep editing" }).click()
  }
  await expect(page.getByRole("textbox", { name: "Business name" })).toHaveValue("Unpublished local name")
})

test("Repeated enum answers preserve siblings in the saved review", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await mockShell(page)
  const name = "attributes/payments"
  const baseline = { attributes: [{ name, repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque"] } }] }
  const payload = { attributes: [{ name, repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque", "card"] } }] }
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toMatchObject({ attributes: payload.attributes, attributeMask: [name] })
      return route.fulfill({ json: { changeSet: { id: "00000000-0000-4000-8000-000000000018", locationName: "Camden Hotel", payloadHash: "c".repeat(64), baselineHash: "b".repeat(64), baseline, payload, updateMask: [name], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" } } })
    }
    if (route.request().url().includes("type=")) return route.fulfill({ json: { changeSets: [] } })
    return route.fulfill({ json: { businessInformation: { location: {}, attributes: baseline, attributeMetadata: [{ parent: name, displayName: "Payments", valueType: "REPEATED_ENUM", valueMetadata: [{ value: "cash", displayName: "Cash" }, { value: "card", displayName: "Card" }, { value: "cheque", displayName: "Cheque" }] }], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  await page.getByRole("combobox", { name: "Payments: Card" }).click()
  await page.getByRole("option", { name: "No", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Payments: Cash" })).toHaveText("Yes")
  await expect(page.getByRole("combobox", { name: "Payments: Cheque" })).toHaveText("No")
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("Cash: Yes; Card: Not set; Cheque: No", { exact: true })).toBeVisible()
  await expect(review.getByText("Cash: Yes; Card: No; Cheque: No", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("repeated-enum-review.png"), animations: "disabled" })
})

test("Multiple URL attributes remove one value and review all remaining URLs", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await mockShell(page)
  const name = "attributes/menu"
  const baseline = { attributes: [{ name, uriValues: [{ uri: "https://example.com/food" }, { uri: "https://example.com/drinks" }] }] }
  const payload = { attributes: [{ name, uriValues: [{ uri: "https://example.com/food" }, { uri: "https://example.com/wine" }] }] }
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toMatchObject({ attributes: payload.attributes, attributeMask: [name] })
      return route.fulfill({ json: { changeSet: { id: "00000000-0000-4000-8000-000000000019", locationName: "Camden Hotel", payloadHash: "c".repeat(64), baselineHash: "b".repeat(64), baseline, payload, updateMask: [name], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T00:00:00Z" } } })
    }
    if (route.request().url().includes("type=")) return route.fulfill({ json: { changeSets: [] } })
    return route.fulfill({ json: { businessInformation: { location: {}, attributes: baseline, attributeMetadata: [{ parent: name, displayName: "Menu links", valueType: "URL", repeatable: true }], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } })
  })
  await page.goto("/listings/location-management/profile")
  await page.getByRole("button", { name: "Remove Menu links URL 2" }).click()
  await expect(page.getByRole("textbox", { name: "Menu links URL 1", exact: true })).toHaveValue("https://example.com/food")
  await page.getByRole("textbox", { name: "New Menu links URL" }).fill("https://example.com/wine")
  await page.getByRole("button", { name: "Add URL", exact: true }).click()
  await page.getByRole("button", { name: "Review changes", exact: true }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("https://example.com/food, https://example.com/drinks", { exact: true })).toBeVisible()
  await expect(review.getByText("https://example.com/food, https://example.com/wine", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("multiple-url-review.png"), animations: "disabled" })
})

test("Industry sections omit retired controls and surface a failing section honestly", async ({ page }) => {
  await mockShell(page)
  const available = (data: Record<string, unknown>) => ({ data, error: null })
  await page.route(/\/api\/locations\/location-management\/industry(?:\?.*)?$/, (route) => route.fulfill({ json: { industry: { lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({ diffMask: "policies" }), calls: available({ callsState: "ENABLED" }), callInsights: available({ businessCallsInsights: [] }), healthcareServices: { data: null, error: "Google request failed." }, providerAttributes: available({ attributes: [] }), insuranceNetworks: available({ networks: [] }), canManage: true, writesEnabled: true } } }))
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: { title: "Camden Hotel", metadata: { canOperateLodgingData: true } }, attributes: { name: "locations/camden/attributes", attributes: [] }, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  await page.goto("/listings/location-management/profile")
  await expect(page.getByRole("heading", { name: "Lodging", exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Calls" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Save calls" })).toHaveCount(0)
  await expect(page.getByText("Provider attributes", { exact: true })).toHaveCount(0)
  // The failing healthcareServices sub-resource shows the honest per-section
  // warning, never the raw Google error string.
  await expect(page.getByText("We couldn't load healthcare services from Google right now. Try refreshing in a moment.")).toBeVisible()
})

test("Lodging publishes only the frozen reviewed change and preserves sibling amenities", async ({ page }, testInfo) => {
  await mockShell(page)
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: { metadata: { canOperateLodgingData: true } }, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  const changeSet = { id: "22222222-2222-4222-8222-222222222222", locationName: "Camden Hotel", targetResourceName: "locations/camden", payloadHash: "b".repeat(64), baselineHash: "a".repeat(64), payload: { pets: { petsAllowed: true }, metadata: { updateTime: "2026-09-29T12:00:00Z" } }, baseline: { pets: { petsAllowed: false, catsAllowed: true } }, updateMask: ["pets.petsAllowed", "metadata.updateTime"], requestedBy: "owner", approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2027-01-01T12:00:00Z" }
  let writes = 0
  let approvals = 0
  await page.route(/\/api\/locations\/location-management\/industry(?:\?.*)?$/, async (route) => {
    const method = route.request().method()
    if (method === "PUT") {
      expect(route.request().postDataJSON()).toEqual({ payload: { pets: { petsAllowed: true } }, updateMask: ["pets.petsAllowed"], expectedGoogleHash: "a".repeat(64) })
      await route.fulfill({ json: { changeSet } })
    } else if (method === "POST") {
      expect(route.request().postDataJSON()).toEqual({ action: "approve_lodging", changeSetId: changeSet.id, expectedPayloadHash: changeSet.payloadHash })
      approvals += 1
      await route.fulfill({ json: { changeSet: { ...changeSet, approvedBy: "owner" } } })
    } else if (method === "PATCH") {
      expect(approvals).toBe(1)
      expect(route.request().postDataJSON()).toMatchObject({ changeSetId: changeSet.id, payload: changeSet.payload, updateMask: changeSet.updateMask })
      writes += 1
      await route.fulfill({ json: { id: "attempt", status: "succeeded", idempotent: false, executionState: "accepted", confirmationState: "confirmed" } })
    } else {
      if (new URL(route.request().url()).searchParams.get("type") === "workflows") {
        await route.fulfill({ json: { items: [], nextCursor: null } }); return
      }
      const empty = { data: null, error: null }
      await route.fulfill({ json: { industry: { lodging: { data: { pets: { petsAllowed: writes > 0, catsAllowed: true } }, error: null }, lodgingUpdated: empty, calls: empty, callInsights: empty, healthcareServices: empty, providerAttributes: empty, insuranceNetworks: empty, canManage: true, writesEnabled: true, lodgingHash: "a".repeat(64), lodgingChangeSets: [] } } })
    }
  })
  await page.goto("/listings/location-management/profile")
  await page.getByRole("searchbox", { name: "Find a lodging detail" }).fill("Pets allowed")
  const lodging = page.getByRole("region", { name: "Lodging details", exact: true })
  await lodging.getByRole("combobox", { name: "Pets allowed", exact: true }).click()
  await page.getByRole("option", { name: "Yes", exact: true }).click()
  await page.getByRole("button", { name: "Review lodging changes" }).click()
  const review = page.getByRole("dialog", { name: "Review changes" })
  await expect(review.getByText("No", { exact: true })).toBeVisible()
  await expect(review.getByText("Yes", { exact: true })).toBeVisible()
  expect(writes).toBe(0)
  await page.screenshot({ path: testInfo.outputPath("lodging-review.png"), fullPage: true })
  await review.getByRole("button", { name: "Approve lodging changes", exact: true }).click()
  expect(writes).toBe(0)
  await expect(review.getByRole("button", { name: "Send approved lodging changes", exact: true })).toBeDisabled()
  await review.getByRole("checkbox", { name: "Send these exact approved lodging changes to Google." }).check()
  await review.getByRole("button", { name: "Send approved lodging changes", exact: true }).click()
  await expect(page.getByText("Lodging details confirmed by Google")).toBeVisible()
  expect(writes).toBe(1)
})

for (const resourceType of ["lodging", "business_info", "attributes"] as const) test(`Activity checks ${resourceType} confirmation without resubmitting the change`, async ({ page }, testInfo) => {
  await mockShell(page)
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: {}, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  let confirmed = false
  let confirmations = 0
  let writes = 0
  const mutationId = "11111111-1111-4111-8111-111111111111"
  await page.route(/\/api\/locations\/location-management\/activity(?:\?.*)?$/, (route) => route.fulfill({ json: { activity: { canManage: true, items: [{ id: `management:${mutationId}`, sourceId: mutationId, source: "management", resourceType, operation: resourceType === "lodging" ? "update_lodging" : "patch", status: confirmed ? "succeeded" : "ambiguous", canConfirm: !confirmed, executionState: "accepted", confirmationState: confirmed ? "confirmed" : "unresolved", targetResourceName: "locations/camden", lastErrorCode: null, updateMask: resourceType === "lodging" ? ["pets.petsAllowed"] : ["serviceItems"], createdAt: "2026-09-29T12:00:00Z", finishedAt: "2026-09-29T12:01:00Z", actorUserId: "owner", actorDisplayName: "Alex Morgan" }], total: 1, page: 1, pageSize: 10 } } }))
  await page.route(new RegExp(`/api/locations/location-management/${resourceType === "lodging" ? "industry" : "business-information"}(?:\\?.*)?$`), async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ mutationId })
      confirmations += 1
      confirmed = true
      await route.fulfill({ json: { id: mutationId, status: "succeeded", idempotent: false, executionState: "accepted", confirmationState: "confirmed" } })
      return
    }
    if (route.request().method() === "PATCH") writes += 1
    await route.fallback()
  })
  await page.goto("/listings/location-management/profile")
  await page.getByRole("button", { name: "Activity", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Recent activity" })
  await expect(dialog.getByText(/Google confirmation: unresolved/)).toBeVisible()
  await dialog.getByRole("button", { name: "Check Google confirmation" }).click()
  await expect(dialog.getByText(/Google confirmation: confirmed/)).toBeVisible()
  expect(confirmations).toBe(1)
  expect(writes).toBe(0)
  await page.screenshot({ path: testInfo.outputPath(`${resourceType}-confirmation.png`) })
})

test("Activity navigates write families with cursors and preserves older page responses", async ({ page }, testInfo) => {
  await mockShell(page)
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: {}, attributes: {}, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  let cursorRequests = 0
  await page.route(/\/api\/locations\/location-management\/activity(?:\?.*)?$/, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor")
    if (cursor) { expect(cursor).toBe("saved-cursor"); cursorRequests += 1 }
    const families = cursor ? ["posts", "reviews"] : ["hours", "profile", "media", "food_menus", "place_actions"]
    return route.fulfill({ json: { activity: { canManage: true, items: families.map((resourceType) => ({ id: `${resourceType}:test`, sourceId: "test", resourceType, operation: "publish", status: "succeeded", targetResourceName: null, lastErrorCode: null, updateMask: [], createdAt: "2026-09-29T12:00:00Z", finishedAt: null, actorUserId: null, actorDisplayName: null, confirmationState: "unrecorded" })), total: 12, page: cursor ? 2 : 1, pageSize: 10, nextCursor: cursor ? null : "saved-cursor" } } })
  })
  await page.goto("/listings/location-management/profile")
  await page.getByRole("button", { name: "Activity", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Recent activity" })
  await expect(dialog.getByText("Publish · Hours", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Next" }).click()
  await expect(dialog.getByText("Publish · Reviews", { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Google confirmation:/)).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled()
  expect(cursorRequests).toBe(1)
  await page.screenshot({ path: testInfo.outputPath("unified-activity.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Previous" }).click()
  await expect(dialog.getByText("Publish · Hours", { exact: true })).toBeVisible()
})

test("Access tab humanises admin roles and gates delete behind a typed name", async ({ page }) => {
  await mockShell(page)
  const available = (data: Record<string, unknown>) => ({ data, error: null })
  await page.route(/\/api\/locations\/location-management\/administration(?:\?.*)?$/, (route) => route.fulfill({ json: { administration: { voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }), verificationOptions: available({ options: [{ verificationMethod: "EMAIL" }] }), googleUpdated: available({ diffMask: "title" }), locationAdmins: available({ admins: [{ admin: "Owner", role: "PRIMARY_OWNER" }] }), accountAdmins: available({ admins: [] }), invitations: available({ invitations: [] }), accountName: "accounts/1", googleLocationName: "locations/camden", canManage: true, writesEnabled: true } } }))
  await page.goto("/listings/location-management/people")
  // "PRIMARY_OWNER" (the raw Google role) never reaches the page.
  await expect(page.getByText("Primary owner", { exact: true })).toBeVisible()
  await expect(page.getByText("PRIMARY_OWNER")).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible()

  await page.getByRole("button", { name: "Delete this location" }).click()
  const confirm = page.getByRole("button", { name: "Delete location" })
  await expect(confirm).toBeDisabled()
  await page.getByLabel("Type the location's name to confirm").fill("Camden Hotel")
  await expect(confirm).toBeEnabled()
})
