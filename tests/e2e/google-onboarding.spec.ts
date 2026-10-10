import { test, expect, type Locator, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { readJourneyState } from "./helpers/stub-bridge"
import type {
  GoogleOnboardingDraft,
  GoogleOnboardingCreation,
  GoogleOnboardingReview,
} from "@/lib/contracts/google-onboarding"

const connectionId = "10000000-0000-4000-8000-000000000001"
const accountId = "10000000-0000-4000-8000-000000000002"
const draftId = "10000000-0000-4000-8000-000000000003"
const actorId = "10000000-0000-4000-8000-000000000004"

async function setup(
  page: Page,
  baseURL: string | undefined,
  outcome?: "unknown" | "link_failed",
  staleSave = false,
  twoPerson = false,
  lostCreationResponse = false
) {
  const state = await readJourneyState()
  const [name, value] = state.cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
  await page.route(`**/api/clients/${state.clientId}/setup`, (route) =>
    route.fulfill({
      json: {
        setup: {
          clientId: state.clientId,
          hasClient: true,
          connection: { id: connectionId, status: "active" },
          accountsActive: 1,
          locationsLinked: 0,
          backfill: "not_started",
          notificationsEnabled: false,
          teamInvited: false,
          nextStep: "locations",
        },
      },
    })
  )
  await page.route("**/api/google/connections", (route) =>
    route.fulfill({
      json: {
        connections: [
          {
            id: connectionId,
            googleEmail: "operator@example.test",
            status: "active",
            notificationsEnabled: false,
            lastRefreshAt: null,
            lastErrorCode: null,
            reconnectRequired: false,
            createdAt: "2026-09-29T09:00:00.000Z",
          },
        ],
      },
    })
  )
  await page.route(/\/api\/google\/accounts(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        accounts: [
          {
            id: accountId,
            googleAccountName: "accounts/business",
            accountName: "Business account",
            googleConnectionId: connectionId,
            type: "PERSONAL",
            role: "OWNER",
            permissionLevel: "OWNER_LEVEL",
            isActive: true,
          },
        ],
      },
    })
  )
  await page.route(/\/api\/google\/locations(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { locations: [] } })
  )
  let draft: GoogleOnboardingDraft = {
    id: draftId,
    accountId,
    accountName: "accounts/business",
    connectionId,
    clientId: state.clientId,
    requestedBy: actorId,
    providerRequestId: actorId,
    revision: 1,
    payload: {
      title: "Saved shop",
      languageCode: "en-GB",
      storefrontAddress: {
        regionCode: "GB",
        addressLines: ["1 High Street"],
        organization: "Preserved organisation",
      },
    },
    payloadHash: "a".repeat(64),
    matchResult: null,
    createdAt: "2026-09-29T09:00:00.000Z",
    updatedAt: "2026-09-29T09:00:00.000Z",
    expiresAt: "2027-03-28T09:00:00.000Z",
  }
  let matches = 0
  let saves = 0
  let links = 0
  let categoryCalls = 0
  let serviceCalls = 0
  let failServiceDiscovery = false
  let suggestedServices = true
  let supportedHours = false
  await page.route(
    `**/api/google/accounts/${accountId}/categories?**`,
    (route) => {
      const query = new URL(route.request().url()).searchParams
      expect(query.get("connectionId")).toBe(connectionId)
      expect(query.get("clientId")).toBe(state.clientId)
      expect(query.get("regionCode")).toBe("GB")
      expect(query.get("languageCode")).toBe("en-GB")
      expect(query.get("query")).toBe("Shop")
      categoryCalls++
      if (categoryCalls === 1)
        return route.fulfill({
          status: 502,
          json: {
            error: "onboarding_categories_invalid",
            message: "Category search failed.",
          },
        })
      return route.fulfill({
        json:
          query.get("pageToken") === "next"
            ? {
                categories: [
                  { name: "categories/gcid:bakery", displayName: "Bakery" },
                ],
              }
            : {
                categories: [
                  { name: "categories/gcid:shop", displayName: "Shop" },
                  { name: "categories/gcid:florist", displayName: "Florist" },
                ],
                nextPageToken: "next",
              },
      })
    }
  )
  const createdIds: string[] = []
  let review: GoogleOnboardingReview | null = null
  let validations = 0
  let approvals = 0
  let submissions = 0
  let creation: GoogleOnboardingCreation | null = outcome
    ? {
        id: actorId,
        draftId,
        reviewId: accountId,
        executionState: outcome === "unknown" ? "unknown" : "accepted",
        confirmationState: outcome === "unknown" ? "unresolved" : "confirmed",
        linkState: outcome === "unknown" ? "pending" : "failed",
        providerResourceName:
          outcome === "unknown" ? null : "locations/created",
        locationId: null,
        errorCode:
          outcome === "unknown"
            ? "onboarding_creation_unconfirmed"
            : "onboarding_local_name_conflict",
        updatedAt: "2026-09-29T09:00:00.000Z",
      }
    : null
  await page.route(
    `**/api/google/accounts/${accountId}/drafts**`,
    async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path.endsWith("/match-link")) return route.fulfill({ status: 404, json: { error: "onboarding_match_link_not_found", message: "No existing-match operation has started." } })
      if (path.endsWith("/services")) {
        serviceCalls++
        expect(new URL(request.url()).searchParams.get("expectedRevision")).toBe(String(draft.revision))
        if (failServiceDiscovery) {
          failServiceDiscovery = false
          return route.fulfill({ status: 502, json: { error: "service_metadata_incomplete", message: "Service choices could not be loaded." } })
        }
        return route.fulfill({ json: { draftId: draft.id, revision: draft.revision, payloadHash: draft.payloadHash, languageCode: draft.payload.languageCode, regionCode: "GB", observedAt: "2026-09-29T10:00:00.000Z", categories: [{ name: "categories/gcid:shop", displayName: "Shop", serviceTypes: suggestedServices ? [{ serviceTypeId: "job:consultation", displayName: "Consultation" }] : [], moreHoursTypes: supportedHours ? [{ hoursTypeId: "provider:delivery", localizedDisplayName: "Delivery" }, { hoursTypeId: "provider:pickup", displayName: "Pickup" }] : [] }] } })
      }
      if (path.endsWith("/reviews")) {
        validations++
        const body = request.postDataJSON()
        expect(body.expectedRevision).toBe(draft.revision)
        expect(body.expectedMatchCheckedAt).toBe(draft.matchResult?.checkedAt)
        expect(body.decision.acknowledgedMatchNames).toEqual(
          draft.matchResult?.matches.map((match) => match.name)
        )
        if (validations === 1)
          return route.fulfill({
            status: 422,
            json: {
              error: "google_validation_rejected",
              message: "Google rejected validation.",
            },
          })
        if (!draft.matchResult)
          throw new Error("The review fixture requires observed matches.")
        review = {
          id: actorId,
          draftId,
          revision: draft.revision,
          accountId,
          accountName: draft.accountName,
          connectionId,
          clientId: state.clientId,
          providerRequestId: draft.providerRequestId,
          payload: draft.payload,
          matchResult: draft.matchResult,
          decision: body.decision,
          reviewHash: "b".repeat(64),
          requestedBy: actorId,
          approvedBy: null,
          requiresSecondApprover: twoPerson,
          canApprove: !twoPerson,
          validatedAt: "2026-09-29T10:00:00.000Z",
          approvalExpiresAt: "2026-09-30T10:00:00.000Z",
        }
        return route.fulfill({ json: review })
      }
      if (path.includes("/reviews/")) {
        if (request.method() === "POST") {
          approvals++
          expect(request.postDataJSON()).toEqual({
            expectedReviewHash: review?.reviewHash,
          })
          if (review) review = { ...review, approvedBy: actorId }
        }
        return route.fulfill({ json: review })
      }
      if (path.endsWith("/creation") && request.method() === "POST") {
        submissions++
        expect(request.postDataJSON()).toEqual({
          reviewId: actorId,
          expectedReviewHash: "b".repeat(64),
        })
        creation = {
          id: accountId,
          draftId,
          reviewId: actorId,
          executionState: "accepted",
          confirmationState: "confirmed",
          linkState: "linked",
          providerResourceName: "locations/created",
          locationId: actorId,
          errorCode: null,
          updatedAt: "2026-09-29T10:00:00.000Z",
        }
        if (lostCreationResponse)
          return route.fulfill({
            status: 503,
            json: {
              error: "response_lost",
              message: "The response was interrupted.",
            },
          })
        return route.fulfill({ json: creation })
      }
      if (path.endsWith("/creation/link")) {
        links++
        expect(request.postDataJSON()).toEqual({
          localName: "Distinct local listing",
        })
        creation = {
          ...creation!,
          linkState: "linked",
          locationId: actorId,
          errorCode: null,
        }
        return route.fulfill({ json: creation })
      }
      if (path.endsWith("/creation"))
        return creation
          ? route.fulfill({ json: creation })
          : route.fulfill({
              status: 404,
              json: {
                error: "onboarding_creation_not_found",
                message: "Creation has not started.",
              },
            })
      if (path.endsWith("/matches")) {
        matches++
        expect(request.postDataJSON()).toEqual({
          expectedRevision: draft.revision,
        })
        if (matches === 1)
          return route.fulfill({
            status: 502,
            json: {
              error: "google_matches_invalid",
              message: "Google search is unavailable. Try again.",
            },
          })
        draft = {
          ...draft,
          matchResult: {
            accountId,
            connectionId,
            checkedAt: "2026-09-29T10:00:00.000Z",
            matches:
              matches === 2
                ? [
                    {
                      name: "googleLocations/candidate",
                      location: {
                        title: "Potential shop",
                        storefrontAddress: {
                          addressLines: ["2 High Street"],
                          postalCode: "NW1 1AA",
                        },
                      },
                      requestAdminRightsUri:
                        "https://business.google.com/request",
                    },
                  ]
                : [],
          },
        }
        return route.fulfill({ json: draft })
      }
      if (path.endsWith("/drafts")) {
        if (request.method() === "POST") {
          const body = request.postDataJSON()
          createdIds.push(body.draftId)
          expect(body).toEqual({
            draftId: expect.any(String),
            connectionId,
            clientId: state.clientId,
            payload: { languageCode: "en-GB" },
          })
          draft = { ...draft, id: body.draftId, payload: body.payload }
          if (createdIds.length === 1)
            return route.fulfill({
              status: 503,
              json: {
                error: "temporarily_unavailable",
                message: "Draft response was interrupted.",
              },
            })
          return route.fulfill({ json: draft })
        }
        return route.fulfill({ json: { drafts: [draft] } })
      }
      if (request.method() === "PUT") {
        saves++
        const body = request.postDataJSON()
        expect(body.expectedRevision).toBe(draft.revision)
        if (body.payload.storefrontAddress !== undefined) {
          expect(body.payload.storefrontAddress.organization).toBe(
            "Preserved organisation"
          )
        }
        if (staleSave && saves === 1) {
          draft = {
            ...draft,
            payload: { ...draft.payload, title: "Saved by another operator" },
            revision: draft.revision + 1,
          }
          return route.fulfill({
            status: 409,
            json: {
              error: "onboarding_draft_stale",
              message: "The saved draft changed. Restore it before editing.",
            },
          })
        }
        draft = {
          ...draft,
          payload: body.payload,
          revision: draft.revision + 1,
          matchResult: null,
        }
      }
      return route.fulfill({ json: draft })
    }
  )
  await page.goto(`/setup?client=${state.clientId}&step=locations`)
  return {
    read: () => ({
      draft,
      matches,
      saves,
      links,
      createdIds,
      validations,
      approvals,
      submissions,
      serviceCalls,
    }),
    seedServiceCategories: (suggested = true) => {
      draft = { ...draft, payload: { ...draft.payload, categories: { primaryCategory: { name: "categories/gcid:shop" } } } }
      failServiceDiscovery = true
      suggestedServices = suggested
    },
    seedChainAffiliation: () => {
      draft = { ...draft, payload: { ...draft.payload, relationshipData: { parentChain: "chains/retained" } } }
    },
    seedAdditionalHours: () => {
      supportedHours = true
      failServiceDiscovery = true
      draft = { ...draft, payload: { ...draft.payload, categories: { primaryCategory: { name: "categories/gcid:shop" } }, relationshipData: { parentChain: "chains/retained" }, moreHours: [{ hoursTypeId: "provider:legacy", periods: [{ openDay: "MONDAY", openTime: {}, closeDay: "MONDAY", closeTime: { hours: 12 } }] }] } }
    },
    clearSupportedHours: () => { supportedHours = false },
    approveElsewhere: () => {
      if (review) review = { ...review, approvedBy: accountId }
    },
    state,
  }
}

