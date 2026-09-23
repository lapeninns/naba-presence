import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"

describe("TypedAttributeControl", () => {
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
        attribute={{ name: "attributes/wheelchair", repeatedEnumValue: { setValues: ["FULL"] } }}
        disabled={false}
        onChange={onChange}
      />
    )
    const trigger = screen.getByRole("combobox", { name: "Wheelchair access" })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole("option", { name: "Partial access" }))
    expect(onChange).toHaveBeenCalledWith({
      name: "attributes/wheelchair",
      repeatedEnumValue: { setValues: ["PARTIAL"] },
    })
  })
})
