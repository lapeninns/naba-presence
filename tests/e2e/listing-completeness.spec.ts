import { expect, type Page, test } from "@playwright/test"
import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../integration/helpers/tenant"

// Its own business tenant with two listings, so the board's order and the
// skip a test makes never touch the shared journey tenant.
type CompletenessTenant = {
  ownerCookie: string
  memberCookie: string
  /** More to fix: no website, no description. */
  crownId: string
  /** Less to fix. */
  bellId: string
}

const DESCRIPTION =
  "A village pub on the green with a big beer garden, real ales from local breweries and a kitchen serving seasonal food every day. Sunday roasts, a quiz on Tuesdays, dogs welcome in the bar, and rooms upstairs for a quiet night away. Book a table online or just walk in."

const completenessTest = test.extend<
  { tenant: CompletenessTenant },
  { harnessAdmin: ReturnType<typeof postgres> }
>({
  harnessAdmin: [
    async ({}, provide) => {
      const url = process.env.DIRECT_DATABASE_URL
      if (!url) {
        throw new Error(
          "DIRECT_DATABASE_URL (the throwaway harness database) is required to seed the completeness tenant."
        )
      }
      const admin = postgres(url, { max: 1 })
      try {
        await provide(admin)
      } finally {
        await admin.end()
      }
    },
    { scope: "worker" },
  ],
  tenant: async ({ harnessAdmin: admin, page }, provide) => {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    try {
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const seed = async (
        name: string,
        location: Record<string, unknown>
      ): Promise<string> => {
        const listing = await seedLinkedLocation(admin, {
          organisationId: owner.organisationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
        })
        await admin`update location set name = ${name} where id = ${listing.locationId}`
        const observedAt = new Date()
        for (const [resource, payload] of [
          ["profile", { observedAt: observedAt.toISOString(), location }],
          [
            "hours",
            {
              observedAt: observedAt.toISOString(),
              location: {
                regularHours: {
                  periods: [
                    {
                      openDay: "MONDAY",
                      closeDay: "MONDAY",
                      openTime: { hours: 11 },
                      closeTime: { hours: 23 },
                    },
                  ],
                },
              },
              metadataWarnings: [],
            },
          ],
        ] as const)
          await admin`
            insert into presence_resource_reconcile_state (
              organisation_id, location_id, resource, status,
              last_attempt_at, last_succeeded_at, observed_at, observed_google_payload
            ) values (
              ${owner.organisationId}, ${listing.locationId}, ${resource}, 'succeeded',
              ${observedAt}, ${observedAt}, ${observedAt}, ${admin.json(payload as unknown as postgres.JSONValue)}
            )
          `
        // Reviews checked just now, none waiting.
        await admin`
          insert into sync_checkpoint (
            organisation_id, external_location_id, sync_type, status, last_succeeded_at
          ) values (
            ${owner.organisationId}, ${listing.externalLocationId}, 'reconcile',
            'succeeded', now()
          )
        `
        return listing.locationId
      }
      const crownId = await seed("The Crown", {
        categories: { primaryCategory: { displayName: "Pub" } },
        phoneNumbers: { primaryPhone: "01223 000000" },
      })
      const bellId = await seed("The Bell", {
        categories: {
          primaryCategory: { displayName: "Pub" },
          additionalCategories: [{ displayName: "Restaurant" }],
        },
        phoneNumbers: { primaryPhone: "01223 111111" },
        websiteUri: "https://thebell.example/?utm_source=google",
        profile: { description: DESCRIPTION },
      })
      const member = await seedMemberUser(admin, {
        organisationId: owner.organisationId,
        assignLocationId: crownId,
      })
      await provide({
        ownerCookie: owner.cookie,
        memberCookie: member.cookie,
        crownId,
        bellId,
      })
    } finally {
      try {
        await page.close()
      } finally {
        await destroyTenants(admin, [owner.organisationId])
      }
    }
  },
})

async function signIn(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

completenessTest.describe("listing completeness", () => {
  completenessTest(
    "the board shows each listing's completeness and orders by most to fix",
    async ({ baseURL, page, tenant }) => {
      await signIn(page, baseURL, tenant.ownerCookie)
      await page.goto("/listings")
      const table = page.getByRole("table")
      await expect(
        table.getByRole("columnheader", { name: "Completeness" })
      ).toBeVisible()
      const crown = table.getByRole("row").filter({ hasText: "The Crown" })
      await expect(crown).toContainText(/\d+%/)
      await expect(crown).toContainText("Website")

      // Worst first breaks ties by name, so The Bell leads until the order
      // changes.
      const names = () =>
        table
          .getByRole("link", { name: /^The (Bell|Crown)$/ })
          .allTextContents()
      await expect.poll(names).toEqual(["The Bell", "The Crown"])
      await page.getByRole("button", { name: /^Order listings/ }).click()
      await page.getByRole("menuitemradio", { name: "Most to fix" }).click()
      await expect(page).toHaveURL(/[?&]order=fix/)
      await expect.poll(names).toEqual(["The Crown", "The Bell"])
    }
  )

  completenessTest(
    "the overview lists what to fix, and an owner can skip a check with a reason",
    async ({ baseURL, page, tenant }) => {
      await signIn(page, baseURL, tenant.ownerCookie)
      await page.goto(`/listings/${tenant.crownId}`)
      const card = page.locator("#listing-completeness")
      await expect(
        card.getByRole("heading", { name: "Completeness" })
      ).toBeVisible()
      await expect(
        card.getByRole("link", { name: "Add website", exact: true })
      ).toHaveAttribute("href", `/listings/${tenant.crownId}/profile`)

      await card.getByRole("button", { name: "Skip: Website" }).click()
      const dialog = page.getByRole("dialog", { name: "Skip “Website”?" })
      await dialog.getByRole("button", { name: "Skip check" }).click()
      await expect(
        dialog.getByText("Say why this check doesn’t apply.")
      ).toBeVisible()
      await dialog
        .getByLabel("Why doesn’t this apply?")
        .fill("Bookings and menus live on the group site")
      await dialog.getByRole("button", { name: "Skip check" }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText("Check skipped")).toBeVisible()
      await expect(
        card.getByRole("button", { name: "Skip: Website" })
      ).toHaveCount(0)

      await card.getByRole("button", { name: /^Show other checks/ }).click()
      const skipped = page.locator("#listing-completeness-skipped")
      await expect(skipped).toContainText(
        "Bookings and menus live on the group site"
      )
      await skipped
        .getByRole("button", { name: "Count again: Website" })
        .click()
      await expect(
        card.getByRole("button", { name: "Skip: Website" })
      ).toBeVisible()
    }
  )

  completenessTest(
    "a member sees what to fix but can't skip checks",
    async ({ baseURL, page, tenant }) => {
      await signIn(page, baseURL, tenant.memberCookie)
      await page.goto(`/listings/${tenant.crownId}`)
      const card = page.locator("#listing-completeness")
      await expect(
        card.getByRole("link", { name: "Add website", exact: true })
      ).toBeVisible()
      await expect(card).toContainText(
        "An owner or admin can skip a check that doesn’t apply."
      )
      await expect(card.getByRole("button", { name: /^Skip:/ })).toHaveCount(0)
    }
  )
})
