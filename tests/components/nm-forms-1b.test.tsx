import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"

import { Banner } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { COUNT_TEXT_CLASS } from "@/components/ui/count-text"
import { DiffView } from "@/components/ui/diff-view"
import { Field, FieldCounter, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Timeline } from "@/components/ui/timeline"
import { TypedConfirmation } from "@/components/ui/typed-confirmation"
import { ValidationSummary } from "@/components/ui/validation-summary"

describe("TypedConfirmation fallbackExpected", () => {
  it("asks for the fallback when expected is null, and matches it", () => {
    const onMatchChange = vi.fn()
    render(
      <TypedConfirmation
        expected={null}
        fallbackExpected="The Old Crown"
        onMatchChange={onMatchChange}
      />
    )
    expect(screen.getByText("The Old Crown")).toBeInTheDocument()
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "the old crown" } })
    expect(onMatchChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByText("Matches")).toBeInTheDocument()
  })

  it("prefers a non-blank expected over the fallback", () => {
    const onMatchChange = vi.fn()
    render(
      <TypedConfirmation
        expected="owner@venue.co.uk"
        fallbackExpected="The Old Crown"
        onMatchChange={onMatchChange}
      />
    )
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "The Old Crown" },
    })
    expect(onMatchChange).not.toHaveBeenCalled()
  })

  it("never arms when expected is blank and there is no fallback", () => {
    const onMatchChange = vi.fn()
    render(<TypedConfirmation expected="  " onMatchChange={onMatchChange} />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } })
    expect(onMatchChange).not.toHaveBeenCalled()
  })
})

describe("Progress status word", () => {
  it("shows the state in words and gives an indeterminate bar that value text", () => {
    render(<Progress label="Import" status="Waiting for Google" />)
    expect(screen.getByText("Waiting for Google")).toBeVisible()
    const bar = screen.getByRole("progressbar", { name: "Import" })
    expect(bar).toHaveAttribute("aria-valuetext", "Waiting for Google")
    expect(bar).not.toHaveAttribute("aria-valuenow")
    expect(bar).toHaveAttribute("data-indeterminate")
    // The travelling highlight stops under reduced motion.
    expect(bar.querySelector(".animate-shimmer")?.className).toContain(
      "motion-reduce:animate-none"
    )
  })

  it("keeps the old markup when there is no status", () => {
    const { container } = render(
      <Progress label="Import" value={40} className="w-40" />
    )
    const bar = screen.getByRole("progressbar", { name: "Import" })
    expect(bar.parentElement).toBe(container)
    expect(bar).toHaveClass("w-40")
    expect(bar).not.toHaveAttribute("aria-valuetext")
  })

  it("puts a figure beside the word and classes on the wrapper", () => {
    const { container } = render(
      <Progress
        label="Import"
        status="Importing"
        figure="3 of 12"
        value={3}
        max={12}
        className="w-60"
      />
    )
    expect(screen.getByText("3 of 12")).toHaveClass("tabular-nums")
    expect(container.firstElementChild).toHaveClass("w-60")
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "3"
    )
  })
})

describe("ValidationSummary onNavigate", () => {
  it("awaits onNavigate before focusing a field it revealed", async () => {
    const calls: string[] = []
    function Demo() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <ValidationSummary
            autoFocus={false}
            errors={[{ fieldId: "late", message: "Add an opening time" }]}
            onNavigate={(fieldId) => {
              calls.push(fieldId)
              setOpen(true)
              // Resolves after React has committed the revealed field.
              return new Promise((resolve) => setTimeout(resolve, 0))
            }}
          />
          {open ? <input id="late" aria-label="Opens at" /> : null}
        </>
      )
    }
    render(<Demo />)
    expect(screen.queryByLabelText("Opens at")).toBeNull()
    fireEvent.click(screen.getByRole("link", { name: "Add an opening time" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Opens at")).toHaveFocus()
    )
    expect(calls).toEqual(["late"])
  })

  it("still moves focus straight to a mounted field without onNavigate", () => {
    render(
      <>
        <ValidationSummary
          autoFocus={false}
          errors={[{ fieldId: "email", message: "Enter an email" }]}
        />
        <input id="email" aria-label="Email" />
      </>
    )
    fireEvent.click(screen.getByRole("link", { name: "Enter an email" }))
    expect(screen.getByLabelText("Email")).toHaveFocus()
  })
})

