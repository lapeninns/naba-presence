import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TagInput } from "@/components/ui/tag-input"

/** The focus halo's shape in the danger line: focus while invalid. */
const DANGER_HALO = "shadow-np-focus-danger"
const DANGER_HALO_FOCUS = `aria-invalid:focus:${DANGER_HALO}`
const DANGER_HALO_FOCUS_VISIBLE = `aria-invalid:focus-visible:${DANGER_HALO}`
const DANGER_HALO_WITHIN = `has-aria-invalid:focus-within:${DANGER_HALO}`

describe("Field auto-wiring", () => {
  it("associates label, description and control without explicit ids", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input defaultValue="Old Crown" />
        <FieldDescription>Shown on your Google profile.</FieldDescription>
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAccessibleDescription("Shown on your Google profile.")
    expect(input).not.toHaveAttribute("aria-invalid")
    // Text entry shows the shared halo on any focus (a click lands the
    // caret there too), with a forced-colours outline.
    expect(input).toHaveClass(
      "focus:border-accent-solid",
      "focus:shadow-(--np-focus-halo)",
      "forced-colors:focus-halo"
    )
  })

  it("wires errors as an alert and marks the control invalid", () => {
    render(
      <Field error="Enter a business name.">
        <FieldLabel>Business name</FieldLabel>
        <Input />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a business name."
    )
    expect(input).toHaveAccessibleDescription("Enter a business name.")
  })

  it("Input works standalone with an explicit aria-label", () => {
    render(<Input aria-label="Search reviews" />)
    expect(
      screen.getByRole("textbox", { name: "Search reviews" })
    ).toBeInTheDocument()
  })

  it("points aria-describedby at exactly the error id when there is no description", () => {
    render(
      <Field error="Enter a business name.">
        <FieldLabel>Business name</FieldLabel>
        <Input />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    const errorId = screen.getByRole("alert").id
    expect(input).toHaveAttribute("aria-describedby", errorId)
  })

  it("omits aria-describedby entirely when neither description nor error render", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).not.toHaveAttribute("aria-describedby")
  })
})

/**
 * A Select's trigger is a `<button>`, which `<label for>` cannot reach, so a
 * Field holding one hands its label over by `aria-labelledby` and stops
 * emitting `htmlFor`. A caller that names the trigger itself keeps that name:
 * `aria-labelledby` wins the name computation, so adding it unconditionally
 * would silently rewrite accessible names across the console.
 */
describe("Field wiring for a pop-up trigger", () => {
  it("names the trigger from the label and carries invalid + description", () => {
    render(
      <Field error="Pick a status.">
        <FieldLabel>Open status</FieldLabel>
        <Select value="OPEN">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent title="Open status">
            <SelectItem value="OPEN">Open</SelectItem>
          </SelectContent>
        </Select>
        <FieldError />
      </Field>
    )
    const trigger = screen.getByRole("combobox", { name: "Open status" })
    expect(trigger).toHaveAttribute("aria-invalid", "true")
    expect(trigger).toHaveAccessibleDescription("Pick a status.")
    expect(trigger).toHaveClass(
      "focus-visible:shadow-(--np-focus-halo)",
      "forced-colors:focus-halo"
    )
  })

  it("drops htmlFor, which a button could never have answered", () => {
    render(
      <Field>
        <FieldLabel>Open status</FieldLabel>
        <Select value="OPEN">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent title="Open status">
            <SelectItem value="OPEN">Open</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    )
    expect(document.querySelector("label")).not.toHaveAttribute("for")
  })

  it("leaves an explicit aria-label as the trigger's accessible name", () => {
    render(
      <Field>
        <FieldLabel>Type</FieldLabel>
        <Select value="DINING_RESERVATION">
          <SelectTrigger aria-label="Booking link type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent title="Type">
            <SelectItem value="DINING_RESERVATION">Reserve</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    )
    expect(
      screen.getByRole("combobox", { name: "Booking link type" })
    ).toBeInTheDocument()
  })

  it("keeps htmlFor for an ordinary input, which can answer it", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input />
      </Field>
    )
    const label = document.querySelector("label")
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(label).toHaveAttribute("for", input.id)
  })
})

