import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { Breadcrumbs } from "@/components/ui/breadcrumb"
import { RemovableChip, ToggleChip } from "@/components/ui/chip"
import { DataTable } from "@/components/ui/data-table"
import { DiffView } from "@/components/ui/diff-view"
import { KpiTile } from "@/components/ui/kpi-tile"
import { StatusPill } from "@/components/ui/status-pill"
import { Stepper } from "@/components/ui/stepper"
import { Timeline } from "@/components/ui/timeline"

describe("Breadcrumbs", () => {
  const crumbs = [
    { label: "Clients", href: "/clients" },
    { label: "Old Crown Group", href: "/clients/c1" },
    { label: "Hours" },
  ]

  it("marks only the last crumb as the current page", () => {
    render(<Breadcrumbs crumbs={crumbs} />)
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(nav).toBeInTheDocument()
    expect(screen.getByText("Hours")).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "href",
      "/clients"
    )
  })

  it("adds no heading, so the page keeps a single h1", () => {
    // `heading-order` and `page-has-heading-one` are pinned axe rules; a
    // breadcrumb heading would sit above the page's own h1.
    const { container } = render(<Breadcrumbs crumbs={crumbs} />)
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
  })

  it("renders nothing when there is no trail", () => {
    const { container } = render(<Breadcrumbs crumbs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("StatusPill", () => {
  it("always carries a label, so colour is never the only signal", () => {
    render(<StatusPill tone="at-risk">Disconnected</StatusPill>)
    expect(screen.getByText("Disconnected")).toBeInTheDocument()
  })

  it("exposes the tone for styling without encoding meaning in a class", () => {
    render(<StatusPill tone="healthy">Healthy</StatusPill>)
    expect(screen.getByText("Healthy").closest("[data-slot]")).toHaveAttribute(
      "data-tone",
      "healthy"
    )
  })
})

describe("Stepper", () => {
  const steps = [
    { id: "a", label: "Agency", state: "done" as const },
    { id: "b", label: "Client", state: "current" as const, meta: "In progress" },
    { id: "c", label: "Connect", state: "todo" as const },
  ]

  it("marks the active step and nothing else", () => {
    render(<Stepper steps={steps} />)
    const items = screen.getAllByRole("listitem")
    expect(items.filter((item) => item.getAttribute("aria-current") === "step")).toHaveLength(1)
    expect(items[1]).toHaveAttribute("aria-current", "step")
  })

  it("states each step in text rather than by colour", () => {
    render(<Stepper steps={steps} />)
    expect(screen.getByText("In progress")).toBeInTheDocument()
  })
})

describe("Timeline", () => {
  it("renders entries in order without adding headings", () => {
    const { container } = render(
      <Timeline
        entries={[
          { id: "1", title: "Reply published", meta: "Aman · 12 min ago" },
          { id: "2", title: "Draft generated", meta: "AI · 25 min ago" },
        ]}
      />
    )
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
  })
})

describe("KpiTile", () => {
  it("labels the figure without spending a heading on it", () => {
    // Four tiles in a row would otherwise put four h2s under the page h1.
    const { container } = render(
      <KpiTile label="Needs reply" value="12" hint="Oldest 2 days" />
    )
    expect(screen.getByText("Needs reply")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
  })
})

describe("chips", () => {
  it("reports toggle state through aria-pressed", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <ToggleChip pressed onClick={onClick}>
        Oldest first
      </ToggleChip>
    )
    const chip = screen.getByRole("button", { name: "Oldest first" })
    expect(chip).toHaveAttribute("aria-pressed", "true")
    await user.click(chip)
    expect(onClick).toHaveBeenCalled()
  })

  it("names what a remove button removes", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <RemovableChip onRemove={onRemove} removeLabel="Remove the rating filter">
        1–2 stars
      </RemovableChip>
    )
    await user.click(screen.getByRole("button", { name: "Remove the rating filter" }))
    expect(onRemove).toHaveBeenCalled()
  })
})

describe("DataTable", () => {
  type Row = { id: string; name: string }
  const rows: Row[] = [
    { id: "1", name: "Old Crown Girton" },
    { id: "2", name: "Old Crown Histon" },
  ]
  const columns = [
    { id: "name", header: "Location", cell: (row: Row) => row.name },
  ]

  it("names the table so several on one page are distinguishable", () => {
    render(
      <DataTable caption="Locations in this client" columns={columns} rows={rows} rowId={(row) => row.id} />
    )
    expect(screen.getByRole("table", { name: "Locations in this client" })).toBeInTheDocument()
  })

  it("selects one row without touching the others", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DataTable
        caption="Locations"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        selection={{
          selected: new Set<string>(),
          onChange,
          label: (row) => `Select ${row.name}`,
        }}
      />
    )
    await user.click(screen.getByRole("checkbox", { name: "Select Old Crown Girton" }))
    expect(onChange).toHaveBeenCalledWith(new Set(["1"]))
  })

  it("selects only the rows currently shown", async () => {
    // Select-all must never reach a row the operator has filtered away.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DataTable
        caption="Locations"
        columns={columns}
        rows={[rows[0]]}
        rowId={(row) => row.id}
        selection={{
          selected: new Set<string>(),
          onChange,
          label: (row) => `Select ${row.name}`,
        }}
      />
    )
    await user.click(screen.getByRole("checkbox", { name: "Select all 1 rows" }))
    expect(onChange).toHaveBeenCalledWith(new Set(["1"]))
  })

  it("renders the empty state instead of a headerless table", () => {
    render(
      <DataTable
        caption="Locations"
        columns={columns}
        rows={[]}
        rowId={(row) => row.id}
        empty={<p>No locations yet</p>}
      />
    )
    expect(screen.getByText("No locations yet")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })
})

describe("DiffView", () => {
  it("pairs each field with its before and after in one row", () => {
    render(
      <DiffView
        caption="Changes to Old Crown Girton"
        rows={[
          { field: "Phone", before: "01223 277 217", after: "01223 277 218", state: "conflict" },
        ]}
      />
    )
    const row = screen.getByText("Phone").closest("tr")!
    expect(row).toHaveTextContent("01223 277 217")
    expect(row).toHaveTextContent("01223 277 218")
    // A field Google changed underneath the draft says so, because publishing
    // it overwrites someone else's edit.
    expect(row).toHaveTextContent("Changed on Google")
  })

  it("says when a value is absent rather than showing a blank cell", () => {
    render(
      <DiffView
        caption="Changes"
        rows={[{ field: "Secondary category", before: null, after: "Gastropub" }]}
      />
    )
    expect(screen.getByText("Not set")).toBeInTheDocument()
  })
})
