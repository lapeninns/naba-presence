import { render, screen, within } from "@testing-library/react"
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
    resultLabel?: string
  } = {}
) {
  return render(
    <FilterToolbar
      state={{ ...baseState, ...overrides }}
      resultLabel={handlers.resultLabel ?? "12 reviews"}
      locations={LOCATIONS}
      showLocationFilter={handlers.showLocationFilter ?? true}
      onChange={handlers.onChange ?? (() => {})}
      onQueueChange={handlers.onQueueChange ?? (() => {})}
      onClear={handlers.onClear ?? (() => {})}
    />
  )
}

afterEach(() => vi.restoreAllMocks())

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Filters/ }))
  return screen.findByRole("dialog", { name: "Filters" })
}

describe("FilterToolbar — the filter end of the toolbar", () => {
  it("presents its controls as one labelled filter group", () => {
    renderToolbar()
    const group = screen.getByRole("group", { name: "Filter reviews" })
    expect(group).toHaveAttribute("data-slot", "inbox-filter-toolbar")
    // Age and sort are in the sheet alone: they used to be mounted a second
    // time here, hidden at every width, so nothing could reach them.
    expect(within(group).queryByRole("combobox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Filter by review age" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Sort reviews" })
    ).not.toBeInTheDocument()
    expect(
      within(group).getByRole("button", { name: /^Filters/ })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Filter by location" })
    ).not.toBeInTheDocument()
    // Rating is not a toolbar control at all: it is the chips above the list.
    expect(
      screen.queryByRole("group", { name: "Rating" })
    ).not.toBeInTheDocument()
  })

  it("keeps every narrowing in the sheet, so a phone loses nothing", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const sheet = await openSheet(user)
    expect(
      within(sheet).getByRole("radiogroup", { name: "Written review" })
    ).toBeInTheDocument()
    for (const name of [
      "Filter by location",
      "Filter by assignee",
      "Filter by review age",
      "Sort reviews",
    ]) {
      expect(within(sheet).getByRole("combobox", { name })).toBeInTheDocument()
    }
    expect(within(sheet).getByLabelText("From date")).toBeInTheDocument()
  })

  it("leaves rating, client and reply status out of the sheet", async () => {
    // Rating is one-tap chips above the list (QuickFilters), the client scope
    // is the app bar's, and the queue tabs already say which reviews are
    // waiting, so none of the three is repeated here.
    const user = userEvent.setup()
    renderToolbar()
    const sheet = await openSheet(user)
    expect(
      within(sheet).queryByRole("group", { name: "Rating" })
    ).not.toBeInTheDocument()
    expect(
      within(sheet).queryByRole("checkbox", { name: "5 stars" })
    ).not.toBeInTheDocument()
    expect(
      within(sheet).queryByRole("combobox", { name: "Filter by client" })
    ).not.toBeInTheDocument()
    expect(
      within(sheet).queryByRole("radiogroup", { name: "Reply status" })
    ).not.toBeInTheDocument()
  })

  it("chooses a venue from a select, which does not raise the keyboard", async () => {
    // The venue used to be a typeable combobox; it is a Select like the
    // assignee and the age, so there is no text field to focus.
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar({}, { onChange })
    const sheet = await openSheet(user)
    const venue = within(sheet).getByRole("combobox", {
      name: "Filter by location",
    })
    expect(venue).not.toHaveAttribute("contenteditable")
    expect(venue.tagName).toBe("BUTTON")
    expect(venue).toHaveTextContent("All venues")
    await user.click(venue)
    await user.click(
      await screen.findByRole("option", { name: "Harbourfront" })
    )
    expect(onChange).toHaveBeenCalledWith({ locationIds: ["loc-2"] })
  })

  it("clears the venue by choosing All venues", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderToolbar({ locationIds: ["loc-1"] }, { onChange })
    const sheet = await openSheet(user)
    const venue = within(sheet).getByRole("combobox", {
      name: "Filter by location",
    })
    expect(venue).toHaveTextContent("Riverside")
    await user.click(venue)
    await user.click(await screen.findByRole("option", { name: "All venues" }))
    expect(onChange).toHaveBeenCalledWith({ locationIds: [] })
  })

  it("hides the venue combobox for a single-location org", async () => {
    // The chip that clears a stale `?locationId=` lives in ActiveFilterChips,
    // not here, so this component simply drops the control.
    const user = userEvent.setup()
    renderToolbar({ locationIds: ["loc-1"] }, { showLocationFilter: false })
    const sheet = await openSheet(user)
    expect(
      within(sheet).queryByRole("combobox", { name: "Filter by location" })
    ).not.toBeInTheDocument()
    expect(
      within(sheet).queryByRole("heading", { name: "Venue" })
    ).not.toBeInTheDocument()
    expect(
      within(sheet).getByRole("radiogroup", { name: "Written review" })
    ).toBeInTheDocument()
  })

  it("shows no count on the Filters button when nothing narrows the list", () => {
    renderToolbar({ search: "breakfast", sort: "updated_asc" })
    const button = screen.getByRole("button", { name: /^Filters/ })
    expect(button).toHaveAccessibleName("Filters")
    expect(button).not.toHaveAttribute("data-active")
    expect(button.querySelector('[data-slot="filter-button-count"]')).toBeNull()
    expect(button).toHaveTextContent(/^$/)
  })

  it("counts each kind of narrowing the sheet holds that is on", () => {
    renderToolbar({
      written: "rating_only",
      locationIds: ["loc-1"],
      assignee: "me",
      dateFrom: "2026-07-01T00:00:00.000Z",
    })
    expect(
      screen.getByRole("button", { name: "Filters, 4 active" })
    ).toBeInTheDocument()
  })

  it("does not count the client scope, which lives in the app bar", () => {
    renderToolbar({ clientId: "c1" })
    const button = screen.getByRole("button", { name: /^Filters/ })
    expect(button).toHaveAccessibleName("Filters")
    expect(button).not.toHaveAttribute("data-active")
  })

  it("does not count what is one tap away above the list", () => {
    // Rating and "With text" are chips of their own and show their state
    // there, so the button would only repeat them as a number.
    renderToolbar({ ratings: [1, 2], written: "with_text" })
    expect(screen.getByRole("button", { name: "Filters" })).not.toHaveAttribute(
      "data-active"
    )
  })

  it("draws Filters as a circle whose icon takes the accent ink while any filter is on", () => {
    renderToolbar({ age: "7d" })
    const button = screen.getByRole("button", { name: "Filters, 1 active" })
    // The Toolbar's FilterButton (its slot name is the tooltip trigger's):
    // a circle the control height (44px on touch, the desk's there), marked
    // active.
    expect(button).toHaveAttribute("data-active")
    expect(button).toHaveClass(
      "rounded-(--np-radius-pill)",
      "size-(--np-control-h)"
    )
    expect(button.querySelector("svg")).toHaveClass("text-accent-ink")
    const badge = button.querySelector('[data-slot="filter-button-count"]')
    expect(badge).toHaveAttribute("aria-hidden", "true")
    expect(badge).toHaveTextContent("1")
    expect(badge).toHaveClass("text-count", "tabular-nums")
    expect(badge).not.toHaveClass("font-mono")
  })

  it("names the icon-only Filters button in a tooltip for a desk pointer", async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.hover(screen.getByRole("button", { name: "Filters" }))
    const tip = await screen.findByText("Filters", {
      selector: '[data-slot="tooltip-content"]',
    })
    expect(tip).toBeInTheDocument()
  })

  it("keeps the Filters icon in its own ink with nothing on", () => {
    renderToolbar()
    const button = screen.getByRole("button", { name: "Filters" })
    expect(button.querySelector("svg")).not.toHaveClass("text-accent-ink")
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
    const sheet = await openSheet(user)
    await user.click(
      within(sheet).getByRole("combobox", { name: "Filter by review age" })
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
    const sheet = await openSheet(user)
    await user.click(
      within(sheet).getByRole("combobox", { name: "Filter by review age" })
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
    await openSheet(user)
    await user.type(await screen.findByLabelText("From date"), "2026-07-01")
    expect(onChange).toHaveBeenCalledWith({
      dateFrom: "2026-07-01T00:00:00.000Z",
      age: undefined,
    })
  })

  it("warns in the panel that a date will replace an active age preset", async () => {
    const user = userEvent.setup()
    renderToolbar({ age: "7d" })
    await openSheet(user)
    expect(
      await screen.findByText("A date here replaces the Age preset.")
    ).toBeInTheDocument()
  })
})

