import { expect, test } from "@playwright/test"

import { startOperationsBackend } from "./helpers/operations-backend"

let backend: Awaited<ReturnType<typeof startOperationsBackend>>
test.beforeAll(async () => {
  backend = await startOperationsBackend()
})
test.afterAll(async () => {
  await backend.stop()
})
test.use({ viewport: { width: 390, height: 844 } })

test("a blocked post stays unsaved and a warning needs explicit acknowledgement", async ({
  page,
}, info) => {
  const f = await backend.fixture(page, 1)
  await page
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).origin === backend.server.baseUrl
        ? route.continue()
        : route.abort("blockedbyclient")
    )
  await f.goto(`/listings/${f.linked[0].locationId}/posts`)
  await page.getByRole("button", { name: "New post", exact: true }).click()
  const composer = page.getByRole("dialog", { name: "New post", exact: true })
  const summary = composer.getByRole("textbox", { name: "Post summary" })
  await summary.fill("Visit https://example.com for our menu.")
  await composer
    .getByRole("button", { name: "Save draft", exact: true })
    .click()
  await expect(composer.getByText(/remove links/i)).toBeVisible()
  const countDrafts = async () => {
    const [{ count }] =
      await backend.admin`select count(*)::int as count from gbp_local_post where organisation_id = ${f.owner.organisationId}`
    return count
  }
  expect(await countDrafts()).toBe(0)
  await page.screenshot({
    path: info.outputPath("blocked-post-390.png"),
    animations: "disabled",
  })

  await summary.fill("Come and see our new menu!!!")
  await composer
    .getByRole("button", { name: "Save draft", exact: true })
    .click()
  const acknowledgement = composer.getByRole("checkbox", {
    name: "I have reviewed these content warnings.",
  })
  await expect(acknowledgement).toBeVisible()
  await expect(acknowledgement).not.toBeChecked()
  expect(await countDrafts()).toBe(0)
  await acknowledgement.check()
  await composer
    .getByRole("button", { name: "Save draft", exact: true })
    .click()
  await expect(composer).not.toBeVisible()
  await expect.poll(countDrafts).toBe(1)
  const [saved] =
    await backend.admin`select summary, content_warning_acknowledgement from gbp_local_post where organisation_id = ${f.owner.organisationId}`
  expect(saved.summary).toBe("Come and see our new menu!!!")
  expect(saved.content_warning_acknowledgement).toMatch(/^[a-f0-9]{64}$/)
  expect(backend.posts).toHaveLength(0)
  await page.screenshot({
    path: info.outputPath("acknowledged-post-390.png"),
    animations: "disabled",
  })
})
