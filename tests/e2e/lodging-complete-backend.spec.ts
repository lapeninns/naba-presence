import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import {
  captureLodging as capture,
  captureLodgingDialog,
  lodgingSheet,
} from "./helpers/lodging-capture"
import { startLodgingBackend } from "./helpers/lodging-backend"
import { JOURNEY_WIDTH, LAYOUT_WIDTHS, viewportAt } from "./helpers/widths"

let backend: Awaited<ReturnType<typeof startLodgingBackend>>
test.beforeAll(async () => {
  backend = await startLodgingBackend()
})
test.afterAll(async () => {
  await backend.stop()
})
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === backend.server.baseUrl
      ? route.continue()
      : route.abort("blockedbyclient")
  )
})
const editor = (page: Page) =>
  page.getByRole("region", { name: "Lodging details", exact: true })
async function search(page: Page, value: string) {
  await editor(page)
    .getByRole("searchbox", { name: "Find a lodging detail" })
    .fill(value)
}

/** Every writable lodging group the editor pins, in the order it shows them. */
const PINNED_GROUPS = [
  "Property",
  "Policies",
  "Guest units",
  "Common living area",
  "Accessibility",
  "Parking",
  "Connectivity",
  "Food and drink",
  "Housekeeping",
  "Wellness",
  "Pools",
  "Activities",
  "Business",
  "Families",
  "Pets",
  "Services",
  "Health and safety",
  "Sustainability",
  "Transportation",
]

/**
 * Opens every pinned group by keyboard (each expands, and Guest units shows its
 * nested item control), then checks all of them together: every select control
 * keeps a readable value at this width, and one axe scan of the editor with all
 * 19 open covers every group's content. Closing each one again proves the
 * toggle. Each group used to be its own test with its own fixture, axe scan and
 * screenshot, because walking all 19 with a scan each took 22-28 s of a 30 s
 * budget; the per-group scan and screenshot are what is not repeated.
 */
async function walkPinnedGroups(page: Page, width: number) {
  await search(page, "")
  for (const group of PINNED_GROUPS) {
    const button = editor(page).getByRole("button", {
      name: group,
      exact: true,
    })
    await button.focus()
    await page.keyboard.press("Enter")
    await expect(button).toHaveAttribute("aria-expanded", "true")
    if (group === "Guest units") {
      await editor(page)
        .getByRole("button", { name: "Add guest units item", exact: true })
        .click()
      await expect(
        editor(page).getByRole("spinbutton", {
          name: "Beds count",
          exact: true,
        })
      ).toBeVisible()
    }
  }
  // Every select control keeps a readable value at this width. Measured once,
  // with all 19 groups open: each measurement lays the whole editor out again.
  const narrowControls = await editor(page)
    .getByRole("combobox")
    .evaluateAll((controls) =>
      controls
        .filter((control) => control.getBoundingClientRect().width < 160)
        .map((control) => ({
          label: control.getAttribute("aria-labelledby"),
          width: control.getBoundingClientRect().width,
        }))
    )
  expect(
    narrowControls,
    `lodging controls must keep readable values at ${width}px`
  ).toEqual([])
  for (const group of PINNED_GROUPS)
    await expect(
      editor(page).getByRole("button", { name: group, exact: true })
    ).toHaveAttribute("aria-expanded", "true")
  // One axe scan and overflow check of the editor with every group open. No
  // screenshot: stitching the editor's full height with all 19 groups open is
  // slower than the rest of the walk, and a screenshot here is only an artefact.
  expect(
    (
      await new AxeBuilder({ page })
        .include('section[aria-labelledby$="-title"]')
        .analyze()
    ).violations
  ).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  for (const group of PINNED_GROUPS) {
    const button = editor(page).getByRole("button", {
      name: group,
      exact: true,
    })
    await button.click()
    await expect(button).toHaveAttribute("aria-expanded", "false")
  }
}

