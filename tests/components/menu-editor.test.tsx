import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuEditor, type MenuEditorValidation } from "@/components/locations/menu-editor"
import type { FoodMenu } from "@/lib/api/location-menu"

vi.mock("@/lib/hooks/use-dirty-guard", () => ({ useDirtyGuard: () => ({ confirmDiscard: vi.fn(), restore: vi.fn() }) }))

afterEach(() => vi.clearAllMocks())

function fixture(): FoodMenu[] {
  return [
    { labels: [{ displayName: "Lunch" }], sections: [{ labels: [{ displayName: "Starters" }], items: [
      { labels: [{ displayName: "Soup", description: "Made fresh" }, { displayName: "Soupe", languageCode: "fr" }], attributes: { price: { currencyCode: "EUR", units: "6", nanos: 500000000 }, custom: "keep" }, options: [{ labels: [{ displayName: "Large" }] }] },
      { labels: [{ displayName: "Salad" }], attributes: { price: { currencyCode: "GBP", units: "8", nanos: 0 } } },
    ] }] },
    { labels: [{ displayName: "Dinner" }], sections: [{ labels: [{ displayName: "Mains" }], items: [{ labels: [{ displayName: "Curry" }], attributes: { price: { currencyCode: "GBP", units: "12", nanos: 0 } } }] }] },
  ]
}

function Harness({ initial = fixture(), disabled = false, onChange = vi.fn() }: { initial?: FoodMenu[]; disabled?: boolean; onChange?: (next: FoodMenu[]) => void }) {
  const [menus, setMenus] = useState(initial)
  const [validation, setValidation] = useState<MenuEditorValidation>({ valid: true, hasUncommittedInput: false })
  return <>
    <MenuEditor menus={menus} disabled={disabled} onChange={(next) => { setMenus(next); onChange(next) }} onValidationChange={setValidation} />
    <output data-testid="wire">{JSON.stringify(menus)}</output>
    <output data-testid="valid">{String(validation.valid)}</output>
  </>
}

function wire() { return JSON.parse(screen.getByTestId("wire").textContent ?? "[]") }

