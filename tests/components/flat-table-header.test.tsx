import { readFileSync } from "node:fs"
import path from "node:path"

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChartDataTable } from "@/components/ui/chart"
import { DiffView } from "@/components/ui/diff-view"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const globals = readFileSync(
  path.join(process.cwd(), "app/globals.css"),
  "utf8"
)

// SYSTEM §10 Tables and DIRECTION D5: no header band, a selected row is the
// neutral fill with an ink edge, and figures are sans tabular.
describe("flat table header (D5)", () => {
  it("resolves the header token to the surface in every theme block", () => {
    const values = [
      ...globals.matchAll(/--np-table-header-bg:\s*([^;]+);/g),
    ].map((match) => match[1].trim())
    // Light, .dark and the no-script dark twin.
    expect(values).toHaveLength(3)
    for (const value of values) expect(value).toBe("var(--np-surface)")
  })

  it("draws caption medium muted labels over a 1px line, sticky on the surface", () => {
    render(
      <Table aria-label="Listings">
        <TableHeader sticky>
          <TableRow>
            <TableHead>Listing</TableHead>
            <TableHead numeric>Views</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>The Bell</TableCell>
            <TableCell numeric>1,204</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const head = screen.getByRole("columnheader", { name: "Listing" })
    expect(head).toHaveClass("text-caption", "font-medium", "text-ink-muted")
    const thead = head.closest("thead")!
    expect(thead).toHaveClass(
      "[&_th]:border-b",
      "[&_th]:border-line",
      "[&_th]:bg-(--np-table-header-bg)",
      "[&_th]:sticky"
    )
    expect(thead.className).not.toMatch(/surface-alt|sunken/)
    // No zebra: a body row has no alternating fill.
    const row = screen.getByText("The Bell").closest("tr")!
    expect(row.className).not.toMatch(/even:|odd:/)
  })

  it("draws a selected row with the fill and an ink edge, not the accent", () => {
    render(
      <Table aria-label="Listings">
        <TableBody>
          <TableRow data-selected="true">
            <TableCell>The Bell</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const row = screen.getByText("The Bell").closest("tr")!
    expect(row).toHaveClass(
      "data-[selected=true]:bg-(--np-selection-bg)",
      "data-[selected=true]:[&>td:first-child]:shadow-np-edge-select"
    )
    expect(row.className).not.toContain("accent-tint")
  })

  it("keeps a quiet fill on group rows", () => {
    render(
      <Table aria-label="Listings">
        <TableBody>
          <TableRow group>
            <TableCell>Cambridge</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(screen.getByText("Cambridge").closest("tr")).toHaveClass(
      "bg-surface-alt"
    )
  })

  it("drops DiffView's own header band", () => {
    render(
      <DiffView
        caption="Changes"
        rows={[{ field: "Phone", before: "01223 1", after: "01223 2" }]}
      />
    )
    const head = screen.getByRole("columnheader", { name: "On Google now" })
    expect(head).toHaveClass("text-caption", "font-medium", "text-ink-muted")
    expect(head.className).not.toMatch(/bg-|font-semibold/)
  })

  it("drops ChartDataTable's own header band", () => {
    render(
      <ChartDataTable
        caption="Reviews by week"
        columns={["Week", "Reviews"]}
        rows={[["3 Nov", 12]]}
        visible
      />
    )
    const table = screen.getByRole("table")
    expect(table.className).not.toContain("[&_th]:bg-")
    expect(table).toHaveClass("[&_th]:font-medium", "[&_th]:text-ink-muted")
  })
})
