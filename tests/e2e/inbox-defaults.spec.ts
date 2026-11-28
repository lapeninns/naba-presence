import { expect, test } from "@playwright/test"
import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../integration/helpers/tenant"
import { hydrated } from "./helpers/hydrated"
import { transitionsSettled } from "./helpers/settled"

const REVIEW_TEXTS = [
  "One star stay",
  "Two star stay",
  "Three star stay",
  "Four star stay",
  "Five star stay",
]

const inboxTest = test.extend<{
  seedReviews: (
    reviews: { rating: number; text: string }[]
  ) => Promise<string[]>
}>({
  seedReviews: async ({ page, baseURL }, provide) => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) throw new Error("The Inbox tests need the harness database.")
    const admin = postgres(url, { max: 1 })
    const { organisationId, cookie } = await createTestTenant(admin)
    try {
      const connection = await seedGoogleConnection(admin, { organisationId })
      const [name, value] = cookie.split("=", 2)
      await page.context().addCookies([{ name, value, url: baseURL! }])
      await provide(async (reviews) => {
        const ids: string[] = []
        for (const review of reviews) {
          const { reviewId } = await seedLinkedReview(admin, {
            organisationId,
            ...connection,
            ...review,
          })
          ids.push(reviewId)
        }
        return ids
      })
    } finally {
      await destroyTenants(admin, [organisationId])
      await admin.end()
    }
  },
})

inboxTest(
  "starts Needs reply at 4+ stars and lets the operator see other ratings",
  async ({ page, seedReviews }) => {
    await seedReviews(
      REVIEW_TEXTS.map((text, index) => ({ text, rating: index + 1 }))
    )
    await page.goto("/inbox")
    const rows = page.locator('[data-slot="review-row"]')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: "Four star stay" })).toBeVisible()
    await expect(rows.filter({ hasText: "Five star stay" })).toBeVisible()

    const defaultRating = page.getByRole("button", { name: "4+ stars" })
    await expect(defaultRating).toHaveAttribute("aria-pressed", "true")
    await hydrated(defaultRating)
    await page.getByRole("button", { name: "2 stars" }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText("Two star stay")
    await page.reload()
    await expect(rows.first()).toContainText("Two star stay")

    await defaultRating.click()
    await expect(rows).toHaveCount(2)
    await defaultRating.click()
    await expect(rows).toHaveCount(5)
    await page.reload()
    await expect(rows).toHaveCount(5)

    await page.goto("/inbox?queue=all")
    await expect(rows).toHaveCount(5)
  }
)

inboxTest(
  "shows a way to the lower ratings when the default list is empty",
  async ({ page, seedReviews }) => {
    const [id] = await seedReviews([{ rating: 2, text: "Two star stay" }])
    await page.goto(`/inbox?selected=${id}`)
    await expect(
      page.getByRole("region", { name: "Selected review" })
    ).toContainText("Two star stay")
    await expect(page.locator('[data-slot="review-row"]')).toHaveCount(0)
    await expect(
      page.getByText("No 4- or 5-star reviews need a reply.")
    ).toBeVisible()
    const showAll = page.getByRole("button", { name: "Show all ratings" })
    await hydrated(showAll)
    await showAll.click()
    await expect(page.locator('[data-slot="review-row"]')).toContainText(
      "Two star stay"
    )
  }
)

for (const width of [1280, 390]) {
  inboxTest(
    `can publish a generated reply while its toast is showing at ${width}px`,
    async ({ page, seedReviews }) => {
      const [id] = await seedReviews([{ rating: 5, text: "" }])
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`/inbox?selected=${id}`)
      const editor = page.getByRole("textbox", { name: "Your reply" })
      await hydrated(editor)
      await expect(editor).toBeEditable()
      // The rating-only generator takes the checked template path without AI.
      // Start with text so the same toast also has the real Undo action.
      await editor.fill("Thank you for taking the time to review us.")
      const draftResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/reviews/${id}/drafts`
      )
      await page.getByRole("button", { name: "Regenerate" }).click()
      const generated = await draftResponse
      expect(generated.status()).toBe(201)
      const { draftId } = await generated.json()
      const toast = page
        .locator('[data-slot="toast"]')
        .filter({ hasText: "Reply ready" })
      await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible()
      const publish = page.getByRole("button", { name: "Publish reply" })
      await expect(publish).toBeEnabled()
      const reachesPublish = () =>
        publish.evaluate((button) => {
          const rect = button.getBoundingClientRect()
          const target = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          )
          return button.contains(target)
        })
      expect(await reachesPublish()).toBe(true)
      await transitionsSettled(page)
      await expect(toast).toBeVisible()
      expect(await reachesPublish()).toBe(true)

      const publishResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/reviews/${id}/publish`
      )
      await publish.click()
      const published = await publishResponse
      expect(published.request().postDataJSON()).toMatchObject({ draftId })
      expect(published.ok()).toBe(true)
    }
  )
}
