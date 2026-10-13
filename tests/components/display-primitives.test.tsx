import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardLink,
  CardTitle,
  cardClassName,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ChipCount, ChipRow, ToggleChip } from "@/components/ui/chip"
import { DataTable } from "@/components/ui/data-table"
import { KpiTile } from "@/components/ui/kpi-tile"
import { Stars } from "@/components/ui/stars"
import { StatusPill } from "@/components/ui/status-pill"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Timeline } from "@/components/ui/timeline"
import {
  STATUS_TONES,
  TONE_CLASSES,
  isToneName,
  resolveTone,
  toneClasses,
} from "@/lib/ui/status-tone"

describe("status-tone vocabulary", () => {
  it("resolves every alias to one of the five tones", () => {
    expect(resolveTone("ok")).toBe("healthy")
    expect(resolveTone("success")).toBe("healthy")
    expect(resolveTone("warn")).toBe("attention")
    expect(resolveTone("warning")).toBe("attention")
    expect(resolveTone("bad")).toBe("at-risk")
    expect(resolveTone("danger")).toBe("at-risk")
    expect(resolveTone("info")).toBe("pending")
    for (const tone of STATUS_TONES) expect(resolveTone(tone)).toBe(tone)
  })

  it("gives an alias exactly its tone's classes, so a synonym cannot drift", () => {
    expect(toneClasses("bad")).toBe(TONE_CLASSES["at-risk"])
    expect(toneClasses("warning")).toBe(TONE_CLASSES.attention)
  })

  it("knows its own names and nothing else", () => {
    expect(isToneName("at-risk")).toBe(true)
    expect(isToneName("ok")).toBe(true)
    expect(isToneName("purple")).toBe(false)
    expect(isToneName(3)).toBe(false)
    // Not through the prototype.
    expect(isToneName("toString")).toBe(false)
    expect(isToneName("constructor")).toBe(false)
  })

  it("draws a pill and a badge in the same state in the same colours", () => {
    render(
      <>
        <StatusPill tone="bad">Disconnected</StatusPill>
        <StatusPill tone="at-risk">Disconnected too</StatusPill>
        <Badge variant="destructive">2 failed</Badge>
      </>
    )
    const [alias, canonical] = [
      screen.getByText("Disconnected"),
      screen.getByText("Disconnected too"),
    ]
    for (const cls of [
      TONE_CLASSES["at-risk"].tint,
      TONE_CLASSES["at-risk"].text,
    ]) {
      expect(alias).toHaveClass(cls)
      expect(canonical).toHaveClass(cls)
      expect(screen.getByText("2 failed")).toHaveClass(cls)
    }
  })
})

