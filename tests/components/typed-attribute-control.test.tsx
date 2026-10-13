import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"

/** One answer in the Yes / No / Not set choice named `group`. */
function answer(group: string, option: string) {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option })
}

describe("TypedAttributeControl", () => {
  it("edits one repeated-enum answer without erasing other yes/no answers", async () => {
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/payments", displayName: "Payments", valueType: "REPEATED_ENUM", valueMetadata: [{ value: "cash", displayName: "Cash" }, { value: "card", displayName: "Card" }, { value: "cheque", displayName: "Cheque" }] }} attribute={{ name: "attributes/payments", repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque"] } }} disabled={false} onChange={onChange} onClear={vi.fn()} />)
    // One Yes / No / Not set choice per option, no pop-up per option.
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(answer("Payments: Cash", "Yes")).toBeChecked()
    expect(answer("Payments: Cheque", "No")).toBeChecked()
    expect(answer("Payments: Card", "Not set")).toBeChecked()
    await userEvent.click(answer("Payments: Card", "No"))
    expect(onChange).toHaveBeenCalledWith({ name: "attributes/payments", repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque", "card"] } })
  })
  it("clears the attribute when its final repeated-enum answer becomes unknown", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    render(<TypedAttributeControl metadata={{ parent: "attributes/payments", displayName: "Payments", valueType: "REPEATED_ENUM", valueMetadata: [{ value: "cash", displayName: "Cash" }] }} attribute={{ name: "attributes/payments", repeatedEnumValue: { unsetValues: ["cash"] } }} disabled={false} onChange={onChange} onClear={onClear} />)
    expect(answer("Payments: Cash", "No")).toBeChecked()
    await userEvent.click(answer("Payments: Cash", "Not set"))
    expect(onClear).toHaveBeenCalledWith("attributes/payments")
    expect(onChange).not.toHaveBeenCalled()
  })
  it("makes deprecated Google attributes read-only", () => {
    render(<TypedAttributeControl metadata={{ parent: "attributes/wifi", displayName: "Old Wi-Fi", valueType: "BOOL", deprecated: true }} attribute={{ name: "attributes/wifi", values: [true] }} disabled={false} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByText("Google no longer accepts changes to this attribute.")).toBeVisible()
    expect(screen.queryByRole("radiogroup")).toBeNull()
    expect(screen.queryByRole("radio")).toBeNull()
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
  it("renders a BOOL attribute as a Yes / No / Not set choice and emits the chosen value", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [false] }}
        disabled={false}
        onChange={onChange}
      />
    )
    expect(answer("Wi-Fi", "No")).toBeChecked()
    expect(answer("Wi-Fi", "Yes")).not.toBeChecked()
    await userEvent.click(answer("Wi-Fi", "Yes"))
    expect(onChange).toHaveBeenCalledWith({ name: "attributes/wifi", values: [true] })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it("says when a BOOL attribute is not set, and clears it only once it is", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    const { rerender } = render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={undefined}
        disabled={false}
        onChange={onChange}
        onClear={onClear}
      />
    )
    expect(answer("Wi-Fi", "Not set")).toBeChecked()
    // Choosing the state it is already in does nothing.
    await userEvent.click(answer("Wi-Fi", "Not set"))
    expect(onClear).not.toHaveBeenCalled()
    // No separate small "Clear" button: "Not set" is the clear.
    expect(screen.queryByRole("button", { name: "Clear Wi-Fi" })).toBeNull()
    rerender(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [true] }}
        disabled={false}
        onChange={onChange}
        onClear={onClear}
      />
    )
    await userEvent.click(answer("Wi-Fi", "Not set"))
    expect(onClear).toHaveBeenCalledWith("attributes/wifi")
    expect(onChange).not.toHaveBeenCalled()
  })
  it("offers no way to unset a BOOL attribute the caller cannot clear", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [true] }}
        disabled={false}
        onChange={onChange}
      />
    )
    expect(answer("Wi-Fi", "Not set")).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(answer("Wi-Fi", "Not set"))
    expect(onChange).not.toHaveBeenCalled()
    expect(answer("Wi-Fi", "Yes")).toBeChecked()
  })
  it("disables every answer while the attribute is read-only", () => {
    render(
      <TypedAttributeControl
        metadata={{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }}
        attribute={{ name: "attributes/wifi", values: [true] }}
        disabled
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    )
    for (const option of ["Yes", "No", "Not set"]) expect(answer("Wi-Fi", option)).toHaveAttribute("aria-disabled", "true")
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
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
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
