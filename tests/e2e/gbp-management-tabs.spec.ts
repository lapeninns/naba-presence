import { expect, test, type Page } from "@playwright/test"

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
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, (route) => route.fulfill({ json: { total: 0, byStatus: {}, byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 } } }))
  // The shell reads the client list for its sidebar, its breadcrumbs and its
  // health chip. Leaving it unstubbed is fatal for the same reason the
  // activity route below is: the real route answers 401 and lib/api/client.ts
  // hard-navigates the page to /sign-in mid-assertion.
  await page.route(/\/api\/clients(?:\?.*)?$/, (route) => route.fulfill({ json: { items: [{ id: "client-management", name: "Camden Group", slug: "camden-group", colour: null, logoUrl: null, notes: null, archivedAt: null, createdAt: "2026-07-01T09:00:00Z", locationCount: 1, linkedCount: 1, verifiedCount: 1, health: "healthy", connections: [], openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 }, backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 }, lastSyncAt: "2026-07-31T09:00:00Z" }], unassignedLocationCount: 0 } }))
  await page.route(/\/api\/organisations(?:\?.*)?$/, (route) => route.fulfill({ json: { items: [] } }))
  // All three consoles gate their editors on this capability (owner/admin
  // only); Business info also reads it for the field-level disabled state.
  await page.route(/\/api\/locations\/location-management\/capabilities(?:\?.*)?$/, (route) => route.fulfill({ json: { capabilities: { canEditCanonical: true, canPublish: true } } }))
  // Two more workspace-level GETs that fire on every location tab: the tab
  // nav's pending-proposal badges (components/locations/location-tab-nav.tsx)
  // and the Recent activity panel below.
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
}

test("Business profile editor renders live Google data with humanised fields", async ({ page }) => {
  await mockShell(page)
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: { title: "Camden Hotel", storeCode: "CAMDEN-1", labels: ["hotel"], openInfo: { status: "OPEN" }, categories: { primaryCategory: { name: "categories/gcid:hotel" } }, serviceItems: [{ foo: 1 }] }, attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [true] }] }, attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  await page.goto("/locations/location-management")
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
})

test("Industry sections humanise Business Calls state and surface a failing section honestly", async ({ page }) => {
  await mockShell(page)
  const available = (data: Record<string, unknown>) => ({ data, error: null })
  await page.route(/\/api\/locations\/location-management\/industry(?:\?.*)?$/, (route) => route.fulfill({ json: { industry: { lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({ diffMask: "policies" }), calls: available({ callsState: "ENABLED" }), callInsights: available({ businessCallsInsights: [] }), healthcareServices: { data: null, error: "Google request failed." }, providerAttributes: available({ attributes: [] }), insuranceNetworks: available({ networks: [] }), canManage: true, writesEnabled: true } } }))
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: { title: "Camden Hotel", metadata: { canOperateLodgingData: true } }, attributes: { name: "locations/camden/attributes", attributes: [] }, attributeMetadata: [], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  // Lodging and calls are sections of the business profile now.
  await page.goto("/locations/location-management")
  // The status badge already humanises correctly ("Currently On", never
  // "Currently ENABLED").
  await expect(page.getByText("Currently On")).toBeVisible()
  // Base UI's <Select.Value> resolves its label from registered
  // <Select.Item>s, which only register once the popup has mounted at least
  // once — a bare <SelectValue /> would show the raw Google enum
  // ("ENABLED") on first paint, before any interaction. industry-sections.tsx
  // passes a children-render-function using callsStateLabel so the trigger
  // matches the "Currently On" badge above from the very first render.
  await expect(page.getByRole("combobox", { name: "Calls" })).toHaveText("On")
  // The failing healthcareServices sub-resource shows the honest per-section
  // warning, never the raw Google error string.
  await expect(page.getByText("We couldn't load healthcare services from Google right now. Try refreshing in a moment.")).toBeVisible()
})

test("Access tab humanises admin roles and gates delete behind a typed name", async ({ page }) => {
  await mockShell(page)
  const available = (data: Record<string, unknown>) => ({ data, error: null })
  await page.route(/\/api\/locations\/location-management\/administration(?:\?.*)?$/, (route) => route.fulfill({ json: { administration: { voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }), verificationOptions: available({ options: [{ verificationMethod: "EMAIL" }] }), googleUpdated: available({ diffMask: "title" }), locationAdmins: available({ admins: [{ admin: "Owner", role: "PRIMARY_OWNER" }] }), accountAdmins: available({ admins: [] }), invitations: available({ invitations: [] }), accountName: "accounts/1", googleLocationName: "locations/camden", canManage: true, writesEnabled: true } } }))
  await page.goto("/locations/location-management/access")
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
