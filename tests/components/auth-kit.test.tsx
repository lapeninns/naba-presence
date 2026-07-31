import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AuthCard } from "@/components/auth/auth-card"
import { PasswordField } from "@/components/auth/password-field"
import {
  PasswordRequirements,
  checkPasswordRules,
} from "@/components/auth/password-requirements"

describe("AuthCard", () => {
  it("renders the page's single h1", () => {
    render(<AuthCard title="Sign in">body</AuthCard>)
    expect(
      screen.getByRole("heading", { level: 1, name: "Sign in" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })
})

describe("PasswordField", () => {
  function Harness({ error }: { error?: string } = {}) {
    return (
      <PasswordField
        label="Password"
        name="password"
        value="secret"
        onValueChange={() => {}}
        autoComplete="current-password"
        error={error}
      />
    )
  }

  it("is labelled, masked, and carries the autocomplete hint", () => {
    render(<Harness />)
    const input = screen.getByLabelText("Password")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toHaveAttribute("autocomplete", "current-password")
  })

  it("toggles visibility from a labelled button", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Show password" }))
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text")
    await user.click(screen.getByRole("button", { name: "Hide password" }))
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password")
  })

  it("wires errors through the Field system", () => {
    render(<Harness error="Enter your password." />)
    const input = screen.getByLabelText("Password")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription("Enter your password.")
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your password.")
  })

  it("calls onValueChange as the user types", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <PasswordField
        label="Password"
        name="password"
        value=""
        onValueChange={onValueChange}
        autoComplete="new-password"
      />
    )
    await user.type(screen.getByLabelText("Password"), "a")
    expect(onValueChange).toHaveBeenCalledWith("a")
  })
})

describe("password requirements", () => {
  it("evaluates every rule", () => {
    expect(checkPasswordRules("short")).toEqual([
      { id: "length", label: "At least 12 characters", met: false },
      { id: "letter", label: "A letter", met: true },
      { id: "number", label: "A number", met: false },
      { id: "symbol", label: "A symbol", met: false },
    ])
    expect(
      checkPasswordRules("correct-horse-9").every((rule) => rule.met)
    ).toBe(true)
  })

  it("announces met and unmet rules without relying on colour", () => {
    render(<PasswordRequirements value="correct-horse-9" />)
    expect(
      screen.getByRole("listitem", { name: "Met: At least 12 characters" })
    ).toBeInTheDocument()
    render(<PasswordRequirements value="short" />)
    expect(
      screen.getByRole("listitem", { name: "Not yet met: A number" })
    ).toBeInTheDocument()
  })
})
