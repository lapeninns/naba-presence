import { expect, test } from "@playwright/test"

/**
 * A business-mode owner never sees the client or agency layer.
 *
 * Written for the port-3100 harness and NOT run in the stage that added it
 * (unit tests only there). It assumes the harness tenant is a business-mode
 * organisation, which is what a new organisation is; against an agency
 * tenant it skips instead of failing.
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

async function isBusinessTenant(
  request: import("@playwright/test").APIRequestContext
) {
  const response = await request.get("/api/session")
  if (!response.ok()) return false
  const body = (await response.json()) as {
    session: { workspaceMode?: string } | null
  }
  return body.session?.workspaceMode === "business"
}

for (const { path, heading } of PAGES) {
  test(`${path} never says client or agency`, async ({ page, request }) => {
    test.skip(
      !(await isBusinessTenant(request)),
      "The harness tenant is not in business mode."
    )
    await page.goto(path)
    if (heading) {
      await expect(
        page.getByRole("heading", { name: heading, level: 1 })
      ).toBeVisible()
    }
    // Settle the shell's queries so the text is the loaded page's.
    await page.waitForLoadState("networkidle")

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

test("the client pages redirect a business to Listings and Settings", async ({
  page,
  request,
}) => {
  test.skip(
    !(await isBusinessTenant(request)),
    "The harness tenant is not in business mode."
  )
  for (const [from, to] of [
    ["/clients", "/listings"],
    ["/clients/new", "/listings"],
    ["/clients/00000000-0000-4000-8000-000000000001", "/listings"],
    ["/clients/00000000-0000-4000-8000-000000000001/settings", "/settings"],
  ]) {
    await page.goto(from)
    expect(new URL(page.url()).pathname).toBe(to)
  }
})

test("the primary navigation is Inbox, Listings, Reports, Team, Settings", async ({
  page,
  request,
}) => {
  test.skip(
    !(await isBusinessTenant(request)),
    "The harness tenant is not in business mode."
  )
  await page.goto("/team")
  const nav = page.getByRole("navigation", { name: "Primary" })
  await expect(nav.getByRole("link", { name: "Clients" })).toHaveCount(0)
  for (const label of ["Inbox", "Listings", "Reports", "Team", "Settings"]) {
    await expect(
      nav.getByRole("link", { name: label, exact: true })
    ).toBeVisible()
  }
  await expect(page.getByRole("combobox", { name: /client/i })).toHaveCount(0)
})
