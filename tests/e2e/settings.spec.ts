import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page, test } from "@playwright/test"

import { readJourneyState } from "./helpers/stub-bridge"
import { seedTeamTenant } from "./helpers/team-tenant"
import { pageWorkspaceMode } from "./helpers/workspace-mode"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const STRUCTURE_RULES = ["landmark-no-duplicate-main", "landmark-main-is-top-level", "heading-order", "page-has-heading-one"]
// Team left Settings for its own destination, and Listing is gone: it
// administered a location from a page nowhere near it, and that now lives in
// the location's own Access section. Compliance and Operations are gone too —
// their routes are still served under `/api/privacy/**`, `/api/legal-holds`
// and `/api/operations/health`, owner/admin-gated as they always were.
const AREAS = [
  { path: "/settings", heading: "Reply policy" },
  { path: "/settings/connections", heading: "Google connections" },
] as const

async function applyCookie(page: Page, baseURL: string | undefined, cookie: string) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

test.describe("settings", () => {
  test("each area is a sibling route with its own level-1 heading and a shared sub-nav", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    for (const area of AREAS) {
      await page.goto(area.path)
      await expect(page).toHaveURL(new RegExp(`${area.path.replace("/", "\\/")}$`))
      await expect(page.getByRole("heading", { name: area.heading, level: 1 })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible()
    }
  })

  test("/connections redirects under settings and forwards the query string", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.goto("/connections?google=connected")
    await expect(page).toHaveURL(/\/settings\/connections\?google=connected$/)
  })

  for (const theme of ["light", "dark"] as const) {
    for (const area of AREAS) {
      test(`${area.heading} loads clean (${theme})`, async ({ baseURL, page }) => {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        page.on("pageerror", (error) => pageErrors.push(error.message))
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await page.goto(area.path)
        await expect(page.getByRole("heading", { name: area.heading, level: 1 })).toBeVisible()
        await page.waitForLoadState("networkidle")
        expect(consoleErrors, `${theme} ${area.heading} console`).toEqual([])
        expect(pageErrors, `${theme} ${area.heading} pageerror`).toEqual([])
        const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        expect(wcag.violations, `${theme} ${area.heading} wcag`).toEqual([])
        const best = await new AxeBuilder({ page }).withTags(["best-practice"]).analyze()
        expect(best.violations.filter((v) => STRUCTURE_RULES.includes(v.id)), `${theme} ${area.heading} structure`).toEqual([])
      })
    }
  }

  test("permission walk: a member sees only Policy, and is TOLD when a route is closed", async ({ baseURL, browser }) => {
    const state = await readJourneyState()
    for (const cookie of [state.memberUnassignedCookie, state.viewerCookie]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await applyCookie(page, baseURL, cookie)
      await page.goto("/settings")
      const nav = page.getByRole("navigation", { name: "Settings sections" })
      await expect(nav.getByRole("link", { name: "Policy" })).toBeVisible()
      for (const gone of ["Team", "Compliance", "Google connections", "Listing", "Operations"]) {
        await expect(nav.getByRole("link", { name: gone })).toHaveCount(0)
      }
      // The read-only Policy form shows the gate reason, not an editable control.
      await expect(page.getByText("Only owners and admins can change these settings.")).toBeVisible()

      // Following a colleague's link to a privileged route explains the
      // refusal instead of silently landing somewhere else, which is
      // indistinguishable from a bug.
      for (const privileged of ["/settings/connections"]) {
        await page.goto(privileged)
        expect(new URL(page.url()).pathname).toBe(privileged)
        await expect(
          page.getByRole("heading", { name: /You don.t have access to this page/, level: 1 })
        ).toBeVisible()
        // "Ask for access" leads; the way back is the shell's own back target
        // (here Settings, as the app bar says), scoped to the page body because
        // the phone app bar draws a link of the same name.
        const body = page.getByRole("main")
        await expect(body.getByRole("button", { name: "Ask for access" })).toBeVisible()
        await expect(body.getByRole("link", { name: "Back to Settings" })).toBeVisible()
        await expect(body.getByText("403")).toHaveCount(0)
      }
      await context.close()
    }
  })

  test("an admin keeps Policy and Connections, and Team as a primary destination", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.adminCookie)
    // From 1180px the sidebar's More group, open on a Settings page.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/settings")
    const nav = page.getByRole("navigation", { name: "Settings sections" })
    await expect(nav.getByRole("link", { name: "Google connections" })).toBeVisible()
    // Team is a primary destination now, not a settings tab.
    await expect(
      page
        .locator('aside[aria-label="Sidebar"]')
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Team", exact: true })
    ).toBeVisible()
    // The compliance console is gone for every role, admin included.
    await expect(nav.getByRole("link", { name: "Compliance" })).toHaveCount(0)
    // Operations returned for owners and admins as the operational recovery
    // view (components/settings/settings-nav.tsx).
    await expect(nav.getByRole("link", { name: "Operations" })).toBeVisible()

    // On a phone Team is a row in the More sheet, beside Settings.
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "More", exact: true })
      .click()
    const more = page.getByRole("dialog", { name: "More" }).getByRole("navigation", { name: "More" })
    await expect(more.getByRole("link", { name: "Team", exact: true })).toBeVisible()
    await expect(more.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page")
  })
})

