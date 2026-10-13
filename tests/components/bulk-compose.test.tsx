import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { BulkCompose } from "@/components/bulk/bulk-compose"

const A = "00000000-0000-4000-8000-0000000000d1"
const B = "00000000-0000-4000-8000-0000000000d2"
const NEW_ID = "00000000-0000-4000-8000-0000000000b9"
const ASSET = "00000000-0000-4000-8000-0000000000a9"

let search = `ids=${A},${B}`
const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => "owner",
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({
    data: [
      { id: A, name: "Old Crown" },
      { id: B, name: "White Horse" },
    ],
  }),
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
const asset = {
  id: ASSET,
  status: "ready",
  mediaFormat: "PHOTO",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  byteLength: 20_000,
  sha256: "b".repeat(64),
  width: 800,
  height: 600,
  rejectionCode: null,
  stagingExpiresAt: "2026-10-13T00:00:00.000Z",
  finalisedAt: "2026-10-12T00:00:00.000Z",
  createdAt: "2026-10-12T00:00:00.000Z",
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
const previewBody = () => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/api/listings/bulk/preview")
  )
  return call ? JSON.parse(String(call[1]?.body)) : undefined
}

beforeEach(() => {
  search = `ids=${A},${B}`
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/api/listings/bulk/preview"))
      return json({ operation: { id: NEW_ID } }, 400)
    if (url.startsWith("/api/assets?status=ready")) return json({ assets: [] })
    if (url === "/api/assets" && init?.method === "POST")
      return json({
        asset: { ...asset, status: "staging", finalisedAt: null },
        upload: {
          url: "http://127.0.0.1:54321/storage/v1/object/upload/sign/x?token=t",
          method: "PUT",
          headers: { "content-type": "image/jpeg", "x-upsert": "false" },
        },
      })
    if (url.startsWith("http://127.0.0.1:54321/")) return new Response("{}")
    if (url === `/api/assets/${ASSET}/finalise`) return json({ asset })
    return json({ error: "not_found" }, 404)
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

/** Picks the kind of change from the "What to change" list. */
async function chooseChange(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole("combobox", { name: "What to change" }))
  await user.click(await screen.findByRole("option", { name }))
}

describe("BulkCompose (P09-R9)", () => {
  it("says photo storage is not set up as soon as the uploads cannot be listed for it", async () => {
    fetchMock.mockImplementation(async () =>
      json(
        {
          error: "asset_storage_unavailable",
          message: "Photo storage is not configured.",
        },
        503
      )
    )
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await chooseChange(user, "Photos")
    expect(
      (
        await screen.findAllByText(
          "Photo storage isn’t set up for this workspace yet."
        )
      ).length
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole("button", { name: "Choose from library" })
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled()
  })

  it("sends only the ticked weekdays of an opening-hours change", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await chooseChange(user, "Opening hours")
    for (const day of [
      "Sunday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ])
      await user.click(screen.getByRole("checkbox", { name: day }))
    expect(
      screen.getByRole("switch", { name: "Open on Tuesday" })
    ).toHaveAttribute("aria-disabled", "true")
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await vi.waitFor(() => expect(previewBody()).toBeDefined())
    expect(previewBody()).toEqual({
      locationIds: [A, B],
      items: [
        {
          operation: "regular_hours",
          days: [
            {
              dayOfWeek: 1,
              isClosed: false,
              periods: [{ opensAt: "09:00", closesAt: "17:00" }],
            },
          ],
        },
      ],
    })
  })

  it("says an overnight close's day and sends 24:00 as midnight the contract can carry", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await chooseChange(user, "Opening hours")
    for (const day of [
      "Sunday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ])
      await user.click(screen.getByRole("checkbox", { name: day }))
    const closes = screen.getByRole("textbox", { name: "Monday closes" })
    await user.clear(closes)
    await user.type(closes, "0200")
    await user.tab()
    expect(
      screen.getByText("Closes Tuesday at 02:00 (overnight).")
    ).toBeInTheDocument()
    await user.clear(closes)
    await user.type(closes, "2400")
    await user.tab()
    expect(
      screen.getByText("Closes at midnight, end of Monday.")
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await vi.waitFor(() => expect(previewBody()).toBeDefined())
    expect(previewBody().items[0].days).toEqual([
      {
        dayOfWeek: 1,
        isClosed: false,
        periods: [{ opensAt: "09:00", closesAt: "00:00" }],
      },
    ])
  })

  it("marks a special date that closes before it opens, instead of sending it", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
      target: { value: "2026-12-25" },
    })
    await user.click(screen.getByRole("combobox", { name: "Set to, date 1" }))
    await user.click(await screen.findByRole("option", { name: "Open" }))
    const closes = screen.getByRole("textbox", { name: "Closes, date 1" })
    await user.clear(closes)
    await user.type(closes, "0900")
    expect(closes).toHaveAccessibleDescription(
      /A special date can’t run past midnight/
    )
    expect(closes).toHaveAttribute("aria-invalid", "true")
    expect(
      screen.getByText("Check the times marked above.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Preview this change" })
    ).toBeDisabled()
  })

  it("keeps the selected listings behind a count", () => {
    renderWithProviders(<BulkCompose />)
    expect(screen.getByText("2 listings")).toBeInTheDocument()
    expect(screen.getByText("White Horse")).toBeInTheDocument()
  })

  it("refuses an opening-hours change with no weekday ticked", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await chooseChange(user, "Opening hours")
    for (const day of [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ])
      await user.click(screen.getByRole("checkbox", { name: day }))
    expect(
      screen.getByText("Tick at least one weekday to change.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Preview this change" })
    ).toBeDisabled()
  })

  it("builds an ordered change list, reorders it and previews exactly that list", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    const date = screen.getByLabelText("Date", { exact: true })
    fireEvent.change(date, { target: { value: "2026-12-25" } })
    await user.click(screen.getByRole("button", { name: "Add to the batch" }))
    fireEvent.change(date, { target: { value: "2026-12-31" } })
    await user.click(screen.getByRole("button", { name: "Add to the batch" }))
    const list = screen.getByRole("list", {
      name: "Changes in this batch, in the order they are sent",
    })
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(["1. Special hours: 2026-12-25", "2. Special hours: 2026-12-31"])
    await user.click(screen.getByRole("button", { name: "Move change 2 up" }))
    expect(
      screen.getByText(/2 listings × 2 changes = 4 of at most 500/)
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Preview these 2 changes" })
    )
    await vi.waitFor(() => expect(previewBody()).toBeDefined())
    expect(
      previewBody().items.map(
        (item: { dates: { date: string }[] }) => item.dates[0].date
      )
    ).toEqual(["2026-12-31", "2026-12-25"])
  })

  it("says when the change being edited is not in the list it previews", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    const date = screen.getByLabelText("Date", { exact: true })
    fireEvent.change(date, { target: { value: "2026-12-25" } })
    await user.click(screen.getByRole("button", { name: "Add to the batch" }))
    expect(
      screen.queryByText(/The change being edited above is not in this batch/)
    ).not.toBeInTheDocument()
    fireEvent.change(date, { target: { value: "2026-12-31" } })
    expect(
      screen.getByText(/The change being edited above is not in this batch/)
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Preview the 1 change in the list" })
    )
    await vi.waitFor(() => expect(previewBody()).toBeDefined())
    expect(
      previewBody().items.map(
        (item: { dates: { date: string }[] }) => item.dates[0].date
      )
    ).toEqual(["2026-12-25"])
  })

  it("refuses two changes to the same date before any preview", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
      target: { value: "2026-12-25" },
    })
    await user.click(screen.getByRole("button", { name: "Add to the batch" }))
    await user.click(screen.getByRole("button", { name: "Add to the batch" }))
    expect(screen.getByText(/Change 2 overlaps change 1/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Preview these 2 changes" })
    ).toBeDisabled()
  })

  it("refuses a selection of more than 50 listings instead of trimming it", () => {
    search = `ids=${Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    ).join(",")}`
    renderWithProviders(<BulkCompose />)
    fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
      target: { value: "2026-12-25" },
    })
    expect(
      screen.getByText(/covers at most 50 listings; this selection has 51/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Preview this change" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Add to the batch" })
    ).toBeDisabled()
  })

  it("uploads a photo in three steps and previews it as a photos change", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await chooseChange(user, "Photos")
    expect(
      screen.getByText("Upload a photo or choose one already uploaded.")
    ).toBeInTheDocument()
    const file = new File([new Uint8Array(20_000)], "front.jpg", {
      type: "image/jpeg",
    })
    await user.upload(screen.getByLabelText("Choose from library"), file)
    expect(
      await screen.findByText("front.jpg is uploaded and checked.")
    ).toBeInTheDocument()
    const started = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/assets" && init?.method === "POST"
    )
    const declared = JSON.parse(String(started?.[1]?.body))
    expect(declared).toMatchObject({
      fileName: "front.jpg",
      contentType: "image/jpeg",
      byteLength: 20_000,
    })
    // SHA-256 of 20,000 zero bytes, computed in the browser.
    expect(declared.sha256).toMatch(/^[a-f0-9]{64}$/)
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")
    expect(String(put?.[0])).toContain("/storage/v1/object/upload/sign/")
    await user.click(
      screen.getByRole("button", { name: "Preview this change" })
    )
    await vi.waitFor(() => expect(previewBody()).toBeDefined())
    expect(previewBody().items).toEqual([
      { operation: "photos", assetId: ASSET, category: "EXTERIOR" },
    ])
  })

  it("says so when photo storage is not set up, and refuses a non-photo file", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === "/api/assets"
        ? json(
            {
              error: "asset_storage_unavailable",
              message: "Photo storage is not configured.",
            },
            503
          )
        : json({ assets: [] })
    )
    const user = userEvent.setup({ applyAccept: false })
    renderWithProviders(<BulkCompose />)
    await chooseChange(user, "Photos")
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File(["x"], "notes.txt", { type: "text/plain" })
    )
    expect(screen.getByText("Choose a JPEG or PNG photo.")).toBeInTheDocument()
    await user.upload(
      screen.getByLabelText("Choose from library"),
      new File([new Uint8Array(20_000)], "front.png", { type: "image/png" })
    )
    expect(
      await screen.findByText(
        "Photo storage isn’t set up for this workspace yet."
      )
    ).toBeInTheDocument()
  })
})
