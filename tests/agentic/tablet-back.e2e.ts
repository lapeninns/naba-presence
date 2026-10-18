// AMA-145: the remembered client must not squeeze the tablet toolbar's
// Back link beneath its real 44px hit target. The journey seeds one extra
// client because the ordinary journey tenant has only one and therefore
// hides the client switcher. All navigation and data stay on the local
// throwaway harness; the extra client is removed in finally.
import { randomUUID } from "node:crypto"

import { describe, test } from "@e2e-dev/web"
import type { Browser } from "@e2e-dev/web"
import { expect } from "e2e"
import postgres from "postgres"

import { pathPattern, readJourneyState } from "./support.ts"

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"])

function localHarnessUrl(value: string | undefined, database = false) {
  let url: URL
  try {
    url = new URL(value ?? "")
  } catch {
    throw new Error(
      "The tablet journey requires a parseable local harness URL."
    )
  }
  if (!LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("The tablet journey only runs against a loopback harness.")
  }
  if (
    database &&
    (!new Set(["postgres:", "postgresql:"]).has(url.protocol) ||
      url.port === "54322")
  ) {
    throw new Error(
      "Use a throwaway PostgreSQL instance, not shared port 54322."
    )
  }
  return url
}

async function assertBackHitTarget(browser: Browser) {
  const geometry = await browser.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    const controls = [
      ...document.querySelectorAll('[data-slot="back-control"]'),
    ].filter((node) => node.checkVisibility())
    const back = controls[0]
    if (!back) return null
    const rect = back.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const owns = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)
      return Boolean(hit && (hit === back || back.contains(hit)))
    }
    const reach = (dx: number, dy: number) => {
      let pixels = 0
      while (
        pixels < 400 &&
        owns(cx + dx * (pixels + 1), cy + dy * (pixels + 1))
      )
        pixels++
      return pixels
    }
    return {
      count: controls.length,
      width: rect.width,
      height: rect.height,
      centreOwned: owns(cx, cy),
      edgesOwned: [
        owns(rect.left + 1, cy),
        owns(rect.right - 1, cy),
        owns(cx, rect.top + 1),
        owns(cx, rect.bottom - 1),
      ],
      hitWidth: reach(-1, 0) + reach(1, 0) + 1,
      hitHeight: reach(0, -1) + reach(0, 1) + 1,
    }
  })
  expect(geometry).not.toBeNull()
  if (!geometry) throw new Error("No visible tablet back control.")
  expect(geometry.count).toBe(1)
  expect(geometry.width).toBeGreaterThanOrEqual(44)
  expect(geometry.height).toBeGreaterThanOrEqual(44)
  expect(geometry.centreOwned).toBe(true)
  expect(geometry.edgesOwned).toEqual([true, true, true, true])
  expect(geometry.hitWidth).toBeGreaterThanOrEqual(44)
  expect(geometry.hitHeight).toBeGreaterThanOrEqual(44)
}

describe("tablet back navigation", { tags: ["tablet", "navigation"] }, () => {
  test(
    "remembered client leaves both toolbar Back links usable",
    { session: "owner", timeout: 240_000 },
    async ({ agent, app, browser, screen }) => {
      localHarnessUrl(app.baseUrl)
      const state = await readJourneyState()
      await app.open(`/clients/${state.clientId}`)
      const width = await browser.evaluate(() => window.innerWidth)
      test.skip(width !== 768, `tablet journey; this target is ${width}px wide`)
      expect(width).toBe(768)

      const url = localHarnessUrl(process.env.DIRECT_DATABASE_URL, true)
      const admin = postgres(url.toString(), { max: 1 })
      let extraClient: { id: string; organisationId: string } | undefined
      try {
        const [client] = await admin<{ organisationId: string }[]>`
          select organisation_id::text as "organisationId"
          from client where id = ${state.clientId}
        `
        if (!client) throw new Error("The seeded journey client is missing.")
        const [created] = await admin<{ id: string }[]>`
          insert into client (organisation_id, name, slug)
          values (
            ${client.organisationId}, 'Tablet navigation QA client',
            ${`tablet-navigation-${randomUUID()}`}
          )
          returning id::text as id
        `
        if (!created)
          throw new Error("The temporary second client was not created.")
        extraClient = { id: created.id, organisationId: client.organisationId }

        // Reload after seeding so the server hydrates both real clients.
        await app.open(`/clients/${state.clientId}`)
        await expect(
          screen.getByRole("heading", { name: state.clientName, level: 1 })
        ).toBeVisible({ timeout: 30_000 })
        const selected = screen.getByRole("button", {
          name: `Client: ${state.clientName}`,
          exact: true,
          visible: true,
        })
        await expect(selected).toBeVisible()
        await agent.assert(
          `The toolbar shows the selected client "${state.clientName}"`
        )
        expect(
          await browser.evaluate(
            (id) => document.cookie.split("; ").includes(`np_client=${id}`),
            state.clientId
          )
        ).toBe(true)

        for (const route of [
          {
            path: "/clients/new",
            heading: "New client",
            label: "Clients",
            destination: "/clients",
          },
          {
            path: "/settings/connections",
            heading: "Google connections",
            label: "Settings",
            destination: "/settings",
          },
        ]) {
          await app.open(route.path)
          await expect(
            screen.getByRole("heading", { name: route.heading, level: 1 })
          ).toBeVisible({ timeout: 30_000 })
          await expect(selected).toBeVisible()
          const back = screen.getByRole("link", {
            name: `Back to ${route.label}`,
            exact: true,
            visible: true,
          })
          await expect(back).toBeVisible()
          await expect(back).toHaveAttribute("href", route.destination)
          await expect(
            browser.locator('[data-slot="toolbar"] [data-slot="health-chip"]')
          ).toBeVisible()
          await assertBackHitTarget(browser)
          await app.screenshot(`tablet-back-${route.label.toLowerCase()}`)
          await agent.act(
            `Use the "Back to ${route.label}" link in the top toolbar. Do not use the browser Back command or the side navigation.`
          )
          await expect(browser).toHaveURL(pathPattern(route.destination))
        }
      } finally {
        try {
          if (extraClient) {
            await admin`
              delete from client
              where id = ${extraClient.id}
                and organisation_id = ${extraClient.organisationId}
            `
          }
        } finally {
          await admin.end()
        }
      }
    }
  )
})
