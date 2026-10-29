import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  attributeFieldId,
  TypedAttributeControl,
} from "@/components/locations/typed-attribute-control"

/** One answer in the Yes / No / Not set choice named `group`. */
function answer(group: string, option: string) {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole(
    "radio",
    { name: option }
  )
}

describe("TypedAttributeControl", () => {
  it("edits one repeated-enum answer without erasing other yes/no answers", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/payments",
          displayName: "Payments",
          valueType: "REPEATED_ENUM",
          valueMetadata: [
            { value: "cash", displayName: "Cash" },
            { value: "card", displayName: "Card" },
            { value: "cheque", displayName: "Cheque" },
          ],
        }}
        attribute={{
          name: "attributes/payments",
          repeatedEnumValue: { setValues: ["cash"], unsetValues: ["cheque"] },
        }}
        disabled={false}
        onChange={onChange}
        onClear={vi.fn()}
      />
    )
    // One Yes / No / Not set choice per option, no pop-up per option.
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(answer("Payments: Cash", "Yes")).toBeChecked()
    expect(answer("Payments: Cheque", "No")).toBeChecked()
    expect(answer("Payments: Card", "Not set")).toBeChecked()
    await userEvent.click(answer("Payments: Card", "No"))
    expect(onChange).toHaveBeenCalledWith({
      name: "attributes/payments",
      repeatedEnumValue: {
        setValues: ["cash"],
        unsetValues: ["cheque", "card"],
      },
    })
  })
  it("clears the attribute when its final repeated-enum answer becomes unknown", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/payments",
          displayName: "Payments",
          valueType: "REPEATED_ENUM",
          valueMetadata: [{ value: "cash", displayName: "Cash" }],
        }}
        attribute={{
          name: "attributes/payments",
          repeatedEnumValue: { unsetValues: ["cash"] },
        }}
        disabled={false}
        onChange={onChange}
        onClear={onClear}
      />
    )
    expect(answer("Payments: Cash", "No")).toBeChecked()
    await userEvent.click(answer("Payments: Cash", "Not set"))
    expect(onClear).toHaveBeenCalledWith("attributes/payments")
    expect(onChange).not.toHaveBeenCalled()
  })
  it("makes deprecated Google attributes read-only", () => {
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/wifi",
          displayName: "Old Wi-Fi",
          valueType: "BOOL",
          deprecated: true,
        }}
        attribute={{ name: "attributes/wifi", values: [true] }}
        disabled={false}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    )
    expect(
      screen.getByText("Google no longer accepts changes to this attribute.")
    ).toBeVisible()
    expect(screen.queryByRole("radiogroup")).toBeNull()
    expect(screen.queryByRole("radio")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("offers an explicit clear for an enum answer", async () => {
    const onClear = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/wifi",
          displayName: "Wi-Fi",
          valueType: "ENUM",
          valueMetadata: [{ value: "FREE", displayName: "Free" }],
        }}
        attribute={{ name: "attributes/wifi", values: ["FREE"] }}
        disabled={false}
        onChange={vi.fn()}
        onClear={onClear}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Clear Wi-Fi" }))
    expect(onClear).toHaveBeenCalledWith("attributes/wifi")
  })
  it("preserves sibling URLs when editing the first URL", () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/menu",
          displayName: "Menu",
          valueType: "URL",
          repeatable: true,
        }}
        attribute={{
          name: "attributes/menu",
          uriValues: [
            { uri: "https://example.com/1" },
            { uri: "https://example.com/2" },
          ],
        }}
        disabled={false}
        onChange={onChange}
      />
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Menu URL 1" }), {
      target: { value: "https://example.com/new" },
    })
    expect(onChange).toHaveBeenCalledWith({
      name: "attributes/menu",
      uriValues: [
        { uri: "https://example.com/new" },
        { uri: "https://example.com/2" },
      ],
    })
  })
  it("removes a specific URL and adds a valid URL without replacing siblings", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/menu",
          displayName: "Menu",
          valueType: "URL",
          repeatable: true,
        }}
        attribute={{
          name: "attributes/menu",
          uriValues: [
            { uri: "https://example.com/1" },
            { uri: "https://example.com/2" },
          ],
        }}
        disabled={false}
        onChange={onChange}
        onClear={vi.fn()}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Menu URL 2" })
    )
    expect(onChange).toHaveBeenLastCalledWith({
      name: "attributes/menu",
      uriValues: [{ uri: "https://example.com/1" }],
    })
    const add = screen.getByRole("button", { name: "Add URL" })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: "New Menu URL" }), {
      target: { value: "https://example.com/3" },
    })
    await userEvent.click(add)
    expect(onChange).toHaveBeenLastCalledWith({
      name: "attributes/menu",
      uriValues: [
        { uri: "https://example.com/1" },
        { uri: "https://example.com/2" },
        { uri: "https://example.com/3" },
      ],
    })
  })
  it("clears a repeatable URL attribute when the last URL is removed", async () => {
    const onClear = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/menu",
          displayName: "Menu",
          valueType: "URL",
          repeatable: true,
        }}
        attribute={{
          name: "attributes/menu",
          uriValues: [{ uri: "https://example.com/1" }],
        }}
        disabled={false}
        onChange={vi.fn()}
        onClear={onClear}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Menu URL 1" })
    )
    expect(onClear).toHaveBeenCalledWith("attributes/menu")
  })
  it("clears a URL by removing its attribute rather than sending empty URI values", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/menu",
          displayName: "Menu URL",
          valueType: "URL",
        }}
        attribute={{
          name: "attributes/menu",
          uriValues: [{ uri: "https://example.com" }],
        }}
        disabled={false}
        onChange={onChange}
        onClear={onClear}
      />
    )
    await userEvent.clear(screen.getByRole("textbox", { name: "Menu URL" }))
    expect(onClear).toHaveBeenCalledWith("attributes/menu")
    expect(onChange).not.toHaveBeenCalled()
  })
  it("renders a BOOL attribute as a Yes / No / Not set choice and emits the chosen value", async () => {
    const onChange = vi.fn()
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/wifi",
          displayName: "Wi-Fi",
          valueType: "BOOL",
        }}
        attribute={{ name: "attributes/wifi", values: [false] }}
        disabled={false}
        onChange={onChange}
      />
    )
    expect(answer("Wi-Fi", "No")).toBeChecked()
    expect(answer("Wi-Fi", "Yes")).not.toBeChecked()
    await userEvent.click(answer("Wi-Fi", "Yes"))
    expect(onChange).toHaveBeenCalledWith({
      name: "attributes/wifi",
      values: [true],
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
  it("says when a BOOL attribute is not set, and clears it only once it is", async () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    const { rerender } = render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/wifi",
          displayName: "Wi-Fi",
          valueType: "BOOL",
        }}
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
        metadata={{
          parent: "attributes/wifi",
          displayName: "Wi-Fi",
          valueType: "BOOL",
        }}
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
        metadata={{
          parent: "attributes/wifi",
          displayName: "Wi-Fi",
          valueType: "BOOL",
        }}
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
        metadata={{
          parent: "attributes/wifi",
          displayName: "Wi-Fi",
          valueType: "BOOL",
        }}
        attribute={{ name: "attributes/wifi", values: [true] }}
        disabled
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    )
    for (const option of ["Yes", "No", "Not set"])
      expect(answer("Wi-Fi", option)).toHaveAttribute("aria-disabled", "true")
  })
  it("renders an unsupported valueType read-only with the pressure-valve note (§12)", () => {
    render(
      <TypedAttributeControl
        metadata={{
          parent: "attributes/menu",
          displayName: "Menu",
          valueType: "PHOTOS_LIST",
        }}
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
    await userEvent.click(
      await screen.findByRole("option", { name: "Partial access" })
    )
    expect(onChange).toHaveBeenCalledWith({
      name: "attributes/wheelchair",
      values: ["PARTIAL"],
    })
  })
  describe('layout="row" (settings-row drawing)', () => {
    it("keeps the BOOL choice named by its label and the same value paths", async () => {
      const onChange = vi.fn()
      const onClear = vi.fn()
      render(
        <TypedAttributeControl
          layout="row"
          description="Free for guests"
          metadata={{
            parent: "attributes/wifi",
            displayName: "Wi-Fi",
            valueType: "BOOL",
          }}
          attribute={{ name: "attributes/wifi", values: [false] }}
          disabled={false}
          onChange={onChange}
          onClear={onClear}
        />
      )
      // The label still names the radio group (aria-labelledby), and the
      // description is drawn under it.
      expect(answer("Wi-Fi", "No")).toBeChecked()
      expect(screen.getByText("Free for guests")).toBeVisible()
      // It describes the control; it is not part of its name.
      expect(
        screen.getByRole("radiogroup", { name: "Wi-Fi" })
      ).toHaveAccessibleDescription("Free for guests")
      await userEvent.click(answer("Wi-Fi", "Yes"))
      expect(onChange).toHaveBeenCalledWith({
        name: "attributes/wifi",
        values: [true],
      })
      await userEvent.click(answer("Wi-Fi", "Not set"))
      expect(onClear).toHaveBeenCalledWith("attributes/wifi")
      expect(onChange).toHaveBeenCalledTimes(1)
    })
    it("keeps the ENUM select named by its label and emits the chosen value", async () => {
      const onChange = vi.fn()
      render(
        <TypedAttributeControl
          layout="row"
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
      await userEvent.click(
        screen.getByRole("combobox", { name: "Wheelchair access" })
      )
      await userEvent.click(
        await screen.findByRole("option", { name: "Partial access" })
      )
      expect(onChange).toHaveBeenCalledWith({
        name: "attributes/wheelchair",
        values: ["PARTIAL"],
      })
    })
    it("draws nothing extra in the default stack layout", () => {
      render(
        <TypedAttributeControl
          description="Free for guests"
          metadata={{
            parent: "attributes/wifi",
            displayName: "Wi-Fi",
            valueType: "BOOL",
          }}
          attribute={{ name: "attributes/wifi", values: [true] }}
          disabled={false}
          onChange={vi.fn()}
        />
      )
      expect(answer("Wi-Fi", "Yes")).toBeChecked()
      expect(screen.queryByText("Free for guests")).toBeNull()
    })
  })
  describe("with an error", () => {
    it("marks a single URL field invalid and describes it with the message", () => {
      render(
        <TypedAttributeControl
          layout="row"
          description="Where the menu lives"
          metadata={{
            parent: "attributes/url_menu",
            displayName: "Menu",
            valueType: "URL",
          }}
          attribute={{
            name: "attributes/url_menu",
            uriValues: [{ uri: "example.com" }],
          }}
          disabled={false}
          onChange={vi.fn()}
          error="Use an http or https link."
        />
      )
      const field = screen.getByRole("textbox", { name: "Menu" })
      // The summary links here.
      expect(field).toHaveAttribute(
        "id",
        attributeFieldId("attributes/url_menu")
      )
      expect(field).toHaveAttribute("aria-invalid", "true")
      // The row's description and the message both describe the field.
      expect(field).toHaveAccessibleDescription(
        "Where the menu lives Use an http or https link."
      )
    })
    it("says nothing without an error", () => {
      render(
        <TypedAttributeControl
          metadata={{
            parent: "attributes/url_menu",
            displayName: "Menu",
            valueType: "URL",
          }}
          attribute={{
            name: "attributes/url_menu",
            uriValues: [{ uri: "example.com" }],
          }}
          disabled={false}
          onChange={vi.fn()}
        />
      )
      const field = screen.getByRole("textbox", { name: "Menu" })
      expect(field).not.toHaveAttribute("aria-invalid")
      expect(field).not.toHaveAttribute("aria-describedby")
    })
    it("marks only the repeated URLs Google can't take, and lands the summary link on the first", () => {
      render(
        <TypedAttributeControl
          metadata={{
            parent: "attributes/menu",
            displayName: "Menu",
            valueType: "URL",
            repeatable: true,
          }}
          attribute={{
            name: "attributes/menu",
            uriValues: [
              { uri: "https://example.com/1" },
              { uri: "example.com/2" },
            ],
          }}
          disabled={false}
          onChange={vi.fn()}
          error="Use an http or https link."
        />
      )
      const first = screen.getByRole("textbox", { name: "Menu URL 1" })
      const second = screen.getByRole("textbox", { name: "Menu URL 2" })
      expect(first).toHaveAttribute("id", attributeFieldId("attributes/menu"))
      expect(first).not.toHaveAttribute("aria-invalid")
      expect(second).toHaveAttribute("aria-invalid", "true")
      expect(second).toHaveAccessibleDescription("Use an http or https link.")
    })
  })
})