describe("SearchInput tap target", () => {
  it("focuses the input from a press anywhere on the 44px field", () => {
    // The input itself is 2px short of the field (its border); the field's
    // border, padding and icon must not be dead space.
    render(<Input type="search" aria-label="Filter clients by name" />)
    const input = screen.getByRole("searchbox", {
      name: "Filter clients by name",
    })
    const field = input.closest('[data-slot="input-search"]') as HTMLElement
    expect(input).toHaveClass("forced-colors:focus-ring-inset")
    expect(field).toHaveClass("focus-within:shadow-(--np-focus-halo)")
    expect(document.activeElement).not.toBe(input)
    fireEvent.mouseDown(field)
    expect(document.activeElement).toBe(input)
  })

  it("leaves a press on the input itself to the browser", () => {
    render(<Input type="search" aria-label="Search" />)
    const input = screen.getByRole("searchbox", { name: "Search" })
    // Not prevented: the caret lands where the person pressed.
    expect(fireEvent.mouseDown(input)).toBe(true)
  })

  it("does nothing while disabled", () => {
    render(<Input type="search" aria-label="Search" disabled />)
    const input = screen.getByRole("searchbox", { name: "Search" })
    fireEvent.mouseDown(
      input.closest('[data-slot="input-search"]') as HTMLElement
    )
    expect(document.activeElement).not.toBe(input)
  })
})

