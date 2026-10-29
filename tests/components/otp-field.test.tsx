import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { OtpField, PinField } from "@/components/ui/otp-field"

function Controlled({
  onComplete,
  length,
}: {
  onComplete?: (v: string) => void
  length?: number
}) {
  const [value, setValue] = useState("")
  return (
    <>
      <OtpField
        aria-label="Verification code"
        length={length}
        value={value}
        onValueChange={setValue}
        onComplete={onComplete}
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe("OtpField", () => {
  it("renders one numeric box per character with one-time-code autofill", () => {
    render(<OtpField aria-label="Verification code" />)
    const boxes = screen.getAllByRole("textbox")
    expect(boxes).toHaveLength(6)
    for (const box of boxes) {
      expect(box).toHaveAttribute("inputmode", "numeric")
      expect(box).toHaveClass(
        "focus:shadow-(--np-focus-halo)",
        "aria-invalid:focus:shadow-np-focus-danger",
        "forced-colors:focus-halo"
      )
    }
    expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code")
    expect(
      screen.getByRole("group", { name: "Verification code" })
    ).toBeInTheDocument()
    expect(boxes[0]).toHaveAccessibleName("Verification code")
    expect(boxes[1]).toHaveAccessibleName("Digit 2 of 6")
  })

  it("moves through the boxes as digits are typed", async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const boxes = screen.getAllByRole("textbox")
    await user.click(boxes[0])
    await user.keyboard("12a3")
    expect(screen.getByTestId("value")).toHaveTextContent("123")
    expect(boxes[2]).toHaveValue("3")
    expect(boxes[3]).toHaveFocus()
  })

  it("fills every box from a pasted code and completes once", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Controlled onComplete={onComplete} />)
    const boxes = screen.getAllByRole("textbox")
    await user.click(boxes[0])
    await user.paste("482915")
    expect(screen.getByTestId("value")).toHaveTextContent("482915")
    expect(boxes.map((box) => (box as HTMLInputElement).value)).toEqual([
      "4",
      "8",
      "2",
      "9",
      "1",
      "5",
    ])
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith("482915")
  })

  it("fires onComplete once when the last digit is typed", async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Controlled length={5} onComplete={onComplete} />)
    await user.click(screen.getAllByRole("textbox")[0])
    await user.keyboard("1234")
    expect(onComplete).not.toHaveBeenCalled()
    await user.keyboard("5")
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith("12345")
  })

  it("takes its group name, description and invalid state from Field", () => {
    render(
      <Field error="That code has expired.">
        <FieldLabel>Sign-in code</FieldLabel>
        <OtpField />
        <FieldDescription>We sent it to your phone.</FieldDescription>
        <FieldError />
      </Field>
    )
    const group = screen.getByRole("group", { name: "Sign-in code" })
    expect(group).toHaveAccessibleDescription(
      "That code has expired. We sent it to your phone."
    )
    const boxes = screen.getAllByRole("textbox")
    expect(boxes[0]).toHaveAccessibleName("Sign-in code")
    for (const box of boxes) expect(box).toHaveAttribute("aria-invalid", "true")
  })

  it("supports alphanumeric codes and disabled", () => {
    render(
      <PinField aria-label="Code" mode="alphanumeric" length={8} disabled />
    )
    const boxes = screen.getAllByRole("textbox")
    expect(boxes).toHaveLength(8)
    expect(boxes[0]).toHaveAttribute("inputmode", "text")
    expect(boxes[1]).toHaveAccessibleName("Character 2 of 8")
    for (const box of boxes) expect(box).toBeDisabled()
  })
})
