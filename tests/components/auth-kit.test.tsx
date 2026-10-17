import {
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
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

  it("starts with a skip link to the card's main", () => {
    const { container } = render(<AuthCard title="Sign in">body</AuthCard>)
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    // The first focusable thing on the page, ahead of the panel's links.
    expect(container.querySelector("a, button, input")).toBe(skip)
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
  })

  it("keeps the legal links, each a 44px target off the desk", () => {
    render(<AuthCard title="Sign in">body</AuthCard>)
    const legal = screen.getByRole("navigation", { name: "Legal" })
    for (const name of ["Privacy policy", "Terms of service"]) {
      const link = within(legal).getByRole("link", { name })
      expect(link.className).toContain("min-h-(--np-touch)")
      expect(link.className).toContain("desk:min-h-6")
    }
  })

  it("lays out on the token breakpoints, not pixel ones", () => {
    const { container } = render(<AuthCard title="Sign in">body</AuthCard>)
    expect(container.innerHTML).not.toMatch(/(?:max|min)-\[\d+px\]:/)
    expect(screen.getByRole("main").className).toMatch(/\bpt-safe\b/)
  })
})

describe("AuthCard copy", () => {
  // Every pre-auth screen is shared by single businesses and agencies, so
  // none of them may assume the reader manages clients.
  it.each(["product", "recovery", "reset", "invite"] as const)(
    "the %s panel never addresses the reader as an agency with clients",
    (aside) => {
      const { container } = render(
        <AuthCard title="Title" aside={aside}>
          body
        </AuthCard>
      )
      const text = container.textContent ?? ""
      expect(text).not.toMatch(/\bclients?\b|client’s/i)
      expect(text).not.toMatch(/your agency|agency owner/i)
    }
  )
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
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password"
    )
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

  it("keeps describedBy content alongside the caps-lock hint, not replaced by it", () => {
    render(
      <PasswordField
        label="Password"
        name="password"
        value="secret"
        onValueChange={() => {}}
        autoComplete="current-password"
        describedBy={<span>Requirements go here</span>}
      />
    )
    const input = screen.getByLabelText("Password")

    // Requirements are visible before any Caps Lock signal.
    expect(input).toHaveAccessibleDescription("Requirements go here")

    // jsdom's KeyboardEvent#getModifierState has no real keyboard state to
    // read from, so build the event via createEvent and stub the method on
    // the native event directly - React's SyntheticEvent#getModifierState
    // delegates to nativeEvent.getModifierState when present.
    const capsLockKeyUp = createEvent.keyUp(input, {
      key: "a",
    }) as KeyboardEvent
    capsLockKeyUp.getModifierState = () => true
    fireEvent(input, capsLockKeyUp)

    expect(input).toHaveAccessibleDescription(
      "Caps Lock is on. Requirements go here"
    )
  })
})

describe("password requirements", () => {
  it("evaluates every rule", () => {
    expect(checkPasswordRules("short")).toEqual([
      { id: "length", label: "Between 15 and 128 characters", met: false },
    ])
    expect(
      checkPasswordRules("correct-horse-9").every((rule) => rule.met)
    ).toBe(true)
  })

  it("counts code points, as the schema does", () => {
    const met = (value: string) =>
      checkPasswordRules(value).every((rule) => rule.met)
    expect(met("🚀".repeat(8))).toBe(false)
    expect(met("🚀".repeat(14))).toBe(false)
    expect(met("🚀".repeat(15))).toBe(true)
    expect(met("🚀".repeat(128))).toBe(true)
    expect(met("🚀".repeat(129))).toBe(false)
  })

  it("has length as the only rule, with no letter, number or symbol rules", () => {
    expect(checkPasswordRules("short").map((rule) => rule.id)).toEqual([
      "length",
    ])
    // Letters only, spaces only and digits only all meet it at 15 characters.
    for (const value of [
      "onlyletterslong",
      "correct horse battery",
      "123456789012345",
    ]) {
      expect(checkPasswordRules(value).every((rule) => rule.met)).toBe(true)
    }
  })

  it("rejects a password past the server's upper bound", () => {
    const tooLong = `${"correct-horse-9".padEnd(129, "x")}`
    expect(tooLong).toHaveLength(129)
    const rules = checkPasswordRules(tooLong)
    expect(rules.find((rule) => rule.id === "length")).toEqual({
      id: "length",
      label: "Between 15 and 128 characters",
      met: false,
    })
  })

  it("announces met and unmet rules without relying on colour", () => {
    render(<PasswordRequirements value="correct-horse-9" />)
    expect(
      screen.getByRole("listitem", {
        name: "Met: Between 15 and 128 characters",
      })
    ).toBeInTheDocument()
    render(<PasswordRequirements value="short" />)
    expect(
      screen.getByRole("listitem", {
        name: "Not yet met: Between 15 and 128 characters",
      })
    ).toBeInTheDocument()
  })
})
