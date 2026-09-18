import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FilterToolbar } from "@/components/inbox/filter-toolbar"
import type { InboxState } from "@/lib/inbox/url-state"

const baseState: InboxState = {
  queue: "needs_reply",
  locationIds: [],
  ratings: [],
  search: "",
  sort: "updated_desc",
}

const LOCATIONS = [
  { id: "loc-1", name: "Riverside" },
  { id: "loc-2", name: "Harbourfront" },
]

function renderToolbar(
  overrides: Partial<InboxState> = {},
  handlers: {
    onChange?: (partial: Partial<InboxState>) => void
    onQueueChange?: (queue: InboxState["queue"]) => void
    onClear?: () => void
    showLocationFilter?: boolean
    clients?: { id: string; name: string }[]
  } = {}
) {
  return render(
    <FilterToolbar
      state={{ ...baseState, ...overrides }}
      locations={LOCATIONS}
      clients={handlers.clients ?? []}
      showLocationFilter={handlers.showLocationFilter ?? true}
      onChange={handlers.onChange ?? (() => {})}
      onQueueChange={handlers.onQueueChange ?? (() => {})}
      onClear={handlers.onClear ?? (() => {})}
    />
  )
}

afterEach(() => vi.restoreAllMocks())

describe("FilterToolbar — the line above the panes", () => {
  it("presents its controls as one labelled filter group", () => {
    renderToolbar()
    const group = screen.getByRole("group", { name: "Filter reviews" })
    expect(group).toHaveAttribute("data-slot", "inbox-filter-toolbar")
    expect(
      screen.getByRole("combobox", { name: "Filter by location" })
    ).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Rating" })).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Filter by assignee" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Filter by review age" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /More filters/ })
    ).toBeInTheDocument()
    // Each control is named on screen too, not only to assistive tech.
    for (const label of ["Venue", "Rating", "Assigned", "Age"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it("hides the venue combobox for a single-location org", () => {
    // The chip that clears a stale `?locationId=` lives in ActiveFilterChips,
    // not here, so this component simply drops the control.
    renderToolbar({ locationIds: ["loc-1"] }, { showLocationFilter: false })
    expect(
      screen.queryByRole("combobox", { name: "Filter by location" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Venue")).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Rating" })).toBeInTheDocument()
  })

  it("keeps the rating stars visible without opening any panel", () => {
    renderToolbar()
    for (const name of ["5 stars", "4 stars", "3 stars", "2 stars", "1 star"]) {
      expect(screen.getByRole("checkbox", { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("toggles a star rating into the URL state", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar({}, { onChange })
    await user.click(screen.getByRole("checkbox", { name: "5 stars" }))
    expect(onChange).toHaveBeenCalledWith({ ratings: [5] })
  })

  it("supports multi-star ratings from Home deep-links", async () => {
    // components/home/attention-list.tsx links to /inbox?rating=1,2, so the
    // control has to render several checked stars and clear them one at a time.
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar({ ratings: [1, 2] }, { onChange })
    expect(screen.getByRole("checkbox", { name: "1 star" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "2 stars" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "5 stars" })).not.toBeChecked()
    await user.click(screen.getByRole("checkbox", { name: "1 star" }))
    expect(onChange).toHaveBeenCalledWith({ ratings: [2] })
  })

  it("does not count the always-visible rating toward the More filters badge", () => {
    renderToolbar({ ratings: [3] })
    expect(
      screen.getByRole("button", { name: /More filters/ })
    ).not.toHaveTextContent("1")
  })

  it("counts what is actually behind More filters on its badge", () => {
    renderToolbar({
      clientId: "c1",
      replyState: "unreplied",
      dateFrom: "2026-07-01T00:00:00.000Z",
    })
    expect(
      screen.getByRole("button", { name: /More filters/ })
    ).toHaveTextContent("3")
  })
})

describe("FilterToolbar — Waiting on", () => {
  it("offers the ownership control only inside Approval", () => {
    renderToolbar({ queue: "needs_reply" })
    expect(
      screen.queryByRole("combobox", { name: "Approval waiting on" })
    ).not.toBeInTheDocument()
  })

  it("preselects the owner a legacy approval deep-link already names", () => {
    // `?queue=awaiting_my_approval` predates the Approval aggregate and must
    // keep working: it lights the Approval control with "Waiting on: Me".
    renderToolbar({ queue: "awaiting_my_approval" })
    expect(
      screen.getByRole("combobox", { name: "Approval waiting on" })
    ).toHaveTextContent("Me")
  })

  it("writes the owner as a queue rather than a second parameter", async () => {
    // The two narrow queues already carry the ownership rule the server
    // evaluates, so routing the control through them keeps one definition of
    // "waiting on me" and adds nothing new to the URL.
    const user = userEvent.setup()
    const onQueueChange = vi.fn()
    const onChange = vi.fn()
    renderToolbar({ queue: "approval" }, { onQueueChange, onChange })
    const owner = screen.getByRole("combobox", { name: "Approval waiting on" })
    await user.click(owner)
    await user.click(await screen.findByRole("option", { name: "Me" }))
    expect(onQueueChange).toHaveBeenCalledWith("awaiting_my_approval")

    await user.click(owner)
    await user.click(await screen.findByRole("option", { name: "Others" }))
    expect(onQueueChange).toHaveBeenCalledWith("awaiting_others")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("returns to the Approval aggregate when the owner is cleared", async () => {
    const user = userEvent.setup()
    const onQueueChange = vi.fn()
    renderToolbar({ queue: "awaiting_others" }, { onQueueChange })
    await user.click(
      screen.getByRole("combobox", { name: "Approval waiting on" })
    )
    await user.click(await screen.findByRole("option", { name: "Anyone" }))
    expect(onQueueChange).toHaveBeenCalledWith("approval")
  })
})

describe("FilterToolbar — age and custom dates", () => {
  it("expands the age presets the URL understands", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar({}, { onChange })
    await user.click(
      screen.getByRole("combobox", { name: "Filter by review age" })
    )
    await user.click(await screen.findByRole("option", { name: "Last 7 days" }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ age: "7d" })
    )
  })

  it("clears a custom range when an age preset is chosen", async () => {
    // Both controls narrow the same two columns, and left to themselves they
    // produce a filter set nobody chose — "last 24 hours" AND "1–31 July" is
    // empty while neither control looks wrong. See lib/inbox/review-age.ts.
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar(
      {
        dateFrom: "2026-07-01T00:00:00.000Z",
        dateTo: "2026-07-31T00:00:00.000Z",
      },
      { onChange }
    )
    await user.click(
      screen.getByRole("combobox", { name: "Filter by review age" })
    )
    await user.click(
      await screen.findByRole("option", { name: "Last 24 hours" })
    )
    expect(onChange).toHaveBeenCalledWith({
      age: "24h",
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it("clears the age preset when a custom date is typed", async () => {
    // The mirror of the case above, and the reason the relationship is stated
    // in one place: a date is the more specific claim, so it wins.
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar({ age: "7d" }, { onChange })
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    await user.type(await screen.findByLabelText("From date"), "2026-07-01")
    expect(onChange).toHaveBeenCalledWith({
      dateFrom: "2026-07-01T00:00:00.000Z",
      age: undefined,
    })
  })

  it("warns in the panel that a date will replace an active age preset", async () => {
    const user = userEvent.setup()
    renderToolbar({ age: "7d" })
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    expect(
      await screen.findByText(
        "A date here replaces the Age preset in the toolbar."
      )
    ).toBeInTheDocument()
  })
})

describe("MoreFiltersPanel — what the toolbar keeps off screen", () => {
  async function openPanel(
    overrides: Partial<InboxState> = {},
    handlers: Parameters<typeof renderToolbar>[1] = {}
  ) {
    const user = userEvent.setup()
    renderToolbar(overrides, handlers)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    await screen.findByRole("dialog", { name: "More filters" })
    return user
  }

  it("opens on demand and is closed until then", async () => {
    const user = userEvent.setup()
    renderToolbar()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const trigger = screen.getByRole("button", { name: /More filters/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    await user.click(trigger)
    expect(
      await screen.findByRole("dialog", { name: "More filters" })
    ).toBeInTheDocument()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
  })

  it("holds the reply status and date controls, and nothing else", async () => {
    await openPanel()
    expect(
      screen.getByRole("radiogroup", { name: "Reply state" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("From date")).toBeInTheDocument()
    expect(screen.getByLabelText("To date")).toBeInTheDocument()
    for (const title of ["Reply status", "Date range"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument()
    }
    // The pipeline-state checkboxes and the saved presets are gone: the first
    // filtered on a record's place in the publish pipeline, the second
    // duplicated controls already on the toolbar.
    for (const title of ["Workflow", "Saved presets"]) {
      expect(
        screen.queryByRole("heading", { name: title })
      ).not.toBeInTheDocument()
    }
  })

  it("scopes by client only for an agency with more than one", async () => {
    await openPanel()
    expect(
      screen.queryByRole("combobox", { name: "Filter by client" })
    ).not.toBeInTheDocument()

    const onChange = vi.fn()
    const user = await openPanel(
      {},
      {
        onChange,
        clients: [
          { id: "c1", name: "Lapen Inns" },
          { id: "c2", name: "Harbour Group" },
        ],
      }
    )
    const scope = screen.getByRole("combobox", { name: "Filter by client" })
    await user.click(scope)
    await user.click(
      await screen.findByRole("option", { name: "Harbour Group" })
    )
    expect(onChange).toHaveBeenCalledWith({ clientId: "c2" })
  })

  it("reflects an already-active date range from the URL in the inputs", async () => {
    await openPanel({
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-15T00:00:00.000Z",
    })
    expect(screen.getByLabelText("From date")).toHaveValue("2026-07-01")
    expect(screen.getByLabelText("To date")).toHaveValue("2026-07-15")
  })

  it("flags an inverted range instead of silently querying nothing", async () => {
    await openPanel({
      dateFrom: "2026-07-15T00:00:00.000Z",
      dateTo: "2026-07-01T00:00:00.000Z",
    })
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The end date must be on or after the start date."
    )
  })

  it("clears every filter and closes from the panel footer", async () => {
    const onClear = vi.fn()
    const user = await openPanel({ replyState: "unreplied" }, { onClear })
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onClear).toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(
      screen.getByRole("button", { name: /More filters/ })
    ).toHaveAttribute("aria-expanded", "false")
  })
})
