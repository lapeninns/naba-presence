import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { filterChipClassName } from "@/components/ui/chip"
import { ChoiceCard } from "@/components/ui/choice-card"
import {
  Field,
  FieldError,
  FieldLabel,
  FormError,
  FormErrorScope,
} from "@/components/ui/field"
import {
  FieldGroup,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
} from "@/components/ui/fieldset"
import { Input, inputHints } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ValidationSummary } from "@/components/ui/validation-summary"

describe("FieldError", () => {
  it("renders its children even when the Field has no error, and marks the control invalid", () => {
    render(
      <Field>
        <FieldLabel>Destination Google account</FieldLabel>
        <Input />
        <FieldError>Select an exact Google account resource.</FieldError>
      </Field>
    )
    const input = screen.getByRole("textbox", {
      name: "Destination Google account",
    })
    expect(
      screen.getByText("Select an exact Google account resource.")
    ).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription(
      "Select an exact Google account resource."
    )
  })

  it("falls back to the Field error when children are empty", () => {
    render(
      <Field error="Enter an email.">
        <FieldLabel>Email</FieldLabel>
        <Input />
        <FieldError>{undefined}</FieldError>
      </Field>
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an email.")
  })

  it("clears the invalid state when a children-only error unmounts", () => {
    const { rerender } = render(
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input />
        <FieldError>Too short.</FieldError>
      </Field>
    )
    rerender(
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Name" })
    expect(input).not.toHaveAttribute("aria-invalid")
    expect(input).not.toHaveAttribute("aria-describedby")
  })

  it("is one alert per field outside a FormErrorScope (unchanged default)", () => {
    render(
      <>
        <Field error="One.">
          <Input aria-label="a" />
          <FieldError />
        </Field>
        <Field error="Two.">
          <Input aria-label="b" />
          <FieldError />
        </Field>
      </>
    )
    expect(screen.getAllByRole("alert")).toHaveLength(2)
  })

  it("respects an explicit announce override", () => {
    render(
      <Field error="Quiet.">
        <Input aria-label="a" />
        <FieldError announce="off" />
      </Field>
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("FormErrorScope", () => {
  function Form({ summary }: { summary: boolean }) {
    return (
      <FormErrorScope>
        {summary ? (
          <ValidationSummary
            errors={[
              { fieldId: "a", message: "Enter a name." },
              { fieldId: "b", message: "Enter a phone number." },
            ]}
          />
        ) : null}
        <Field error="Enter a name.">
          <Input aria-label="Name" />
          <FieldError />
        </Field>
        <Field error="Enter a phone number.">
          <Input aria-label="Phone" />
          <FieldError />
        </Field>
      </FormErrorScope>
    )
  }

  it("silences field errors and speaks once through a single polite region", () => {
    const { container } = render(<Form summary={false} />)
    expect(screen.queryAllByRole("alert")).toHaveLength(0)
    const regions = container.querySelectorAll("[aria-live]")
    expect(regions).toHaveLength(1)
    expect(regions[0]).toHaveAttribute("aria-live", "polite")
    expect(regions[0]).toHaveTextContent(
      "Enter a name. 1 more field needs attention."
    )
    // The errors still describe their controls.
    expect(
      screen.getByRole("textbox", { name: "Phone" })
    ).toHaveAccessibleDescription("Enter a phone number.")
  })

  it("leaves the announcement to the ValidationSummary when one is shown", () => {
    const { container } = render(<Form summary />)
    const alerts = screen.getAllByRole("alert")
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveAttribute("data-slot", "validation-summary")
    expect(alerts[0]).toHaveClass(
      "focus-visible:shadow-np-focus-danger",
      "forced-colors:focus-halo"
    )
    expect(
      container.querySelector("[data-slot=form-error-announcer]")
    ).toBeEmptyDOMElement()
  })
})

describe("FormError", () => {
  it("renders nothing without children and an alert with them", () => {
    const { rerender } = render(<FormError>{null}</FormError>)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    rerender(<FormError>Google refused the request.</FormError>)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google refused the request."
    )
  })
})

describe("Fieldset", () => {
  it("names the group by its legend and describes it", () => {
    render(
      <Fieldset>
        <FieldsetLegend>Notify me about</FieldsetLegend>
        <FieldsetDescription>Sent to your account email.</FieldsetDescription>
        <FieldGroup>
          <Checkbox label="New reviews" />
          <Checkbox label="Failed publishes" />
        </FieldGroup>
      </Fieldset>
    )
    const group = screen.getByRole("group", { name: "Notify me about" })
    expect(group).toHaveAccessibleDescription("Sent to your account email.")
    expect(within(group).getAllByRole("checkbox")).toHaveLength(2)
  })

  it("keeps the name when the legend is visually hidden", () => {
    render(
      <Fieldset>
        <FieldsetLegend srOnly>Opening days</FieldsetLegend>
      </Fieldset>
    )
    const group = screen.getByRole("group", { name: "Opening days" })
    expect(group.querySelector("[data-slot=fieldset-legend]")).toHaveClass(
      "sr-only"
    )
  })
})

describe("Checkbox and radio touch targets", () => {
  it("gives an unlabelled checkbox a hit area that reaches --np-touch", () => {
    render(<Checkbox aria-label="Select review" />)
    const box = screen.getByRole("checkbox", { name: "Select review" })
    expect(box.className).toContain(
      "after:inset-[calc((100%-var(--np-touch))/2)]"
    )
    expect(box.className).toContain(
      "desk:after:inset-[calc((100%-var(--np-touch-min))/2)]"
    )
  })

  it("makes a labelled row the 44px target and fades a disabled control once", () => {
    render(<Checkbox label="Include replies" disabled />)
    const box = screen.getByRole("checkbox", { name: "Include replies" })
    const row = box.closest("label")!
    expect(row.className).toContain("min-h-(--np-touch)")
    expect(row.className).not.toMatch(/opacity/)
    expect(box.className).not.toContain("var(--np-touch)")
  })

  it("toggles when the label words are tapped", async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Include replies" />)
    await user.click(screen.getByText("Include replies"))
    expect(
      screen.getByRole("checkbox", { name: "Include replies" })
    ).toBeChecked()
  })

  it("gives unlabelled radios the hit area and labelled radio rows the touch height", () => {
    render(
      <RadioGroup aria-label="Tone" defaultValue="warm">
        <RadioGroupItem value="warm">Warm</RadioGroupItem>
        <RadioGroupItem value="brief" aria-label="Brief" />
      </RadioGroup>
    )
    expect(
      screen.getByRole("radio", { name: "Warm" }).closest("label")!.className
    ).toContain("min-h-(--np-touch)")
    expect(screen.getByRole("radio", { name: "Brief" }).className).toContain(
      "after:inset-[calc((100%-var(--np-touch))/2)]"
    )
  })
})

describe("ChoiceCard", () => {
  it("renders the aside slot and does not fade the ring a second time", () => {
    render(
      <RadioGroup aria-label="Plan" defaultValue="a">
        <ChoiceCard value="a" title="Monthly" aside="£12" />
        <ChoiceCard value="b" title="Yearly" disabled />
      </RadioGroup>
    )
    expect(screen.getByText("£12")).toHaveAttribute(
      "data-slot",
      "choice-card-aside"
    )
    expect(screen.getByRole("radio", { name: "Yearly" }).className).toContain(
      "data-disabled:opacity-100"
    )
  })
})

describe("Switch", () => {
  it("names itself by label and describes itself by description", () => {
    render(
      <Switch
        label="Auto-publish 5-star replies"
        description="Replies to five-star reviews go live without approval."
      />
    )
    const sw = screen.getByRole("switch", {
      name: "Auto-publish 5-star replies",
    })
    expect(sw).toHaveAccessibleDescription(
      "Replies to five-star reviews go live without approval."
    )
    expect(sw.closest("label")!.className).toContain("min-h-(--np-touch)")
  })

  it("toggles when the label is tapped", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch label="Weekly digest" onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByText("Weekly digest"))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it("keeps a caller's aria-describedby after its own description", () => {
    render(
      <>
        <p id="extra">Owners only.</p>
        <Switch
          label="Billing"
          description="Monthly invoice."
          aria-describedby="extra"
        />
      </>
    )
    expect(
      screen.getByRole("switch", { name: "Billing" })
    ).toHaveAccessibleDescription("Monthly invoice. Owners only.")
  })

  it("still works unlabelled with aria-label, keeping the existing API", () => {
    render(<Switch aria-label="Enabled" />)
    expect(screen.getByRole("switch", { name: "Enabled" })).not.toHaveAttribute(
      "aria-describedby"
    )
  })
})

describe("Textarea", () => {
  afterEach(() => vi.restoreAllMocks())

  it("hides the resize grip on touch and keeps it at the desk", () => {
    render(<Textarea aria-label="Notes" />)
    const el = screen.getByRole("textbox", { name: "Notes" })
    expect(el.className).toContain("resize-none")
    expect(el.className).toContain("desk:resize-y")
    expect(el).toHaveClass(
      "focus:shadow-(--np-focus-halo)",
      "forced-colors:focus-halo"
    )
  })

  it("autoSize grows with content between minRows and maxRows", async () => {
    // Pretend the engine lacks field-sizing, to exercise the measured fallback.
    vi.spyOn(CSS, "supports").mockReturnValue(false)
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get"
    ).mockReturnValue(500)
    function Controlled() {
      const [value, setValue] = useState("")
      return (
        <Textarea
          aria-label="Reply"
          autoSize
          minRows={2}
          maxRows={4}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )
    }
    const user = userEvent.setup()
    render(<Controlled />)
    const el = screen.getByRole("textbox", { name: "Reply" })
    expect(el).toHaveAttribute("data-autosize", "true")
    expect(el).toHaveStyle({ minHeight: "60px", maxHeight: "104px" })
    await user.type(el, "a long reply")
    // Clamped to maxRows (4 × 22 + 16).
    expect(el.style.height).toBe("104px")
    expect(el.className).toContain("field-sizing-content")
  })
})

describe("Input hints", () => {
  it("passes identifier hints straight through", () => {
    render(<Input aria-label="Account" {...inputHints.identifier} />)
    const input = screen.getByRole("textbox", { name: "Account" })
    expect(input).toHaveAttribute("autocapitalize", "none")
    expect(input).toHaveAttribute("autocorrect", "off")
    expect(input).toHaveAttribute("spellcheck", "false")
  })

  it("uses the touch-first body size rather than a coarse-pointer patch", () => {
    render(<Input aria-label="Name" />)
    const input = screen.getByRole("textbox", { name: "Name" })
    expect(input.className).toContain("text-body")
    expect(input.className).not.toContain("pointer-coarse:text-base")
  })
})

describe("touch overhangs measure from the padding box", () => {
  // A fixed -4px overhang on a 36px control with a 1px border reached only
  // 34 + 8 = 42px (pseudo-element insets resolve against the padding box);
  // a percentage of that same box always comes to --np-touch.
  it("gives a small button and a small icon button a 44px touch band", () => {
    render(
      <>
        <Button size="sm">Show values</Button>
        <Button size="icon-sm" aria-label="More" />
      </>
    )
    expect(screen.getByRole("button", { name: "Show values" })).toHaveClass(
      "after:inset-y-[calc((100%-var(--np-touch))/2)]",
      "desk:after:hidden"
    )
    expect(screen.getByRole("button", { name: "More" })).toHaveClass(
      "after:inset-[calc((100%-var(--np-touch))/2)]"
    )
  })

  it("gives a chip a 44px touch band", () => {
    expect(filterChipClassName()).toContain(
      "after:inset-y-[calc((100%-var(--np-touch))/2)]"
    )
  })
})
