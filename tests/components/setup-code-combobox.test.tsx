import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"

import { CodeCombobox } from "@/components/setup/code-combobox"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  codeLabel,
  countryOptions,
  languageOptions,
  typedCountryCode,
  typedLanguageTag,
  withCurrent,
} from "@/lib/setup/onboarding-codes"

function Language({
  initial,
  spy,
}: {
  initial: string
  spy?: (code: string) => void
}) {
  const [value, setValue] = React.useState(initial)
  const options = withCurrent(languageOptions(), value, "language")
  return (
    <Field>
      <FieldLabel>Listing language</FieldLabel>
      <CodeCombobox
        title="Listing language"
        value={value}
        options={options}
        typed={(text) => typedLanguageTag(text, options)}
        label={(code) => codeLabel("language", code)}
        onValueChange={(code) => {
          spy?.(code)
          setValue(code)
        }}
      />
      <output data-testid="value">{value}</output>
    </Field>
  )
}

describe("CodeCombobox", () => {
  it("is labelled by its field and shows the saved code by name", () => {
    render(<Language initial="en-GB" />)
    const input = screen.getByRole("combobox", { name: "Listing language" })
    expect(input).toHaveValue("English (UK) · en-GB")
  })

  it("commits a whole typed code on leaving the field, like the old text field", async () => {
    const spy = vi.fn()
    render(<Language initial="en-GB" spy={spy} />)
    const input = screen.getByRole("combobox", { name: "Listing language" })
    await userEvent.clear(input)
    await userEvent.type(input, "cy")
    // Not mid-typing: "cy" could still be on the way to something else.
    expect(spy).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(screen.getByTestId("value")).toHaveTextContent(/^cy$/)
    expect(spy).toHaveBeenLastCalledWith("cy")
    expect(input).toHaveValue("Welsh · cy")
  })

  it("commits a picked option", async () => {
    render(<Language initial="en-GB" />)
    const input = screen.getByRole("combobox", { name: "Listing language" })
    await userEvent.clear(input)
    await userEvent.type(input, "Germ")
    await userEvent.click(await screen.findByRole("option", { name: "German · de" }))
    expect(screen.getByTestId("value")).toHaveTextContent(/^de$/)
  })

  it("keeps a saved code outside the list instead of dropping it", () => {
    render(<Language initial="sw-KE" />)
    expect(screen.getByTestId("value")).toHaveTextContent("sw-KE")
    const input = screen.getByRole("combobox", { name: "Listing language" })
    expect((input as HTMLInputElement).value).toContain("sw-KE")
  })

  it("offers a well-formed typed tag that is not listed", async () => {
    render(<Language initial="en-GB" />)
    const input = screen.getByRole("combobox", { name: "Listing language" })
    await userEvent.clear(input)
    await userEvent.type(input, "mi-NZ")
    await userEvent.tab()
    expect(screen.getByTestId("value")).toHaveTextContent("mi-NZ")
  })

  it("Escape keeps the chosen value, by name", async () => {
    render(<Language initial="en-GB" />)
    const input = screen.getByRole("combobox", { name: "Listing language" })
    await userEvent.clear(input)
    await userEvent.type(input, "Fren")
    expect(screen.getByTestId("value")).toHaveTextContent("en-GB")
    await userEvent.keyboard("{Escape}")
    expect(input).toHaveValue("English (UK) · en-GB")
  })
})

describe("country codes", () => {
  it("accepts any two-letter code the schema accepts", () => {
    const options = countryOptions()
    expect(options.some((o) => o.code === "GB")).toBe(true)
    expect(typedCountryCode("xk", options)).toBe("XK")
    expect(typedCountryCode("gb", options)).toBeNull()
    expect(typedCountryCode("GBR", options)).toBeNull()
  })
})
