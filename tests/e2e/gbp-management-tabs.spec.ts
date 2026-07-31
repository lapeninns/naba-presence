import { expect, test, type Page } from "@playwright/test"

async function mockShell(page: Page) {
  await page.route(/\/api\/session(?:\?.*)?$/, (route) => route.fulfill({ json: { session: { sessionId: "session-management", userId: "user-management", organisationId: "org-management", organisationName: "Naba Presence", displayName: "Alex Morgan", email: "alex@example.com", role: "owner", canPublish: true } } }))
  await page.route(/\/api\/location-links(?:\?.*)?$/, (route) => route.fulfill({ json: { locations: [{ locationId: "location-management", name: "Camden Hotel", timezone: "Europe/London", address: { addressLines: ["10 Camden High Street"], locality: "London", postalCode: "NW1 0JH", regionCode: "GB" }, linkId: "link-management", externalLocationId: "external-management", googleLocationName: "locations/camden", googleTitle: "Camden Hotel", verified: true }] } }))
  await page.route(/\/api\/google\/connections(?:\?.*)?$/, (route) => route.fulfill({ json: { connections: [{ id: "connection-management", googleEmail: "owner@example.com", status: "active", notificationsEnabled: true, lastRefreshAt: "2026-07-31T09:00:00Z", lastErrorCode: null, reconnectRequired: false, createdAt: "2026-07-01T09:00:00Z" }] } }))
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, (route) => route.fulfill({ json: { total: 0, byStatus: {} } }))
  await page.route(/\/api\/organisations(?:\?.*)?$/, (route) => route.fulfill({ json: { items: [] } }))
}

test("complete Business Information editor renders live Google data", async ({ page }) => {
  await mockShell(page)
  await page.route(/\/api\/locations\/location-management\/business-information(?:\?.*)?$/, (route) => route.fulfill({ json: { businessInformation: { location: { title: "Camden Hotel", storeCode: "CAMDEN-1", labels: ["hotel"], openInfo: { status: "OPEN" }, categories: { primaryCategory: { name: "categories/gcid:hotel" } } }, attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [true] }] }, attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }], locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true } } }))
  await page.goto("/locations/location-management/details")
  await expect(page.getByText("Complete Business Information", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Approved payload")).toHaveValue(/CAMDEN-1/)
  await expect(page.getByRole("button", { name: "Validate and publish" })).toBeDisabled()
  await expect(page.getByText("Amenities: 1")).toBeVisible()
})

test("administration workspace exposes lifecycle, verification, and permissions", async ({ page }) => {
  await mockShell(page)
  const available = (data: Record<string, unknown>) => ({ data, error: null })
  await page.route(/\/api\/locations\/location-management\/administration(?:\?.*)?$/, (route) => route.fulfill({ json: { administration: { voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }), verificationOptions: available({ options: [{ verificationMethod: "EMAIL" }] }), googleUpdated: available({ diffMask: "title" }), locationAdmins: available({ admins: [{ admin: "Owner", role: "PRIMARY_OWNER" }] }), accountAdmins: available({ admins: [] }), invitations: available({ invitations: [] }), accountName: "accounts/1", googleLocationName: "locations/camden", canManage: true, writesEnabled: true } } }))
  await page.goto("/locations/location-management/administration")
  await expect(page.getByText("Google location administration", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Operation", { exact: true })).toHaveValue("start_verification")
  await expect(page.getByText("Voice of Merchant", { exact: true })).toBeVisible()
  await expect(page.getByText("Location owners and managers", { exact: true })).toBeVisible()
})

test("industry and direct media management render eligible controls", async ({ page }) => {
  await mockShell(page)
  const available = (data: Record<string, unknown>) => ({ data, error: null })
  await page.route(/\/api\/locations\/location-management\/industry(?:\?.*)?$/, (route) => route.fulfill({ json: { industry: { lodging: available({ policies: { checkinTime: "15:00" } }), lodgingUpdated: available({ diffMask: "policies" }), calls: available({ callsState: "ENABLED" }), callInsights: available({ businessCallsInsights: [] }), healthcareServices: available({ serviceItems: [] }), providerAttributes: available({ attributes: [] }), insuranceNetworks: available({ networks: [] }), canManage: true, writesEnabled: true } } }))
  await page.goto("/locations/location-management/industry")
  await expect(page.getByText("Industry-specific Google management", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Resource")).toHaveValue("update_lodging")
  await expect(page.getByText("Business Calls insights", { exact: true })).toBeVisible()

  await page.route(/\/api\/locations\/location-management\/media(?:\?.*)?$/, (route) => route.fulfill({ json: { media: { canPublish: true, writesEnabled: true, categories: ["COVER", "PROFILE", "ADDITIONAL"], items: [] } } }))
  await page.goto("/locations/location-management/photos")
  await expect(page.getByText("Add media", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Direct file upload")).toBeVisible()
  await expect(page.getByRole("button", { name: "Review file upload" })).toBeDisabled()
})