// P13: the invite sheet and the change-role sheet. Server writes are
// answered here (POST /api/invitations, PATCH /api/members) so the shared
// journey tenant is left as it was; reads go to the real app.
const ROLE_NAMES = /^(Member|Viewer|Admin|Owner)/

// Team has two "Invite a teammate" buttons (the page header and the empty
// invitations list): the header's is the one these steps use.
function inviteButton(page: Page) {
  return page
    .getByRole("main")
    .locator("header")
    .getByRole("button", { name: "Invite a teammate" })
}

async function roleRows(scope: Locator) {
  const rows = scope
    .getByRole("radiogroup", { name: "Role" })
    .getByRole("radio")
  return rows.evaluateAll((nodes) =>
    nodes.map(
      (node) => node.textContent?.match(/^(Member|Viewer|Admin|Owner)/)?.[0]
    )
  )
}

test.describe("team roles", () => {
  // Tenants seeded by a test, destroyed after it whatever the outcome.
  const cleanups: (() => Promise<void>)[] = []
  test.afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })

  test("the invite sheet lists roles as rows and shows Client access above the button on a phone", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    // Client access has no row in a business workspace: say so up front.
    expect(
      await pageWorkspaceMode(page),
      "this test needs an agency workspace"
    ).toBe("agency")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/team")
    await inviteButton(page).click()
    const dialog = page.getByRole("dialog", { name: "Invite a teammate" })
    await expect(dialog).toBeVisible()

    // Member (the usual choice) first, Owner last: an owner may pick all four.
    expect(await roleRows(dialog)).toEqual([
      "Member",
      "Viewer",
      "Admin",
      "Owner",
    ])
    await expect(
      dialog.getByRole("radio", { name: ROLE_NAMES }).first()
    ).toBeChecked()
    // The visible pill, once (the screen-reader hint says it in a sentence).
    await expect(
      dialog.getByText("Usual choice", { exact: true })
    ).toHaveCount(1)
    // The pill is a hint, not part of the radio's name.
    await expect(
      dialog.getByRole("radio", { name: "Member", exact: true })
    ).toBeChecked()
    // The selected row carries the true Member copy: no promise of listing edits.
    await expect(
      dialog.getByRole("radio", { name: /^Member/ })
    ).toHaveAccessibleDescription(
      /Can.t edit a listing.s profile, hours or menu/
    )

    // Client access (Location access has no row in a business workspace) is
    // on screen, above the submit button, without scrolling the sheet.
    const access = dialog.getByRole("button", { name: "Client access" })
    const submit = dialog.getByRole("button", {
      name: /Create invite link|Send invitation/,
    })
    await expect(access).toBeInViewport()
    await expect(submit).toBeInViewport()
    const accessBox = await access.boundingBox()
    const submitBox = await submit.boundingBox()
    expect(accessBox!.y + accessBox!.height).toBeLessThanOrEqual(submitBox!.y)
    await expect(access).toHaveAccessibleDescription(/All clients/)
    await expect(
      dialog.getByRole("radio", { name: /^All clients/ })
    ).toHaveCount(0)
    await access.click()
    await expect(
      dialog.getByRole("radio", { name: /^All clients/ })
    ).toBeChecked()

    // An admin has no client choice.
    await dialog.getByRole("radio", { name: /^Admin/ }).click()
    await expect(access).toHaveCount(0)
  })

  test("a created invitation has one primary action, Share or Copy link", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await page.setViewportSize({ width: 390, height: 844 })
    let posted: unknown
    await page.route(/\/api\/invitations(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      posted = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        json: {
          invitation: {
            id: "00000000-0000-4000-8000-0000000000a1",
            email: "new.member@example.test",
            role: "member",
            canPublish: false,
            expiresAt: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000
            ).toISOString(),
            acceptedAt: null,
            createdAt: new Date().toISOString(),
          },
          inviteUrl: "http://localhost:3000/invite/e2e-p13-token",
        },
      })
    })
    await page.goto("/team")
    await inviteButton(page).click()
    const dialog = page.getByRole("dialog", { name: "Invite a teammate" })
    await dialog
      .getByRole("textbox", { name: "Email address" })
      .fill("new.member@example.test")
    await dialog
      .getByRole("button", { name: /Create invite link|Send invitation/ })
      .click()

    await expect(dialog.getByTestId("invite-created")).toBeVisible()
    // The same payload as before: role Member, publishing off, no client list.
    expect(posted).toEqual({
      email: "new.member@example.test",
      role: "member",
      canPublish: false,
    })

    // One primary (Share where the browser has a share sheet, else Copy
    // link); Done is quiet and Invite someone else is a text link.
    const primary = dialog.locator(
      '[data-slot="button"][data-variant="default"]'
    )
    await expect(primary).toHaveCount(1)
    await expect(primary).toHaveText(/^(Share|Copy link)$/)
    await expect(dialog.getByRole("button", { name: "Done" })).toHaveAttribute(
      "data-variant",
      "ghost"
    )
    await expect(
      dialog.getByRole("button", { name: "Invite someone else" })
    ).toHaveAttribute("data-variant", "link")
    await expect(
      dialog.getByRole("textbox", { name: "Invite link" })
    ).toHaveValue("http://localhost:3000/invite/e2e-p13-token")
  })

  test("change role offers the roles in the same order and sends the chosen role", async ({
    baseURL,
    page,
  }) => {
    // /team reads its members on the server (P20), so Ben is a real member
    // of a throwaway tenant; the stub answers only the role change.
    const team = await seedTeamTenant({
      members: [
        {
          displayName: "Ben Member",
          email: "ben.{id}@example.test",
          role: "member",
          canPublish: false,
        },
      ],
    })
    cleanups.push(team.destroy)
    await applyCookie(page, baseURL, team.cookie)
    const BEN = team.members[0]!.userId
    let patched: unknown
    await page.route(/\/api\/members(?:\?.*)?$/, async (route) => {
      const request = route.request()
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as {
          userId: string
          role: string
          canPublish: boolean
        }
        patched = body
        return route.fulfill({
          json: {
            member: {
              ...body,
              locationScope: "all",
              createdAt: "2026-07-01T09:00:00.000Z",
            },
          },
        })
      }
      return route.fallback()
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/team")
    // SET-10: the role chip opens Change role in one tap (chip, role,
    // confirm: 3 taps, where ⋯, Change role…, role, confirm took 4).
    await page
      .getByRole("button", { name: "Member: change Ben Member’s role" })
      .click()
    const dialog = page.getByRole("dialog", { name: "Change role" })
    await expect(dialog).toBeVisible()

    expect(await roleRows(dialog)).toEqual([
      "Member",
      "Viewer",
      "Admin",
      "Owner",
    ])
    await expect(dialog.getByRole("radio", { name: /^Member/ })).toBeChecked()
    await expect(
      dialog.getByRole("radio", { name: /^Member/ })
    ).toHaveAccessibleDescription(/Drafts replies and posts/)
    // Nothing chosen yet: nothing to save.
    await expect(
      dialog.getByRole("button", { name: "Change role" })
    ).toBeDisabled()

    await dialog.getByRole("radio", { name: /^Viewer/ }).click()
    await expect(
      dialog.getByRole("radio", { name: /^Viewer/ })
    ).toHaveAccessibleDescription(/Can.t draft, publish or change anything/)
    await dialog.getByRole("button", { name: "Make Ben a viewer" }).click()
    await expect(dialog).toBeHidden()
    expect(patched).toEqual({ userId: BEN, role: "viewer", canPublish: false })
  })

  test("a member is one row on a phone, and the row opens their sheet", async ({
    baseURL,
    page,
  }) => {
    // /team reads its members on the server (P20), so Ben is a real member
    // of a throwaway tenant. The stub answers the publishing change and
    // keeps the refetch after it showing that change.
    const team = await seedTeamTenant({
      members: [
        {
          displayName: "Ben Member",
          email: "ben.member.with.a.long.{id}@example.test",
          role: "member",
          canPublish: false,
        },
      ],
    })
    cleanups.push(team.destroy)
    await applyCookie(page, baseURL, team.cookie)
    const seeded = team.members[0]!
    const BEN = seeded.userId
    let patched: unknown
    let ben: Record<string, unknown> | null = null
    await page.route(/\/api\/members(?:\?.*)?$/, async (route) => {
      const request = route.request()
      if (request.method() === "GET") {
        const response = await route.fetch()
        const json = (await response.json()) as {
          members: { userId: string }[]
        }
        if (ben) {
          const changed = ben
          json.members = json.members.map((m) =>
            m.userId === BEN ? { ...m, ...changed } : m
          )
        }
        return route.fulfill({ response, json })
      }
      if (request.method() === "PATCH") {
        patched = request.postDataJSON()
        ben = { ...(ben ?? {}), ...(patched as object) }
        return route.fulfill({
          json: {
            member: {
              ...(patched as object),
              locationScope: "all",
              createdAt: "2026-07-01T09:00:00.000Z",
            },
          },
        })
      }
      return route.fallback()
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/team")
    const list = page.getByRole("list", { name: "Members" })
    const rowName = `Ben Member, ${seeded.email}`
    const row = list.getByRole("button", { name: rowName })
    await expect(row).toBeVisible()
    // SET-02: one row (name, the full email, the role chip and its line),
    // not the record card (about 178px). Measured on the whole list item,
    // footer included: 132px at 390.
    const box = await list
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: rowName }) })
      .boundingBox()
    expect(box!.height).toBeLessThanOrEqual(140)
    await expect(list.getByText("All clients · Drafts only")).toBeVisible()
    await expect(page.getByRole("table", { name: "Members" })).toHaveCount(0)

    await row.click()
    const sheet = page.getByRole("dialog", { name: "Ben Member" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("button", { name: /^Role/ })).toContainText(
      "Member"
    )
    await sheet.getByRole("switch", { name: /Can publish/ }).click()
    await expect.poll(() => patched).toEqual({
      userId: BEN,
      role: "member",
      canPublish: true,
    })
    await expect(sheet.getByText("Saved: publishing on")).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: /Remove from team/ })
    ).toBeEnabled()

    // The sheet hands over to Change role; closing that puts focus back on
    // the member's row, not on the page.
    await sheet.getByRole("button", { name: /^Role/ }).click()
    const dialog = page.getByRole("dialog", { name: "Change role" })
    await expect(dialog).toBeVisible()
    await expect(sheet).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(row).toBeFocused()
  })
})