describe("SearchInput clear button", () => {
  it("draws 28px and reaches 44px on touch, 36px on a desk", () => {
    render(<Input type="search" aria-label="Search" defaultValue="parking" />)
    const clear = screen.getByRole("button", { name: "Clear search" })
    expect(clear).toHaveClass("size-7", "after:-inset-2", "desk:after:-inset-1")
  })
})

describe("DiffView flat variant", () => {
  const rows = [
    { field: "Phone", before: "01223 277 217", after: "01223 277 218" },
    { field: "Website", before: "", after: "https://example.com" },
  ]

  it("drops the card and tints, mutes the field and the struck old value", () => {
    const { container } = render(
      <DiffView caption="Changes" rows={rows} variant="flat" />
    )
    const root = container.querySelector('[data-slot="diff-view"]')!
    expect(root).toHaveAttribute("data-variant", "flat")
    expect(root.className).not.toContain("border-line")
    expect(root.className).not.toContain("rounded-")
    const table = screen.getByRole("table", { name: "Changes" })
    expect(table.innerHTML).not.toMatch(/bg-(danger|success)-tint/)
    expect(screen.getByRole("rowheader", { name: "Phone" })).toHaveClass(
      "text-ink-muted"
    )
    const old = within(table).getByText("01223 277 217")
    expect(old.tagName).toBe("DEL")
    expect(old.closest("td")).toHaveClass("text-ink-muted")
    const next = within(table).getByText("01223 277 218")
    expect(next.closest("td")).toHaveClass("text-ink")
    expect(next.closest("td")).not.toHaveClass("font-semibold")
    // Words, not colour, still say what an empty cell means.
    expect(within(table).getByText("Not set")).toBeInTheDocument()
  })

  it("keeps the card look by default", () => {
    const { container } = render(<DiffView caption="Changes" rows={rows} />)
    const root = container.querySelector('[data-slot="diff-view"]')!
    expect(root).toHaveClass("border-line", "rounded-(--np-radius-card)")
    expect(
      within(screen.getByRole("table")).getByText("01223 277 218").closest("td")
    ).toHaveClass("bg-success-tint")
  })
})

describe("D1 / D8 type", () => {
  it("sets timeline times in sans caption with tabular figures", () => {
    render(
      <Timeline
        entries={[{ id: "1", title: "Reply published", when: "2 h ago" }]}
      />
    )
    const when = screen.getByText("2 h ago")
    expect(when).toHaveClass("text-caption", "tabular-nums")
    expect(when).not.toHaveClass("font-mono")
  })

  it("draws counts and counters in sans tabular figures", () => {
    expect(COUNT_TEXT_CLASS).not.toContain("font-mono")
    expect(COUNT_TEXT_CLASS).toContain("tabular-nums")
    render(
      <FieldCounter count={3} max={40}>
        3 / 40
      </FieldCounter>
    )
    expect(screen.getByText("3 / 40")).not.toHaveClass("font-mono")
  })

  it("sets the role badge in sentence case, never mono uppercase", () => {
    render(<Badge variant="role">Owner</Badge>)
    const badge = screen.getByText("Owner")
    expect(badge).not.toHaveClass("uppercase")
    expect(badge).not.toHaveClass("font-mono")
  })

  it("gives field labels the calm medium weight", () => {
    render(
      <Field>
        <FieldLabel>Work email</FieldLabel>
        <Input />
      </Field>
    )
    const label = screen.getByText("Work email")
    expect(label).toHaveClass("font-medium", "text-ink-secondary")
    expect(screen.getByRole("textbox", { name: "Work email" })).toBeVisible()
  })
})

describe("Banner announcement tone", () => {
  it("uses the banner roles with no status glyph", () => {
    render(
      <Banner tone="announcement">
        New: faster replies. <a href="/news">Learn more</a>
      </Banner>
    )
    const banner = screen.getByRole("status")
    expect(banner).toHaveClass("bg-banner-bg", "text-banner-ink")
    expect(banner.querySelector("svg")).toBeNull()
    expect(screen.getByRole("link", { name: "Learn more" })).toBeVisible()
  })
})
