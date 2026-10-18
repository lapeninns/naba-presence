import { expect, type Locator, type Page, test } from "@playwright/test"
import postgres from "postgres"

import { CLIENT_SCOPE_COOKIE } from "../../lib/clients/scope"
import { clientCreateSchema } from "../../lib/contracts/clients"
import { createTestTenant, destroyTenants } from "../integration/helpers/tenant"

// The switcher is absent for a one-client tenant. Use two real clients and
// the longest permitted selected name, rather than relying on the shared
// journey tenant or putting clientId on an organisation-wide page's URL.
const LONG_CLIENT_NAME = clientCreateSchema.parse({
  name: "Journey Hospitality ".padEnd(120, "W"),
}).name

type ToolbarTenant = { cookie: string; clientId: string }

const toolbarTest = test.extend<
  { toolbarTenant: ToolbarTenant },
  { harnessAdmin: ReturnType<typeof postgres> }
>({
  harnessAdmin: [
    async ({}, provide) => {
      const url = process.env.DIRECT_DATABASE_URL
      if (!url) {
        throw new Error(
          "DIRECT_DATABASE_URL (the throwaway harness database) is required to seed the toolbar tenant."
        )
      }
      // The imported tenant helpers also reject non-local database URLs.
      const admin = postgres(url, { max: 1 })
      try {
        await provide(admin)
      } finally {
        await admin.end()
      }
    },
    { scope: "worker" },
  ],
  toolbarTenant: async ({ harnessAdmin }, provide) => {
    const tenant = await createTestTenant(harnessAdmin, {
      workspaceMode: "agency",
    })
    try {
      const [client] = await harnessAdmin<{ id: string }[]>`
        insert into client (organisation_id, name, slug)
        values (${tenant.organisationId}, ${LONG_CLIENT_NAME}, 'long-toolbar-client')
        returning id::text as id
      `
      await harnessAdmin`
        insert into client (organisation_id, name, slug)
        values (${tenant.organisationId}, 'Other client', 'other-toolbar-client')
      `
      await provide({ cookie: tenant.cookie, clientId: client!.id })
    } finally {
      await destroyTenants(harnessAdmin, [tenant.organisationId])
    }
  },
})

/** Wait for fonts and finite chrome animations, then two stable frames. */
async function settleBack(page: Page, back: Locator) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect
    .poll(
      () =>
        back.evaluate(async (element) => {
          const frame = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            )
          const snapshot = () => {
            const rect = element.getBoundingClientRect()
            return [rect.x, rect.y, rect.width, rect.height].join(",")
          }
          const before = snapshot()
          await frame()
          const middle = snapshot()
          await frame()
          return (
            before === middle &&
            middle === snapshot() &&
            !document
              .getAnimations()
              .some(
                (animation) =>
                  animation.playState === "running" &&
                  Number.isFinite(
                    animation.effect?.getComputedTiming().endTime ?? Infinity
                  )
              )
          )
        }),
      { message: "the back control settles", timeout: 5_000 }
    )
    .toBe(true)
}

/** The hit band measures what receives a press, including child elements. */
async function measureBack(back: Locator) {
  return back.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const owns = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)
      return Boolean(hit && (hit === element || element.contains(hit)))
    }
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const reach = (dx: number, dy: number) => {
      let pixels = 0
      while (
        pixels < 400 &&
        owns(cx + dx * (pixels + 1), cy + dy * (pixels + 1))
      ) {
        pixels++
      }
      return pixels
    }
    const centreOwned = owns(cx, cy)
    const health = element
      .closest("header")
      ?.querySelector('[data-slot="health-chip"]')
      ?.getBoundingClientRect()
    const chevron = element.querySelector("svg")?.getBoundingClientRect()
    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      centreOwned,
      insetEdgesOwned: [
        owns(rect.left + 1, cy),
        owns(rect.right - 1, cy),
        owns(cx, rect.top + 1),
        owns(cx, rect.bottom - 1),
      ],
      hitWidth: centreOwned ? reach(-1, 0) + reach(1, 0) + 1 : 0,
      hitHeight: centreOwned ? reach(0, -1) + reach(0, 1) + 1 : 0,
      chevronContained: Boolean(
        chevron &&
        chevron.left >= rect.left &&
        chevron.right <= rect.right &&
        chevron.top >= rect.top &&
        chevron.bottom <= rect.bottom
      ),
      overlapsHealth: Boolean(
        health &&
        rect.left < health.right &&
        rect.right > health.left &&
        rect.top < health.bottom &&
        rect.bottom > health.top
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1,
    }
  })
}

