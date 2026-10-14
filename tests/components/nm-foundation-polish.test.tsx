import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BoundaryErrorState } from "@/components/app-shell/boundary"
import * as boundary from "@/components/app-shell/boundary"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { SelectionBar } from "@/components/ui/selection-bar"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { tabItemClassName, textTabItemClassName } from "@/components/ui/tabs"
import { FilterButton, Toolbar } from "@/components/ui/toolbar"
import { ViewHeader } from "@/components/ui/view-header"

afterEach(() => vi.unstubAllGlobals())

describe("ListRow item attributes (F1, F2)", () => {
  it("marks the whole item busy, not only the row", () => {
    render(
      <ListRows aria-label="Notifications">
        <ListRow busy title="Reply published" footer={<button>Undo</button>} />
        <ListRow title="Idle" />
      </ListRows>
    )
    const [busy, idle] = screen.getAllByRole("listitem")
    expect(busy).toHaveAttribute("aria-busy", "true")
    expect(idle).not.toHaveAttribute("aria-busy")
  })

  it("passes aria-busy and a data-slot through wrapperProps to the li", () => {
    render(
      <ListRows aria-label="Reviews">
        <ListRow
          title="Amelia Hart"
          wrapperProps={{ "aria-busy": true, "data-slot": "review-row-item" }}
        />
      </ListRows>
    )
    const item = screen.getByRole("listitem")
    expect(item).toHaveAttribute("aria-busy", "true")
    expect(item).toHaveAttribute("data-slot", "review-row-item")
  })

  it("keeps the list-row slot by default", () => {
    render(<ListRow title="One" />)
    expect(document.querySelector('[data-slot="list-row"]')).not.toBeNull()
  })

  it("bleeds a single row by PageFrame's phone padding too", () => {
    render(<ListRow bleed title="One" />)
    const row = document.querySelector('[data-slot="list-row"]')!
    expect(row.className).toContain("max-md:-mx-5")
    expect(row.className).toContain(
      "max-md:[--np-row-inset-start:calc(--spacing(5)+var(--np-avatar-list)+--spacing(3))]"
    )
  })
})

describe("ViewHeader on a narrow phone (F1, F5b)", () => {
  it("lets the actions wrap under the title below desk, never on a desk", () => {
    render(
      <ViewHeader
        title="Notifications"
        actions={<a href="/settings">Notification settings</a>}
      />
    )
    const header = document.querySelector('[data-slot="view-header"]')!
    expect(header.className).toContain("flex-wrap")
    expect(header.className).toContain("desk:flex-nowrap")
    const title = document.querySelector('[data-slot="view-header-title"]')!
    expect(title.className).toContain("basis-48")
    expect(title.className).toContain("desk:basis-0")
    const actions = document.querySelector('[data-slot="view-header-actions"]')!
    expect(actions.className).toContain("max-w-full")
    expect(actions.className).toContain("flex-wrap")
  })
})

describe("boundary (FOUNDATION-B)", () => {
  it("retires the unused title and eyebrow class exports", () => {
    expect(boundary).not.toHaveProperty("BOUNDARY_TITLE_CLASS")
    expect(boundary).not.toHaveProperty("BOUNDARY_EYEBROW_CLASS")
  })

  it("takes a custom second action in place of the home link", async () => {
    const back = vi.fn()
    render(
      <BoundaryErrorState
        title="The inbox hit an error"
        description="Nothing was sent."
        onReset={vi.fn()}
        secondaryAction={
          <button type="button" onClick={back}>
            Back to Inbox
          </button>
        }
      />
    )
    expect(screen.queryByRole("link")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Back to Inbox" }))
    expect(back).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible()
  })
})

describe("tabs (F2)", () => {
  it("draws aria-current=true like page, for tabs that are buttons", () => {
    for (const cls of [tabItemClassName, textTabItemClassName]) {
      expect(cls).toContain("aria-[current=true]:font-semibold")
      expect(cls).toContain("aria-[current=true]:text-ink")
      expect(cls).toContain("aria-[current=true]:after:bg-ink")
    }
  })
})

describe("Toolbar (F2)", () => {
  function mockTouch() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    )
  }

  it("does not take focus when it mounts in search mode with focusSearchOnMount={false}", () => {
    mockTouch()
    render(
      <Toolbar
        searchMode
        focusSearchOnMount={false}
        filter={<FilterButton />}
      />
    )
    expect(screen.getByRole("searchbox", { name: "Search" })).not.toHaveFocus()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  })

  it("still focuses the field when search mode is switched on later", async () => {
    mockTouch()
    function Harness() {
      const [mode, setMode] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setMode(true)}>
            Open search
          </button>
          <Toolbar
            searchMode={mode}
            onSearchModeChange={setMode}
            focusSearchOnMount={false}
          />
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByRole("button", { name: "Open search" }))
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus()
  })

  it("can draw the results label without a live region", () => {
    const { rerender } = render(<Toolbar resultsLabel="12 reviews" />)
    expect(screen.getByRole("status")).toHaveTextContent("12 reviews")
    rerender(<Toolbar resultsLabel="12 reviews" resultsLive={false} />)
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByText("12 reviews")).toHaveAttribute(
      "data-slot",
      "toolbar-results"
    )
  })
})

describe("SelectionBar spacer slot (F2)", () => {
  it("names the docked spacer as the caller asks", () => {
    render(
      <SelectionBar
        count={2}
        onCancel={() => {}}
        spacerSlot="review-bulk-spacer"
      />
    )
    expect(
      document.querySelector('[data-slot="review-bulk-spacer"]')
    ).toHaveAttribute("aria-hidden")
  })
})

describe("TableCell numeric on a record card (F5b)", () => {
  it("marks numeric cells so a record card sets them in sans", () => {
    render(
      <Table responsive aria-label="By location">
        <TableBody>
          <TableRow>
            <TableCell>The Bell</TableCell>
            <TableCell numeric label="Views">
              1,204
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const cell = screen.getByText("1,204")
    expect(cell).toHaveAttribute("data-numeric")
    // Mono stays for the table itself; the card drops it.
    expect(cell.className).toContain("font-mono")
    expect(screen.getByRole("table").className).toContain(
      "@max-3xl/table:[&_tbody>tr>td[data-numeric]]:font-sans"
    )
    expect(screen.getByText("The Bell")).not.toHaveAttribute("data-numeric")
  })
})
