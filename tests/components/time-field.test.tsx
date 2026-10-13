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
import {
  TimeField,
  formatTimeDigits,
  isValidTime,
  normalizeTimeInput,
} from "@/components/ui/time-field"

function Controlled({
  initial = "",
  allowEndOfDay,
  onValueChange,
}: {
  initial?: string
  allowEndOfDay?: boolean
  onValueChange?: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <TimeField
      aria-label="Opens"
      value={value}
      allowEndOfDay={allowEndOfDay}
      onValueChange={(next) => {
        setValue(next)
        onValueChange?.(next)
      }}
    />
  )
}

describe("time helpers", () => {
  it("validates HH:MM with optional 24:00", () => {
    expect(isValidTime("09:30")).toBe(true)
    expect(isValidTime("23:59")).toBe(true)
    expect(isValidTime("24:00")).toBe(true)
    expect(isValidTime("24:00", { allow24: false })).toBe(false)
    expect(isValidTime("24:30")).toBe(false)
    expect(isValidTime("9:30")).toBe(false)
  })

  it("auto-inserts the colon while typing", () => {
    expect(formatTimeDigits("09")).toBe("09")
    expect(formatTimeDigits("093")).toBe("09:3")
    expect(formatTimeDigits("0930")).toBe("09:30")
    expect(formatTimeDigits("930")).toBe("9:30")
    expect(formatTimeDigits("2400")).toBe("24:00")
    expect(formatTimeDigits("240", { allow24: false })).toBe("2:40")
    expect(formatTimeDigits("9:")).toBe("9:")
    expect(formatTimeDigits("a9:3x0:")).toBe("9:30")
  })

  it("normalises on the documented rules and leaves invalid text alone", () => {
    expect(normalizeTimeInput("9")).toBe("09:00")
    expect(normalizeTimeInput("17")).toBe("17:00")
    expect(normalizeTimeInput("930")).toBe("09:30")
    expect(normalizeTimeInput("0930")).toBe("09:30")
    expect(normalizeTimeInput("9:30")).toBe("09:30")
    expect(normalizeTimeInput("9:")).toBe("09:00")
    expect(normalizeTimeInput("2400")).toBe("24:00")
    expect(normalizeTimeInput("2400", { allow24: false })).toBe("2400")
    expect(normalizeTimeInput("9:5")).toBe("9:5")
    expect(normalizeTimeInput("2530")).toBe("2530")
    expect(normalizeTimeInput("")).toBe("")
  })
})

describe("TimeField", () => {
  it("opens the numeric keypad and is a compact HH:MM text field", () => {
    render(<TimeField aria-label="Opens" />)
    const input = screen.getByRole("textbox", { name: "Opens" })
    expect(input).toHaveAttribute("type", "text")
    expect(input).toHaveAttribute("inputmode", "numeric")
    expect(input).toHaveAttribute("autocomplete", "off")
    expect(input).toHaveAttribute("placeholder", "HH:MM")
    expect(input).toHaveAttribute("maxlength", "5")
    expect(input).toHaveAttribute(
      "pattern",
      "(?:[01]\\d|2[0-3]):[0-5]\\d|24:00"
    )
    expect(input.className).toContain("tabular-nums")
  })

  it("inserts the colon as digits are typed", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Controlled onValueChange={onValueChange} />)
    const input = screen.getByRole("textbox", { name: "Opens" })
    await user.type(input, "093")
    expect(input).toHaveValue("09:3")
    await user.type(input, "0")
    expect(input).toHaveValue("09:30")
    expect(onValueChange).toHaveBeenLastCalledWith("09:30")
  })

  it("lets backspace delete through the colon", async () => {
    const user = userEvent.setup()
    render(<Controlled initial="09:30" />)
    const input = screen.getByRole("textbox", { name: "Opens" })
    await user.click(input)
    await user.keyboard("{End}{Backspace}{Backspace}{Backspace}{Backspace}")
    expect(input).toHaveValue("0")
  })

  it("normalises on blur, including 24:00", async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const input = screen.getByRole("textbox", { name: "Opens" })
    await user.type(input, "2400")
    await user.tab()
    expect(input).toHaveValue("24:00")

    await user.clear(input)
    await user.type(input, "9")
    await user.tab()
    expect(input).toHaveValue("09:00")
  })

  it("does not treat 24 as an hour when allowEndOfDay is false", async () => {
    const user = userEvent.setup()
    render(<Controlled allowEndOfDay={false} />)
    const input = screen.getByRole("textbox", { name: "Opens" })
    expect(input).toHaveAttribute("pattern", "(?:[01]\\d|2[0-3]):[0-5]\\d")
    await user.type(input, "240")
    expect(input).toHaveValue("2:40")
    await user.tab()
    expect(input).toHaveValue("02:40")
  })

  it("leaves invalid text as typed on blur", async () => {
    const user = userEvent.setup()
    render(<TimeField aria-label="Closes" defaultValue="" />)
    const input = screen.getByRole("textbox", { name: "Closes" })
    await user.type(input, "9:5")
    await user.tab()
    expect(input).toHaveValue("9:5")
  })

  it("passes the formatted value to a plain onChange", async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    render(
      <TimeField
        aria-label="Opens"
        onChange={(event) => seen.push(event.target.value)}
      />
    )
    await user.type(screen.getByRole("textbox", { name: "Opens" }), "930")
    expect(seen.at(-1)).toBe("9:30")
  })

  it("takes its name, description and error from Field", () => {
    render(
      <Field error="Enter a time as HH:MM.">
        <FieldLabel>Opens at</FieldLabel>
        <TimeField defaultValue="9:5" />
        <FieldDescription>Use 24:00 for midnight.</FieldDescription>
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Opens at" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription(
      "Enter a time as HH:MM. Use 24:00 for midnight."
    )
  })

  it("lets explicit aria props override the Field wiring", () => {
    render(
      <Field error="Bad">
        <FieldLabel>Opens at</FieldLabel>
        <TimeField id="custom" aria-describedby="elsewhere" />
      </Field>
    )
    const input = screen.getByRole("textbox")
    expect(input).toHaveAttribute("id", "custom")
    expect(input).toHaveAttribute("aria-describedby", "elsewhere")
  })
})
