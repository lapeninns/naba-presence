import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  MenuEditor,
  stripDraftKeys,
  validateMenu,
} from "@/components/locations/menu-editor"
import { ValidationSummary } from "@/components/ui/validation-summary"
import type { FoodMenu } from "@/lib/api/location-menu"

afterEach(() => vi.clearAllMocks())

/** Opens a row's overflow menu ("Actions for Soup") and picks one action. */
async function rowAction(
  user: ReturnType<typeof userEvent.setup>,
  trigger: string,
  action: string
) {
  await user.click(screen.getByRole("button", { name: trigger }))
  await user.click(await screen.findByRole("menuitem", { name: action }))
}

/**
 * The menu switcher is the shared Select (a combobox and a listbox), not a
 * native <select>: open it and pick the menu by name.
 */
function menuSwitcher() {
  return screen.getByRole("combobox", { name: "Menu" })
}

async function chooseMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(menuSwitcher())
  await user.click(await screen.findByRole("option", { name }))
}

function fixture(): FoodMenu[] {
  return [
    {
      labels: [{ displayName: "Lunch" }],
      sections: [
        {
          labels: [{ displayName: "Starters" }],
          items: [
            {
              labels: [
                { displayName: "Soup", description: "Made fresh" },
                { displayName: "Soupe", languageCode: "fr" },
              ],
              attributes: {
                price: { currencyCode: "EUR", units: "6", nanos: 500000000 },
                custom: "keep",
              },
              options: [{ labels: [{ displayName: "Large" }] }],
            },
            {
              labels: [{ displayName: "Salad" }],
              attributes: {
                price: { currencyCode: "GBP", units: "8", nanos: 0 },
              },
            },
          ],
        },
      ],
    },
    {
      labels: [{ displayName: "Dinner" }],
      sections: [
        {
          labels: [{ displayName: "Mains" }],
          items: [
            {
              labels: [{ displayName: "Curry" }],
              attributes: {
                price: { currencyCode: "GBP", units: "12", nanos: 0 },
              },
            },
          ],
        },
      ],
    },
  ]
}

/**
 * The tab's contract: the draft holds the editor's typing state, problems
 * come from `validateMenu` once a review is attempted ("Validate" here),
 * and what is saved is `stripDraftKeys(draft)`.
 */
function Harness({
  initial = fixture(),
  disabled = false,
  onChange = vi.fn(),
}: {
  initial?: FoodMenu[]
  disabled?: boolean
  onChange?: (next: FoodMenu[]) => void
}) {
  const [menus, setMenus] = useState(initial)
  const [attempt, setAttempt] = useState(0)
  const problems = attempt > 0 ? validateMenu(menus) : []
  return (
    <>
      <ValidationSummary errors={problems} focusKey={attempt} />
      <MenuEditor
        menus={menus}
        disabled={disabled}
        problems={problems}
        validationAttempt={attempt}
        onChange={(next) => {
          setMenus(next)
          onChange(next)
        }}
      />
      <button onClick={() => setAttempt((count) => count + 1)}>Validate</button>
      <output data-testid="wire">
        {JSON.stringify(stripDraftKeys(menus))}
      </output>
      <output data-testid="valid">
        {String(validateMenu(menus).length === 0)}
      </output>
    </>
  )
}

function wire() {
  return JSON.parse(screen.getByTestId("wire").textContent ?? "[]")
}

