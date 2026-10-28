import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { BulkCompose } from "@/components/bulk/bulk-compose"

const A = "00000000-0000-4000-8000-0000000000d1"
const B = "00000000-0000-4000-8000-0000000000d2"
const NEW_ID = "00000000-0000-4000-8000-0000000000b9"

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

/** A previewed operation the client's schema accepts. */
const previewed = {
  id: NEW_ID,
  operation: "special_hours",
  items: [
    {
      operation: "special_hours",
      dates: [{ action: "closed", date: "2026-12-25" }],
    },
  ],
  status: "previewed",
  previewHash: "a".repeat(64),
  requestedBy: "00000000-0000-4000-8000-0000000000e1",
  approvedBy: null,
  requiresSecondApprover: false,
  canApprove: true,
  approvalExpiresAt: "2099-10-02T00:00:00.000Z",
  previewExpiresAt: "2099-10-02T00:00:00.000Z",
  dispatchExpiresAt: null,
  createdAt: "2026-09-30T00:00:00.000Z",
  finishedAt: null,
  counts: { previewed: 0 },
  children: [],
}

let answer: () => Response | Promise<Response>
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
const previewCalls = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith("/api/listings/bulk/preview")
  )

beforeEach(() => {
  search = `ids=${A},${B}`
  answer = () => json({ operation: previewed })
  fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith("/api/listings/bulk/preview")
      ? answer()
      : json({ error: "not_found" }, 404)
  )
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

/** The docked bar's status words (not the reasons its buttons carry). */
const bar = () =>
  screen
    .getByRole("region", { name: "Preview the bulk change" })
    .querySelector<HTMLElement>('[data-slot="action-bar-status"]')!
const previewButton = () =>
  screen.getByRole("button", { name: "Preview this change" })
const pickDate = (value = "2026-12-25") =>
  fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
    target: { value },
  })

describe("BulkCompose first run (p4-F13 C1, C2)", () => {
  it("asks for the date as the next step, never the contract's ISO wording", () => {
    renderWithProviders(<BulkCompose />)
    expect(screen.queryByText(/Invalid ISO date/)).toBeNull()
    // A muted instruction in the change card, not an alarm.
    const line = screen
      .getAllByText("Choose a date.")
      .find((node) => node.getAttribute("role") === "status")
    expect(line).toHaveClass("text-ink-muted")
    expect(line).not.toHaveClass("text-danger-ink")
  })

  it("keeps Preview and Add focusable and says why they can't be used, in the bar too", () => {
    renderWithProviders(<BulkCompose />)
    const preview = previewButton()
    expect(preview).toHaveAttribute("aria-disabled", "true")
    expect(preview).toHaveAccessibleDescription("Choose a date.")
    preview.focus()
    expect(preview).toHaveFocus()
    const add = screen.getByRole("button", { name: "Add to the batch" })
    expect(add).toHaveAttribute("aria-disabled", "true")
    expect(add).toHaveAccessibleDescription("Choose a date.")
    expect(within(bar()).getByText("Choose a date.")).toBeInTheDocument()
    pickDate()
    expect(previewButton()).not.toHaveAttribute("aria-disabled")
    expect(
      within(bar()).getByText("2 listing changes to preview")
    ).toBeInTheDocument()
  })

  it("asks for a Google attribute ID in words, not as a pattern", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    await user.click(screen.getByRole("combobox", { name: "What to change" }))
    await user.click(await screen.findByRole("option", { name: "Attributes" }))
    expect(screen.queryByText(/must match pattern/)).toBeNull()
    expect(
      screen.getAllByText(
        "Type each Google attribute ID, such as attributes/has_wifi."
      ).length
    ).toBeGreaterThan(0)
  })
})

describe("BulkCompose with no listings (p4-F13 C3)", () => {
  it("offers one way back to choose listings instead of the whole form", () => {
    search = ""
    renderWithProviders(<BulkCompose />)
    expect(screen.getByText("Choose listings first")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Choose listings" })
    ).toHaveAttribute("href", "/listings")
    expect(
      screen.queryByRole("combobox", { name: "What to change" })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull()
  })

  it("treats ids that aren't listing ids as no selection", () => {
    search = "ids=not-a-listing"
    renderWithProviders(<BulkCompose />)
    expect(screen.getByText("Choose listings first")).toBeInTheDocument()
  })
})

describe("BulkCompose preview hand-off (p4-F13 C4)", () => {
  it("stays busy after the preview exists, so a second press sends nothing", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    pickDate()
    await user.click(previewButton())
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/listings/bulk/${NEW_ID}`)
    )
    // The route has not changed yet (push is a no-op here).
    const busy = screen.getByRole("button", { name: "Reading each listing…" })
    expect(busy).toHaveAttribute("aria-busy", "true")
    expect(
      within(bar()).getByText("Preparing the preview…")
    ).toBeInTheDocument()
    await user.click(busy)
    expect(previewCalls()).toHaveLength(1)
  })
})

describe("BulkCompose preview failures (p4-F13 C5)", () => {
  it("says to choose the listings again when one is no longer available, and clears it on an edit", async () => {
    answer = () =>
      json(
        {
          error: "bulk_targets_unavailable",
          message:
            "One or more selected listings are not available to you. Refresh the selection.",
        },
        404
      )
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    pickDate()
    await user.click(previewButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "One or more selected listings are no longer available to you. Choose the listings again."
    )
    expect(
      screen.getByRole("link", { name: "Choose listings" })
    ).toHaveAttribute("href", "/listings")
    expect(
      within(bar()).getByText(
        "The preview couldn’t be prepared; see the batch above"
      )
    ).toBeInTheDocument()
    // A different batch is not the one that failed.
    pickDate("2026-12-31")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("link", { name: "Choose listings" })).toBeNull()
  })

  it("says when to try again after too many previews, from the server's wait", async () => {
    answer = () =>
      json(
        {
          error: "bulk_rate_limited",
          message:
            "Too many requests like this in a short time. Wait a few minutes and try again.",
          retryable: true,
          details: { retryAfter: 125 },
        },
        429
      )
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    pickDate()
    await user.click(previewButton())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many previews in the last few minutes. Try again in 3 minutes."
    )
    expect(previewCalls()).toHaveLength(1)
  })
})

describe("BulkCompose batch copy (p4-F13 C6)", () => {
  it("speaks of one batch, before and after a change is added", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BulkCompose />)
    expect(
      screen.getByText(
        /Preview sends the change above on its own\. To send more than one change to each listing, add each one to the batch\./
      )
    ).toBeInTheDocument()
    pickDate()
    await user.click(screen.getByRole("button", { name: "Add to the batch" }))
    expect(
      screen.getByRole("button", { name: "Preview the batch (1 change)" })
    ).toBeInTheDocument()
    pickDate("2026-12-31")
    expect(
      screen.getByText(
        "The change above isn’t in the batch yet. Add it, or it won’t be previewed."
      )
    ).toBeInTheDocument()
  })
})