// P20 Release & QA repro: Reply policy is prefetched on the server, so
// Next's router cache keeps the page's old payload. Back after a save must
// still show the saved policy, not the snapshot the page was first read
// with (it used to: the old payload was re-dated on every mount and won).
test.describe("reply policy after Back", () => {
  const cleanups: (() => Promise<void>)[] = []
  test.afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })

  test("save, leave by an in-app link, press Back: the form shows what was saved", async ({
    baseURL,
    page,
  }) => {
    // A throwaway tenant, so the shared journey tenant's policy is untouched.
    const tenant = await seedTeamTenant({
      settings: { approvalRequired: false, rawContentRetentionDays: 30 },
    })
    cleanups.push(tenant.destroy)
    await applyCookie(page, baseURL, tenant.cookie)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/settings")
    await expect(page.getByRole("heading", { name: "Reply policy", level: 1 })).toBeVisible()

    const approval = page.getByRole("switch", { name: "Require approval before replies publish" })
    const secondPerson = page.getByRole("switch", { name: /Require a second person/ })
    await expect(approval).not.toBeChecked()
    await approval.click()
    await secondPerson.click()
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("button", { name: "Save changes" })).toBeHidden()
    await expect(approval).toBeChecked()
    await expect(secondPerson).toBeChecked()

    // A marker that only a full page load clears: Back must be a soft
    // navigation from Next's router cache, the path that went wrong.
    await page.evaluate(() => {
      ;(window as unknown as { __p20Soft?: boolean }).__p20Soft = true
    })
    await page
      .locator('aside[aria-label="Sidebar"]')
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: /^Inbox/ })
      .click()
    await expect(page).not.toHaveURL(/\/settings$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole("heading", { name: "Reply policy", level: 1 })).toBeVisible()
    expect(
      await page.evaluate(() => (window as unknown as { __p20Soft?: boolean }).__p20Soft)
    ).toBe(true)

    await expect(approval).toBeChecked()
    await expect(secondPerson).toBeChecked()
    // Nothing looks unsaved, so a later save can't send the old values.
    await expect(page.getByRole("button", { name: "Save changes" })).toBeHidden()

    // And the server holds the saved policy.
    await page.reload()
    await expect(approval).toBeChecked()
    await expect(secondPerson).toBeChecked()
  })
})
