import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CheckIcon, LayersIcon } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ListRow, ListRowTag, ListRows } from "@/components/ui/list-row"
import {
  SelectionBar,
  SelectionBarLinkTile,
  SelectionBarTile,
} from "@/components/ui/selection-bar"
import {
  SettingsDestructiveAction,
  SettingsGroup,
  SettingsRow,
} from "@/components/ui/settings-row"
import { FilterButton, Toolbar } from "@/components/ui/toolbar"

afterEach(() => vi.restoreAllMocks())

describe("ListRow drop 4 (F6)", () => {
  it("draws the footer as a block div that can hold a form and a dl", () => {
    render(
      <ListRow
        interactive={false}
        title="PIN"
        footerLayout="stack"
        footer={
          <>
            <form aria-label="Enter PIN">
              <input aria-label="PIN" />
            </form>
            <dl>
              <dt>Sent</dt>
              <dd>Today</dd>
            </dl>
          </>
        }
      />
    )
    const footer = document.querySelector('[data-slot="list-row-footer"]')!
    expect(footer.tagName).toBe("DIV")
    expect(footer).toHaveAttribute("data-layout", "stack")
    expect(footer.className).toContain("flex-col")
    expect(footer.closest('[data-slot="list-row-hit"]')).toBeNull()
    expect(
      within(footer as HTMLElement).getByRole("form", { name: "Enter PIN" })
    ).toBeInTheDocument()
    expect(footer.querySelector("dl")).not.toBeNull()
  })

  it("keeps the default footer a wrapping row", () => {
    render(
      <ListRow interactive={false} title="A" footer={<button>Go</button>} />
    )
    const footer = document.querySelector('[data-slot="list-row-footer"]')!
    expect(footer.className).toContain("flex-wrap")
    expect(footer).toHaveAttribute("data-layout", "row")
  })

  it("draws a real heading on a non-interactive row, with no span around it", () => {
    render(
      <ListRow
        interactive={false}
        titleAs="h2"
        titleId="area-profile"
        title="Profile"
        subtitle="3 fields"
      />
    )
    const heading = screen.getByRole("heading", { level: 2, name: "Profile" })
    expect(heading.tagName).toBe("H2")
    expect(heading).toHaveAttribute("id", "area-profile")
    let parent = heading.parentElement
    while (parent && parent.dataset.slot !== "list-row-hit") {
      expect(parent.tagName).not.toBe("SPAN")
      parent = parent.parentElement
    }
    expect(parent?.tagName).toBe("DIV")
  })

  it("draws a heading inside a link row (an <a> is transparent)", () => {
    render(<ListRow href="/listings/1" titleAs="h3" title="The Bell" />)
    const link = screen.getByRole("link")
    expect(
      within(link).getByRole("heading", { level: 3, name: "The Bell" })
    ).toBeInTheDocument()
  })

  it("refuses a heading inside a button row, with a dev warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    render(<ListRow titleAs="h2" title="Open" />)
    expect(screen.queryByRole("heading")).toBeNull()
    expect(
      document.querySelector('[data-slot="list-row-title"]')!.tagName
    ).toBe("SPAN")
    expect(warn).toHaveBeenCalled()
  })

  it("refuses a heading inside a listbox option", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    render(
      <ListRows listbox aria-label="Rows">
        <ListRow interactive={false} titleAs="h2" title="A" />
      </ListRows>
    )
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("wraps title and subtitle instead of truncating with `wrap`", () => {
    render(
      <ListRow
        interactive={false}
        wrap
        title="a.very.long.admin.address@example.com"
        subtitle="another.very.long.address@example.com"
      />
    )
    const title = document.querySelector('[data-slot="list-row-title"]')!
    const subtitle = document.querySelector('[data-slot="list-row-subtitle"]')!
    for (const el of [title, subtitle]) {
      expect(el.className).toContain("wrap-anywhere")
      expect(el.className).not.toContain("truncate")
    }
  })

  it("truncates by default", () => {
    render(<ListRow title="A" subtitle="B" />)
    expect(
      document.querySelector('[data-slot="list-row-title"]')!.className
    ).toContain("truncate")
    expect(
      document.querySelector('[data-slot="list-row-subtitle"]')!.className
    ).toContain("truncate")
  })
})