async function chooseRelationship(page: Page, group: Locator, name: string) {
  await chooseOnboardingOption(page, group.getByRole("combobox"), name)
}

async function chooseOnboardingOption(page: Page, trigger: Locator, name: string) {
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.locator('[data-slot="select-content"][data-open]').getByRole("option", { name, exact: true }).click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
}

for (const width of [375, 768, 1280]) {
  test(`additional service hours in creation draft at ${width}px`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    fixture.seedAdditionalHours()
    const card = page.getByRole("region", { name: "Find your business on Google" })
    await card.getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ }).click()
    const hours = card.getByRole("group", { name: "Creation additional service hours", exact: true })
    const save = card.getByRole("button", { name: "Save business details", exact: true })
    const search = card.getByRole("button", { name: "Search for matches", exact: true })
    const capture = async (name: string) => {
      await page.setViewportSize({ width, height: 7000 })
      await hours.screenshot({ path: testInfo.outputPath(`service-hours-${name}-${width}.png`), animations: "disabled" })
      await page.setViewportSize({ width, height: 1000 })
    }
    await expect(hours.getByRole("alert")).toBeVisible()
    await expect(hours.getByText("provider:legacy", { exact: true }).first()).toBeVisible()
    await expect(hours.getByRole("combobox", { name: "Additional hours type" })).toBeDisabled()
    await capture("metadata-error")
    await hours.getByRole("button", { name: "Retry hour types" }).click()
    await expect(hours.getByRole("combobox", { name: "Additional hours type" })).toBeEnabled()
    const typeTrigger = hours.getByRole("combobox", { name: "Additional hours type" })
    await typeTrigger.click()
    await expect(typeTrigger).toHaveAttribute("aria-expanded", "true")
    await page.locator('[data-slot="select-content"][data-open]').screenshot({ path: testInfo.outputPath(`service-hours-type-options-${width}.png`), animations: "disabled" })
    await page.keyboard.press("Escape")
    await expect(typeTrigger).toHaveAttribute("aria-expanded", "false")
    expect(fixture.read().draft.payload.moreHours?.[0].hoursTypeId).toBe("provider:legacy")
    await card.getByRole("textbox", { name: "Listing language", exact: true }).fill("cy")
    await expect(hours.getByRole("combobox", { name: "Additional hours type" })).toBeDisabled()
    await expect(hours.getByText("Select and save the categories, language and country before loading hour types.", { exact: true })).toBeVisible()
    expect(fixture.read().draft.payload.moreHours?.[0].hoursTypeId).toBe("provider:legacy")
    await card.getByRole("textbox", { name: "Listing language", exact: true }).fill("en-GB")
    await hours.getByRole("button", { name: "Remove provider:legacy period 1", exact: true }).click()
    if (width === 375) {
      const trigger = hours.getByRole("combobox", { name: "Additional hours type" })
      await trigger.focus()
      await trigger.press("ArrowDown")
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await page.keyboard.press("d")
      await page.keyboard.press("Enter")
      await expect(trigger).toContainText("Delivery")
    } else await chooseOnboardingOption(page, hours.getByRole("combobox", { name: "Additional hours type" }), "Delivery")
    await expect(save).toBeDisabled()
    await expect(search).toBeDisabled()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.getByText("Save your business draft before changing setup steps, or use Saved drafts to discard your edits.", { exact: true })).toBeVisible()
    for (const [label, day] of [["Additional opening day", "Saturday"], ["Additional closing day", "Sunday"]]) await chooseOnboardingOption(page, hours.getByRole("combobox", { name: label }), day)
    await hours.getByRole("textbox", { name: "Additional opening time", exact: true }).fill("22:00")
    await hours.getByRole("textbox", { name: "Additional closing time", exact: true }).fill("02:00")
    await hours.getByRole("button", { name: "Add service hours period" }).click()
    await chooseOnboardingOption(page, hours.getByRole("combobox", { name: "Additional hours type" }), "Delivery")
    for (const [label, day] of [["Additional opening day", "Saturday"], ["Additional closing day", "Sunday"]]) await chooseOnboardingOption(page, hours.getByRole("combobox", { name: label }), day)
    await hours.getByRole("textbox", { name: "Additional opening time", exact: true }).fill("23:00")
    await hours.getByRole("textbox", { name: "Additional closing time", exact: true }).fill("01:00")
    await hours.getByRole("button", { name: "Add service hours period" }).click()
    await expect(hours.getByRole("alert")).toContainText("overlap")
    await capture("period-error")
    await hours.getByRole("button", { name: "Discard service hours entry" }).click()
    await chooseOnboardingOption(page, hours.getByRole("combobox", { name: "Additional hours type" }), "Delivery")
    for (const label of ["Additional opening day", "Additional closing day"]) await chooseOnboardingOption(page, hours.getByRole("combobox", { name: label }), "Monday")
    await hours.getByRole("textbox", { name: "Additional opening time", exact: true }).fill("09:00")
    await hours.getByRole("textbox", { name: "Additional closing time", exact: true }).fill("12:00")
    await hours.getByRole("button", { name: "Add service hours period" }).click()
    await chooseOnboardingOption(page, hours.getByRole("combobox", { name: "Additional hours type" }), "Pickup")
    for (const label of ["Additional opening day", "Additional closing day"]) await chooseOnboardingOption(page, hours.getByRole("combobox", { name: label }), "Monday")
    await hours.getByRole("textbox", { name: "Additional opening time", exact: true }).fill("00:00")
    await hours.getByRole("textbox", { name: "Additional closing time", exact: true }).fill("24:00")
    await hours.getByRole("button", { name: "Add service hours period" }).click()
    await save.click()
    await expect(search).toBeEnabled()
    const expected = [
      { hoursTypeId: "provider:delivery", periods: [{ openDay: "SATURDAY", openTime: { hours: 22, minutes: 0 }, closeDay: "SUNDAY", closeTime: { hours: 2, minutes: 0 } }, { openDay: "MONDAY", openTime: { hours: 9, minutes: 0 }, closeDay: "MONDAY", closeTime: { hours: 12, minutes: 0 } }] },
      { hoursTypeId: "provider:pickup", periods: [{ openDay: "MONDAY", openTime: { hours: 0, minutes: 0 }, closeDay: "MONDAY", closeTime: { hours: 24, minutes: 0 } }] },
    ]
    expect(fixture.read().draft.payload.moreHours).toEqual(expected)
    await page.reload()
    await expect(hours.getByText("Saturday 22:00 to Sunday 02:00", { exact: true })).toBeVisible()
    await capture("saved")
    await search.click()
    await expect(card.getByRole("alert")).toContainText("temporarily unavailable")
    await search.click()
    const review = card.getByRole("region", { name: "Create a separate listing" })
    await hours.getByRole("textbox", { name: "Additional opening time", exact: true }).fill("09:00")
    await expect(review).toHaveCount(0)
    await hours.getByRole("button", { name: "Discard service hours entry" }).click()
    await review.getByRole("checkbox", { name: /I reviewed the potential match/ }).check()
    await review.getByRole("textbox", { name: "Why is a separate listing needed?" }).fill("Separate genuine business with service schedules.")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByRole("alert")).toContainText("could not be validated")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByText("Service hours 1 / period 1", { exact: true })).toBeVisible()
    await expect(review.getByText("provider:delivery: Saturday 22:00 to Sunday 02:00", { exact: true })).toBeVisible()
    await page.setViewportSize({ width, height: 7000 })
    await review.screenshot({ path: testInfo.outputPath(`service-hours-review-${width}.png`), animations: "disabled" })
    expect((await new AxeBuilder({ page }).include('[aria-label="Creation additional service hours"]').include('[aria-label="Create a separate listing"]').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width, height: 1000 })
    await hours.getByRole("button", { name: "Remove provider:delivery period 1", exact: true }).click()
    await save.click()
    await expect(search).toBeEnabled()
    expect(fixture.read().draft.payload.moreHours).toEqual([{ ...expected[0], periods: [expected[0].periods[1]] }, expected[1]])
    await hours.getByRole("button", { name: "Remove provider:delivery period 1", exact: true }).click()
    await save.click()
    await expect(search).toBeEnabled()
    expect(fixture.read().draft.payload.moreHours).toEqual([expected[1]])
    await hours.getByRole("button", { name: "Remove provider:pickup period 1", exact: true }).click()
    await save.click()
    await expect(search).toBeEnabled()
    expect(fixture.read().draft.payload.moreHours).toBeUndefined()
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/retained" })
    fixture.clearSupportedHours()
    await page.reload()
    await expect(hours.getByText("Google returned no additional hour types for these saved categories.", { exact: true })).toBeVisible()
    await expect(hours.getByRole("combobox", { name: "Additional hours type" })).toBeDisabled()
    await capture("no-types")
  })

  test(`opening hours in creation draft at ${width}px`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    fixture.seedChainAffiliation()
    const card = page.getByRole("region", { name: "Find your business on Google" })
    await card.getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ }).click()
    const hours = card.getByRole("group", { name: "Creation opening hours", exact: true })
    const regular = hours.getByRole("group", { name: "Proposed regular hours", exact: true })
    const special = hours.getByRole("group", { name: "Proposed special hours", exact: true })
    const save = card.getByRole("button", { name: "Save business details", exact: true })
    await special.getByLabel("Special start date", { exact: true }).fill("2026-12-26")
    await chooseOnboardingOption(page, special.getByRole("combobox", { name: "Special date opening" }), "Closed all day")
    await expect(special.getByRole("button", { name: "Add special date", exact: true })).toBeDisabled()
    await expect(save).toBeDisabled()
    await special.getByRole("button", { name: "Discard special entry" }).click()
    if (width === 375) {
      const trigger = regular.getByRole("combobox", { name: "Regular opening day" })
      await trigger.focus()
      await trigger.press("ArrowDown")
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await page.keyboard.press("m")
      await page.keyboard.press("Enter")
      await expect(trigger).toContainText("Monday")
    } else await chooseOnboardingOption(page, regular.getByRole("combobox", { name: "Regular opening day" }), "Monday")
    await chooseOnboardingOption(page, regular.getByRole("combobox", { name: "Regular closing day" }), "Tuesday")
    await regular.getByRole("textbox", { name: "Regular opening time", exact: true }).fill("24:01")
    await regular.getByRole("textbox", { name: "Regular closing time", exact: true }).fill("02:00")
    await regular.getByRole("button", { name: "Add regular period" }).click()
    await expect(regular.getByRole("alert")).toContainText("zero minutes")
    await page.setViewportSize({ width, height: 7000 })
    await regular.screenshot({ path: testInfo.outputPath(`hours-regular-error-${width}.png`), animations: "disabled" })
    await page.setViewportSize({ width, height: 1000 })
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.getByText("Save your business draft before changing setup steps, or use Saved drafts to discard your edits.", { exact: true })).toBeVisible()
    await regular.getByRole("textbox", { name: "Regular opening time", exact: true }).fill("22:00")
    await regular.getByRole("button", { name: "Add regular period" }).click()
    for (const label of ["Regular opening day", "Regular closing day"]) await chooseOnboardingOption(page, regular.getByRole("combobox", { name: label }), "Wednesday")
    await regular.getByRole("textbox", { name: "Regular opening time", exact: true }).fill("00:00")
    await regular.getByRole("textbox", { name: "Regular closing time", exact: true }).fill("24:00")
    await regular.getByRole("button", { name: "Add regular period" }).click()
    await special.getByLabel("Special start date", { exact: true }).fill("2026-12-26")
    await chooseOnboardingOption(page, special.getByRole("combobox", { name: "Special date opening" }), "Closed all day")
    await special.getByRole("button", { name: "Add special date" }).click()
    await special.getByLabel("Special start date", { exact: true }).fill("2026-12-24")
    await chooseOnboardingOption(page, special.getByRole("combobox", { name: "Special date opening" }), "Custom hours")
    await special.getByRole("textbox", { name: "Special opening time", exact: true }).fill("13:01")
    await special.getByRole("textbox", { name: "Special closing time", exact: true }).fill("12:00")
    await special.getByLabel("Special end date (optional)", { exact: true }).fill("2026-12-25")
    await special.getByRole("button", { name: "Add special date" }).click()
    await expect(special.getByRole("alert")).toContainText("before noon")
    await page.setViewportSize({ width, height: 7000 })
    await special.screenshot({ path: testInfo.outputPath(`hours-special-error-${width}.png`), animations: "disabled" })
    await page.setViewportSize({ width, height: 1000 })
    await expect(save).toBeDisabled()
    await special.getByRole("textbox", { name: "Special closing time", exact: true }).fill("11:59")
    await special.getByRole("button", { name: "Add special date" }).click()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    const expected = {
      regularHours: { periods: [
        { openDay: "MONDAY", closeDay: "TUESDAY", openTime: { hours: 22, minutes: 0 }, closeTime: { hours: 2, minutes: 0 } },
        { openDay: "WEDNESDAY", closeDay: "WEDNESDAY", openTime: { hours: 0, minutes: 0 }, closeTime: { hours: 24, minutes: 0 } },
      ] },
      specialHours: { specialHourPeriods: [
        { startDate: { year: 2026, month: 12, day: 26 }, closed: true },
        { startDate: { year: 2026, month: 12, day: 24 }, endDate: { year: 2026, month: 12, day: 25 }, openTime: { hours: 13, minutes: 1 }, closeTime: { hours: 11, minutes: 59 } },
      ] },
    }
    expect(fixture.read().draft.payload).toMatchObject({ ...expected, relationshipData: { parentChain: "chains/retained" } })
    await page.reload()
    await expect(regular.getByText("Monday 22:00 to Tuesday 02:00", { exact: true })).toBeVisible()
    await expect(special.getByText("2026-12-26: Closed", { exact: true })).toBeVisible()
    await card.getByRole("button", { name: "Search for matches", exact: true }).click()
    await expect(card.getByRole("alert")).toContainText("temporarily unavailable")
    await card.getByRole("button", { name: "Search for matches", exact: true }).click()
    const review = card.getByRole("region", { name: "Create a separate listing" })
    await regular.getByRole("textbox", { name: "Regular opening time", exact: true }).fill("09:00")
    await expect(review).toHaveCount(0)
    await regular.getByRole("button", { name: "Discard regular entry" }).click()
    await review.getByRole("checkbox", { name: /I reviewed the potential match/ }).check()
    await review.getByRole("textbox", { name: "Why is a separate listing needed?" }).fill("Separate genuine business with explicit opening hours.")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByRole("alert")).toContainText("could not be validated")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByText("Monday 22:00 to Tuesday 02:00", { exact: true })).toBeVisible()
    await expect(review.getByText("Wednesday 00:00 to Wednesday 24:00", { exact: true })).toBeVisible()
    await expect(review.getByText("2026-12-24 13:01 to 2026-12-25 11:59", { exact: true })).toBeVisible()
    expect(fixture.read().draft.payload).toMatchObject(expected)
    await page.setViewportSize({ width, height: 7000 })
    await hours.screenshot({ path: testInfo.outputPath(`hours-controls-${width}.png`) })
    await review.screenshot({ path: testInfo.outputPath(`hours-review-${width}.png`) })
    expect((await new AxeBuilder({ page }).include('[aria-label="Creation opening hours"]').include('[aria-label="Create a separate listing"]').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await regular.getByRole("button", { name: "Remove regular period 2", exact: true }).click()
    await expect(regular.getByRole("button", { name: "Remove regular period 1", exact: true })).toBeDisabled()
    await special.getByRole("button", { name: "Remove special period 2", exact: true }).click()
    await special.getByRole("button", { name: "Remove special period 1", exact: true }).click()
    await regular.getByRole("button", { name: "Remove regular period 1", exact: true }).click()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    expect(fixture.read().draft.payload.regularHours).toBeUndefined()
    expect(fixture.read().draft.payload.specialHours).toBeUndefined()
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/retained" })
  })

  test(`chain affiliation in creation draft at ${width}px`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    fixture.seedChainAffiliation()
    let calls = 0
    await page.route(`**/api/google/accounts/${accountId}/drafts/${draftId}/chains?**`, (route) => {
      const params = new URL(route.request().url()).searchParams
      const draft = fixture.read().draft
      expect(params.get("expectedRevision")).toBe(String(draft.revision))
      calls++
      if (calls === 1) return route.fulfill({ status: 502, json: { error: "onboarding_chains_invalid", message: "Incomplete chains." } })
      return route.fulfill({ json: { draftId, revision: draft.revision, payloadHash: draft.payloadHash, query: params.get("query"), choices: params.get("query") === "Missing" ? [] : [{ name: "chains/123", label: "Brand UK" }, { name: "chains/456", label: "Other brand" }] } })
    })
    const card = page.getByRole("region", { name: "Find your business on Google" })
    await card.getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ }).click()
    const chain = card.getByRole("group", { name: "Creation chain affiliation", exact: true })
    const save = card.getByRole("button", { name: "Save business details", exact: true })
    await expect(chain.getByText("chains/retained", { exact: true })).toBeVisible()
    const parent = card.getByRole("group", { name: "Proposed parent business", exact: true })
    await parent.getByRole("textbox", { name: "Parent business place ID", exact: true }).fill("ChIJ_parent")
    await chooseRelationship(page, parent, "Department")
    await parent.getByRole("button", { name: "Set parent business", exact: true }).click()
    const children = card.getByRole("group", { name: "Proposed child businesses", exact: true })
    await children.getByRole("textbox", { name: "New child business place ID", exact: true }).fill("ChIJ_child")
    await chooseRelationship(page, children, "Department")
    await children.getByRole("button", { name: "Add child business", exact: true }).click()
    await chain.getByRole("textbox", { name: "Search Google chains", exact: true }).fill("Brand")
    await chain.getByRole("button", { name: "Search chains", exact: true }).click()
    await expect(chain.getByRole("alert")).toContainText("temporarily unavailable")
    await expect(chain.getByRole("button", { name: "Select chain Brand UK", exact: true })).toHaveCount(0)
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/retained" })
    await chain.getByRole("button", { name: "Search chains", exact: true }).click()
    await chain.getByRole("button", { name: "Select chain Brand UK", exact: true }).click()
    await expect(chain.getByRole("button", { name: "Select chain Brand UK", exact: true })).toBeDisabled()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    const related = { parentLocation: { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" }, childrenLocations: [{ placeId: "ChIJ_child", relationType: "DEPARTMENT_OF" }] }
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/123", ...related })
    await page.reload()
    await expect(chain.getByText("chains/123", { exact: true })).toBeVisible()
    await chain.getByRole("textbox", { name: "Search Google chains", exact: true }).fill("Missing")
    await chain.getByRole("button", { name: "Search chains", exact: true }).click()
    await expect(chain.getByText("No chains found for Missing. Try another name.", { exact: true })).toBeVisible()
    await expect(chain.getByText("chains/123", { exact: true })).toBeVisible()
    await chain.getByRole("textbox", { name: "Search Google chains", exact: true }).fill("Brand")
    await chain.getByRole("textbox", { name: "Search Google chains", exact: true }).press("Enter")
    await expect(chain.getByRole("button", { name: "Select chain Other brand", exact: true })).toBeVisible()
    await page.setViewportSize({ width, height: 7000 })
    await chain.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
    await chain.screenshot({ path: testInfo.outputPath(`chain-controls-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="onboarding-drafts-heading"]').analyze()).violations).toEqual([])
    await chain.getByRole("button", { name: "Remove chain from proposal", exact: true }).click()
    await expect(chain.getByText("No chain affiliation in this proposal.", { exact: true })).toBeVisible()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    expect(fixture.read().draft.payload.relationshipData).toEqual(related)
    await page.reload()
    await expect(chain.getByText("No chain affiliation in this proposal.", { exact: true })).toBeVisible()
    await expect(parent.getByText("ChIJ_parent", { exact: true })).toBeVisible()
    await expect(children.getByText("ChIJ_child", { exact: true })).toBeVisible()
  })
}

for (const width of [375, 768, 1280]) {
  test(`relationships in creation draft at ${width}px`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    fixture.seedChainAffiliation()
    const card = page.getByRole("region", { name: "Find your business on Google" })
    await card.getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ }).click()
    const relationships = card.getByRole("group", { name: "Creation business relationships", exact: true })
    const parent = relationships.getByRole("group", { name: "Proposed parent business", exact: true })
    const children = relationships.getByRole("group", { name: "Proposed child businesses", exact: true })
    const parentId = parent.getByRole("textbox", { name: "Parent business place ID", exact: true })
    const childId = children.getByRole("textbox", { name: "New child business place ID", exact: true })
    const save = card.getByRole("button", { name: "Save business details", exact: true })
    await parentId.fill("https://maps.google.com/place")
    await chooseRelationship(page, parent, "Department")
    await parent.getByRole("button", { name: "Set parent business", exact: true }).click()
    await expect(parent.getByRole("alert")).toContainText("without spaces or URL characters")
    await expect(save).toBeDisabled()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.getByText("Save your business draft before changing setup steps, or use Saved drafts to discard your edits.", { exact: true })).toBeVisible()
    await parent.getByRole("button", { name: "Discard parent entry" }).click()
    await parentId.fill("ChIJ_parent")
    await chooseRelationship(page, parent, "Department")
    await parent.getByRole("button", { name: "Set parent business", exact: true }).click()
    for (const [placeId, relation] of [["ChIJ_child", "Department"], ["ChIJ_second", "Independent business at the same address"]]) {
      await childId.fill(placeId)
      await chooseRelationship(page, children, relation)
      await children.getByRole("button", { name: "Add child business", exact: true }).click()
    }
    await childId.fill("ChIJ_child")
    await chooseRelationship(page, children, "Department")
    await children.getByRole("button", { name: "Add child business", exact: true }).click()
    await expect(children.getByRole("alert")).toContainText("already in the proposal")
    await expect(save).toBeDisabled()
    await children.getByRole("button", { name: "Discard child entry" }).click()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/retained", parentLocation: { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" }, childrenLocations: [{ placeId: "ChIJ_child", relationType: "DEPARTMENT_OF" }, { placeId: "ChIJ_second", relationType: "INDEPENDENT_ESTABLISHMENT_IN" }] })
    await page.reload()
    await expect(parent.getByText("ChIJ_parent", { exact: true })).toBeVisible()
    await expect(children.getByText("ChIJ_second", { exact: true })).toBeVisible()
    await parentId.fill("ChIJ_new_parent")
    await chooseRelationship(page, parent, "Independent business at the same address")
    await parent.getByRole("button", { name: "Set parent business", exact: true }).click()
    await children.getByRole("button", { name: "Remove child from proposal ChIJ_child", exact: true }).click()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/retained", parentLocation: { placeId: "ChIJ_new_parent", relationType: "INDEPENDENT_ESTABLISHMENT_IN" }, childrenLocations: [{ placeId: "ChIJ_second", relationType: "INDEPENDENT_ESTABLISHMENT_IN" }] })
    await card.getByRole("button", { name: "Search for matches", exact: true }).click()
    await expect(card.getByRole("alert")).toContainText("temporarily unavailable")
    await card.getByRole("button", { name: "Search for matches", exact: true }).click()
    const review = card.getByRole("region", { name: "Create a separate listing" })
    await parentId.fill("Unfinished")
    await expect(review).toHaveCount(0)
    await expect(save).toBeDisabled()
    await parent.getByRole("button", { name: "Discard parent entry" }).click()
    await review.getByRole("checkbox", { name: /I reviewed the potential match/ }).check()
    await review.getByRole("textbox", { name: "Why is a separate listing needed?" }).fill("Separate genuine business with related departments.")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByRole("alert")).toContainText("could not be validated")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByText("Parent business place ID", { exact: true })).toBeVisible()
    await expect(review.getByText("ChIJ_new_parent", { exact: true })).toBeVisible()
    await expect(review.getByText("Child 1 place ID", { exact: true })).toBeVisible()
    await expect(review.getByText("ChIJ_second", { exact: true })).toBeVisible()
    await expect(review.getByText("chains/retained", { exact: true })).toBeVisible()
    await page.setViewportSize({ width, height: 7000 })
    await relationships.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
    await relationships.screenshot({ path: testInfo.outputPath(`relationship-controls-${width}.png`) })
    await review.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
    await review.screenshot({ path: testInfo.outputPath(`relationship-review-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="onboarding-drafts-heading"]').analyze()).violations).toEqual([])
    await parent.getByRole("button", { name: "Remove parent from proposal ChIJ_new_parent", exact: true }).click()
    await children.getByRole("button", { name: "Remove child from proposal ChIJ_second", exact: true }).click()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    expect(fixture.read().draft.payload.relationshipData).toEqual({ parentChain: "chains/retained" })
  })
}

for (const width of [375, 768, 1280]) {
  test(`services in creation draft at ${width}px`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    fixture.seedServiceCategories()
    const card = page.getByRole("region", { name: "Find your business on Google" })
    await card.getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ }).click()
    const services = card.getByRole("group", { name: "Creation services", exact: true })
    const suggested = services.getByRole("combobox", { name: "Add a suggested service", exact: true })
    await expect(services.getByRole("alert")).toContainText("temporarily unavailable")
    await expect(suggested).toBeDisabled()
    await services.getByRole("button", { name: "Retry service choices" }).click()
    await expect(suggested).toBeEnabled()
    await suggested.click()
    await page.getByRole("option", { name: "Consultation", exact: true }).click()
    const first = services.getByRole("group", { name: "Service 1", exact: true })
    await first.getByRole("textbox", { name: "Service description", exact: true }).fill("An individual consultation.")
    await first.getByRole("textbox", { name: "Service price", exact: true }).fill("0")
    await services.getByRole("combobox", { name: "Add a custom service for category" }).click()
    await page.getByRole("option", { name: "Shop", exact: true }).click()
    const second = services.getByRole("group", { name: "Service 2", exact: true })
    const save = card.getByRole("button", { name: "Save business details", exact: true })
    await expect(save).toBeDisabled()
    await expect(services.getByRole("alert")).toContainText("Enter a custom service name")
    await second.getByRole("textbox", { name: "Custom service name" }).fill("Custom advice")
    await second.getByRole("textbox", { name: "Service description", exact: true }).fill("Advice for a specific project.")
    await second.getByRole("textbox", { name: "Service price", exact: true }).fill("1e2")
    await expect(save).toBeDisabled()
    await expect(services.getByRole("alert")).toContainText("up to nine decimal places")
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.getByText("Save your business draft before changing setup steps, or use Saved drafts to discard your edits.", { exact: true })).toBeVisible()
    await second.getByRole("textbox", { name: "Service price", exact: true }).fill("19.123456789")
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    const originalFirst = fixture.read().draft.payload.serviceItems?.[0]
    expect(originalFirst).toEqual({ structuredServiceItem: { serviceTypeId: "job:consultation", description: "An individual consultation." }, price: { currencyCode: "GBP", units: "0", nanos: 0 } })
    expect(fixture.read().draft.payload.serviceItems?.[1]).toEqual({ freeFormServiceItem: { category: "categories/gcid:shop", label: { displayName: "Custom advice", description: "Advice for a specific project.", languageCode: "en-GB" } }, price: { currencyCode: "GBP", units: "19", nanos: 123456789 } })
    await page.reload()
    await expect(second.getByRole("textbox", { name: "Service price", exact: true })).toHaveValue("19.123456789")
    await card.getByRole("textbox", { name: "Listing language", exact: true }).fill("cy")
    await expect(suggested).toBeDisabled()
    await card.getByRole("textbox", { name: "Listing language", exact: true }).fill("en-GB")
    await second.getByRole("textbox", { name: "Custom service name" }).fill("Custom advice updated")
    await second.getByRole("button", { name: "Clear service price", exact: true }).click()
    await second.getByRole("button", { name: "Clear service description", exact: true }).click()
    await save.click()
    await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
    expect(fixture.read().draft.payload.serviceItems?.[0]).toEqual(originalFirst)
    expect(fixture.read().draft.payload.serviceItems?.[1]).toEqual({ freeFormServiceItem: { category: "categories/gcid:shop", label: { displayName: "Custom advice updated", languageCode: "en-GB" } } })
    await card.getByRole("button", { name: "Search for matches", exact: true }).click()
    await expect(card.getByRole("alert")).toContainText("temporarily unavailable")
    await card.getByRole("button", { name: "Search for matches", exact: true }).click()
    const review = card.getByRole("region", { name: "Create a separate listing" })
    await review.getByRole("checkbox", { name: /I reviewed the potential match/ }).check()
    await review.getByRole("textbox", { name: "Why is a separate listing needed?" }).fill("Separate new premises and services.")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByRole("alert")).toContainText("could not be validated")
    await review.getByRole("button", { name: "Validate and review creation" }).click()
    await expect(review.getByText("Service 1 Google ID", { exact: true })).toBeVisible()
    await expect(review.getByText("job:consultation", { exact: true })).toBeVisible()
    await expect(review.getByText("GBP 0", { exact: true })).toBeVisible()
    await expect(review.getByText("Custom advice updated", { exact: true })).toBeVisible()
    await page.setViewportSize({ width, height: 8500 })
    await card.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
    await card.screenshot({ path: testInfo.outputPath(`services-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="onboarding-drafts-heading"]').analyze()).violations).toEqual([])
  })
}

test("confirmed categories without suggested services allow a custom proposal and removal", async ({ page, baseURL }) => {
  const fixture = await setup(page, baseURL)
  fixture.seedServiceCategories(false)
  const card = page.getByRole("region", { name: "Find your business on Google" })
  await card.getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ }).click()
  const services = card.getByRole("group", { name: "Creation services", exact: true })
  await services.getByRole("button", { name: "Retry service choices" }).click()
  await expect(services.getByText("Google returned these categories without suggested services. You can propose a custom service for a selected category.", { exact: true })).toBeVisible()
  await expect(services.getByRole("combobox", { name: "Add a suggested service" })).toBeDisabled()
  await services.getByRole("combobox", { name: "Add a custom service for category" }).click()
  await page.getByRole("option", { name: "Shop", exact: true }).click()
  await services.getByRole("textbox", { name: "Custom service name" }).fill("Local advice")
  await card.getByRole("button", { name: "Save business details", exact: true }).click()
  await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
  await services.getByRole("button", { name: "Remove service 1", exact: true }).click()
  await card.getByRole("button", { name: "Save business details", exact: true }).click()
  await expect(card.getByRole("button", { name: "Search for matches", exact: true })).toBeEnabled()
  expect(fixture.read().draft.payload.serviceItems).toEqual([])
})

for (const width of [375, 768, 1280])
  test(`creation review and approval at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(
      page,
      baseURL,
      undefined,
      false,
      false,
      width === 375
    )
    const card = page.getByRole("region", {
      name: "Find your business on Google",
    })
    await card
      .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
      .click()
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    await expect(card.getByRole("alert")).toBeVisible()
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    const panel = card.getByRole("region", {
      name: "Create a separate listing",
    })
    await panel
      .getByRole("textbox", { name: "Why is a separate listing needed?" })
      .fill("Separate new premises with a distinct business.")
    await expect(
      panel.getByRole("button", { name: "Validate and review creation" })
    ).toBeDisabled()
    await panel
      .getByRole("checkbox", {
        name: "I reviewed the potential match: Potential shop",
      })
      .check()
    await panel
      .getByRole("button", { name: "Validate and review creation" })
      .click()
    await expect(panel.getByRole("alert")).toBeVisible()
    await expect(
      panel.getByRole("button", { name: "Create approved Google listing" })
    ).toHaveCount(0)
    await panel
      .getByRole("button", { name: "Validate and review creation" })
      .click()
    await expect(
      panel.getByText("Google validation completed.", { exact: false })
    ).toBeVisible()
    await expect(
      panel.getByText("Preserved organisation", { exact: true })
    ).toBeVisible()
    await page.reload()
    await expect(
      panel.getByRole("button", { name: "Approve creation details" })
    ).toBeVisible()
    await page.setViewportSize({ width, height: 3000 })
    await panel.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" })
    )
    await panel.screenshot({
      path: testInfo.outputPath(`creation-review-${width}.png`),
    })
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-labelledby="creation-review-heading"]')
          .analyze()
      ).violations
    ).toEqual([])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await panel
      .getByRole("button", { name: "Approve creation details" })
      .click()
    await expect(
      panel.getByRole("button", { name: "Create approved Google listing" })
    ).toBeDisabled()
    await panel
      .getByRole("checkbox", {
        name: "I am ready to create this public Google listing with the reviewed details.",
      })
      .check()
    await panel
      .getByRole("button", { name: "Create approved Google listing" })
      .click()
    await expect(
      card.getByRole("link", { name: "Continue to verification" })
    ).toBeVisible()
    expect(fixture.read()).toMatchObject({
      validations: 2,
      approvals: 1,
      submissions: 1,
    })
  })