const routes = [
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
] as const

for (const width of [390, 767, 768, 1024]) {
  for (const colourScheme of ["light", "dark"] as const) {
    for (const coarse of width === 390 ? [true] : [false, true]) {
      toolbarTest.describe(
        `remembered client at ${width}px, ${colourScheme}, ${coarse ? "coarse" : "fine"} pointer`,
        () => {
          toolbarTest.use({
            viewport: { width, height: width === 390 ? 844 : 1024 },
            colorScheme: colourScheme,
            hasTouch: coarse,
            isMobile: width === 390,
            reducedMotion: "reduce",
          })

          for (const route of routes) {
            toolbarTest(
              `Back from ${route.path} retains an unobscured 44px hit target`,
              async (
                { baseURL, browserName, page, toolbarTenant },
                testInfo
              ) => {
                const [name, value] = toolbarTenant.cookie.split("=", 2)
                await page
                  .context()
                  .addCookies([{ name, value, url: baseURL! }])
                await page.goto(`/clients/${toolbarTenant.clientId}`)
                await expect(
                  page.getByRole("heading", {
                    name: LONG_CLIENT_NAME,
                    level: 1,
                    exact: true,
                  })
                ).toBeVisible()
                await expect
                  .poll(async () => {
                    const cookies = await page.context().cookies()
                    return cookies.find(
                      (cookie) => cookie.name === CLIENT_SCOPE_COOKIE
                    )?.value
                  })
                  .toBe(toolbarTenant.clientId)

                // A full load proves the remembered preference survived;
                // neither route itself declares a client scope.
                await page.goto(route.path)
                await expect(
                  page.getByRole("heading", {
                    name: route.heading,
                    level: 1,
                    exact: true,
                  })
                ).toBeVisible()
                await expect(page.locator("html")).toHaveClass(
                  new RegExp(`(?:^|\\s)${colourScheme}(?:\\s|$)`)
                )
                expect(
                  await page.evaluate(
                    () => matchMedia("(pointer: coarse)").matches
                  )
                ).toBe(coarse)

                if (width >= 768) {
                  await expect(
                    page.getByRole("button", {
                      name: `Client: ${LONG_CLIENT_NAME}`,
                      exact: true,
                    })
                  ).toBeVisible()
                  await expect(
                    page.locator('[data-slot="health-chip"]:visible')
                  ).toBeVisible()
                }
                const back = page.locator('[data-slot="back-control"]:visible')
                await expect(back).toHaveCount(1)
                await expect(back).toHaveAccessibleName(
                  `Back to ${route.label}`
                )
                await expect(back).toHaveAttribute("href", route.destination)
                await settleBack(page, back)
                const geometry = await measureBack(back)
                await testInfo.attach("back-target-geometry", {
                  body: JSON.stringify({
                    width,
                    colourScheme,
                    coarse,
                    ...geometry,
                  }),
                  contentType: "application/json",
                })
                expect(geometry.rect.width).toBeGreaterThanOrEqual(44)
                expect(geometry.rect.height).toBeGreaterThanOrEqual(44)
                expect(geometry.centreOwned).toBe(true)
                expect(geometry.insetEdgesOwned).toEqual([
                  true,
                  true,
                  true,
                  true,
                ])
                expect(geometry.hitWidth).toBeGreaterThanOrEqual(44)
                expect(geometry.hitHeight).toBeGreaterThanOrEqual(44)
                expect(geometry.chevronContained).toBe(true)
                expect(geometry.overlapsHealth).toBe(false)
                expect(geometry.horizontalOverflow).toBe(false)

                // WebKit's default Tab order skips links; Option-Tab includes
                // them. Use the browser's real link-navigation shortcut, then
                // activate with the pointer type checked above.
                for (let step = 0; step < 40; step++) {
                  if (
                    await back.evaluate(
                      (node) => node === document.activeElement
                    )
                  )
                    break
                  await page.keyboard.press(
                    browserName === "webkit" ? "Alt+Tab" : "Tab"
                  )
                }
                await expect(back).toBeFocused()
                if (coarse) await back.tap()
                else await back.click()
                await expect(page).toHaveURL(
                  (url) => url.pathname === route.destination
                )
              }
            )
          }
        }
      )
    }
  }
}
