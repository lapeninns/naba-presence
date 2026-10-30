import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../integration/helpers/tenant"
import { pageSettled } from "./helpers/settled"

// S3: review topics. Its own tenant with the review_topics feature on and
// three classified reviews, each at its own listing, destroyed afterwards.
// No AI is called: the labels are seeded as the classifier would store them.
const REVIEWS = [
  {
    text: "The roast was cold and the gravy tasted of nothing.",
    rating: 2,
    topics: [
      ["sunday_roast", "negative"],
      ["food_quality", "negative"],
    ],
  },
  {
    text: "Lovely staff, nothing was too much trouble.",
    rating: 5,
    topics: [["service", "positive"]],
  },
  {
    text: "Great pint and friendly staff behind the bar.",
    rating: 5,
    topics: [
      ["drinks", "positive"],
      ["service", "positive"],
    ],
  },
] as const

const topicsTest = test.extend<{ cookie: string }>({
  // Playwright requires the first fixture argument to be destructured.
  cookie: async ({}, provide) => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) {
      throw new Error(
        "DIRECT_DATABASE_URL (the harness database) is required to seed the review topics tenant."
      )
    }
    const admin = postgres(url, { max: 1 })
    const tenant = await createTestTenant(admin)
    try {
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled)
        values (${tenant.organisationId}, 'review_topics', true)
      `
      for (const review of REVIEWS) {
        const seeded = await seedLinkedReview(admin, {
          organisationId: tenant.organisationId,
          connectionId: connection.connectionId,
          googleAccountName: connection.googleAccountName,
          text: review.text,
          rating: review.rating,
        })
        await admin`
          insert into review_topic_classification (
            organisation_id, review_id, status, text_hash, model,
            review_update_time, classified_at
          )
          values (
            ${tenant.organisationId}, ${seeded.reviewId}, 'classified',
            md5(${review.text}), 'stub-model', now() - interval '1 day', now()
          )
        `
        for (const [topic, sentiment] of review.topics) {
          await admin`
            insert into review_topic (
              organisation_id, review_id, topic, sentiment, model,
              classified_at, review_update_time
            )
            values (
              ${tenant.organisationId}, ${seeded.reviewId}, ${topic},
              ${sentiment}, 'stub-model', now(), now() - interval '1 day'
            )
          `
        }
      }
      await provide(tenant.cookie)
    } finally {
      await destroyTenants(admin, [tenant.organisationId])
      await admin.end()
    }
  },
})

topicsTest.describe("review topics", () => {
  topicsTest.beforeEach(async ({ baseURL, cookie, page }) => {
    const [name, value] = cookie.split("=", 2)
    await page.context().addCookies([{ name, value, url: baseURL! }])
  })

  topicsTest(
    "a topic link narrows the inbox, and its chip widens it again",
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto("/inbox?queue=all&topic=service")
      const rows = page.locator('[data-slot="review-row"]')
      await expect(rows).toHaveCount(2)
      await expect(rows.filter({ hasText: "roast" })).toHaveCount(0)
      await page
        .getByRole("button", { name: "Remove filter: Topic: Service" })
        .click()
      await expect(rows).toHaveCount(3)
      await expect(page).not.toHaveURL(/topic=/)
    }
  )

  topicsTest(
    "the Filters sheet narrows the inbox to one topic",
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto("/inbox?queue=all")
      const rows = page.locator('[data-slot="review-row"]')
      await expect(rows).toHaveCount(3)
      await page.getByRole("button", { name: /^Filters/ }).click()
      const sheet = page.getByRole("dialog", { name: "Filters" })
      await sheet.getByRole("combobox", { name: "Filter by topic" }).click()
      await page.getByRole("option", { name: "Sunday roast" }).click()
      await expect(page).toHaveURL(/topic=sunday_roast/)
      await page.keyboard.press("Escape")
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText("roast was cold")
    }
  )

  topicsTest(
    "Reports shows what guests talk about and opens a topic's reviews on a phone",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto("/reports")
      const panel = page.getByRole("region", { name: "What guests talk about" })
      await expect(panel).toBeVisible()
      await expect(panel.getByText(/^From 3 reviews with text\./)).toBeVisible()
      // Service is mentioned most, so it leads, and it opens its reviews.
      const service = panel.getByRole("link", { name: /^Service/ }).first()
      await expect(service).toBeVisible()
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      )
      expect(overflow).toBe(false)
      await service.click()
      // Every queue, the topic and the trend window: the reviews the figure counts.
      await expect(page).toHaveURL(/\/inbox\?queue=all&topic=service&dateFrom=/)
      await expect(page.locator('[data-slot="review-row"]')).toHaveCount(2)
    }
  )

  for (const theme of ["light", "dark"] as const) {
    topicsTest(
      `Reports with the topics panel is axe-clean (${theme})`,
      async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme })
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto("/reports")
        await expect(
          page.getByRole("region", { name: "What guests talk about" })
        ).toBeVisible()
        await expect(
          page.getByRole("heading", { name: "Topic by listing", level: 3 })
        ).toBeVisible()
        await pageSettled(page)
        const wcag = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
        expect(wcag.violations, `${theme} wcag`).toEqual([])
        const best = await new AxeBuilder({ page })
          .withTags(["best-practice"])
          .analyze()
        expect(
          best.violations.filter((v) =>
            [
              "landmark-no-duplicate-main",
              "landmark-main-is-top-level",
              "heading-order",
              "page-has-heading-one",
              "region",
            ].includes(v.id)
          ),
          `${theme} structure`
        ).toEqual([])
      }
    )
  }
})