describe("MenuEditor structured workspace", () => {
  it("does not emit a mutation on mount", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(menuSwitcher()).toHaveTextContent(/^Lunch$/)
  })

  it("keeps a decimal point and fractional digits during ordinary typing", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const price = screen.getByLabelText("Price (EUR)")
    await user.clear(price)
    await user.type(price, "12.")
    expect(price).toHaveValue("12.")
    await user.type(price, "50")
    expect(price).toHaveValue("12.50")
    expect(wire()[0].sections[0].items[0].attributes.price).toMatchObject({
      currencyCode: "EUR",
      units: "12",
      nanos: 500000000,
    })
  })

  it("keeps prices exact rather than rounding to two places", async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), {
      target: { value: "12.999" },
    })
    expect(wire()[0].sections[0].items[0].attributes.price).toMatchObject({
      units: "12",
      nanos: 999000000,
    })
    // Unknown attributes beside the price survive the edit.
    expect(wire()[0].sections[0].items[0].attributes.custom).toBe("keep")
  })

  it("does not serialize invalid input and marks it invalid", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const price = screen.getByLabelText("Price (EUR)")
    fireEvent.change(price, { target: { value: "12,50" } })
    expect(price).toHaveValue("12,50")
    expect(screen.getByTestId("valid")).toHaveTextContent("false")
    expect(wire()[0].sections[0].items[0].attributes.price.units).toBe("6")
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    await user.click(screen.getByRole("button", { name: "Validate" }))
    expect(screen.getByLabelText("Price (EUR)")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  })

  it("keeps the currency when a price is cleared and re-entered", () => {
    render(<Harness />)
    const price = screen.getByLabelText("Price (EUR)")
    fireEvent.change(price, { target: { value: "" } })
    expect(wire()[0].sections[0].items[0].attributes.price).toBeUndefined()
    fireEvent.change(screen.getByLabelText("Price (EUR)"), {
      target: { value: "7" },
    })
    expect(wire()[0].sections[0].items[0].attributes.price).toMatchObject({
      currencyCode: "EUR",
      units: "7",
      nanos: 0,
    })
  })

  it("retains unfinished input across a menu switch and shows hidden errors", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await chooseMenu(user, "Dinner")
    fireEvent.change(screen.getByLabelText("Price (GBP)"), {
      target: { value: "." },
    })
    await chooseMenu(user, "Lunch")
    expect(screen.getByTestId("valid")).toHaveTextContent("false")
    await user.click(screen.getByRole("button", { name: "Validate" }))
    expect(menuSwitcher()).toHaveTextContent(/^Dinner$/)
    expect(screen.getByLabelText("Price (GBP)")).toHaveValue(".")
    const summary = screen.getByRole("alert")
    expect(summary).toHaveTextContent("Dinner · Curry")
  })

  it("edits the second menu without overwriting the first", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const first = wire()[0]
    await chooseMenu(user, "Dinner")
    await user.clear(screen.getByLabelText("Menu name"))
    await user.type(screen.getByLabelText("Menu name"), "Evening menu")
    expect(wire()[0]).toEqual(first)
    expect(wire()[1].labels[0].displayName).toBe("Evening menu")
  })

  it("preserves translations and options after a name edit", () => {
    render(<Harness />)
    fireEvent.change(screen.getByDisplayValue("Soup"), {
      target: { value: "Tomato soup" },
    })
    const item = wire()[0].sections[0].items[0]
    expect(item.labels[1]).toEqual({ displayName: "Soupe", languageCode: "fr" })
    expect(item.options).toHaveLength(1)
    expect(item.attributes.custom).toBe("keep")
  })

  it("keeps a raw price when collapsing and reopening its section", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), {
      target: { value: "12." },
    })
    await user.click(screen.getByRole("button", { name: "Collapse Starters" }))
    expect(screen.queryByLabelText("Price (EUR)")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Expand Starters" }))
    expect(screen.getByLabelText("Price (EUR)")).toHaveValue("12.")
  })

  it("cancelled removal makes no data change", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await rowAction(user, "Actions for Soup", "Remove item")
    const dialog = screen.getByRole("alertdialog")
    expect(dialog).toHaveTextContent("Google keeps its menu")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" })
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
  })

  it("undo restores only the removed item, preserving later edits", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await rowAction(user, "Actions for Soup", "Remove item")
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove item",
      })
    )
    expect(screen.queryByDisplayValue("Soup")).not.toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue("Salad"), {
      target: { value: "Garden salad" },
    })
    await user.click(screen.getByRole("button", { name: "Undo removal" }))
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Garden salad")).toBeInTheDocument()
    expect(
      wire()[0].sections[0].items.map(
        (item: { labels: Array<{ displayName: string }> }) =>
          item.labels[0]?.displayName
      )
    ).toEqual(["Soup", "Garden salad"])
  })

  it("confirms the affected item count before removing a section", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await rowAction(user, "Actions for section Starters", "Remove section")
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "2 items will be removed"
    )
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove section",
      })
    )
    expect(wire()[0].sections).toEqual([])
    await user.click(screen.getByRole("button", { name: "Undo removal" }))
    expect(wire()[0].sections[0].items).toHaveLength(2)
  })

  it("removes and restores a whole menu", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Remove menu Lunch" }))
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove menu",
      })
    )
    expect(wire()).toHaveLength(1)
    expect(menuSwitcher()).toHaveTextContent(/^Dinner$/)
    await user.click(screen.getByRole("button", { name: "Undo removal" }))
    expect(wire().map((menu: FoodMenu) => menu.labels)).toEqual([
      [{ displayName: "Lunch" }],
      [{ displayName: "Dinner" }],
    ])
  })

  it("supports reordering without moving raw input to the wrong item", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), {
      target: { value: "12." },
    })
    await rowAction(user, "Actions for Soup", "Move down")
    expect(
      wire()[0].sections[0].items.map(
        (item: { labels: Array<{ displayName: string }> }) =>
          item.labels[0]?.displayName
      )
    ).toEqual(["Salad", "Soup"])
    expect(screen.getByLabelText("Price (EUR)")).toHaveValue("12.")
  })

  it("duplicates an item with its options and independent identity", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await rowAction(user, "Actions for Soup", "Duplicate")
    const copy = screen.getByDisplayValue("Soup (copy)")
    expect(copy).toHaveFocus()
    expect(wire()[0].sections[0].items[1].options).toEqual(
      wire()[0].sections[0].items[0].options
    )
    fireEvent.change(copy, { target: { value: "Soup, large" } })
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
  })

  it("supports the empty to menu to section to item flow", async () => {
    const user = userEvent.setup()
    render(<Harness initial={[]} />)
    await user.click(screen.getByRole("button", { name: "Create menu" }))
    expect(screen.getByLabelText("Menu name")).toHaveFocus()
    await user.type(screen.getByLabelText("Menu name"), "Lunch")
    await user.click(screen.getByRole("button", { name: "Add section" }))
    const section = screen.getByRole("textbox", { name: "Section 1 name" })
    expect(section).toHaveFocus()
    await user.type(section, "Mains")
    await user.click(screen.getByRole("button", { name: "Add item" }))
    await user.type(screen.getByLabelText("Item name"), "Curry")
    expect(screen.getByTestId("valid")).toHaveTextContent("true")
    expect(wire()[0].sections[0].items[0].labels[0].displayName).toBe("Curry")
  })

  it("requires a name for every menu", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "New menu" }))
    expect(screen.getByLabelText("Menu name")).toHaveFocus()
    expect(menuSwitcher()).toHaveTextContent(/^Untitled menu 3$/)
    expect(screen.getByTestId("valid")).toHaveTextContent("false")
    await user.click(screen.getByRole("button", { name: "Validate" }))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Menu 3: name this menu."
    )
  })

  it("renders a labelled preview without treating a missing price as free", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), {
      target: { value: "" },
    })
    await user.click(screen.getByRole("tab", { name: "Preview" }))
    const preview = screen.getByRole("region", { name: "Menu preview" })
    expect(preview).toHaveTextContent("Soup")
    expect(preview).not.toHaveTextContent("€0.00")
    expect(preview).toHaveTextContent("Draft preview only")
    expect(screen.queryByLabelText("Menu name")).not.toBeInTheDocument()
  })

  it("allows navigation but no mutations in read-only mode", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness disabled onChange={onChange} />)
    expect(screen.getByLabelText("Menu name")).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "New menu" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Actions for Soup" })
    ).not.toBeInTheDocument()
    await chooseMenu(user, "Dinner")
    expect(screen.getByDisplayValue("Curry")).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("drops undo for an external draft replacement", async () => {
    const user = userEvent.setup()
    const initial = fixture()
    const { rerender } = render(
      <MenuEditor menus={initial} disabled={false} onChange={() => {}} />
    )
    await rowAction(user, "Actions for Soup", "Remove item")
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove item",
      })
    )
    // The parent ignored the change and replaced the draft (Discard).
    const replacement = fixture()
    replacement[0] = {
      labels: [{ displayName: "Replacement" }],
      sections: [],
    }
    rerender(
      <MenuEditor menus={replacement} disabled={false} onChange={() => {}} />
    )
    expect(screen.getByLabelText("Menu name")).toHaveValue("Replacement")
    expect(screen.queryByDisplayValue("Soup")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Undo removal" })
    ).not.toBeInTheDocument()
  })
})