describe("ListRowTag tones (F6)", () => {
  it("has an on-image tone: surface, full ink, raised shadow", () => {
    render(<ListRowTag tone="on-image">Logo</ListRowTag>)
    const tag = screen.getByText("Logo")
    expect(tag).toHaveAttribute("data-tone", "on-image")
    expect(tag.className).toContain("bg-surface")
    expect(tag.className).toContain("text-ink")
    expect(tag.className).toContain("shadow-np-raised")
  })

  it("has an accent tone: accent-ink on accent-tint", () => {
    render(<ListRowTag tone="accent">Customer</ListRowTag>)
    const tag = screen.getByText("Customer")
    expect(tag.className).toContain("bg-accent-tint")
    expect(tag.className).toContain("text-accent-ink")
  })
})

describe("SettingsGroup drop 4 (F6)", () => {
  it("takes a caller labelId and names its list", () => {
    render(
      <SettingsGroup
        label="Danger zone"
        labelId="danger-zone-heading"
        listProps={{ "aria-label": "Danger zone actions" }}
      >
        <SettingsRow label="Name" value="The Bell" />
      </SettingsGroup>
    )
    const heading = screen.getByRole("heading", { name: "Danger zone" })
    expect(heading).toHaveAttribute("id", "danger-zone-heading")
    expect(
      document.querySelector('[data-slot="settings-group"]')
    ).toHaveAttribute("aria-labelledby", "danger-zone-heading")
    expect(
      screen.getByRole("list", { name: "Danger zone actions" })
    ).toBeInTheDocument()
  })

  it("headingId wins over labelId", () => {
    render(
      <SettingsGroup label="X" labelId="b" headingId="a">
        <SettingsRow label="Name" value="v" />
      </SettingsGroup>
    )
    expect(screen.getByRole("heading", { name: "X" })).toHaveAttribute(
      "id",
      "a"
    )
  })

  it("keeps the label at text-caption medium muted ink (D8)", () => {
    render(
      <SettingsGroup label="Areas">
        <SettingsRow label="Name" value="v" />
      </SettingsGroup>
    )
    const label = screen.getByRole("heading", { name: "Areas" })
    expect(label.className).toContain("text-caption")
    expect(label.className).toContain("font-medium")
    expect(label.className).toContain("text-ink-muted")
  })

  it("renders a div body with div rows for a one-card group", () => {
    render(
      <SettingsGroup label="Compose" bodyAs="div">
        <SettingsRow label="Name" value="The Bell" />
        <SettingsDestructiveAction asRow>Remove</SettingsDestructiveAction>
      </SettingsGroup>
    )
    expect(screen.queryByRole("list")).toBeNull()
    expect(screen.queryByRole("listitem")).toBeNull()
    const body = document.querySelector('[data-slot="settings-group-rows"]')!
    expect(body.tagName).toBe("DIV")
    for (const row of body.children) expect(row.tagName).toBe("DIV")
  })
})

describe("SettingsRow footnote (F6)", () => {
  it("draws a note under the row and describes the control with it", () => {
    render(
      <SettingsGroup label="G">
        <SettingsRow
          label="Transfer"
          onClick={() => {}}
          disabled
          footnote="Only an owner can transfer this listing."
          footnoteProps={{ role: "note" }}
        />
      </SettingsGroup>
    )
    const note = screen.getByRole("note")
    expect(note).toHaveTextContent("Only an owner can transfer this listing.")
    expect(note.closest("li")).not.toBeNull()
    const button = screen.getByRole("button", { name: "Transfer" })
    expect(button).toHaveAccessibleDescription(
      "Only an owner can transfer this listing."
    )
  })
})