test.describe(`Complete lodging journeys at ${JOURNEY_WIDTH}px`, () => {
  test.use({ viewport: viewportAt(JOURNEY_WIDTH) })
  test("edits an unknown boolean without overwriting unknown siblings or conditional details", async ({
    page,
  }, info) => {
    const fixture = await backend.lodgingFixture(page)
    await fixture.open()
    await search(page, "Parking available")
    const value = editor(page).getByRole("radiogroup", {
      name: "Parking available",
      exact: true,
    })
    await expect(
      value.getByRole("radio", { name: "Not recorded", exact: true })
    ).toBeChecked()
    await capture(page, info, "unknown")
    await value.getByRole("radio", { name: "No", exact: true }).click()
    const footer = page.getByRole("region", {
      name: "Editor actions",
      exact: true,
    })
    await expect(
      footer.getByText("1 change not on Google", { exact: true })
    ).toBeVisible()
    // Save here can't take a lodging draft: it is left out of the bar (and the
    // phone's overflow menu) rather than greyed, and the bar's note says why.
    await expect(
      footer.getByRole("button", { name: "Save here", exact: true })
    ).toHaveCount(0)
    await expect(footer.getByRole("note")).toContainText(
      "saved through their own review"
    )
    await capture(page, info, "explicit-no")
    await footer
      .getByRole("button", { name: "Review lodging draft", exact: true })
      .click()
    const review = page.getByRole("dialog", { name: lodgingSheet })
    await expect(
      review.getByText("Parking · Parking available", { exact: true })
    ).toBeVisible()
    await expect(
      review
        .getByRole("row")
        .filter({
          has: page.getByText("Parking · Parking available", { exact: true }),
        })
        .getByText("Not set", { exact: true })
    ).toBeVisible()
    expect(fixture.writes()).toHaveLength(0)
    await captureLodgingDialog(page, info, "review")
    await review
      .getByRole("button", { name: "Approve lodging changes", exact: true })
      .click()
    expect(fixture.writes()).toHaveLength(0)
    await expect(
      review.getByRole("button", {
        name: "Send approved lodging changes",
        exact: true,
      })
    ).toBeDisabled()
    await review
      .getByRole("checkbox", {
        name: "Send these exact approved lodging changes to Google.",
      })
      .check()
    await review
      .getByRole("button", {
        name: "Send approved lodging changes",
        exact: true,
      })
      .click()
    await expect(
      page.getByText("Lodging details confirmed by Google", { exact: true })
    ).toBeVisible()
    expect(fixture.writes()).toHaveLength(1)
    expect(fixture.writes()[0].body).toMatchObject({
      parking: { parkingAvailable: false },
    })
    expect(fixture.writes()[0].path).toContain("parking.parkingAvailable")
    expect(fixture.state.lodging.parking).toEqual({
      freeParking: false,
      freeParkingException: "DEPENDENT_ON_SEASON",
      parkingAvailable: false,
    })
    expect(fixture.state.lodging.pets).toEqual({
      petsAllowed: false,
      futureProviderSibling: "retain",
    })
  })
  test("applies one real Google suggestion into a draft and preserves an unrelated manual edit", async ({
    page,
  }, info) => {
    const fixture = await backend.lodgingFixture(page)
    await fixture.open()
    await search(page, "Rooms count")
    await editor(page)
      .getByRole("spinbutton", { name: "Rooms count", exact: true })
      .fill("24")
    await page
      .getByRole("button", {
        name: "Apply suggested pets allowed to draft",
        exact: true,
      })
      .click()
    await search(page, "Pets allowed")
    await expect(
      editor(page)
        .getByRole("radiogroup", { name: "Pets allowed", exact: true })
        .getByRole("radio", { name: "Yes", exact: true })
    ).toBeChecked()
    await capture(page, info, "selected-suggestion")
    await page
      .getByRole("button", { name: "Review lodging changes", exact: true })
      .click()
    await expect(page.getByRole("dialog", { name: lodgingSheet })).toBeVisible()
    const [review] =
      await backend.admin`select payload, update_mask from gbp_change_set where organisation_id = ${fixture.owner.organisationId} and resource_type = 'lodging' order by created_at desc limit 1`
    expect(review.payload).toMatchObject({
      property: { roomsCount: 24 },
      pets: { petsAllowed: true },
    })
    expect(review.update_mask).toEqual([
      "metadata.updateTime",
      "pets.petsAllowed",
      "property.roomsCount",
    ])
    expect(fixture.writes()).toHaveLength(0)
    await captureLodgingDialog(page, info, "suggestion-review")
  })
  test("edits a repeated collection and displays concrete validation errors", async ({
    page,
  }, info) => {
    const fixture = await backend.lodgingFixture(page)
    await fixture.open()
    await search(page, "Languages spoken")
    await editor(page)
      .getByRole("button", { name: "Add languages spoken item", exact: true })
      .click()
    const codes = editor(page).getByRole("textbox", {
      name: "Language code",
      exact: true,
    })
    await codes.nth(1).fill("fr")
    const spoken = editor(page).getByRole("radiogroup", {
      name: "Spoken",
      exact: true,
    })
    await spoken.nth(1).getByRole("radio", { name: "Yes", exact: true }).click()
    await capture(page, info, "repeated-language")
    await editor(page)
      .getByRole("button", { name: "Add languages spoken item", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Review lodging changes", exact: true })
    ).toBeDisabled()
    await expect(
      page
        .getByRole("region", { name: "Editor actions", exact: true })
        .getByRole("button", { name: "Review lodging draft", exact: true })
    ).toBeDisabled()
    await expect(
      editor(page)
        .getByRole("textbox", { name: "Language code", exact: true })
        .nth(2)
    ).toHaveAttribute("aria-invalid", "true")
    await expect(
      editor(page).getByText("Enter a language code such as en, fr or es.", {
        exact: true,
      })
    ).toBeVisible()
    await capture(page, info, "invalid-language")
    await editor(page)
      .getByRole("button", { name: "Remove languages spoken 3", exact: true })
      .click()
    await search(page, "Checkin time")
    await editor(page)
      .getByLabel("Check-in time", { exact: true })
      .fill("00:00")
    await page
      .getByRole("button", { name: "Review lodging changes", exact: true })
      .click()
    await expect(page.getByRole("dialog", { name: lodgingSheet })).toBeVisible()
    const [review] =
      await backend.admin`select payload, update_mask from gbp_change_set where organisation_id = ${fixture.owner.organisationId} and resource_type = 'lodging' order by created_at desc limit 1`
    expect(review.payload).toMatchObject({
      policies: { checkinTime: { hours: 0, minutes: 0 } },
      services: {
        languagesSpoken: [
          { languageCode: "en", spoken: true },
          { languageCode: "fr", spoken: true },
        ],
      },
    })
    expect(review.update_mask).toEqual([
      "metadata.updateTime",
      "policies.checkinTime",
      "services.languagesSpoken",
    ])
    expect(fixture.writes()).toHaveLength(0)
    await captureLodgingDialog(page, info, "collection-review")
  })
  test("shows every pinned writable lodging group and its nested guest-unit control", async ({
    page,
  }) => {
    // One test now does what 19 did, each with its own 30 s: three times the budget, not 19.
    test.slow()
    const fixture = await backend.lodgingFixture(page)
    await fixture.open()
    await walkPinnedGroups(page, JOURNEY_WIDTH)
    expect(fixture.writes()).toHaveLength(0)
  })
  test("restores an expired confirmed request after disconnection without a provider resend", async ({
    page,
  }, info) => {
    const fixture = await backend.lodgingFixture(page)
    await fixture.open()
    await search(page, "Pets allowed")
    await editor(page)
      .getByRole("radiogroup", { name: "Pets allowed", exact: true })
      .getByRole("radio", { name: "Yes", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Review lodging changes", exact: true })
      .click()
    const dialog = page.getByRole("dialog", { name: lodgingSheet })
    await dialog
      .getByRole("button", { name: "Approve lodging changes", exact: true })
      .click()
    await dialog
      .getByRole("checkbox", {
        name: "Send these exact approved lodging changes to Google.",
      })
      .check()
    await dialog
      .getByRole("button", {
        name: "Send approved lodging changes",
        exact: true,
      })
      .click()
    await expect(
      dialog.getByText("Independently confirmed", { exact: true })
    ).toBeVisible()
    const reviewId = await fixture.reviewId("lodging")
    await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 hour' where id = ${reviewId}`
    await fixture.disconnect()
    await page.reload()
    const saved = page.getByRole("region", {
      name: "Saved lodging work",
      exact: true,
    })
    await expect(saved.getByText(/^Lodging details for /).first()).toBeVisible()
    await saved
      .getByRole("button", { name: "Open lodging outcome", exact: true })
      .click()
    await expect(
      dialog.getByText("Independently confirmed", { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByRole("button", {
        name: "Send approved lodging changes",
        exact: true,
      })
    ).toHaveCount(0)
    await expect(dialog.locator("time").last()).toBeVisible()
    await expect(
      page.getByRole("dialog", { name: "Saved lodging outcome" })
    ).toBeVisible()
    await expect(
      dialog.getByText(/fresh preview|Approval expired/)
    ).toHaveCount(0)
    await captureLodgingDialog(page, info, "disconnected-expired-outcome")
    expect(fixture.writes()).toHaveLength(1)
  })
})
// What width changes on this screen: the editor's controls and the review sheet
// reflow. The journeys above make the same axe and overflow assertions at
// JOURNEY_WIDTH.
for (const width of LAYOUT_WIDTHS)
  test.describe(`Complete lodging layout at ${width}px`, () => {
    test.use({ viewport: viewportAt(width) })
    test("keeps the editor and every pinned group usable", async ({
      page,
    }, info) => {
      test.slow() // the same 19-group walk
      const fixture = await backend.lodgingFixture(page)
      await fixture.open()
      await search(page, "Parking available")
      await capture(page, info, "unknown")
      await walkPinnedGroups(page, width)
      expect(fixture.writes()).toHaveLength(0)
    })
    test("keeps the review, consent and confirmed outcome sheet usable", async ({
      page,
    }, info) => {
      const fixture = await backend.lodgingFixture(page)
      await fixture.open()
      await search(page, "Pets allowed")
      await editor(page)
        .getByRole("radiogroup", { name: "Pets allowed", exact: true })
        .getByRole("radio", { name: "Yes", exact: true })
        .click()
      await capture(page, info, "draft")
      await page
        .getByRole("button", { name: "Review lodging changes", exact: true })
        .click()
      const dialog = page.getByRole("dialog", { name: lodgingSheet })
      await captureLodgingDialog(page, info, "review")
      await dialog
        .getByRole("button", { name: "Approve lodging changes", exact: true })
        .click()
      await dialog
        .getByRole("checkbox", {
          name: "Send these exact approved lodging changes to Google.",
        })
        .check()
      await captureLodgingDialog(page, info, "consent")
      await dialog
        .getByRole("button", {
          name: "Send approved lodging changes",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByText("Independently confirmed", { exact: true })
      ).toBeVisible()
      await captureLodgingDialog(page, info, "confirmed")
      expect(fixture.writes()).toHaveLength(1)
    })
  })