test("two-person creation waits for another approver and refreshes the approval", async ({
  page,
  baseURL,
}) => {
  const fixture = await setup(page, baseURL, undefined, false, true)
  const card = page.getByRole("region", {
    name: "Find your business on Google",
  })
  await card
    .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
    .click()
  await card
    .getByRole("button", { name: "Search for matches", exact: true })
    .click()
  await expect(card.getByRole("alert")).toBeVisible()
  await card
    .getByRole("button", { name: "Search for matches", exact: true })
    .click()
  const panel = card.getByRole("region", { name: "Create a separate listing" })
  await panel
    .getByRole("textbox", { name: "Why is a separate listing needed?" })
    .fill("A separate business.")
  await panel
    .getByRole("checkbox", {
      name: "I reviewed the potential match: Potential shop",
    })
    .check()
  await panel
    .getByRole("button", { name: "Validate and review creation" })
    .click()
  await expect(panel.getByRole("alert")).toBeVisible()
  await panel
    .getByRole("button", { name: "Validate and review creation" })
    .click()
  await expect(
    panel.getByRole("button", { name: "Approve creation details" })
  ).toBeDisabled()
  await expect(
    panel.getByText("A different authorised owner or admin", { exact: false })
  ).toBeVisible()
  fixture.approveElsewhere()
  await panel.getByRole("button", { name: "Refresh creation review" }).click()
  await expect(
    panel.getByRole("button", { name: "Create approved Google listing" })
  ).toBeVisible()
  expect(fixture.read().approvals).toBe(0)
  await page.route(
    `**/api/google/accounts/${accountId}/drafts/${draftId}/reviews/${actorId}`,
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: "approval_expired",
          message: "The creation review expired.",
        },
      })
  )
  await panel.getByRole("button", { name: "Refresh creation review" }).click()
  await expect(panel.getByRole("alert")).toBeVisible()
  await expect(
    panel.getByRole("button", { name: "Create approved Google listing" })
  ).toHaveCount(0)
  await expect(
    panel.getByRole("button", { name: "Start a fresh review" })
  ).toBeVisible()
})

