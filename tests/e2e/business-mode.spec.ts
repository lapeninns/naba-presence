import { expect } from "@playwright/test"

import { test } from "./helpers/business-tenant"
import { pageSettled, trackRequests } from "./helpers/settled"
import { pageWorkspaceMode } from "./helpers/workspace-mode"

/**
 * A business-mode owner never sees the client or agency layer.
 *
 * Written for the port-3100 harness. The shared harness tenants (the
 * cookie-less local bootstrap organisation and the journey tenant) are agency
 * organisations, so each test signs its page in to a dedicated business-mode
 * organisation it creates and destroys (helpers/business-tenant.ts). A tenant
 * that cannot be created fails the test: nothing here skips.
 *
 * The scan reads the visible text of each page and fails on the words
 * "client" and "agency". The allowlist is for text that is not the
 * business's own wording: the sign-in provider name and user-authored
 * content (a location called "Agency Road Cafe" is the user's data).
 */
const ALLOWED = [
  // Review text and names are the customer's own words.
  /Agency Road/i,
]

const PAGES = [
  { path: "/inbox", heading: /^Inbox$/ },
  { path: "/listings", heading: /^Listings$/ },
  { path: "/reports", heading: /^Reports$/ },
  { path: "/team", heading: /^Team$/ },
  { path: "/settings", heading: /^Reply policy$/ },
  { path: "/setup", heading: null },
] as const

// Reads the mode through the page's own cookie jar, so the page's first
// navigation renders as the signed-in business session.
async function isBusinessTenant(page: import("@playwright/test").Page) {
  return (await pageWorkspaceMode(page)) === "business"
}

for (const { path, heading } of PAGES) {
  test(`${path} never says client or agency`, async ({ page }) => {
    expect(await isBusinessTenant(page)).toBe(true)
    const requests = trackRequests(page)
    await page.goto(path)
    if (heading) {
      await expect(
        page.getByRole("heading", { name: heading, level: 1 })
      ).toBeVisible()
    }
    // Settle the shell's queries so the text is the loaded page's: no region
    // busy, no skeleton left, and every request answered.
    await pageSettled(page)
    await requests.idle()

    const text = await page.locator("body").innerText()
    const scrubbed = ALLOWED.reduce(
      (current, allowed) => current.replace(allowed, ""),
      text
    )
    expect(scrubbed).not.toMatch(/\bclients?\b/i)
    expect(scrubbed).not.toMatch(/\bagency\b/i)
    // The accessible names too: a visually hidden "Filter by client" counts.
    const names = await page
      .locator("[aria-label]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label") ?? "")
      )
    expect(names.join("\n")).not.toMatch(/\bclients?\b|\bagency\b/i)
  })
}

// Each wizard step, by deep link. A step the data has not reached opens the
// furthest reachable one, so this scans whichever steps the tenant can open.
for (const step of [
  "agency",
  "connect",
  "account",
  "locations",
  "backfill",
  "notifications",
  "team",
  "done",
  "client",
  "connect&google=error&status=403",
]) {
  test(`/setup?step=${step} never says client or agency`, async ({ page }) => {
    expect(await isBusinessTenant(page)).toBe(true)
    await page.goto(`/setup?step=${step}`)
    await expect(
      page.getByRole("heading", { name: "Setup", level: 1 })
    ).toBeVisible()
    // The rail renders only once the setup query has resolved, so the step
    // body below it is the loaded one and not the skeleton.
    const rail = page.getByRole("list", { name: "Setup steps" })
    await expect(rail).toBeVisible()
    await pageSettled(page)
    const text = await page.locator("body").innerText()
    const scrubbed = ALLOWED.reduce(
      (current, allowed) => current.replace(allowed, ""),
      text
    )
    expect(scrubbed).not.toMatch(/\bclients?\b/i)
    expect(scrubbed).not.toMatch(/\bagency\b/i)
    const names = await page
      .locator("[aria-label]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label") ?? "")
      )
    expect(names.join("\n")).not.toMatch(/\bclients?\b|\bagency\b/i)
    // The business flow has no "Client" step in its rail.
    await expect(rail.getByText(/^Client$/)).toHaveCount(0)
  })
}

test("the client pages redirect a business to Listings and Settings", async ({ page }) => {
  expect(await isBusinessTenant(page)).toBe(true)
  for (const [from, to] of [
    ["/clients", "/listings"],
    ["/clients/new", "/listings"],
    ["/clients/00000000-0000-4000-8000-000000000001", "/listings"],
    ["/clients/00000000-0000-4000-8000-000000000001/settings", "/settings"],
  ]) {
    await page.goto(from)
    // The redirect can land after the load event (it is issued from a page
    // that streams), so poll the address instead of reading it once.
    await expect.poll(() => new URL(page.url()).pathname).toBe(to)
  }
})

test("the primary navigation is Inbox, Listings, Reports, Team, Settings", async ({ page }) => {
  expect(await isBusinessTenant(page)).toBe(true)
  // The desk sidebar (from 1180px): its More disclosure is open on /team.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/team")
  const nav = page
    .locator('aside[aria-label="Sidebar"]')
    .getByRole("navigation", { name: "Primary" })
  await expect(nav.getByRole("link", { name: "Clients" })).toHaveCount(0)
  for (const label of ["Inbox", "Listings", "Reports", "Team", "Settings"]) {
    await expect(
      nav.getByRole("link", { name: label, exact: true })
    ).toBeVisible()
  }
  await expect(page.getByRole("combobox", { name: /client/i })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Client:/ })).toHaveCount(0)
})

test("a phone's tabs have no Clients, and More holds Team and Settings", async ({ page }) => {
  expect(await isBusinessTenant(page)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/reports")
  await expect(
    page.getByRole("heading", { name: "Reports", level: 1 })
  ).toBeVisible()
  const tabs = page.getByRole("navigation", { name: "Primary" })
  await expect(tabs).toHaveAttribute("data-slot", "tab-bar")
  await expect(tabs.getByRole("link", { name: "Clients" })).toHaveCount(0)
  // Calendar takes the Clients slot (or Notifications, with scheduling off).
  await expect(tabs.getByRole("link")).toHaveCount(4)
  for (const label of ["Listings", "Reports"]) {
    await expect(
      tabs.getByRole("link", { name: label, exact: true })
    ).toBeVisible()
  }
  await expect(
    tabs.getByRole("link", {
      name: /^Inbox(, \d+ (?:needs? a reply|awaiting your approval|needs? your attention: \d+ to reply, \d+ to approve))?$/,
    })
  ).toBeVisible()
  // The app bar names the business; there is no client chip to change.
  const bar = page.locator('header[data-slot="app-bar"]')
  await expect(bar.getByRole("button", { name: /^Client:/ })).toHaveCount(0)
  await expect(bar.locator('[data-slot="workspace-name"]')).toBeVisible()

  await tabs.getByRole("button", { name: "More", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "More" })
  await expect(sheet).toBeVisible()
  // No "Working on" client row in a business.
  await expect(sheet.getByText("Working on", { exact: true })).toHaveCount(0)
  const more = sheet.getByRole("navigation", { name: "More" })
  for (const label of ["Team", "Settings"]) {
    await expect(
      more.getByRole("link", { name: label, exact: true })
    ).toBeVisible()
  }
  await expect(more.getByRole("link", { name: "Clients" })).toHaveCount(0)
})
