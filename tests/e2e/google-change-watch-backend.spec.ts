import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { startGoogleWatchBackend } from "./helpers/google-watch-backend"

// The Google change watch (S5) against a private Google stub: a field changed
// on Google is shown as ours against Google's, put back through the reviewed
// business-information change (approve, then publish), and confirmed by
// reading Google again. Nothing reaches a real Google.
//
// INTEGRATION(S5): add `google-change-watch-backend` to the ISOLATED pattern
// in playwright.config.ts so the shared suite skips this self-contained spec.

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
  await page.getByRole("button", { name: "Check Google now" }).first().click()

  const row = panel.locator('[data-slot="google-change"]')
  await expect(row).toHaveCount(1)
  const diff = row.getByRole("table", {
    name: "Business name: ours against what Google shows",
  })
  await expect(diff).toContainText("Old Crown")
  await expect(diff).toContainText("Old Crown Inn")
  await expect(row.getByText("Needs a decision")).toBeVisible()
  // The same field is not offered again as one of Google's suggestions.
  await expect(
    page.getByRole("button", { name: "Accept", exact: true })
  ).toHaveCount(0)

  await row.getByRole("button", { name: "Put ours back" }).click()
  await expect(page.getByText("Ours is ready to review")).toBeVisible()
  await expect(row.getByText("Waiting for approval")).toBeVisible()
  expect(f.writes).toHaveLength(0)

  await row.getByRole("button", { name: "Approve" }).click()
  await expect(row.getByText("Ready to publish")).toBeVisible()
  expect(f.writes).toHaveLength(0)

  await row.getByRole("button", { name: "Publish to Google" }).click()
  await expect(page.getByText("Sent to Google", { exact: true })).toBeVisible()
  expect(f.writes).toEqual([expect.objectContaining({ title: "Old Crown" })])
  expect(f.location.title).toBe("Old Crown")

  // Reading Google again settles it as put back.
  await page.getByRole("button", { name: "Check Google now" }).first().click()
  await expect(
    panel.getByText(/Google matches ours for every protected field/)
  ).toBeVisible()
  await panel.getByText(/Earlier changes on Google/).click()
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
  const panel = page.locator('[data-slot="google-changes"]')
  const row = panel.locator('[data-slot="google-change"]')
  await expect(row.getByRole("table")).toContainText("+44 1223 999999")
  const putBack = row.getByRole("button", { name: "Put ours back" })
  await expect(putBack).toHaveAttribute("aria-disabled", "true")
  await expect(
    panel.getByText(
      "Only owners and admins who can publish this listing can put ours back or keep Google’s. You can see what changed."
    )
  ).toBeVisible()
  await putBack.click({ force: true })
  expect(f.writes).toHaveLength(0)

  // Nothing in the panel scrolls sideways at 390px.
  const overflow = await panel.evaluate(
    (element) => element.scrollWidth - element.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
  const results = await new AxeBuilder({ page })
    .include('[data-slot="google-changes"]')
    .analyze()
  expect(results.violations).toEqual([])
})