describe("StatusPill", () => {
  it("is at least the pill height token tall and never a sub-12px literal", () => {
    render(<StatusPill tone="healthy">Verified</StatusPill>)
    const pill = screen.getByText("Verified")
    expect(pill).toHaveClass("min-h-(--np-pill-h)", "text-caption")
    expect(pill.className).not.toMatch(/text-\[/)
  })

  it("gives a lone dot its words for screen readers", () => {
    const { container } = render(
      <StatusPill tone="attention" variant="dot" label="Needs attention" />
    )
    expect(
      container.querySelector('[data-slot="status-pill"]')
    ).toHaveTextContent("Needs attention")
  })
})

describe("Table record cards", () => {
  it("marks each cell with its record-card priority", () => {
    render(
      <Table responsive>
        <TableBody>
          <TableRow>
            <TableCell priority="primary">Old Crown</TableCell>
            <TableCell priority="trailing" label="Health">
              Healthy
            </TableCell>
            <TableCell priority="meta" label="Joined">
              3 Oct
            </TableCell>
            <TableCell actions>…</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const cells = screen.getAllByRole("cell")
    expect(cells.map((cell) => cell.getAttribute("data-priority"))).toEqual([
      "primary",
      "trailing",
      "meta",
      "actions",
    ])
    expect(cells[2]).toHaveAttribute("data-label", "Joined")
  })

  it("puts a cell holding only a checkbox in the leading select slot", () => {
    render(
      <Table responsive>
        <TableBody>
          <TableRow>
            <TableCell label="Select">
              <Checkbox aria-label="Select Old Crown" />
            </TableCell>
            <TableCell label="Listing">Old Crown</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const [select, title] = screen.getAllByRole("cell")
    expect(select).toHaveAttribute("data-priority", "select")
    // The title infers its place in CSS; it carries no priority of its own,
    // so existing tables keep their markup.
    expect(title).not.toHaveAttribute("data-priority")
  })

  // listing-admin-profile-23: a container that does not scroll sideways is
  // not a tab stop (jsdom lays nothing out, so nothing overflows here).
  it("is a tab stop only while it scrolls sideways", () => {
    const { container } = render(
      <Table responsive>
        <TableBody>
          <TableRow>
            <TableCell>Old Crown</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const scrollPort = container.querySelector('[data-slot="table-container"]')!
    expect(scrollPort).not.toHaveAttribute("tabindex")
  })
})

describe("DataTable record cards", () => {
  const rows = [
    { id: "a", name: "Old Crown", health: "Healthy" },
    { id: "b", name: "Bell", health: "Paused" },
  ]
  const columns = [
    {
      id: "name",
      header: "Listing",
      priority: "primary" as const,
      cell: (row: (typeof rows)[number]) => row.name,
    },
    {
      id: "health",
      header: "Health",
      priority: "trailing" as const,
      cell: (row: (typeof rows)[number]) => row.health,
    },
  ]

  it("passes each column's priority to its cells", () => {
    render(
      <DataTable
        caption="Listings"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        responsive
      />
    )
    const first = screen.getAllByRole("row")[1]
    expect(
      within(first)
        .getAllByRole("cell")
        .map((cell) => cell.getAttribute("data-priority"))
    ).toEqual(["primary", "trailing"])
  })

  // prim-05: the select-all checkbox survives as a bar above the cards and
  // says how many are chosen; each row's checkbox is the card's leading slot.
  it("keeps select-all with a visible count, and leads each card with its checkbox", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <DataTable
        caption="Listings"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        responsive
        selection={{
          selected: new Set(),
          onChange,
          label: (row) => `Select ${row.name}`,
        }}
      />
    )
    // The bar's words start with the checkbox's own name (label in name).
    expect(screen.getByText("Select all 2 rows")).toHaveAttribute("aria-hidden")
    expect(
      screen.getByRole("checkbox", { name: "Select Old Crown" }).closest("td")
    ).toHaveAttribute("data-priority", "select")
    await user.click(
      screen.getByRole("checkbox", { name: "Select all 2 rows" })
    )
    expect(onChange).toHaveBeenCalledWith(new Set(["a", "b"]))

    rerender(
      <DataTable
        caption="Listings"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        responsive
        selection={{
          selected: new Set(["a"]),
          onChange,
          label: (row) => `Select ${row.name}`,
        }}
      />
    )
    expect(
      screen.getByText("Select all 2 rows · 1 selected")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("checkbox", { name: "Select all 2 rows" })
    ).toBeInTheDocument()
  })
})

describe("Card", () => {
  it("renders the whole card as one link with href", () => {
    render(
      <Card href="/listings/1">
        <CardTitle>Old Crown</CardTitle>
      </Card>
    )
    const link = screen.getByRole("link", { name: "Old Crown" })
    expect(link).toHaveAttribute("href", "/listings/1")
    expect(link).toHaveAttribute("data-slot", "card")
    expect(link).toHaveAttribute("data-interactive")
  })

  // listings-content-18: the card is one target, but a button inside it is
  // still its own target and the link's name is the title, not the card.
  it("stretches a CardLink over an interactive card and keeps inner buttons", () => {
    render(
      <Card interactive>
        <CardHeader>
          <CardTitle>
            <CardLink href="/listings/1/hours">Hours</CardLink>
          </CardTitle>
        </CardHeader>
        <button type="button">Check</button>
      </Card>
    )
    const link = screen.getByRole("link", { name: "Hours" })
    expect(link).toHaveAttribute("data-slot", "card-link")
    expect(link.className).toContain("after:inset-0")
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument()
    expect(link.closest('[data-slot="card"]')).toHaveClass("relative")
  })

  it("renders as another element and as the sunken well", () => {
    const { container } = render(
      <ul>
        <Card as="li" surface="sunken">
          Row
        </Card>
      </ul>
    )
    const card = container.querySelector("li")!
    expect(card).toHaveAttribute("data-surface", "sunken")
    expect(card).toHaveClass("bg-surface-alt")
  })

  it("exports the card box as a recipe for elements that cannot be a Card", () => {
    expect(cardClassName()).toContain("rounded-(--np-radius-card)")
    expect(cardClassName()).toContain("border-line")
    expect(cardClassName({ pad: true })).toContain("p-(--np-card-pad)")
    expect(cardClassName({ interactive: true })).toContain(
      "active:bg-surface-alt"
    )
  })
})

describe("KpiTile modes", () => {
  it("is one link whose name starts with the label", () => {
    render(
      <KpiTile
        label="Needs reply"
        value="5"
        hint="Across this client"
        href="/inbox?q=1"
      />
    )
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", "/inbox?q=1")
    expect(link.textContent).toMatch(/^Needs reply/)
    // Only phrasing content inside a link.
    expect(link.querySelector("p, div")).toBeNull()
  })

  it("is a filter toggle that reports its state", async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const { rerender } = render(
      <KpiTile label="Paused" value="2" onPress={onPress} />
    )
    const toggle = screen.getByRole("button", { name: /Paused/ })
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    await user.click(toggle)
    expect(onPress).toHaveBeenCalledTimes(1)
    rerender(<KpiTile label="Paused" value="2" onPress={onPress} pressed />)
    expect(screen.getByRole("button", { name: /Paused/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("has a compact size for a dense phone row", () => {
    const { container } = render(
      <KpiTile label="Views" value="1,204" size="compact" />
    )
    const tile = container.querySelector('[data-slot="kpi-tile"]')!
    expect(tile).toHaveAttribute("data-size", "compact")
    expect(screen.getByText("1,204")).toHaveClass("text-section")
  })
})

describe("Stars label", () => {
  it("speaks a label built from the value", () => {
    render(
      <Stars
        value={4}
        label={(value) => `${value} star${value === 1 ? "" : "s"}`}
      />
    )
    expect(screen.getByRole("img", { name: "4 stars" })).toBeInTheDocument()
  })

  it("names the empty state with emptyLabel, and keeps a string label working", () => {
    const { rerender } = render(<Stars value={null} emptyLabel="Rating only" />)
    expect(screen.getByText("Rating only")).toBeInTheDocument()
    rerender(<Stars value={null} label="Not rated" />)
    expect(screen.getByText("Not rated")).toBeInTheDocument()
    rerender(<Stars value={3} label="Three" />)
    expect(screen.getByRole("img", { name: "Three" })).toBeInTheDocument()
  })
})

describe("Chip", () => {
  it("draws counts in the shared count figure, never a sub-12px literal", () => {
    render(
      <>
        <ChipCount>4</ChipCount>
        <Badge variant="secondary" count>
          7
        </Badge>
      </>
    )
    for (const figure of [screen.getByText("4"), screen.getByText("7")]) {
      expect(figure.className).toContain("--np-text-count")
      expect(figure.className).not.toMatch(/text-\[\d/)
    }
    // tailwind-merge keeps the colour beside the count size.
    expect(screen.getByText("7")).toHaveClass("text-ink-secondary")
  })

  it("scrolls the pressed chip into view when it changes, inside the row only", () => {
    // A 200px row; "All" sits inside it, "Failed" 300px past its end.
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 36,
        height: 36,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute("data-slot") === "chip-row") return rect(0, 200)
      if (this.textContent === "Failed") return rect(500, 60) as DOMRect
      return rect(10, 40)
    }
    try {
      const { container, rerender } = render(
        <ChipRow>
          <ToggleChip pressed>All</ToggleChip>
          <ToggleChip>Failed</ToggleChip>
        </ChipRow>
      )
      const row = container.querySelector<HTMLElement>(
        '[data-slot="chip-row"]'
      )!
      // Already in view: nothing moves.
      expect(row.scrollLeft).toBe(0)
      rerender(
        <ChipRow>
          <ToggleChip>All</ToggleChip>
          <ToggleChip pressed>Failed</ToggleChip>
        </ChipRow>
      )
      // 560 - 200 past the end, plus the chip-width margin (capped at 50).
      expect(row.scrollLeft).toBe(410)
      row.scrollLeft = 0
      rerender(
        <ChipRow>
          <ToggleChip>All</ToggleChip>
          <ToggleChip pressed>Failed</ToggleChip>
        </ChipRow>
      )
      // Same chip: the reader's own scroll is left alone.
      expect(row.scrollLeft).toBe(0)
      // The page never scrolls: scrollIntoView would move every ancestor.
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe("Timeline tones", () => {
  it("accepts status tones and aliases and draws them from the tone map", () => {
    const { container } = render(
      <Timeline
        entries={[
          { id: "1", title: "Published", tone: "healthy" },
          { id: "2", title: "Failed", tone: "danger" },
        ]}
      />
    )
    const marks = container.querySelectorAll("li > span[aria-hidden]")
    expect(marks[0]).toHaveClass(TONE_CLASSES.healthy.tint)
    expect(marks[1]).toHaveClass(TONE_CLASSES["at-risk"].tint)
  })
})

// The e2e suites find record-card values by `td[data-label="<column>"]`
// (accessibility.spec.ts, place-actions-backend, lodging-recovery-backend):
// a record card is the same `tr`/`td` restyled, never a separate tree, and
// every labelled cell keeps its column name whatever its priority.
describe("record cards keep the td[data-label] contract", () => {
  it("labels every DataTable cell with its column header, primary and meta included", () => {
    render(
      <DataTable
        caption="Response by listing"
        rows={[{ id: "a", name: "Old Crown", rate: "80%", replied: "4" }]}
        rowId={(row) => row.id}
        responsive
        columns={[
          {
            id: "name",
            header: "Listing",
            priority: "primary",
            cell: (row) => row.name,
          },
          {
            id: "rate",
            header: "Response rate",
            priority: "trailing",
            cell: (row) => row.rate,
          },
          {
            id: "replied",
            header: "Replied",
            priority: "meta",
            cell: (row) => row.replied,
          },
        ]}
      />
    )
    const cells = screen.getAllByRole("cell")
    expect(cells.every((cell) => cell.tagName === "TD")).toBe(true)
    expect(cells.map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Listing",
      "Response rate",
      "Replied",
    ])
    // The column headers are still real header cells for the desk layout.
    expect(
      screen.getByRole("columnheader", { name: "Response rate" })
    ).toBeInTheDocument()
  })

  it("keeps a hand-composed table's labels on its cells", () => {
    render(
      <Table responsive>
        <TableBody>
          <TableRow>
            <TableCell label="Listing">Old Crown</TableCell>
            <TableCell label="Health" priority="trailing">
              Healthy
            </TableCell>
            <TableCell label="Last published" priority="desk-only">
              2 days ago
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(
      screen.getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))
    ).toEqual(["Listing", "Health", "Last published"])
  })
})
