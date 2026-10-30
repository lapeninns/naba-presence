import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page, test } from "@playwright/test"

import { startGoogleWatchBackend } from "./helpers/google-watch-backend"

// The Google change watch (S5) against a private Google stub: a field changed
// on Google is shown as ours against Google's, put back through the reviewed
// business-information change (approve, then publish) or the hours publish,
// or kept as Google's, and settled by reading Google again. Nothing reaches
// a real Google. Self-contained, so it is in playwright.config.ts's ISOLATED
// pattern: the isolated suite runs it and the shared suite skips it.

let backend: Awaited<ReturnType<typeof startGoogleWatchBackend>>
test.beforeAll(async () => {
  backend = await startGoogleWatchBackend()
})
test.afterAll(async () => {
  await backend?.stop()
})
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === backend.server.baseUrl
      ? route.continue()
      : route.abort("blockedbyclient")
  )
})

/** The one row of a change, found by its diff table's title. */
function changeRow(page: Page, title: string) {
  return page.locator('[data-slot="google-change"]').filter({
    has: page.getByRole("table", {
      name: `${title}: ours against Google’s`,
    }),
  })
}

/** The Ours and Google’s cells of a diff row, by its first cell. */
async function expectDiff(
  row: Locator,
  label: string,
  ours: string,
  google: string
) {
  const line = row.getByRole("row").filter({ hasText: label })
  const cells = line.getByRole("cell")
  await expect(cells.nth(0)).toHaveText(new RegExp(`${ours}$`))
  await expect(cells.nth(1)).toHaveText(new RegExp(`${google}$`))
}

/** The tab's one "Check Google now", which also runs the watch. */
async function checkGoogle(page: Page) {
  const check = page.getByRole("button", { name: "Check Google now" })
  await expect(check).toHaveCount(1)
  await check.click()
  await expect(page.getByText("Checked with Google")).toBeVisible()
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('[data-slot="google-changes"]')
    .analyze()
  expect(results.violations).toEqual([])
}

test("an owner puts a business name Google changed back, through review, approval and publishing", async ({
  page,
}) => {
  const f = await backend.fixture(page)
  // The first read is the baseline: Google matches what we hold.
  expect((await f.check()).found).toBe(0)
  // Someone edits the listing on Google.
  f.location.title = "Old Crown Inn"

  await f.goto(`/listings/${f.linked.locationId}/suggestions`)
  const panel = page.locator('[data-slot="google-changes"]')
  await expect(
    panel.getByRole("heading", { name: /Protected fields Google changed/ })
  ).toBeVisible()
  await checkGoogle(page)

  const row = changeRow(page, "Business name")
  await expect(row).toHaveCount(1)
  await expectDiff(row, "Business name", "Old Crown", "Old Crown Inn")
  await expect(row.getByText("Needs a decision")).toBeVisible()
  await expect(
    panel.getByRole("heading", { name: /· 1 to decide/ })
  ).toBeVisible()
  // Google's own suggestion for the same field is decided here, not twice.
  await expect(
    page.getByText(/Suggestions for protected fields are decided above/)
  ).toBeVisible()

  await row.getByRole("button", { name: "Put ours back" }).click()
  await expect(page.getByText("Ours is ready to review")).toBeVisible()
  await expect(row.getByText("Waiting for approval")).toBeVisible()
  expect(f.writes).toHaveLength(0)

  await row.getByRole("button", { name: "Approve" }).click()
  await expect(row.getByText("Ready to publish")).toBeVisible()
  expect(f.writes).toHaveLength(0)
  await expectAccessible(page)

  await row.getByRole("button", { name: "Publish to Google" }).click()
  await expect(
    row.getByText("Sent to Google, waiting for Google to confirm")
  ).toBeVisible()
  // Only the name went to Google: nothing else on the listing was written.
  expect(f.writes).toEqual([expect.objectContaining({ title: "Old Crown" })])
  expect(f.updateMasks).toEqual(["title"])
  expect(f.location.title).toBe("Old Crown")

  // Reading Google again settles it as put back.
  await checkGoogle(page)
  await expect(
    panel.getByText(/Google matches ours for every protected field/)
  ).toBeVisible()
  await panel.getByText(/Earlier changes on Google/).click()
  await expect(panel.getByText("Ours was put back on Google")).toBeVisible()
})

