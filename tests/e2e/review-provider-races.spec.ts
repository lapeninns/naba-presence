import { expect, test } from "@playwright/test"

const activeConnection = {
  id: "connection-provider-race",
  googleEmail: "race@example.test",
  status: "active",
  notificationsEnabled: true,
  lastRefreshAt: null,
  lastErrorCode: null,
  reconnectRequired: false,
  createdAt: "2026-07-30T12:00:00.000Z",
}

test("a stale bootstrap cannot hide a newer Home data failure", async ({
  page,
}) => {
  let connectionRequestCount = 0
  let releaseBootstrap = () => {}
  let markBootstrapStarted = () => {}
  let markBootstrapFinished = () => {}
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve
  })
  const bootstrapStarted = new Promise<void>((resolve) => {
    markBootstrapStarted = resolve
  })
  const bootstrapFinished = new Promise<void>((resolve) => {
    markBootstrapFinished = resolve
  })

  await page.route(
    /\/api\/google\/connections(?:\?.*)?$/,
    async (route) => {
      connectionRequestCount += 1
      const isBootstrap = connectionRequestCount === 1
      if (isBootstrap) {
        markBootstrapStarted()
        await bootstrapGate
      }
      await route.fulfill({ json: { connections: [activeConnection] } })
      if (isBootstrap) markBootstrapFinished()
    }
  )
  await page.route(/\/api\/reviews\/counts(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        total: 0,
        byStatus: {
          new: 0,
          drafted: 0,
          verified: 0,
          awaiting_approval: 0,
          publish_requested: 0,
          published: 0,
          rejected: 0,
          failed: 0,
          escalated: 0,
        },
      },
    })
  })
  await page.route(/\/api\/reviews(?:\?.*)?$/, async (route) => {
    await route.abort("failed")
  })

  try {
    await page.goto("/inbox")
    await bootstrapStarted
    await page.getByRole("link", { name: "Home", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 })
    ).toBeVisible()
    await expect(page.getByText("Live data unavailable")).toBeVisible()

    releaseBootstrap()
    await bootstrapFinished
    await page.waitForTimeout(250)

    await expect(page.getByText("Live data unavailable")).toBeVisible()
    await expect(page.getByText("Live data", { exact: true })).toHaveCount(0)
  } finally {
    releaseBootstrap()
  }
})
