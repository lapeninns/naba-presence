import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"

type Client = { id: string; name: string; health: string; sync: string }

const ROWS: Client[] = [
  { id: "c1", name: "Old Crown Group", health: "Healthy", sync: "2h ago" },
  { id: "c2", name: "Barley Mow", health: "Needs attention", sync: "1d ago" },
]

const COLUMNS: DataTableColumn<Client>[] = [
  {
    id: "avatar",
    header: "",
    priority: "leading",
    cell: (row) => <span aria-hidden>{row.name[0]}</span>,
  },
  {
    id: "name",
    header: "Client",
    priority: "primary",
    cell: (row) => <a href={`/clients/${row.id}`}>{row.name}</a>,
  },
  {
    id: "health",
    header: "Health",
    priority: "secondary",
    cell: (row) => row.health,
  },
  {
    id: "sync",
    header: "Last sync",
    priority: "meta",
    cell: (row) => row.sync,
  },
]

describe('DataTable responsive="list" (F5 R1)', () => {
  it("keeps the table, its caption and every td[data-priority]", () => {
    render(
      <DataTable
        caption="Clients"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        responsive="list"
      />
    )
    const table = screen.getByRole("table", { name: "Clients" })
    expect(table).toHaveAttribute("data-responsive", "list")
    const [first] = within(table).getAllByRole("row").slice(1)
    const cells = within(first).getAllByRole("cell")
    expect(cells.map((cell) => cell.getAttribute("data-priority"))).toEqual([
      "leading",
      "primary",
      "secondary",
      "meta",
    ])
    expect(cells[3]).toHaveAttribute("data-label", "Last sync")
    // The name link stays the keyboard and screen-reader path.
    expect(
      within(first).getByRole("link", { name: "Old Crown Group" })
    ).toHaveAttribute("href", "/clients/c1")
  })

  it("draws list-row anatomy on a phone: page padding, inset hairline, leading column, no card edge", () => {
    render(
      <DataTable
        caption="Clients"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        responsive="list"
        surface
        bleed
      />
    )
    const table = screen.getByRole("table", { name: "Clients" })
    const classes = table.className
    // Still the record-card frame underneath.
    expect(classes).toContain("@max-3xl/table:[&_tbody>tr]:flex")
    // The mail row's padding and touch floor.
    expect(classes).toContain(
      "@max-3xl/table:[&_tbody>tr]:px-(--np-page-pad-x)"
    )
    expect(classes).toContain(
      "@max-3xl/table:[&_tbody>tr]:py-(--np-row-mail-py)"
    )
    expect(classes).toContain("@max-3xl/table:[&_tbody>tr]:min-h-(--np-touch)")
    // No card edge between records; a line-subtle hairline instead, inset
    // to the text column and never under the last row.
    expect(classes).toContain("@max-3xl/table:[&_tbody>tr]:border-b-0")
    expect(classes).toContain("var(--color-line-subtle)")
    expect(classes).toContain(
      "@max-3xl/table:[&_tbody>tr:has(>td[data-priority=leading])]:ps-(--np-row-inset-start)"
    )
    expect(classes).toContain(
      "@max-3xl/table:[&_tbody>tr:last-child]:[background-image:none]"
    )
    // The avatar sits in the --np-avatar-list column.
    expect(classes).toContain(
      "@max-3xl/table:[&_tbody>tr>td[data-priority=leading]]:size-(--np-avatar-list)"
    )
    // The card around the table drops on a phone, and bleed reaches the edges.
    const container = table.closest('[data-slot="table-container"]')!
    expect(container).toHaveAttribute("data-bleed")
    expect(container.className).toContain("max-md:border-0")
    // The same bleed as ListRows: PageFrame's phone px-5, exactly.
    expect(container.className).toContain("max-md:-mx-5")
    expect(container.className).toContain(
      "max-md:[--np-page-pad-x:--spacing(5)]"
    )
  })

  it("marks clickable rows for the trailing chevron and keeps selection outside the row click", async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    const onChange = vi.fn()
    render(
      <DataTable
        caption="Clients"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        responsive="list"
        onRowClick={onRowClick}
        selection={{
          selected: new Set(),
          onChange,
          label: (row) => `Select ${row.name}`,
        }}
      />
    )
    const table = screen.getByRole("table", { name: "Clients" })
    const rows = within(table).getAllByRole("row").slice(1)
    for (const row of rows) expect(row).toHaveAttribute("data-interactive")
    expect(table.className).toContain(
      "@max-3xl/table:[&_tbody>tr[data-interactive]]:after:content-['']"
    )
    // With selection too, the checkbox keeps the start and the avatar moves.
    expect(table.className).toContain(
      "@max-3xl/table:[&_tbody>tr:has(>td[data-priority=select])>td[data-priority=leading]]:start-12"
    )
    await user.click(
      screen.getByRole("checkbox", { name: "Select Barley Mow" })
    )
    expect(onChange).toHaveBeenCalledOnce()
    expect(onRowClick).not.toHaveBeenCalled()
    await user.click(within(rows[1]).getByText("Needs attention"))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1])
  })

  it("leaves existing responsive tables unchanged", () => {
    render(
      <DataTable
        caption="Plain"
        columns={COLUMNS.slice(1)}
        rows={ROWS}
        rowId={(row) => row.id}
        responsive
        surface
      />
    )
    const table = screen.getByRole("table", { name: "Plain" })
    expect(table).toHaveAttribute("data-responsive", "true")
    expect(table.className).not.toContain("var(--color-line-subtle)")
    const container = table.closest('[data-slot="table-container"]')!
    expect(container).not.toHaveAttribute("data-bleed")
    expect(container.className).not.toContain("max-md:border-0")
  })

  it("treats the cell after a leading cell as the title when nothing says primary", () => {
    render(
      <Table responsive="list">
        <TableBody>
          <TableRow>
            <TableCell priority="leading">A</TableCell>
            <TableCell label="Listing">Old Crown</TableCell>
            <TableCell label="Health">Healthy</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const classes = screen.getByRole("table").className
    expect(classes).toContain(
      "td[data-priority=leading]+td:not([data-priority]))]:order-1"
    )
    expect(classes).toContain(":not([data-priority=leading]+td))]:order-7")
  })
})

describe("Table header labels (D8)", () => {
  it("are caption medium muted, never mono uppercase", () => {
    render(
      <DataTable
        caption="Clients"
        columns={COLUMNS.slice(1)}
        rows={ROWS}
        rowId={(row) => row.id}
      />
    )
    const header = screen.getByRole("columnheader", { name: "Client" })
    expect(header).toHaveClass("text-caption", "font-medium", "text-ink-muted")
    expect(header.className).not.toMatch(/font-mono|uppercase/)
  })
})