describe("SettingsDestructiveAction asRow (F6)", () => {
  it("is an li row in a list group, with a footnote", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <SettingsGroup
        label="Danger zone"
        listProps={{ "aria-label": "Danger zone actions" }}
      >
        <SettingsDestructiveAction
          asRow
          onClick={onClick}
          footnote="Removing needs owner access."
          footnoteProps={{ role: "note" }}
        >
          Remove listing
        </SettingsDestructiveAction>
      </SettingsGroup>
    )
    const list = screen.getByRole("list", { name: "Danger zone actions" })
    const item = within(list).getByRole("listitem")
    expect(item).toHaveAttribute("data-kind", "destructive")
    const button = within(item).getByRole("button", { name: "Remove listing" })
    expect(button).toHaveAccessibleDescription("Removing needs owner access.")
    expect(within(item).getByRole("note")).toBeInTheDocument()
    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("stays the page's closing button by default", () => {
    render(<SettingsDestructiveAction>Disconnect</SettingsDestructiveAction>)
    const wrap = document.querySelector('[data-slot="settings-destructive"]')!
    expect(wrap.tagName).toBe("DIV")
    expect(wrap.className).toContain("mt-8")
  })
})

describe("SelectionBar drop 4 (F6)", () => {
  it("has an accent link tile that navigates (a local step, not a write)", () => {
    render(
      <SelectionBar count={2} onCancel={() => {}}>
        <SelectionBarTile icon={<CheckIcon aria-hidden />} label="Done" />
        <SelectionBarLinkTile
          href="/listings/bulk?ids=l1,l2"
          icon={<LayersIcon aria-hidden />}
          label="Prepare bulk change"
        />
      </SelectionBar>
    )
    const toolbar = screen.getByRole("toolbar", { name: "Actions" })
    const link = within(toolbar).getByRole("link", {
      name: "Prepare bulk change",
    })
    expect(link).toHaveAttribute("href", "/listings/bulk?ids=l1,l2")
    expect(link).toHaveAttribute("data-tone", "accent")
    expect(link.className).toContain("bg-accent-tint")
    expect(link.className).toContain("text-accent-ink")
    expect(link.className).toContain("min-h-16")
  })

  it("offers an accent tone on a button tile", () => {
    render(
      <SelectionBar count={1} onCancel={() => {}}>
        <SelectionBarTile tone="accent" label="Next" />
      </SelectionBar>
    )
    expect(screen.getByRole("button", { name: "Next" })).toHaveAttribute(
      "data-tone",
      "accent"
    )
  })

  it("can give the docked spacer the shared action-bar slot", () => {
    render(
      <SelectionBar
        count={1}
        onCancel={() => {}}
        spacerSlot="action-bar-spacer"
      />
    )
    const bar = document.querySelector('[data-slot="selection-bar"]')!
    expect(bar.previousElementSibling).toHaveAttribute(
      "data-slot",
      "action-bar-spacer"
    )
  })

  it("keeps the selection-bar spacer slot by default", () => {
    render(<SelectionBar count={1} onCancel={() => {}} />)
    const bar = document.querySelector('[data-slot="selection-bar"]')!
    expect(bar.previousElementSibling).toHaveAttribute(
      "data-slot",
      "selection-bar-spacer"
    )
  })
})

describe("Toolbar drop 4 (F6)", () => {
  it("names the search landmark", () => {
    render(<Toolbar searchRegionLabel="Filter listings" />)
    expect(
      screen.getByRole("search", { name: "Filter listings" })
    ).toBeInTheDocument()
  })

  it("leaves the landmark unnamed by default", () => {
    render(<Toolbar />)
    expect(screen.getByRole("search")).not.toHaveAttribute("aria-label")
  })

  it("can drop the search field for a filters-only toolbar", () => {
    render(
      <Toolbar
        search={false}
        filter={<FilterButton />}
        view={<button type="button">Grid</button>}
      />
    )
    expect(screen.queryByRole("search")).toBeNull()
    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Grid" })).toBeInTheDocument()
  })

  it("lets the view slot wrap below the field instead of squeezing it", () => {
    render(
      <Toolbar
        filter={<FilterButton />}
        view={<button type="button">Order</button>}
      />
    )
    const row = document.querySelector('[data-slot="toolbar-row"]')!
    expect(row.className).toContain("flex-wrap")
    const field = document.querySelector('[data-slot="toolbar-search"]')!
    expect(field.className).toContain("basis-48")
    expect(field.className).toContain("flex-1")
  })
})
