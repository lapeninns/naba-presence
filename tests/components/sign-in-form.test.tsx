import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SignInForm } from "@/components/auth/sign-in-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/sign-in", search: "", assign })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe("sign-in mode", () => {
  it("submits credentials and lands on /home", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue(undefined)
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/home"))
    expect(authApi.signIn).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "correct-horse-9",
      inviteToken: undefined,
    })
  })

  it("honours a validated next path", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue(undefined)
    render(<SignInForm nextPath="/inbox?queue=needs_reply" />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/inbox?queue=needs_reply")
    )
  })

  it("shows mapped copy and offers resend when the email is unconfirmed", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockRejectedValue(
      new ApiClientError(403, "email_not_verified", "server copy")
    )
    const resend = vi
      .spyOn(authApi, "resendConfirmation")
      .mockResolvedValue(undefined)
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Confirm your email address to continue.")
    expect(alert).not.toHaveTextContent("server copy")
    await user.click(
      screen.getByRole("button", { name: "Resend confirmation email" })
    )
    await waitFor(() => expect(resend).toHaveBeenCalledWith("a@example.test"))
    expect(
      await screen.findByText("Confirmation email sent.")
    ).toBeInTheDocument()
  })

  it("prevents double submission while a request is in flight", async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    vi.spyOn(authApi, "signIn").mockImplementation(
      () => new Promise<void>((resolve) => { release = () => resolve() })
    )
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    const submit = screen.getByRole("button", { name: "Sign in" })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(authApi.signIn).toHaveBeenCalledTimes(1)
    release()
  })

  it("renders a status message passed from the confirmation redirect", () => {
    render(
      <SignInForm
        statusMessage={{ title: "That invitation has expired.", description: "Ask for a new one." }}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That invitation has expired."
    )
  })

  it("rejects a locally-invalid email before contacting the server", async () => {
    const user = userEvent.setup()
    const signInSpy = vi.spyOn(authApi, "signIn")
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "not-an-email")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(signInSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("Email address")).toHaveFocus()
  })
})

describe("create-account mode", () => {
  it("validates locally before calling the server", async () => {
    const user = userEvent.setup()
    const registerSpy = vi.spyOn(authApi, "register")
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "tooshort")
    await user.type(screen.getByLabelText("Confirm password"), "tooshort")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(registerSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("Password")).toHaveFocus()
  })

  it("reports mismatched confirmation without contacting the server", async () => {
    const user = userEvent.setup()
    const registerSpy = vi.spyOn(authApi, "register")
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-8")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(registerSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Confirm password")).toHaveAccessibleDescription(
      "Both passwords must match."
    )
  })

  it("shows the check-your-email state when confirmation is required", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "register").mockResolvedValue({
      authenticated: false,
      confirmationRequired: true,
    })
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(
      await screen.findByRole("heading", { name: "Check your email" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Resend confirmation email" })
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("locks the email field for an invited address", () => {
    render(
      <SignInForm
        initialMode="create-account"
        inviteToken="tok"
        invitedEmail="invited@example.test"
      />
    )
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveValue("invited@example.test")
    expect(email).toHaveAttribute("readonly")
  })
})

describe("mode toggle", () => {
  it("clears the field error and keeps typed values when switching to create-account", async () => {
    const user = userEvent.setup()
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "not-an-email")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "aria-invalid",
      "true"
    )

    await user.click(
      screen.getByRole("button", { name: "Switch to create-account" })
    )

    expect(screen.getByLabelText("Email address")).not.toHaveAttribute(
      "aria-invalid"
    )
    expect(
      screen.getByRole("button", { name: "Switch to sign-in" })
    ).toHaveAttribute("aria-pressed", "false")
    expect(
      screen.getByRole("button", { name: "Switch to create-account" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Email address")).toHaveValue("not-an-email")
    expect(screen.getByLabelText("Password")).toHaveValue("correct-horse-9")
  })
})
