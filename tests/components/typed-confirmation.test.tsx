import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  TypedConfirmation,
  confirmationMatches,
} from "@/components/ui/typed-confirmation"

describe("confirmationMatches", () => {
  it("is trimmed, whitespace-collapsed and case-insensitive by default", () => {
    expect(confirmationMatches("  the old   crown ", "The Old Crown")).toBe(
      true
    )
    expect(confirmationMatches("The Old Crow", "The Old Crown")).toBe(false)
  })

  it("exact mode trims only", () => {
    expect(
      confirmationMatches(" The Old Crown ", "The Old Crown", "exact")
    ).toBe(true)
    expect(confirmationMatches("the old crown", "The Old Crown", "exact")).toBe(
      false
    )
    expect(
      confirmationMatches("The Old  Crown", "The Old Crown", "exact")
    ).toBe(false)
  })

  it("never matches an empty expectation", () => {
    expect(confirmationMatches("", "")).toBe(false)
    expect(confirmationMatches(" ", "  ", "exact")).toBe(false)
  })
})

describe("TypedConfirmation", () => {
  it("is a labelled field with a non-autocorrecting input", () => {
    render(<TypedConfirmation expected="The Bell" />)
    const input = screen.getByRole("textbox", {
      name: "Type The Bell to confirm",
    })
    expect(input).toHaveAttribute("autocomplete", "off")
    expect(input).toHaveAttribute("autocapitalize", "none")
    expect(input).toHaveAttribute("autocorrect", "off")
    expect(input).toHaveAttribute("spellcheck", "false")
    expect(input).toHaveAttribute("enterkeyhint", "done")
  })

  it("reports match flips and shows a polite status, not an alert", async () => {
    const user = userEvent.setup()
    const onMatchChange = vi.fn()
    render(
      <TypedConfirmation
        expected="The Bell"
        onMatchChange={onMatchChange}
        description="This cannot be undone."
      />
    )
    const input = screen.getByRole("textbox")
    expect(input).toHaveAccessibleDescription("This cannot be undone.")
    expect(screen.queryByText("Matches")).not.toBeInTheDocument()

    await user.type(input, "the bel")
    expect(onMatchChange).not.toHaveBeenCalled()
    await user.type(input, "l ")
    expect(onMatchChange).toHaveBeenCalledTimes(1)
    expect(onMatchChange).toHaveBeenLastCalledWith(true)
    const status = screen.getByText("Matches")
    expect(status.closest("[aria-live]")).toHaveAttribute("aria-live", "polite")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    await user.type(input, "x")
    expect(onMatchChange).toHaveBeenCalledTimes(2)
    expect(onMatchChange).toHaveBeenLastCalledWith(false)
  })

  it("exact mode requires the same capitals", async () => {
    const user = userEvent.setup()
    const onMatchChange = vi.fn()
    render(
      <TypedConfirmation
        expected="The Bell"
        match="exact"
        onMatchChange={onMatchChange}
      />
    )
    const input = screen.getByRole("textbox")
    await user.type(input, "the bell")
    expect(onMatchChange).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, "The Bell ")
    expect(onMatchChange).toHaveBeenLastCalledWith(true)
  })

  it("works controlled", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <TypedConfirmation
        expected="The Bell"
        value="The Bell"
        onValueChange={onValueChange}
      />
    )
    expect(screen.getByText("Matches")).toBeInTheDocument()
    await user.type(screen.getByRole("textbox"), "!")
    expect(onValueChange).toHaveBeenCalledWith("The Bell!")
  })
})
