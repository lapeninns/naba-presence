import { expect, type Page, test } from "@playwright/test"

import { applyCookie } from "./helpers/client-stubs"
import { readJourneyState } from "./helpers/stub-bridge"

// The client hub (R15): /clients/[clientId], read against the real seeded
// "Journey Hospitality" client and its seeded listings. Nothing here writes:
// the share sheet is opened but no link is created.

test.beforeEach(async ({ baseURL, page }) => {
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)
})

async function openHub(page: Page) {
  const state = await readJourneyState()
  await page.goto(`/clients/${state.clientId}`)
  await expect(
    page.getByRole("heading", { name: state.clientName, level: 1 })
  ).toBeVisible()
  return state
}

function listingsTable(page: Page) {
  return page.getByRole("table", { name: /listings with their Google link/ })
}

test.describe("client hub at a 1280px desk", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("names the client and summarises the work for it", async ({ page }) => {
    const state = await openHub(page)
    const work = page.getByRole("region", { name: "Work for this client" })
    await expect(work).toBeVisible()
    await expect(
      work.getByText(`filtered to ${state.clientName}`)
    ).toBeVisible()
    // Four tiles, each one link.
    await expect(work.getByRole("link")).toHaveCount(4)
  })

  test("each work tile opens the inbox or listings scoped to this client", async ({
    page,
  }) => {
    const state = await openHub(page)
    const work = page.getByRole("region", { name: "Work for this client" })
    const id = state.clientId
    await expect(
      work.getByRole("link", { name: /^Needs reply/ })
    ).toHaveAttribute("href", `/inbox?clientId=${id}&queue=needs_reply`)
    await expect(
      work.getByRole("link", { name: /^Awaiting approval/ })
    ).toHaveAttribute("href", `/inbox?clientId=${id}&queue=approval`)
    await expect(
      work.getByRole("link", { name: /^Replies that didn.t post/ })
    ).toHaveAttribute("href", `/inbox?clientId=${id}&queue=failed`)
    await expect(
      work.getByRole("link", { name: /^Listings linked/ })
    ).toHaveAttribute("href", `/listings?clientId=${id}`)
  })

  test("a work tile navigates to the inbox filtered to the client", async ({
    page,
  }) => {
    const state = await openHub(page)
    await page
      .getByRole("region", { name: "Work for this client" })
      .getByRole("link", { name: /^Needs reply/ })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/inbox\\?.*clientId=${state.clientId}`)
    )
  })

  test("lists the seeded listings with their section links, and opens one", async ({
    page,
  }) => {
    const state = await openHub(page)
    const table = listingsTable(page)
    const direct = state.directReview
    const approval = state.approvalReview
    await expect(
      table.getByRole("link", { name: direct.locationName, exact: true })
    ).toHaveAttribute("href", `/listings/${direct.locationId}`)
    await expect(
      table.getByRole("link", { name: approval.locationName, exact: true })
    ).toHaveAttribute("href", `/listings/${approval.locationId}`)

    // At the desk each row carries its own section links, not a menu.
    const sections = page.getByRole("navigation", {
      name: `${direct.locationName} sections`,
    })
    await expect(
      sections.getByRole("link", { name: "Profile" })
    ).toHaveAttribute("href", `/listings/${direct.locationId}/profile`)
    await expect(
      sections.getByRole("link", { name: "Photos" })
    ).toHaveAttribute("href", `/listings/${direct.locationId}/photos`)
    await expect(sections.getByRole("link", { name: "Posts" })).toHaveAttribute(
      "href",
      `/listings/${direct.locationId}/posts`
    )
    await expect(
      sections.getByRole("link", { name: "Reports" })
    ).toHaveAttribute("href", `/reports?locationId=${direct.locationId}`)
    await expect(
      page.getByRole("button", { name: `More for ${direct.locationName}` })
    ).toHaveCount(0)

    await table
      .getByRole("link", { name: direct.locationName, exact: true })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/listings/${direct.locationId}(?:[/?#]|$)`)
    )
  })

  test("the More menu offers Report, Share report and Settings", async ({
    page,
  }) => {
    const state = await openHub(page)
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click()
    await expect(
      page.getByRole("menuitem", { name: "Report", exact: true })
    ).toHaveAttribute("href", `/reports?clientId=${state.clientId}`)
    await expect(
      page.getByRole("menuitem", { name: "Share report" })
    ).toBeVisible()
    await expect(
      page.getByRole("menuitem", { name: "Settings" })
    ).toHaveAttribute("href", `/clients/${state.clientId}/settings`)
  })

  test("Share report opens the share sheet without creating a link", async ({
    page,
  }) => {
    const state = await openHub(page)
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click()
    await page.getByRole("menuitem", { name: "Share report" }).click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", {
        name: `Share ${state.clientName}’s report`,
      })
    ).toBeVisible()
    await expect(
      dialog.getByRole("button", { name: "Create link" })
    ).toBeVisible()
    await expect(
      dialog.getByRole("textbox", { name: "Report link" })
    ).toHaveCount(0)
  })

  test("the details cards show the past-review import and the team notes", async ({
    page,
  }) => {
    const state = await openHub(page)
    const details = page.getByRole("complementary", {
      name: `${state.clientName} details`,
    })
    await expect(
      details.getByRole("heading", { name: "Past reviews", level: 2 })
    ).toBeVisible()
    await expect(
      details.getByRole("heading", { name: "Notes for the team", level: 2 })
    ).toBeVisible()
    await expect(
      details.getByRole("link", { name: "Edit notes" })
    ).toHaveAttribute("href", `/clients/${state.clientId}/settings#details`)
  })
})

test.describe("client hub on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("names the client and keeps the four work tiles as links", async ({
    page,
  }) => {
    const state = await openHub(page)
    const work = page.getByRole("region", { name: "Work for this client" })
    await expect(work.getByRole("link")).toHaveCount(4)
    await expect(
      work.getByRole("link", { name: /^Needs reply/ })
    ).toHaveAttribute(
      "href",
      `/inbox?clientId=${state.clientId}&queue=needs_reply`
    )
    // No sideways scroll at 390px.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    )
    expect(overflow).toBe(false)
  })

  test("the listings are cards: a name link and one More menu per row", async ({
    page,
  }) => {
    const state = await openHub(page)
    const direct = state.directReview
    await expect(
      listingsTable(page).getByRole("link", {
        name: direct.locationName,
        exact: true,
      })
    ).toHaveAttribute("href", `/listings/${direct.locationId}`)
    // The four inline section links give way to a menu.
    await expect(
      page.getByRole("navigation", { name: `${direct.locationName} sections` })
    ).toHaveCount(0)
    await page
      .getByRole("button", { name: `More for ${direct.locationName}` })
      .click()
    await expect(
      page.getByRole("menuitem", { name: "Profile" })
    ).toHaveAttribute("href", `/listings/${direct.locationId}/profile`)
    await expect(
      page.getByRole("menuitem", { name: "Reports" })
    ).toHaveAttribute("href", `/reports?locationId=${direct.locationId}`)
  })

  test("Share report is reachable from More and opens the share sheet", async ({
    page,
  }) => {
    const state = await openHub(page)
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click()
    await page.getByRole("menuitem", { name: "Share report" }).click()
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: `Share ${state.clientName}’s report` })
    ).toBeVisible()
  })
})
