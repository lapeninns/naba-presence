import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname } from "node:path"

import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import postgres from "postgres"

import { readJourneyState, useSessionCookie } from "./support.ts"

test("R53–R55: dashboard notices show only for their applicable state and route", async ({
  app,
  browser,
  screen,
}) => {
  test.skip(
    process.env.SUPPORT_IMPERSONATION_ENABLED !== "true",
    "Run with support impersonation enabled on the disposable fixture server"
  )
  const dbUrl = process.env.DIRECT_DATABASE_URL
  const disposable = process.env.NABA_PG_DISPOSABLE
  if (!dbUrl || !disposable)
    throw new Error("Use the disposable database wrapper")
  const db = new URL(dbUrl)
  if (
    db.hostname !== "127.0.0.1" ||
    db.host !== disposable ||
    db.pathname !== "/nabareview_test"
  ) {
    throw new Error(
      "Dashboard notice fixtures require the local disposable database"
    )
  }

  const { cookie } = await readJourneyState()
  const hash = createHash("sha256")
    .update(cookie.slice(cookie.indexOf("=") + 1))
    .digest("hex")
  const sql = postgres(dbUrl, { max: 1 })
  const billing = browser.locator('[data-slot="billing-banner"]')
  const reconnect = browser.locator('[data-slot="reconnect-banner"]')
  const support = browser.locator('[data-slot="impersonation-banner"]')
  try {
    await useSessionCookie(browser, app.baseUrl, cookie)
    await app.open("/inbox")
    if (await browser.evaluate(() => window.innerWidth === 768)) {
      await browser.setViewport({ width: 834, height: 1194 })
    }
    await expect(
      screen.getByRole("heading", { name: "Inbox", level: 1 })
    ).toBeVisible()
    for (const notice of [billing, reconnect, support])
      await expect(notice).toHaveCount(0)

    const fixture = await sql.begin(async (tx) => {
      const [session] = await tx`
        select s.organisation_id, b.state from app_session s
        join organisation_billing b on b.organisation_id = s.organisation_id
        where s.token_hash = ${hash} and s.support_actor is null
      `
      if (!session)
        throw new Error("Seeded dashboard session or billing row missing")
      const org = session.organisation_id
      await tx`update organisation_billing set state = 'read_only' where organisation_id = ${org}`
      const [task] = await tx`
        insert into connection_task (organisation_id, google_connection_id, task_type, reason_code)
        select organisation_id, id, 'reconnect', 'invalid_grant' from google_connection
        where organisation_id = ${org} and status = 'active' order by id limit 1
        returning id
      `
      if (!task) throw new Error("Seeded Google connection missing")
      await tx`update app_session set support_actor = 'Fixture support', impersonation_reason = 'Dashboard notice QA' where token_hash = ${hash}`
      return { org, billingState: session.state, taskId: task.id }
    })

    try {
      await app.open("/inbox")
      await expect(support).toBeVisible()
      await expect(billing).toBeHidden()
      await expect(reconnect).toBeHidden()
      await browser.evaluate(() => {
        document
          .querySelector<HTMLButtonElement>(
            '[data-slot="shell-notices"] > button'
          )
          ?.focus()
      })
      await browser.keyboard.press("Enter")
      await expect(
        screen.getByRole("button", { name: "Show fewer notices" })
      ).toBeVisible()
      await expect(billing).toBeVisible()
      await expect(reconnect).toBeVisible()
      await expect(reconnect).toContainText("Google stopped accepting")
      await expect(support).toContainText("Support session: Fixture support")
      await expect(
        screen.getByRole("button", { name: "End impersonation" })
      ).toBeVisible()

      await app.open("/settings")
      await screen.getByRole("button", { name: "+2 more notices" }).click()
      for (const notice of [billing, reconnect, support])
        await expect(notice).toBeVisible()
      expect(
        await browser.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(await browser.evaluate(() => window.innerWidth))

      await app.screenshot("dashboard-notices-expanded")
      const require = createRequire(import.meta.url)
      const axePath = require.resolve("axe-core/axe.min.js", {
        paths: [dirname(require.resolve("@axe-core/playwright"))],
      })
      const axe = await readFile(axePath, "utf8")
      const violations = await browser.evaluate<string[]>(`
        () => {
          ${axe}
          return window.axe.run('[data-slot="shell-notices"]')
            .then((result) => result.violations.map((violation) => violation.id))
        }
      `)
      expect(violations).toEqual([])

      await app.open("/settings/billing")
      await expect(browser).toHaveURL(/\/settings\/billing\/?$/)
      await expect(billing).toHaveCount(0)
      await screen.getByRole("button", { name: "+1 more notice" }).click()
      await expect(reconnect).toBeVisible()
      await expect(support).toBeVisible()

      await app.open("/settings/connections")
      await expect(browser).toHaveURL(/\/settings\/connections\/?$/)
      await expect(reconnect).toHaveCount(0)
      await screen.getByRole("button", { name: "+1 more notice" }).click()
      await expect(billing).toBeVisible()
      await expect(support).toBeVisible()
    } finally {
      await sql.begin(async (tx) => {
        await tx`update app_session set support_actor = null, impersonation_reason = null where token_hash = ${hash}`
        await tx`delete from connection_task where id = ${fixture.taskId}`
        await tx`update organisation_billing set state = ${fixture.billingState} where organisation_id = ${fixture.org}`
      })
    }
  } finally {
    await sql.end()
  }
})
