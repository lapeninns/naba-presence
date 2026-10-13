import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  SegmentedControl,
  SegmentedControlItem,
  type SegmentedControlProps,
} from "@/components/ui/segmented-control"

function Control(props: Partial<SegmentedControlProps>) {
  return (
    <SegmentedControl aria-label="View" defaultValue="month" {...props}>
      <SegmentedControlItem value="month">Month</SegmentedControlItem>
      <SegmentedControlItem value="week">Week</SegmentedControlItem>
      <SegmentedControlItem value="agenda">Agenda</SegmentedControlItem>
    </SegmentedControl>
  )
}

function tabStops(elements: HTMLElement[]) {
  return elements.filter((element) => element.tabIndex === 0)
}

describe("SegmentedControl semantics=tabs (default)", () => {
  it("renders a tablist of tabs and selects with arrows", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Control onValueChange={onValueChange} />)

    expect(screen.getByRole("tablist", { name: "View" })).toBeInTheDocument()
    const month = screen.getByRole("tab", { name: "Month" })
    expect(month).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute(
      "aria-selected",
      "false"
    )

    await user.click(screen.getByRole("tab", { name: "Week" }))
    expect(onValueChange).toHaveBeenLastCalledWith("week")

    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Agenda" })).toHaveFocus()
    expect(onValueChange).toHaveBeenLastCalledWith("agenda")
  })

  it("puts the count inside the accessible name", () => {
    render(
      <SegmentedControl aria-label="Filter by health" defaultValue="all">
        <SegmentedControlItem value="all" count={2}>
          All
        </SegmentedControlItem>
        <SegmentedControlItem value="attention" count={3}>
          Needs attention
        </SegmentedControlItem>
      </SegmentedControl>
    )
    expect(
      screen.getByRole("tab", { name: "Needs attention 3" })
    ).toBeInTheDocument()
  })
})

describe("SegmentedControl sizing", () => {
  // Each segment's own box is a 44px target on touch (the track grows to
  // 50px around it); only the desk returns to the control-height track.
  it("makes every segment a 44px touch target, compact only at the desk", () => {
    render(<Control />)
    for (const segment of screen.getAllByRole("tab")) {
      expect(segment).toHaveClass(
        "h-(--np-touch)",
        "desk:h-[calc(var(--np-control-h)-2*var(--np-segment-inset))]"
      )
    }
  })

  it("sets the count in the count role", () => {
    render(
      <SegmentedControl aria-label="Filter by health" defaultValue="all">
        <SegmentedControlItem value="all" count={2}>
          All
        </SegmentedControlItem>
      </SegmentedControl>
    )
    const count = screen.getByText("2")
    expect(count).toHaveAttribute("data-slot", "segmented-control-count")
    expect(count).toHaveClass("text-count", "text-ink-muted")
    expect(count.className).not.toMatch(/text-\[/)
  })
})

describe("SegmentedControl semantics=radio", () => {
  it("renders a radiogroup with one tab stop and arrow-key roving", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <>
        <button type="button">before</button>
        <Control semantics="radio" onValueChange={onValueChange} />
      </>
    )

    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument()
    const radios = screen.getAllByRole("radio")
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ])
    expect(tabStops(radios)).toEqual([radios[0]])

    await user.click(screen.getByRole("button", { name: "before" }))
    await user.tab()
    expect(radios[0]).toHaveFocus()

    await user.keyboard("{ArrowRight}")
    expect(radios[1]).toHaveFocus()
    expect(radios[1]).toHaveAttribute("aria-checked", "true")
    expect(onValueChange).toHaveBeenLastCalledWith("week")
    expect(tabStops(screen.getAllByRole("radio"))).toEqual([radios[1]])

    await user.keyboard("{ArrowLeft}")
    expect(radios[0]).toHaveFocus()
    expect(onValueChange).toHaveBeenLastCalledWith("month")

    await user.click(radios[2])
    expect(onValueChange).toHaveBeenLastCalledWith("agenda")
    expect(radios[2]).toHaveAttribute("aria-checked", "true")
  })

  it("is named by the Field label when inside a Field", () => {
    render(
      <Field>
        <FieldLabel>Reply tone</FieldLabel>
        <SegmentedControl semantics="radio" defaultValue="warm">
          <SegmentedControlItem value="warm">Warm</SegmentedControlItem>
          <SegmentedControlItem value="concise">Concise</SegmentedControlItem>
        </SegmentedControl>
      </Field>
    )
    expect(
      screen.getByRole("radiogroup", { name: "Reply tone" })
    ).toBeInTheDocument()
    // The label no longer points `for` at something it cannot label.
    expect(screen.getByText("Reply tone")).not.toHaveAttribute("for")
  })

  it("submits the chosen value under `name`", async () => {
    const user = userEvent.setup()
    render(
      <form data-testid="form">
        <Control semantics="radio" name="view" />
      </form>
    )
    await user.click(screen.getByRole("radio", { name: "Agenda" }))
    const form = screen.getByTestId("form") as HTMLFormElement
    expect(new FormData(form).get("view")).toBe("agenda")
  })

  it("renders counts inside the radio's name", () => {
    render(
      <SegmentedControl semantics="radio" aria-label="Filter" defaultValue="a">
        <SegmentedControlItem value="a" count="12">
          Unreplied
        </SegmentedControlItem>
      </SegmentedControl>
    )
    expect(
      screen.getByRole("radio", { name: "Unreplied 12" })
    ).toBeInTheDocument()
  })
})