describe("TagInput focus", () => {
  it("keeps the field halo and an inset forced-colours fallback while typing a tag", () => {
    render(<TagInput aria-label="Labels" value={[]} onChange={() => {}} />)
    const input = screen.getByRole("textbox", { name: "Labels" })
    fireEvent.change(input, { target: { value: "Brunch" } })
    expect(input).toHaveValue("Brunch")
    expect(input).toHaveClass("forced-colors:focus-ring-inset")
    expect(input.parentElement).toHaveClass(
      "focus-within:shadow-(--np-focus-halo)"
    )
  })

  it("keeps a refused tag's danger edge under a danger halo while focused", () => {
    render(
      <TagInput aria-label="Labels" value={["Brunch"]} onChange={() => {}} />
    )
    const input = screen.getByRole("textbox", { name: "Labels" })
    fireEvent.change(input, { target: { value: "brunch" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    // The error used to be a plain class that `focus-within:` outranked, so
    // focusing the field erased it. It is now read from the input and
    // compounded with focus.
    expect(input.parentElement).toHaveClass(
      "has-aria-invalid:border-danger-ink",
      "has-aria-invalid:focus-within:border-danger-ink",
      DANGER_HALO_WITHIN
    )
  })

  it("draws disabled with the disabled roles, never opacity", () => {
    render(
      <TagInput aria-label="Labels" value={[]} onChange={() => {}} disabled />
    )
    const wrapper = screen.getByRole("textbox", { name: "Labels" })
      .parentElement as HTMLElement
    expect(wrapper).toHaveAttribute("data-disabled", "true")
    expect(wrapper).toHaveClass(
      "data-disabled:bg-disabled",
      "data-disabled:text-disabled-ink",
      "data-disabled:border-disabled-line"
    )
    expect(wrapper.className).not.toMatch(/opacity-/)
  })
})

/**
 * Focus while invalid (WCAG 2.4.7). jsdom has no layout or cascade, so this
 * is a class-level contract: the invalid-and-focused drawing is a compound
 * variant (`aria-invalid:focus:`), which outranks both the plain focus rule
 * and the plain invalid rule by specificity. With only `aria-invalid:` after
 * `focus:` at equal specificity, an invalid field showed no focus at all.
 */
describe("Field chrome: focus while invalid", () => {
  it("keeps the danger edge and turns the halo danger on an invalid Input", () => {
    render(
      <Field error="Enter a business name.">
        <FieldLabel>Business name</FieldLabel>
        <Input />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveClass(
      "aria-invalid:border-danger-ink",
      "aria-invalid:focus:border-danger-ink",
      DANGER_HALO_FOCUS,
      "focus:shadow-(--np-focus-halo)"
    )
    // The old 3px tint rings are gone: one focus language.
    expect(input.className).not.toContain("--np-field-ring")
  })

  it("does the same on an invalid SelectTrigger, keyboard focus and open", () => {
    render(
      <Field error="Pick a status.">
        <FieldLabel>Open status</FieldLabel>
        <Select value="OPEN">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent title="Open status">
            <SelectItem value="OPEN">Open</SelectItem>
          </SelectContent>
        </Select>
        <FieldError />
      </Field>
    )
    const trigger = screen.getByRole("combobox", { name: "Open status" })
    expect(trigger).toHaveAttribute("aria-invalid", "true")
    expect(trigger).toHaveClass(
      "aria-invalid:border-danger-ink",
      "aria-invalid:focus-visible:border-danger-ink",
      DANGER_HALO_FOCUS_VISIBLE,
      "aria-invalid:data-popup-open:border-danger-ink"
    )
    expect(trigger.className).not.toContain("--np-field-ring")
  })

  it("does the same on an invalid search field's wrapper", () => {
    render(
      <Field error="Too short.">
        <FieldLabel>Find</FieldLabel>
        <Input type="search" />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("searchbox", { name: "Find" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input.closest('[data-slot="input-search"]')).toHaveClass(
      "has-aria-invalid:border-danger-ink",
      DANGER_HALO_WITHIN
    )
  })
})

describe("Field chrome: disabled is drawn, never faded", () => {
  it("draws a disabled Input and SelectTrigger with the disabled roles", () => {
    render(
      <>
        <Input aria-label="Name" disabled />
        <Select value="OPEN" disabled>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent title="Status">
            <SelectItem value="OPEN">Open</SelectItem>
          </SelectContent>
        </Select>
      </>
    )
    const input = screen.getByRole("textbox", { name: "Name" })
    expect(input).toHaveClass(
      "disabled:bg-disabled",
      "disabled:text-disabled-ink",
      "disabled:border-disabled-line",
      "placeholder:text-ink-muted"
    )
    const trigger = screen.getByRole("combobox", { name: "Status" })
    expect(trigger).toHaveClass(
      "data-disabled:bg-disabled",
      "data-disabled:text-disabled-ink",
      "data-disabled:border-disabled-line"
    )
    for (const el of [input, trigger]) {
      expect(el.className).not.toMatch(/opacity-/)
    }
  })

  it("turns a disabled control's Label to the disabled ink", () => {
    render(
      <>
        <input id="n" className="peer" disabled />
        <Label htmlFor="n">Name</Label>
      </>
    )
    const label = screen.getByText("Name")
    expect(label).toHaveClass(
      "peer-disabled:text-disabled-ink",
      "group-data-[disabled=true]:text-disabled-ink"
    )
    expect(label.className).not.toMatch(/opacity-/)
  })

  it("darkens the edge on hover only where no other state is drawn", () => {
    render(<Input aria-label="Name" />)
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveClass(
      "hover-fine:hover:not-focus:not-disabled:not-read-only:not-aria-invalid:border-ink-muted"
    )
  })
})

describe("Field measure", () => {
  it("is the full column by default", () => {
    const { container } = render(
      <Field>
        <FieldLabel>Notes</FieldLabel>
        <Input />
      </Field>
    )
    const field = container.querySelector('[data-slot="field"]')!
    expect(field).not.toHaveAttribute("data-measure")
    expect(field.className).not.toMatch(/max-w/)
  })

  it("limits a short field to max-w-md on a desk only, so a phone stays full width", () => {
    const { container } = render(
      <Field measure="short" className="mt-2">
        <FieldLabel>Agency name</FieldLabel>
        <Input />
      </Field>
    )
    const field = container.querySelector('[data-slot="field"]')!
    expect(field).toHaveAttribute("data-measure", "short")
    const classes = field.className.split(/\s+/)
    expect(classes).toContain("desk:max-w-md")
    // No unprefixed cap: below the desk variant the field fills its column.
    expect(classes).not.toContain("max-w-md")
    expect(classes).toContain("mt-2")
  })
})