for (const width of [375, 768, 1280])
  test(`onboarding draft matching at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    const card = page.getByRole("region", {
      name: "Find your business on Google",
    })
    await card
      .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
      .click()
    await expect(
      card.getByRole("textbox", { name: "Business name", exact: true })
    ).toHaveValue("Saved shop")
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    const categoryGroup = card.getByRole("group", {
      name: "Business categories",
    })
    await categoryGroup
      .getByRole("textbox", { name: "Search Google categories" })
      .fill("Shop")
    await categoryGroup
      .getByRole("textbox", { name: "Search Google categories" })
      .press("Enter")
    await expect(categoryGroup.getByRole("alert")).toBeVisible()
    await categoryGroup
      .getByRole("button", { name: "Find categories", exact: true })
      .click()
    await categoryGroup
      .getByRole("button", { name: /Set primary\s*:\s*Shop/, exact: true })
      .click()
    await categoryGroup
      .getByRole("button", { name: /Add category\s*:\s*Florist/, exact: true })
      .click()
    await categoryGroup
      .getByRole("button", { name: "Load more categories" })
      .click()
    await categoryGroup
      .getByRole("button", { name: /Set primary\s*:\s*Bakery/, exact: true })
      .click()
    await expect(
      categoryGroup.getByRole("button", {
        name: /Add category\s*:\s*Florist/,
        exact: true,
      })
    ).toBeDisabled()
    await page.setViewportSize({ width, height: 2400 })
    await categoryGroup.screenshot({
      path: testInfo.outputPath(`categories-${width}.png`),
    })
    await page.setViewportSize({ width, height: 1000 })
    await card
      .getByRole("textbox", { name: "Business name", exact: true })
      .fill("New shop name")
    const website = card.getByRole("textbox", {
      name: "Business website (optional)",
      exact: true,
    })
    const primaryPhone = card.getByRole("textbox", {
      name: "Primary business phone (optional)",
      exact: true,
    })
    const additionalPhones = card.getByRole("textbox", {
      name: "Additional business phones (optional)",
      exact: true,
    })
    await website.fill("invalid website")
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    await website.fill("https://shop.example.test")
    await primaryPhone.fill("+44 20 7946 0000")
    await additionalPhones.fill(
      "+44 20 7946 0001\n+44 20 7946 0002\n+44 20 7946 0003"
    )
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    await additionalPhones.fill("+44 20 7946 0001\n+44 20 7946 0002")
    const description = card.getByRole("textbox", {
      name: "Business description",
      exact: true,
    })
    const storeCode = card.getByRole("textbox", {
      name: "Store code (optional)",
      exact: true,
    })
    const labels = card.getByRole("textbox", {
      name: "Private listing labels (optional)",
      exact: true,
    })
    const adPhone = card.getByRole("textbox", {
      name: "Google Ads phone (optional)",
      exact: true,
    })
    await description.fill("A neighbourhood bakery with fresh bread and cakes.")
    await storeCode.fill("SHOP-LONDON-01")
    await adPhone.fill("+44 20 7946 0009")
    await labels.fill(
      Array.from({ length: 11 }, (_, index) => `Label ${index}`).join("\n")
    )
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    await labels.fill("x".repeat(256))
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    await labels.fill("London\nBakery")
    const town = card.getByRole("textbox", {
      name: "Town or city",
      exact: true,
    })
    const county = card.getByRole("textbox", {
      name: "County or region (optional)",
      exact: true,
    })
    const district = card.getByRole("textbox", {
      name: "District (optional)",
      exact: true,
    })
    await town.fill("London")
    await county.fill("Greater London")
    await district.fill("Westminster")
    await expect(
      card.getByRole("button", { name: "Search for matches", exact: true })
    ).toBeDisabled()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(
      page.getByText(
        "Save your business draft before changing setup steps, or use Saved drafts to discard your edits.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      card.getByRole("textbox", { name: "Business name", exact: true })
    ).toHaveValue("New shop name")
    await card.getByRole("link", { name: "Saved drafts", exact: true }).click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page.getByRole("button", { name: "Keep editing" }).click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Search for matches", exact: true })
    ).toBeEnabled()
    expect(fixture.read().saves).toBe(1)
    expect(fixture.read().draft.payload.profile).toEqual({
      description: "A neighbourhood bakery with fresh bread and cakes.",
    })
    expect(fixture.read().draft.payload.storeCode).toBe("SHOP-LONDON-01")
    expect(fixture.read().draft.payload.labels).toEqual(["London", "Bakery"])
    expect(fixture.read().draft.payload.adWordsLocationExtensions).toEqual({
      adPhone: "+44 20 7946 0009",
    })
    expect(fixture.read().draft.payload.storefrontAddress).toMatchObject({
      addressLines: ["1 High Street"],
      locality: "London",
      administrativeArea: "Greater London",
      sublocality: "Westminster",
      organization: "Preserved organisation",
    })
    expect(fixture.read().draft.payload.storefrontAddress).not.toHaveProperty(
      "postalCode"
    )
    expect(fixture.read().draft.payload.websiteUri).toBe(
      "https://shop.example.test"
    )
    expect(fixture.read().draft.payload.phoneNumbers).toEqual({
      primaryPhone: "+44 20 7946 0000",
      additionalPhones: ["+44 20 7946 0001", "+44 20 7946 0002"],
    })
    expect(fixture.read().draft.payload.categories).toEqual({
      primaryCategory: { name: "categories/gcid:bakery" },
      additionalCategories: [{ name: "categories/gcid:florist" }],
    })
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    await expect(card.getByRole("alert")).toContainText(
      "Google or our service is temporarily unavailable"
    )
    await expect(
      card.getByText("Google returned no potential matches.", { exact: false })
    ).toHaveCount(0)
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    await expect(
      card.getByText("Potential shop", { exact: true })
    ).toBeVisible()
    await expect(
      card.getByRole("link", { name: "Review ownership options in Google" })
    ).toHaveAttribute("href", "https://business.google.com/request")
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.setViewportSize({ width, height: 5000 })
    await card.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" })
    )
    await card.screenshot({
      path: testInfo.outputPath(`onboarding-${width}.png`),
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-labelledby="onboarding-drafts-heading"]')
          .analyze()
      ).violations
    ).toEqual([])
    await page.reload()
    await expect(
      card.getByRole("textbox", { name: "Business name", exact: true })
    ).toHaveValue("New shop name")
    await expect(website).toHaveValue("https://shop.example.test")
    await expect(description).toHaveValue(
      "A neighbourhood bakery with fresh bread and cakes."
    )
    await expect(storeCode).toHaveValue("SHOP-LONDON-01")
    await expect(labels).toHaveValue("London\nBakery")
    await expect(adPhone).toHaveValue("+44 20 7946 0009")
    await expect(town).toHaveValue("London")
    await expect(county).toHaveValue("Greater London")
    await expect(district).toHaveValue("Westminster")
    await expect(additionalPhones).toHaveValue(
      "+44 20 7946 0001\n+44 20 7946 0002"
    )
    await expect(
      categoryGroup.getByText("Primary: Bakery", { exact: true })
    ).toBeVisible()
    await expect(
      categoryGroup.getByRole("button", { name: /Remove\s*Florist/ })
    ).toBeVisible()
    await expect(
      card.getByText("Potential shop", { exact: true })
    ).toBeVisible()
    await card
      .getByRole("button", { name: "Refresh matches after changes in Google" })
      .click()
    await expect(
      card.getByText("Google returned no potential matches.", { exact: false })
    ).toBeVisible()
    await categoryGroup
      .getByRole("button", { name: "Clear selected categories" })
      .click()
    await expect(
      card.getByRole("button", { name: "Search for matches", exact: true })
    ).toBeDisabled()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.categories).toBeUndefined()
    await primaryPhone.fill("+44 20 7946 0010")
    await description.fill("A neighbourhood bakery with bread made daily.")
    await district.fill("")
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.phoneNumbers?.additionalPhones).toEqual(
      ["+44 20 7946 0001", "+44 20 7946 0002"]
    )
    expect(fixture.read().draft.payload.labels).toEqual(["London", "Bakery"])
    expect(fixture.read().draft.payload.storeCode).toBe("SHOP-LONDON-01")
    expect(fixture.read().draft.payload.adWordsLocationExtensions).toEqual({
      adPhone: "+44 20 7946 0009",
    })
    expect(fixture.read().draft.payload.storefrontAddress).toMatchObject({
      locality: "London",
      administrativeArea: "Greater London",
      organization: "Preserved organisation",
    })
    expect(fixture.read().draft.payload.storefrontAddress).not.toHaveProperty(
      "sublocality"
    )
    await website.fill("")
    await primaryPhone.fill("")
    await additionalPhones.fill("")
    await description.fill("")
    await storeCode.fill("")
    await labels.fill("")
    await adPhone.fill("")
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.websiteUri).toBeUndefined()
    expect(fixture.read().draft.payload.phoneNumbers).toBeUndefined()
    expect(fixture.read().draft.payload.profile).toBeUndefined()
    expect(fixture.read().draft.payload.storeCode).toBeUndefined()
    expect(fixture.read().draft.payload.labels).toBeUndefined()
    expect(
      fixture.read().draft.payload.adWordsLocationExtensions
    ).toBeUndefined()
    await card
      .getByRole("textbox", { name: "Storefront address", exact: true })
      .fill("")
    await town.fill("")
    await county.fill("")
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.storefrontAddress).toBeUndefined()
    await page.reload()
    await expect(
      categoryGroup.getByText("No primary category selected.", { exact: true })
    ).toBeVisible()
  })

for (const width of [375, 768, 1280]) {
  test(`service-area creation draft at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    const card = page.getByRole("region", {
      name: "Find your business on Google",
    })
    await card
      .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
      .click()
    const area = card.getByRole("group", {
      name: "Service-area business details",
    })
    await card
      .getByRole("textbox", { name: "Business description", exact: true })
      .fill("A local repair service visiting customers across Westminster.")
    await card
      .getByRole("textbox", { name: "Store code (optional)", exact: true })
      .fill("SERVICE-WESTMINSTER")
    await card
      .getByRole("textbox", {
        name: "Private listing labels (optional)",
        exact: true,
      })
      .fill("Repairs")
    await card
      .getByRole("textbox", {
        name: "Google Ads phone (optional)",
        exact: true,
      })
      .fill("+44 20 7946 0019")
    await area
      .getByRole("combobox", { name: "Where do you meet customers?" })
      .click()
    await page
      .getByRole("option", { name: "At customer locations only", exact: true })
      .click()
    await expect(card.getByRole("alert")).toContainText(
      "Enter the service-area country"
    )
    await area
      .getByRole("textbox", { name: "Service-area country code", exact: true })
      .fill("gb")
    await expect(card.getByRole("alert")).toContainText(
      "Remove the storefront address"
    )
    const name = area.getByRole("textbox", {
      name: "Service area name",
      exact: true,
    })
    const id = area.getByRole("textbox", {
      name: "Service area place ID",
      exact: true,
    })
    await name.fill("London")
    await id.fill("invalid place ID")
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(
      page.getByText(/Save your business draft before changing setup steps/)
    ).toBeVisible()
    await area.getByRole("button", { name: "Add service area" }).click()
    await expect(area).toContainText("Enter a place identifier without spaces")
    await id.fill("ChIJ_London")
    await area.getByRole("button", { name: "Add service area" }).click()
    await name.fill("Duplicate London")
    await id.fill("ChIJ_London")
    await area.getByRole("button", { name: "Add service area" }).click()
    await expect(area).toContainText(
      "Each service area must have a different place ID"
    )
    await area.getByRole("button", { name: "Discard area entry" }).click()
    await name.fill("Westminster")
    await id.fill("ChIJ_Westminster")
    await area.getByRole("button", { name: "Add service area" }).click()
    await area.getByRole("combobox").click()
    await page
      .getByRole("option", {
        name: "At business and customer locations",
        exact: true,
      })
      .click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.serviceArea?.businessType).toBe(
      "CUSTOMER_AND_BUSINESS_LOCATION"
    )
    expect(
      fixture.read().draft.payload.serviceArea?.places?.placeInfos
    ).toHaveLength(2)
    expect(fixture.read().draft.payload.storefrontAddress).toMatchObject({
      addressLines: ["1 High Street"],
      organization: "Preserved organisation",
    })
    await area.getByRole("combobox").click()
    await page
      .getByRole("option", { name: "At customer locations only", exact: true })
      .click()
    await card
      .getByRole("button", { name: "Remove storefront from creation draft" })
      .click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.storefrontAddress).toBeUndefined()
    expect(fixture.read().draft.payload.serviceArea).toEqual({
      businessType: "CUSTOMER_LOCATION_ONLY",
      regionCode: "GB",
      places: {
        placeInfos: [
          { placeName: "London", placeId: "ChIJ_London" },
          { placeName: "Westminster", placeId: "ChIJ_Westminster" },
        ],
      },
    })
    await page.reload()
    await expect(area.getByRole("combobox")).toContainText(
      "At customer locations only"
    )
    await expect(
      area.getByText("ChIJ_Westminster", { exact: true })
    ).toBeVisible()
    await area
      .getByRole("button", { name: "Remove service area London", exact: true })
      .click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Search for matches", exact: true })
    ).toBeEnabled()
    expect(
      fixture.read().draft.payload.serviceArea?.places?.placeInfos
    ).toEqual([{ placeName: "Westminster", placeId: "ChIJ_Westminster" }])
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    await expect(card.getByRole("alert")).toContainText(
      "temporarily unavailable"
    )
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    await card
      .getByRole("checkbox", { name: /I reviewed the potential match/ })
      .check()
    await card
      .getByRole("textbox", { name: "Why is a separate listing needed?" })
      .fill("A distinct service business, separate from the returned shop.")
    await card
      .getByRole("button", { name: "Validate and review creation" })
      .click()
    await expect(card.getByRole("alert")).toContainText(
      "The proposed business details could not be validated"
    )
    await card
      .getByRole("button", { name: "Validate and review creation" })
      .click()
    const review = card.getByRole("region", {
      name: "Create a separate listing",
    })
    await expect(
      review.getByText("At customer locations only", { exact: true })
    ).toBeVisible()
    await expect(
      review.getByText("ChIJ_Westminster", { exact: true })
    ).toBeVisible()
    await expect(
      review.getByText(
        "A local repair service visiting customers across Westminster.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      review.getByText("SERVICE-WESTMINSTER", { exact: true })
    ).toBeVisible()
    await expect(review.getByText("Repairs", { exact: true })).toBeVisible()
    await expect(
      review.getByText("+44 20 7946 0019", { exact: true })
    ).toBeVisible()
    await expect(
      review.getByText("Google Ads phone", { exact: true })
    ).toBeVisible()
    await expect(
      review.getByText("Private label 1", { exact: true })
    ).toBeVisible()
    await page.setViewportSize({ width, height: 6500 })
    await card.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" })
    )
    await card.screenshot({
      path: testInfo.outputPath(`service-area-${width}.png`),
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-labelledby="onboarding-drafts-heading"]')
          .analyze()
      ).violations
    ).toEqual([])
  })
}