describe("SegmentedControl semantics=toggle", () => {
  function Controlled({ allowEmpty }: { allowEmpty?: boolean }) {
    const [value, setValue] = useState("password")
    return (
      <>
        <SegmentedControl
          semantics="toggle"
          aria-label="Sign-in method"
          value={value}
          onValueChange={setValue}
          allowEmpty={allowEmpty}
        >
          <SegmentedControlItem value="password">Password</SegmentedControlItem>
          <SegmentedControlItem value="link">Magic link</SegmentedControlItem>
        </SegmentedControl>
        <output data-testid="value">{value}</output>
      </>
    )
  }

  it("renders pressed buttons, selects on click and refuses to go empty", async () => {
    const user = userEvent.setup()
    render(<Controlled />)

    expect(screen.getByRole("group", { name: "Sign-in method" })).toBeVisible()
    const password = screen.getByRole("button", { name: "Password" })
    const link = screen.getByRole("button", { name: "Magic link" })
    expect(password).toHaveAttribute("aria-pressed", "true")
    expect(link).toHaveAttribute("aria-pressed", "false")

    await user.click(link)
    expect(screen.getByTestId("value")).toHaveTextContent("link")
    expect(link).toHaveAttribute("aria-pressed", "true")
    expect(password).toHaveAttribute("aria-pressed", "false")

    // Pressing the pressed segment again does not release it.
    await user.click(link)
    expect(screen.getByTestId("value")).toHaveTextContent("link")
    expect(link).toHaveAttribute("aria-pressed", "true")
  })

  it("moves focus with arrow keys and presses with Enter", async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const password = screen.getByRole("button", { name: "Password" })
    const link = screen.getByRole("button", { name: "Magic link" })

    await user.click(password)
    await user.keyboard("{ArrowRight}")
    expect(link).toHaveFocus()
    // Focus alone does not press: a toggle commits on Enter / Space.
    expect(screen.getByTestId("value")).toHaveTextContent("password")
    await user.keyboard("{Enter}")
    expect(screen.getByTestId("value")).toHaveTextContent("link")
  })

  it("releases to an empty string only with allowEmpty", async () => {
    const user = userEvent.setup()
    render(<Controlled allowEmpty />)
    await user.click(screen.getByRole("button", { name: "Password" }))
    expect(screen.getByTestId("value")).toBeEmptyDOMElement()
  })
})