test("Google changing a field again before it is put back stops the put-back", async ({
  page,
}) => {
  const f = await backend.fixture(page)
  expect((await f.check()).found).toBe(0)
  f.location.websiteUri = "https://crown-pub.example"
  expect((await f.check()).found).toBe(1)

  await f.goto(`/listings/${f.linked.locationId}/suggestions`)
  const row = changeRow(page, "Website")
  await expectDiff(
    row,
    "Website",
    "https://old-crown.example",
    "https://crown-pub.example"
  )
  // Google moves again after the page showed its value.
  f.location.websiteUri = "https://another.example"
  await row.getByRole("button", { name: "Put ours back" }).click()
  await expect(row.getByRole("alert")).toContainText(
    "Google changed this again"
  )
  await expect(row.getByText("Needs a decision")).toBeVisible()
  expect(f.writes).toHaveLength(0)
})

test("hours go back through a confirmation, and Google's website can be kept as ours", async ({
  page,
}) => {
  const f = await backend.fixture(page)
  expect((await f.check()).found).toBe(0)
  f.location.regularHours = {
    periods: [
      {
        openDay: "FRIDAY",
        openTime: { hours: 12 },
        closeDay: "FRIDAY",
        closeTime: { hours: 18 },
      },
      {
        openDay: "SATURDAY",
        openTime: { hours: 12 },
        closeDay: "SATURDAY",
        closeTime: { hours: 23 },
      },
    ],
  }
  f.location.websiteUri = "https://crown-pub.example"
  expect((await f.check()).found).toBe(2)

  await f.goto(`/listings/${f.linked.locationId}/suggestions`)
  const hours = changeRow(page, "Opening hours: Friday")
  await expectDiff(hours, "Friday", "12:00–23:00", "12:00–18:00")
  await hours.getByRole("button", { name: "Put ours back" }).click()
  const dialog = page.getByRole("alertdialog", {
    name: "Put our hours back on Google?",
  })
  await expect(dialog).toContainText("Friday")
  expect(f.writes).toHaveLength(0)
  await dialog.getByRole("button", { name: "Put ours back" }).click()
  await expect(page.getByText("Sent to Google", { exact: true })).toBeVisible()
  expect(f.updateMasks).toEqual(["regularHours"])

  const website = changeRow(page, "Website")
  await website.getByRole("button", { name: "Keep Google’s" }).click()
  const keep = page.getByRole("alertdialog", { name: "Keep Google’s website?" })
  await expect(keep).toContainText("Nothing is sent to Google")
  await keep.getByRole("button", { name: "Keep Google’s" }).click()
  await expect(page.getByText("Kept Google’s website")).toBeVisible()
  // Keeping Google's writes nothing to Google.
  expect(f.updateMasks).toEqual(["regularHours"])

  const panel = page.locator('[data-slot="google-changes"]')
  await expect(
    panel.getByText(/Google matches ours for every protected field/)
  ).toBeVisible()
  await panel.getByText(/Earlier changes on Google/).click()
  await expect(panel.getByText("Kept Google’s")).toBeVisible()
  await expect(panel.getByText("Ours was put back on Google")).toBeVisible()
})

test("a member sees what Google changed, with the reason they can't decide, on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await backend.fixture(page)
  expect((await f.check()).found).toBe(0)
  f.location.phoneNumbers = { primaryPhone: "+44 1223 999999" }
  expect((await f.check()).found).toBe(1)

  await page.context().clearCookies()
  await f.signIn(f.member.cookie)
  await f.goto(`/listings/${f.linked.locationId}/suggestions`)
  const row = changeRow(page, "Phone number")
  await expectDiff(
    row,
    "Phone number",
    "\\+44 1223 000000",
    "\\+44 1223 999999"
  )
  const reason =
    "Only owners and admins who can publish this listing can put ours back or keep Google’s."
  for (const name of ["Put ours back", "Keep Google’s"]) {
    const button = row.getByRole("button", { name })
    await expect(button).toHaveAttribute("aria-disabled", "true")
    await expect(button).toHaveAccessibleDescription(reason)
  }
  await expect(
    page.getByText(`${reason} You can see what changed.`)
  ).toBeVisible()
  // No check for a member either: the tab's check is for owners and admins.
  expect(f.writes).toHaveLength(0)

  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})
