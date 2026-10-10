import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"

describe("TypedAttributeControl", () => {
  it("edits one repeated-enum answer without erasing other yes/no answers", async () => {
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/payments", displayName: "Payments", valueType: "REPEATED_ENUM", valueMetadata: [{ value: "cash", displayName: "Cash" }, { value: "card", displayName: "Card" }, { value: "cheque", displayName: "Cheque" }] }} attribute={{ name: "attributes/payments", repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque"] } }} disabled={false} onChange={onChange} onClear={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Payments: Cash" })).toHaveTextContent("Yes")
    expect(screen.getByRole("combobox", { name: "Payments: Cheque" })).toHaveTextContent("No")
    await userEvent.click(screen.getByRole("combobox", { name: "Payments: Card" }))
    await userEvent.click(await screen.findByRole("option", { name: "No" }))
    expect(onChange).toHaveBeenCalledWith({ name: "attributes/payments", repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque", "card"] } })
  })
  it("clears the attribute when its final repeated-enum answer becomes unknown", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/payments", displayName: "Payments", valueType: "REPEATED_ENUM", valueMetadata: [{ value: "cash", displayName: "Cash" }] }} attribute={{ name: "attributes/payments", repeatedEnumValue: { unsetValues: ["cash"] } }} disabled={false} onChange={onChange} onClear={onClear} />)
    await userEvent.click(screen.getByRole("combobox", { name: "Payments: Cash" }))
    await userEvent.click(await screen.findByRole("option", { name: "Not set" }))
    expect(onClear).toHaveBeenCalledWith("attributes/payments")
    expect(onChange).not.toHaveBeenCalled()
  })
  it("makes deprecated Google attributes read-only", () => {
    render(<TypedAttributeControl metadata={{ parent: "attributes/wifi", displayName: "Old Wi-Fi", valueType: "BOOL", deprecated: true }} attribute={{ name: "attributes/wifi", values: [true] }} disabled={false} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByText("Google no longer accepts changes to this attribute.")).toBeVisible()
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("offers an explicit clear for an enum answer", async () => {
    const onClear = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "ENUM", valueMetadata: [{ value: "FREE", displayName: "Free" }] }} attribute={{ name: "attributes/wifi", values: ["FREE"] }} disabled={false} onChange={vi.fn()} onClear={onClear} />)
    await userEvent.click(screen.getByRole("button", { name: "Clear Wi-Fi" }))
    expect(onClear).toHaveBeenCalledWith("attributes/wifi")
  })
  it("preserves sibling URLs when editing the first URL", () => {
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/menu", displayName: "Menu", valueType: "URL", repeatable: true }} attribute={{ name: "attributes/menu", uriValues: [{ uri: "https://example.com/1" }, { uri: "https://example.com/2" }] }} disabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Menu URL 1" }), { target: { value: "https://example.com/new" } })
    expect(onChange).toHaveBeenCalledWith({ name: "attributes/menu", uriValues: [{ uri: "https://example.com/new" }, { uri: "https://example.com/2" }] })
  })
  it("removes a specific URL and adds a valid URL without replacing siblings", async () => {
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/menu", displayName: "Menu", valueType: "URL", repeatable: true }} attribute={{ name: "attributes/menu", uriValues: [{ uri: "https://example.com/1" }, { uri: "https://example.com/2" }] }} disabled={false} onChange={onChange} onClear={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Remove Menu URL 2" }))
    expect(onChange).toHaveBeenLastCalledWith({ name: "attributes/menu", uriValues: [{ uri: "https://example.com/1" }] })
    const add = screen.getByRole("button", { name: "Add URL" })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: "New Menu URL" }), { target: { value: "https://example.com/3" } })
    await userEvent.click(add)
    expect(onChange).toHaveBeenLastCalledWith({ name: "attributes/menu", uriValues: [{ uri: "https://example.com/1" }, { uri: "https://example.com/2" }, { uri: "https://example.com/3" }] })
  })
  it("clears a repeatable URL attribute when the last URL is removed", async () => {
    const onClear = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/menu", displayName: "Menu", valueType: "URL", repeatable: true }} attribute={{ name: "attributes/menu", uriValues: [{ uri: "https://example.com/1" }] }} disabled={false} onChange={vi.fn()} onClear={onClear} />)
    await userEvent.click(screen.getByRole("button", { name: "Remove Menu URL 1" }))
    expect(onClear).toHaveBeenCalledWith("attributes/menu")
  })
  it("clears a URL by removing its attribute rather than sending empty URI values", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/menu", displayName: "Menu URL", valueType: "URL" }} attribute={{ name: "attributes/menu", uriValues: [{ uri: "https://example.com" }] }} disabled={false} onChange={onChange} onClear={onClear} />)
    await userEvent.clear(screen.getByRole("textbox", { name: "Menu URL" }))
    expect(onClear).toHaveBeenCalledWith("attributes/menu")
    expect(onChange).not.toHaveBeenCalled()
  })
  it("renders a BOOL attribute as a switch and emits the toggled value", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [false] }}
        disabled={false}
        onChange={onChange}
      />
    )
    expect(screen.getByText("No")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("switch", { name: "Wi-Fi" }))
    expect(onChange).toHaveBeenCalledWith({ name: "attributes/wifi", values: [true] })
  })
  it("says when a BOOL attribute is not set, and offers Clear only once it is", async () => {
    const onClear = vi.fn()
    const { rerender } = render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={undefined}
        disabled={false}
        onChange={() => {}}
        onClear={onClear}
      />
    )
    expect(screen.getByText("Not set")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Clear Wi-Fi" })).toBeNull()
    rerender(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [true] }}
        disabled={false}
        onChange={() => {}}
        onClear={onClear}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Clear Wi-Fi" }))
    expect(onClear).toHaveBeenCalledWith("attributes/wifi")
  })
  it("renders an unsupported valueType read-only with the pressure-valve note (§12)", () => {
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/menu", displayName: "Menu", valueType: "PHOTOS_LIST" }}
        attribute={undefined}
        disabled={false}
        onChange={() => {}}
      />
    )
    expect(screen.getByText(/not editable here yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
  it("renders an ENUM attribute as a select whose trigger shows the option's display name, never the raw value", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/wheelchair",
          displayName: "Wheelchair access",
          valueType: "ENUM",
          valueMetadata: [
            { value: "FULL", displayName: "Full access" },
            { value: "PARTIAL", displayName: "Partial access" },
          ],
        }}
        attribute={{ name: "attributes/wheelchair", values: ["FULL"] }}
        disabled={false}
        onChange={onChange}
      />
    )
    const trigger = screen.getByRole("combobox", { name: "Wheelchair access" })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole("option", { name: "Partial access" }))
    expect(onChange).toHaveBeenCalledWith({
      name: "attributes/wheelchair",
      values: ["PARTIAL"],
    })
  })
})
