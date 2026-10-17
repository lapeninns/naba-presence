import { expect, type Page, type Route, test } from "@playwright/test"

import { applyCookie, stubClientSummary } from "./helpers/client-stubs"
import { readJourneyState } from "./helpers/stub-bridge"

// The client form and archive (R17): /clients/new, the client settings page's
// Details form, and its Archive section. Every write is stubbed with
// `page.route` (and its body observed), so the seeded client is never
// changed; reads of the seeded tenant stay real unless a test says otherwise.
// Archiving is one step with an Undo toast, not a confirm dialog, so there is
// no Cancel to test.

test.beforeEach(async ({ baseURL, page }) => {
  const state = await readJourneyState()
  await applyCookie(page, baseURL, state.cookie)
})

type Write = { method: string; body: Record<string, unknown> }

/**
 * Stubs `POST /api/clients` (the exact path, so the shell's list read and its
 * `?archived=1` variant fall through to the real server). Records every body.
 */
async function stubCreate(
  page: Page,
  respond: (route: Route, body: Record<string, unknown>) => Promise<void>
) {
  const writes: Write[] = []
  await page.route(
    (url) => url.pathname === "/api/clients",
    async (route) => {
      const request = route.request()
      if (request.method() !== "POST") return route.fallback()
      const body = request.postDataJSON() as Record<string, unknown>
      writes.push({ method: "POST", body })
      await respond(route, body)
    }
  )
  return writes
}

test.describe("new client", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("an empty name is refused with a message and nothing is sent", async ({
    page,
  }) => {
    const writes = await stubCreate(page, (route) =>
      route.fulfill({ status: 500, json: { error: "unexpected" } })
    )
    await page.goto("/clients/new")
    await expect(
      page.getByRole("heading", { name: "New client", level: 1 })
    ).toBeVisible()
    const name = page.getByRole("textbox", { name: "Client name" })

    // Blank, and blank but for spaces: the same answer.
    await page.getByRole("button", { name: "Create client" }).click()
    await expect(page.getByText("Give the client a name.")).toBeVisible()
    await expect(name).toBeFocused()
    await name.fill("   ")
    await page.getByRole("button", { name: "Create client" }).click()
    await expect(page.getByText("Give the client a name.")).toBeVisible()
    expect(writes).toEqual([])

    // The message goes as soon as there is a name to send.
    await name.fill("Harbour Kitchen")
    await expect(page.getByText("Give the client a name.")).toHaveCount(0)
    expect(writes).toEqual([])
  })

  test("creating a client sends its trimmed name and notes, then goes to connect Google", async ({
    page,
  }) => {
    const state = await readJourneyState()
    // The answer names the seeded client, so the setup page the app moves on
    // to is a real one.
    const writes = await stubCreate(page, (route, body) =>
      route.fulfill({
        status: 201,
        json: {
          client: stubClientSummary(state.clientId, String(body.name), {
            notes: body.notes ?? null,
          }),
        },
      })
    )
    await page.goto("/clients/new")
    await page
      .getByRole("textbox", { name: "Client name" })
      .fill("  Harbour Kitchen  ")
    await page
      .getByRole("textbox", { name: /^Notes/ })
      .fill("  Two sites, one owner.  ")
    await page.getByRole("button", { name: "Create client" }).click()

    await expect(page).toHaveURL(
      new RegExp(`/setup\\?.*client=${state.clientId}`)
    )
    expect(writes).toEqual([
      {
        method: "POST",
        body: { name: "Harbour Kitchen", notes: "Two sites, one owner." },
      },
    ])
    await expect(
      page.getByText("Harbour Kitchen created").first()
    ).toBeVisible()
  })

  test("a refused create keeps what was typed and says nothing was added", async ({
    page,
  }) => {
    await stubCreate(page, (route) =>
      route.fulfill({
        status: 500,
        json: { error: "internal_error", message: "Boom." },
      })
    )
    await page.goto("/clients/new")
    const name = page.getByRole("textbox", { name: "Client name" })
    await name.fill("Harbour Kitchen")
    await page.getByRole("button", { name: "Create client" }).click()

    await expect(page.getByText("The client wasn’t created")).toBeVisible()
    await expect(page.getByText(/Nothing was added/)).toBeVisible()
    await expect(name).toHaveValue("Harbour Kitchen")
    await expect(page).toHaveURL(/\/clients\/new$/)
  })

  test("Cancel goes back to the clients list", async ({ page }) => {
    await page.goto("/clients/new")
    const cancel = page.getByRole("link", { name: "Cancel" })
    await expect(cancel).toHaveAttribute("href", "/clients")
    await cancel.click()
    await expect(page).toHaveURL(/\/clients$/)
  })
})

test.describe("new client on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("Create client stays in view above the fold", async ({ page }) => {
    await page.goto("/clients/new")
    await expect(
      page.getByRole("heading", { name: "New client", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Create client" })
    ).toBeInViewport()
  })
})

/**
 * Stubs the settings page's own client read and write at
 * `/api/clients/{id}`. The read answers the current summary, so a PATCH that
 * renames the client is visible to the refetch that follows it, exactly as the
 * server would. Everything else (the location directory, the shell's list)
 * stays real.
 */