describe("FiltersSheet — the sheet behind the Filters button", () => {
  async function openPanel(
    overrides: Partial<InboxState> = {},
    handlers: Parameters<typeof renderToolbar>[1] = {}
  ) {
    const user = userEvent.setup()
    renderToolbar(overrides, handlers)
    await openSheet(user)
    return user
  }

  it("is the full-height sheet on a phone and the edge panel from there up", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    )
    try {
      renderToolbar()
      const sheet = await openSheet(user)
      expect(sheet).toHaveAttribute("data-variant", "full")
      expect(sheet).toHaveAttribute("data-presentation", "sheet")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("stays the edge panel at the desk", async () => {
    const user = userEvent.setup()
    renderToolbar()
    const sheet = await openSheet(user)
    expect(sheet).toHaveAttribute("data-variant", "edge")
  })

  it("opens on demand and is closed until then", async () => {
    const user = userEvent.setup()
    renderToolbar()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const trigger = screen.getByRole("button", { name: /^Filters/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    await user.click(trigger)
    expect(
      await screen.findByRole("dialog", { name: "Filters" })
    ).toBeInTheDocument()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
  })

  it("groups its controls under headings, without the retired pipeline filters", async () => {
    await openPanel()
    expect(screen.getByLabelText("From date")).toBeInTheDocument()
    expect(screen.getByLabelText("To date")).toBeInTheDocument()
    for (const title of [
      "Written review",
      "Venue",
      "Assigned to",
      "Age",
      "Date range",
      "Sort",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument()
    }
    // Each filter keeps a group name without a landmark per section: a group
    // named by its heading, or (Written review) the control's own named
    // group, never both.
    const sheet = screen.getByRole("dialog", { name: "Filters" })
    for (const title of ["Venue", "Assigned to", "Age", "Date range", "Sort"]) {
      expect(within(sheet).getByRole("group", { name: title })).toBeVisible()
    }
    expect(
      within(sheet).queryAllByRole("group", { name: "Rating" })
    ).toHaveLength(0)
    expect(within(sheet).queryAllByRole("region")).toHaveLength(0)
    // The pipeline-state checkboxes and the saved presets stay gone: the
    // first filtered on a record's place in the publish pipeline, the second
    // duplicated controls already on the toolbar.
    for (const title of ["Workflow", "Saved presets"]) {
      expect(
        screen.queryByRole("heading", { name: title })
      ).not.toBeInTheDocument()
    }
  })

  it("has no client select: the scope lives only in the app bar", async () => {
    await openPanel({ clientId: "c1" })
    expect(
      screen.queryByRole("combobox", { name: "Filter by client" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Client" })
    ).not.toBeInTheDocument()
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
    const user = await openPanel({ age: "7d" }, { onClear })
    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(onClear).toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Show 12 reviews" }))
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
  })

  it("offers Clear only when a filter is on, and keeps focus in the sheet", async () => {
    const onClear = vi.fn()
    const user = await openPanel({ age: "7d" }, { onClear })
    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
    // The button that shows the result takes focus from the Clear that goes.
    expect(
      screen.getByRole("button", { name: "Show 12 reviews" })
    ).toHaveFocus()
  })

  it("has no Clear with nothing to clear, and says where the ratings are", async () => {
    await openPanel()
    const sheet = screen.getByRole("dialog", { name: "Filters" })
    expect(
      within(sheet).queryByRole("button", { name: "Clear all filters" })
    ).not.toBeInTheDocument()
    expect(sheet).toHaveAccessibleDescription(
      "Changes apply as you make them. Star ratings are the chips above the list."
    )
  })

  it("says the live result count on its closing button and aloud", async () => {
    // The count comes from the list itself (InboxToolbar's `resultLabel`),
    // so the sheet follows each change as the query settles.
    const user = userEvent.setup()
    const { rerender } = renderToolbar({}, { resultLabel: "Loading reviews…" })
    const sheet = await openSheet(user)
    expect(
      within(sheet).getByRole("button", { name: "Loading reviews…" })
    ).toBeInTheDocument()
    // The loading state is shown, not announced after every tap.
    expect(within(sheet).getByRole("status")).toHaveTextContent(/^$/)

    rerender(
      <FilterToolbar
        state={baseState}
        resultLabel="50 reviews so far"
        locations={LOCATIONS}
        showLocationFilter
        onChange={() => {}}
        onQueueChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(
      within(sheet).getByRole("button", { name: "Show 50+ reviews" })
    ).toBeInTheDocument()
    expect(within(sheet).getByRole("status")).toHaveTextContent(
      "50 reviews so far"
    )
  })

  it("narrows to rating-only reviews from the written-review group", async () => {
    const onChange = vi.fn()
    const user = await openPanel({}, { onChange })
    const group = screen.getByRole("radiogroup", { name: "Written review" })
    expect(within(group).getByRole("radio", { name: "Any" })).toBeChecked()
    await user.click(within(group).getByRole("radio", { name: "Rating only" }))
    expect(onChange).toHaveBeenCalledWith({ written: "rating_only" })
  })
})