describe("MenuEditor rebuilt workspace", () => {
  it("does not emit a mutation on mount", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(screen.getByLabelText("Menu")).toHaveDisplayValue("Lunch")
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
    expect(wire()[0].sections[0].items[0].attributes.price).toMatchObject({ currencyCode: "EUR", units: "12", nanos: 500000000 })
  })
  it("does not serialize invalid input and marks it invalid", () => {
    render(<Harness />)
    const price = screen.getByLabelText("Price (EUR)")
    fireEvent.change(price, { target: { value: "12,50" } })
    expect(price).toHaveValue("12,50")
    expect(price).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByTestId("valid")).toHaveTextContent("false")
    expect(wire()[0].sections[0].items[0].attributes.price.units).toBe("6")
    expect(screen.getByRole("tab", { name: "Preview" })).toBeDisabled()
  })
  it("retains unfinished input across a menu switch and finds hidden errors", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.selectOptions(screen.getByLabelText("Menu"), screen.getByRole("option", { name: "Dinner" }))
    fireEvent.change(screen.getByLabelText("Price (GBP)"), { target: { value: "." } })
    await user.selectOptions(screen.getByLabelText("Menu"), screen.getByRole("option", { name: "Lunch" }))
    expect(screen.getByTestId("valid")).toHaveTextContent("false")
    await user.click(screen.getByRole("button", { name: "Go to first issue" }))
    expect(screen.getByLabelText("Menu")).toHaveDisplayValue("Dinner")
    expect(screen.getByLabelText("Price (GBP)")).toHaveValue(".")
  })
  it("edits the second menu without overwriting the first", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const first = wire()[0]
    await user.selectOptions(screen.getByLabelText("Menu"), screen.getByRole("option", { name: "Dinner" }))
    await user.clear(screen.getByLabelText("Menu name"))
    await user.type(screen.getByLabelText("Menu name"), "Evening menu")
    expect(wire()[0]).toEqual(first)
    expect(wire()[1].labels[0].displayName).toBe("Evening menu")
  })
  it("preserves translations and options after a name edit", () => {
    render(<Harness />)
    fireEvent.change(screen.getByDisplayValue("Soup"), { target: { value: "Tomato soup" } })
    const item = wire()[0].sections[0].items[0]
    expect(item.labels[1]).toEqual({ displayName: "Soupe", languageCode: "fr" })
    expect(item.options).toHaveLength(1)
    expect(item.attributes.custom).toBe("keep")
  })
  it("keeps a raw price when collapsing and reopening its section", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), { target: { value: "12." } })
    const toggle = screen.getByRole("button", { name: /Starters.*2 items/ })
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    await user.click(toggle)
    expect(screen.getByLabelText("Price (EUR)")).toHaveValue("12.")
  })
  it("cancelled removal makes no data change", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "Remove Soup", exact: true }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
  })
  it("undo restores only the removed item, preserving later edits", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Remove Soup", exact: true }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove item", exact: true }))
    fireEvent.change(screen.getByDisplayValue("Salad"), { target: { value: "Garden salad" } })
    await user.click(screen.getByRole("button", { name: "Undo removal" }))
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Garden salad")).toBeInTheDocument()
  })
  it("confirms the affected item count before removing a section", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Remove section Starters" }))
    expect(screen.getByRole("alertdialog")).toHaveTextContent("2 items will be removed")
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove section", exact: true }))
    expect(wire()[0].sections).toEqual([])
    await user.click(screen.getByRole("button", { name: "Undo removal" }))
    expect(wire()[0].sections[0].items).toHaveLength(2)
  })
  it("supports reordering without moving raw input to the wrong item", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), { target: { value: "12." } })
    await user.click(screen.getByRole("button", { name: "Move Soup down" }))
    expect(wire()[0].sections[0].items.map((item: { labels: Array<{ displayName: string }> }) => item.labels[0]?.displayName)).toEqual(["Salad", "Soup"])
    expect(screen.getByLabelText("Price (EUR)")).toHaveValue("12.")
  })
  it("duplicates an item with its options and independent identity", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Duplicate Soup" }))
    expect(screen.getByDisplayValue("Soup (copy)")).toBeInTheDocument()
    expect(wire()[0].sections[0].items[1].options).toEqual(wire()[0].sections[0].items[0].options)
  })
  it("supports the empty to menu to section to item flow", async () => {
    const user = userEvent.setup()
    render(<Harness initial={[]} />)
    await user.click(screen.getByRole("button", { name: "Create menu" }))
    await user.type(screen.getByLabelText("Menu name"), "Lunch")
    await user.click(screen.getByRole("button", { name: "Add section" }))
    await user.type(screen.getByLabelText("Section name"), "Mains")
    await user.click(screen.getByRole("button", { name: "Add item" }))
    await user.type(screen.getByLabelText("Item name"), "Curry")
    expect(screen.getByTestId("valid")).toHaveTextContent("true")
    expect(wire()[0].sections[0].items[0].labels[0].displayName).toBe("Curry")
  })
  it("renders a labelled preview without treating a missing price as free", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    fireEvent.change(screen.getByLabelText("Price (EUR)"), { target: { value: "" } })
    await user.click(screen.getByRole("tab", { name: "Preview" }))
    const preview = screen.getByRole("region", { name: "Menu preview" })
    expect(preview).toHaveTextContent("Soup")
    expect(preview).not.toHaveTextContent("€0.00")
    expect(preview).toHaveTextContent("Draft preview only")
  })
  it("allows navigation but no mutations in read-only mode", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness disabled onChange={onChange} />)
    expect(screen.getByLabelText("Menu name")).toBeDisabled()
    expect(screen.queryByRole("button", { name: "New menu" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove Soup", exact: true })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("Menu"), screen.getByRole("option", { name: "Dinner" }))
    expect(screen.getByDisplayValue("Curry")).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
  it("resets raw inputs and undo state for an external draft replacement", () => {
    const initial = fixture()
    const { rerender } = render(<MenuEditor menus={initial} disabled={false} onChange={() => {}} />)
    const replacement = fixture()
    replacement[0] = { labels: [{ displayName: "Replacement" }], sections: [] }
    rerender(<MenuEditor menus={replacement} disabled={false} onChange={() => {}} />)
    expect(screen.getByDisplayValue("Replacement")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("Soup")).not.toBeInTheDocument()
  })
})
