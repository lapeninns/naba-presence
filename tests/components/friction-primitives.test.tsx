import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ReportingPanel } from "@/components/reporting/reporting-states"
import { DataTable } from "@/components/ui/data-table"
import {
  Field,
  FieldCounter,
  fieldCounterIsNear,
  FieldLabel,
} from "@/components/ui/field"
import { RouteErrorState } from "@/components/ui/query-states"
import { ACTION_TOAST_TIMEOUT, withActionTimeout } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"

describe("DataTable clickable rows", () => {
  type Row = { id: string; name: string }
  const rows: Row[] = [{ id: "1", name: "Old Crown Girton" }]

  it("keeps the row out of the tab order but still opens it on a click", () => {
    // A focusable <tr> was an unnamed tab stop in front of the row's link.
    const onRowClick = vi.fn()
    render(
      <DataTable
        caption="Clients"
        rows={rows}
        rowId={(row) => row.id}
        onRowClick={onRowClick}
        columns={[
          {
            id: "name",
            header: "Client",
            cell: (row) => <a href={`/clients/${row.id}`}>{row.name}</a>,
          },
        ]}
      />
    )
    const row = screen
      .getByRole("link", { name: "Old Crown Girton" })
      .closest("tr") as HTMLElement
    expect(row).not.toHaveAttribute("tabindex")
    fireEvent.click(row)
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })
})

describe("FieldCounter", () => {
  it("stays quiet far from the limit and speaks up near it", () => {
    const { rerender } = render(
      <Field>
        <FieldLabel>Notes</FieldLabel>
        <FieldCounter count={10} max={2000}>
          10 / 2,000
        </FieldCounter>
      </Field>
    )
    const counter = screen.getByText("10 / 2,000")
    expect(counter).toHaveAttribute("aria-live", "off")
    rerender(
      <Field>
        <FieldLabel>Notes</FieldLabel>
        <FieldCounter count={1900} max={2000}>
          1,900 / 2,000
        </FieldCounter>
      </Field>
    )
    expect(screen.getByText("1,900 / 2,000")).toHaveAttribute(
      "aria-live",
      "polite"
    )
  })

  it("announces an explicit over-limit counter", () => {
    render(<FieldCounter over>4,100 / 4,096 bytes</FieldCounter>)
    expect(screen.getByText("4,100 / 4,096 bytes")).toHaveAttribute(
      "aria-live",
      "polite"
    )
  })

  it("treats the last tenth as near", () => {
    expect(fieldCounterIsNear(1799, 2000)).toBe(false)
    expect(fieldCounterIsNear(1800, 2000)).toBe(true)
  })
})

describe("withActionTimeout", () => {
  it("gives a toast with an action the longer timeout", () => {
    expect(
      withActionTimeout({ title: "Removed", actionProps: { children: "Undo" } })
        .timeout
    ).toBe(ACTION_TOAST_TIMEOUT)
  })

  it("leaves plain toasts and explicit timeouts alone", () => {
    expect(withActionTimeout({ title: "Saved" }).timeout).toBeUndefined()
    expect(
      withActionTimeout({
        title: "Removed",
        timeout: 2000,
        actionProps: { children: "Undo" },
      }).timeout
    ).toBe(2000)
  })
})

describe("RouteErrorState", () => {
  it("names where its way out goes", () => {
    render(
      <RouteErrorState
        title="This client page hit an error"
        description="Try again."
        onReset={() => {}}
        homeHref="/clients"
        homeLabel="All clients"
      />
    )
    expect(screen.getByRole("link", { name: "All clients" })).toHaveAttribute(
      "href",
      "/clients"
    )
  })
})

describe("ReportingPanel errors", () => {
  it("shows the real cause rather than a generic sentence", () => {
    render(
      <ReportingPanel
        variant="error"
        cause={
          new ApiClientError(403, "permission_denied", "Permission denied")
        }
      />
    )
    expect(
      screen.getByText(/You do not have permission to do that\./)
    ).toBeInTheDocument()
  })
})