for (const width of [375, 768, 1280]) {
  test(`opening information in creation draft at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const fixture = await setup(page, baseURL)
    const card = page.getByRole("region", {
      name: "Find your business on Google",
    })
    await card
      .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
      .click()
    const opening = card.getByRole("group", { name: "Opening information" })
    await expect(
      opening.getByRole("button", { name: "Add opening date", exact: true })
    ).toBeDisabled()
    await opening
      .getByRole("combobox", { name: "Opening state", exact: true })
      .click()
    await page
      .getByRole("option", { name: "Temporarily closed", exact: true })
      .click()
    await opening
      .getByRole("button", { name: "Add opening date", exact: true })
      .click()
    const year = opening.getByRole("textbox", {
      name: "Opening year",
      exact: true,
    })
    const month = opening.getByRole("textbox", {
      name: "Opening month",
      exact: true,
    })
    const day = opening.getByRole("textbox", {
      name: "Opening day (optional)",
      exact: true,
    })
    await year.fill("2023")
    await month.fill("2")
    await day.fill("29")
    await expect(opening.getByRole("alert")).toContainText("Enter a valid day")
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    await year.fill("2024")
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.openInfo).toEqual({
      status: "CLOSED_TEMPORARILY",
      openingDate: { year: 2024, month: 2, day: 29 },
    })
    await page.reload()
    await expect(opening.getByRole("combobox")).toContainText(
      "Temporarily closed"
    )
    await expect(day).toHaveValue("29")
    await opening.getByRole("combobox").click()
    await page
      .getByRole("option", { name: "Permanently closed", exact: true })
      .click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.openInfo).toEqual({
      status: "CLOSED_PERMANENTLY",
      openingDate: { year: 2024, month: 2, day: 29 },
    })
    await opening
      .getByRole("button", {
        name: "Clear opening date from proposal",
        exact: true,
      })
      .click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.openInfo).toEqual({
      status: "CLOSED_PERMANENTLY",
    })
    await opening.getByRole("combobox").click()
    await page
      .getByRole("option", {
        name: "Not supplied in this proposal",
        exact: true,
      })
      .click()
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Save business details" })
    ).toBeDisabled()
    expect(fixture.read().draft.payload.openInfo).toBeUndefined()
    await opening.getByRole("combobox").click()
    await page.getByRole("option", { name: "Open", exact: true }).click()
    await opening
      .getByRole("button", { name: "Add opening date", exact: true })
      .click()
    await year.fill("2024")
    await month.fill("2")
    await card.getByRole("button", { name: "Save business details" }).click()
    await expect(
      card.getByRole("button", { name: "Search for matches", exact: true })
    ).toBeEnabled()
    expect(fixture.read().draft.payload.openInfo).toEqual({
      status: "OPEN",
      openingDate: { year: 2024, month: 2 },
    })
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    await expect(card.getByRole("alert")).toContainText(
      "temporarily unavailable"
    )
    await card
      .getByRole("button", { name: "Search for matches", exact: true })
      .click()
    const review = card.getByRole("region", {
      name: "Create a separate listing",
    })
    await review
      .getByRole("checkbox", { name: /I reviewed the potential match/ })
      .check()
    await review
      .getByRole("textbox", { name: "Why is a separate listing needed?" })
      .fill("Separate new premises with different opening information.")
    await review
      .getByRole("button", { name: "Validate and review creation" })
      .click()
    await expect(review.getByRole("alert")).toContainText(
      "could not be validated"
    )
    await review
      .getByRole("button", { name: "Validate and review creation" })
      .click()
    await expect(
      review.getByText("Opening state", { exact: true })
    ).toBeVisible()
    await expect(review.getByText("Open", { exact: true })).toBeVisible()
    await expect(
      review.getByText("2024-02 (day not supplied)", { exact: true })
    ).toBeVisible()
    await page.setViewportSize({ width, height: 6500 })
    await card.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" })
    )
    await card.screenshot({ path: testInfo.outputPath(`opening-${width}.png`) })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-labelledby="onboarding-drafts-heading"]')
          .analyze()
      ).violations
    ).toEqual([])
  })
}

test("starting a draft retries the same identity after an interrupted response", async ({
  page,
  baseURL,
}) => {
  const fixture = await setup(page, baseURL)
  const card = page.getByRole("region", {
    name: "Find your business on Google",
  })
  await card.getByRole("button", { name: "Start a business draft" }).click()
  await expect(card.getByRole("alert")).toContainText(
    "Retry uses the same draft identity"
  )
  await card.getByRole("button", { name: "Start a business draft" }).click()
  await expect(
    card.getByRole("textbox", { name: "Business name", exact: true })
  ).toHaveValue("")
  await expect(
    card.getByRole("textbox", { name: "Listing language" })
  ).toHaveValue("en-GB")
  await expect(
    card.getByRole("button", { name: "Search for matches", exact: true })
  ).toBeDisabled()
  const ids = fixture.read().createdIds
  expect(ids).toHaveLength(2)
  expect(ids[0]).toBe(ids[1])
  await expect(page).toHaveURL(new RegExp(`onboardingDraft=${ids[0]}`))
})

test("a stale save preserves local edits until the operator explicitly reloads", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL, undefined, true)
  const card = page.getByRole("region", {
    name: "Find your business on Google",
  })
  await card
    .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
    .click()
  await card
    .getByRole("textbox", { name: "Business name", exact: true })
    .fill("My unsaved name")
  await card.getByRole("button", { name: "Save business details" }).click()
  await expect(card.getByRole("alert")).toBeVisible()
  await expect(
    card.getByRole("textbox", { name: "Business name", exact: true })
  ).toHaveValue("My unsaved name")
  await card
    .getByRole("button", { name: "Discard local edits and reload saved draft" })
    .click()
  await expect(
    card.getByRole("textbox", { name: "Business name", exact: true })
  ).toHaveValue("Saved by another operator")
  await expect(
    card.getByRole("button", { name: "Save business details" })
  ).toBeDisabled()
})

test("unknown creation stays unresolved without a create or link action", async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await setup(page, baseURL, "unknown")
  const card = page.getByRole("region", {
    name: "Find your business on Google",
  })
  await card
    .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
    .click()
  await expect(
    card.getByRole("heading", { name: "Google creation outcome is unresolved" })
  ).toBeVisible()
  await expect(
    card.getByRole("button", { name: "Resume local linking" })
  ).toHaveCount(0)
  await expect(
    card.getByRole("textbox", { name: "Business name" })
  ).toHaveCount(0)
  await card.getByRole("button", { name: "Refresh creation outcome" }).click()
  await page.setViewportSize({ width: 375, height: 1600 })
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({
    path: testInfo.outputPath("onboarding-unresolved.png"),
  })
})

test("known creation resumes local linking and points to verification", async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 })
  const fixture = await setup(page, baseURL, "link_failed")
  const card = page.getByRole("region", {
    name: "Find your business on Google",
  })
  await card
    .getByRole("button", { name: /Restore draft\s*:\s*Saved shop/ })
    .click()
  await expect(
    card.getByText("A local listing already uses this name.", { exact: false })
  ).toBeVisible()
  await card
    .getByRole("textbox", { name: "Local listing name" })
    .fill("Distinct local listing")
  await card.getByRole("button", { name: "Resume local linking" }).click()
  await expect(
    card.getByRole("link", { name: "Continue to verification" })
  ).toHaveAttribute("href", `/listings/${actorId}/verification`)
  expect(fixture.read().links).toBe(1)
  await page.setViewportSize({ width: 375, height: 1600 })
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: testInfo.outputPath("onboarding-linked.png") })
})