async function stubClientEndpoint(
  page: Page,
  clientId: string,
  initialName: string,
  respond?: (route: Route, body: Record<string, unknown>) => Promise<void>
) {
  const writes: Write[] = []
  let current = stubClientSummary(clientId, initialName, {
    health: "healthy",
  })
  await page.route(
    (url) => url.pathname === `/api/clients/${clientId}`,
    async (route) => {
      const request = route.request()
      if (request.method() === "GET") {
        return route.fulfill({ json: { client: current, locations: [] } })
      }
      if (request.method() !== "PATCH") return route.fallback()
      const body = request.postDataJSON() as Record<string, unknown>
      writes.push({ method: "PATCH", body })
      if (respond) return respond(route, body)
      current = {
        ...current,
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(body.archived === true
          ? { archivedAt: "2026-10-16T09:00:00.000Z" }
          : {}),
      }
      return route.fulfill({ json: { client: current } })
    }
  )
  return writes
}

async function openSettings(page: Page) {
  const state = await readJourneyState()
  const writes = await stubClientEndpoint(
    page,
    state.clientId,
    state.clientName
  )
  await page.goto(`/clients/${state.clientId}/settings`)
  await expect(
    page.getByRole("heading", { name: "Client settings", level: 1 })
  ).toBeVisible()
  return { state, writes }
}

test.describe("client settings at a 1280px desk", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("fills the details from the client and offers Save only once something changes", async ({
    page,
  }) => {
    const { state } = await openSettings(page)
    const name = page.getByRole("textbox", { name: "Client name" })
    await expect(name).toHaveValue(state.clientName)
    await expect(
      page.getByRole("link", { name: `Back to ${state.clientName}` })
    ).toHaveAttribute("href", `/clients/${state.clientId}`)
    const save = page.getByRole("button", { name: "Save changes" })
    await expect(save).toBeHidden()

    await name.fill(`${state.clientName} Group`)
    await expect(save).toBeVisible()
    await expect(page.getByText("Unsaved changes")).toBeVisible()
    await page.getByRole("button", { name: "Discard" }).click()
    await expect(name).toHaveValue(state.clientName)
    await expect(save).toBeHidden()
  })

  test("renaming saves through a PATCH and shows the saved state", async ({
    page,
  }) => {
    const { state, writes } = await openSettings(page)
    const renamed = `${state.clientName} Group`
    await page
      .getByRole("textbox", { name: "Client name" })
      .fill(`  ${renamed} `)
    await page.getByRole("button", { name: "Save changes" }).click()

    await expect(page.getByText("Client updated").first()).toBeVisible()
    // The refetch carries the new name: the header's Back link says it, and
    // there is nothing left to save.
    await expect(
      page.getByRole("link", { name: `Back to ${renamed}` })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Save changes" })
    ).toBeHidden()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.body).toMatchObject({
      name: renamed,
      notes: null,
      colour: null,
    })
  })

  test("a blank name is refused and nothing is sent", async ({ page }) => {
    const { writes } = await openSettings(page)
    await page.getByRole("textbox", { name: "Client name" }).fill("   ")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Give the client a name.")).toBeVisible()
    expect(writes).toEqual([])
  })

  test("a refused save keeps the edits and says they were not saved", async ({
    page,
  }) => {
    const state = await readJourneyState()
    await stubClientEndpoint(page, state.clientId, state.clientName, (route) =>
      route.fulfill({
        status: 500,
        json: { error: "internal_error", message: "Boom." },
      })
    )
    await page.goto(`/clients/${state.clientId}/settings`)
    const name = page.getByRole("textbox", { name: "Client name" })
    await name.fill("Harbour Kitchen")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Changes not saved")).toBeVisible()
    await expect(page.getByText(/Your edits are still here/)).toBeVisible()
    await expect(name).toHaveValue("Harbour Kitchen")
  })

  test("the Archive section says what archiving does to the listings", async ({
    page,
  }) => {
    const { state } = await openSettings(page)
    const archive = page.getByRole("region", { name: "Archive" })
    await expect(
      archive.getByText(/Archiving hides the client from lists and filters/)
    ).toBeVisible()
    // Enabled once the directory has loaded; the seeded client holds listings.
    await expect(
      archive.getByRole("button", { name: `Archive ${state.clientName}` })
    ).toBeEnabled()
    await expect(
      archive.getByText(
        /still has (its listing|its \d+ listings)\. Archiving unfiles/
      )
    ).toBeVisible()
  })

  test("archiving PATCHes archived with the listings detached, then returns to the clients list", async ({
    page,
  }) => {
    const { state, writes } = await openSettings(page)
    const archive = page
      .getByRole("region", { name: "Archive" })
      .getByRole("button", { name: `Archive ${state.clientName}` })
    await expect(archive).toBeEnabled()
    await archive.click()

    await expect(page).toHaveURL(/\/clients$/)
    expect(writes).toHaveLength(1)
    expect(writes[0]!.body).toMatchObject({
      archived: true,
      detachLocations: true,
    })
    await expect(
      page.getByText(`${state.clientName} archived`).first()
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible()
  })

  test("a refused archive stays on the page and says the client wasn't archived", async ({
    page,
  }) => {
    const state = await readJourneyState()
    await stubClientEndpoint(page, state.clientId, state.clientName, (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: "client_has_locations",
          message: "This client still has 2 locations.",
        },
      })
    )
    await page.goto(`/clients/${state.clientId}/settings`)
    const archive = page.getByRole("button", {
      name: `Archive ${state.clientName}`,
    })
    await expect(archive).toBeEnabled()
    await archive.click()

    await expect(page.getByText(/wasn.t archived/)).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`/clients/${state.clientId}/settings$`)
    )
    await expect(archive).toBeEnabled()
  })
})

test.describe("client settings on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the Save bar docks in view once the name changes", async ({ page }) => {
    const { state } = await openSettings(page)
    await page
      .getByRole("textbox", { name: "Client name" })
      .fill(`${state.clientName} Group`)
    await expect(
      page.getByRole("button", { name: "Save changes" })
    ).toBeInViewport()
  })
})
