import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SignInForm } from "@/components/auth/sign-in-form"
import { SignInPanel } from "@/components/auth/sign-in-panel"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()

beforeEach(() => {
  vi.stubGlobal("location", {
    ...window.location,
    pathname: "/sign-in",
    search: "",
    assign,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe("sign-in mode", () => {
  it("keeps the pilot sign-in form available without exposing account creation", () => {
    render(
      <SignInPanel registrationAllowed={false} initialMode="create-account" />
    )
    expect(
      screen.getByText(
        "NabaPresence is available by invitation during the pilot."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Sign in$/ })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Switch to create account" })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument()
  })

  it("retains account creation for an invitation", () => {
    render(
      <SignInPanel
        registrationAllowed
        inviteToken="invitation-token"
        initialMode="create-account"
      />
    )
    expect(screen.getByLabelText("Your name")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Switch to create account" })
    ).toBeInTheDocument()
  })

  it("submits credentials and lands on /inbox", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue({ mfaRequired: false })
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/inbox"))
    expect(authApi.signIn).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "correct-horse-9",
      inviteToken: undefined,
    })
  })

  it("honours a validated next path", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue({ mfaRequired: false })
    render(<SignInForm nextPath="/inbox?queue=needs_reply" />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/inbox?queue=needs_reply")
    )
  })

  it("sends an enrolled person to the code screen, keeping the next path", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockResolvedValue({ mfaRequired: true })
    render(<SignInForm nextPath="/inbox?queue=needs_reply" />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        `/sign-in/verify?next=${encodeURIComponent("/inbox?queue=needs_reply")}`
      )
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
    // Scoped to the alert: the sign-in surface also renders its own
    // always-visible resend affordance (D3), so more than one "Resend
    // confirmation email" button can be on screen at once.
    await user.click(
      within(alert).getByRole("button", { name: "Resend confirmation email" })
    )
    await waitFor(() => expect(resend).toHaveBeenCalledWith("a@example.test"))
    expect(
      await within(alert).findByText("Confirmation email sent.")
    ).toBeInTheDocument()
  })

  it("shows a generic sign-in error and never reveals whether the email is registered", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "signIn").mockRejectedValue(
      new ApiClientError(
        401,
        "invalid_credentials",
        "The email or password is incorrect."
      )
    )
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "real@x.test")
    await user.type(screen.getByLabelText("Password"), "wrong-password-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(
      await screen.findByText(/email or password is incorrect/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/confirm your email/i)).not.toBeInTheDocument()
  })

  it("offers a generic, always-visible resend affordance not tied to any error", () => {
    render(<SignInForm />)
    // Present on the sign-in surface before any submit - so it can never
    // leak registration state by only appearing after a specific error.
    expect(
      screen.getByRole("button", { name: /resend confirmation/i })
    ).toBeInTheDocument()
  })

  it("prevents double submission while a request is in flight", async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    vi.spyOn(authApi, "signIn").mockImplementation(
      () =>
        new Promise<{ mfaRequired: boolean }>((resolve) => {
          release = () => resolve({ mfaRequired: false })
        })
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
        statusMessage={{
          title: "That invitation has expired.",
          description: "Ask for a new one.",
        }}
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
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(registerSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(screen.getByLabelText("Password")).toHaveFocus()
  })

  it("has exactly one new-password field with a show toggle and no confirmation", () => {
    render(<SignInForm initialMode="create-account" />)
    expect(screen.queryByLabelText(/confirm/i)).not.toBeInTheDocument()
    expect(
      document.querySelectorAll('input[autocomplete="new-password"]')
    ).toHaveLength(1)
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password"
    )
    expect(
      screen.getByRole("button", { name: "Show password" })
    ).toBeInTheDocument()
  })

  it("registers a 12+ character password with no digit or symbol", async () => {
    const user = userEvent.setup()
    const registerSpy = vi
      .spyOn(authApi, "register")
      .mockResolvedValue({ authenticated: false, confirmationRequired: true })
    render(<SignInForm initialMode="create-account" />)
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "correct horse battery")
    await user.click(screen.getByRole("button", { name: "Create account" }))
    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1))
    expect(registerSpy.mock.calls[0]?.[0]).toMatchObject({
      password: "correct horse battery",
    })
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
    await user.click(screen.getByRole("button", { name: "Create account" }))
    expect(
      await screen.findByRole("heading", { name: "Check your email" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Resend confirmation email" })
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  async function fillValidAccount(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Your name"), "Sam Patel")
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    await user.type(screen.getByLabelText("Password"), "correct-horse-9!")
  }

  it("offers a business or agency workspace and defaults to business", async () => {
    const user = userEvent.setup()
    const registerSpy = vi
      .spyOn(authApi, "register")
      .mockResolvedValue({ authenticated: false, confirmationRequired: true })
    render(<SignInForm initialMode="create-account" workspaceChoice />)
    const group = screen.getByRole("radiogroup", {
      name: "What are you setting up?",
    })
    expect(
      within(group).getByRole("radio", { name: "My business" })
    ).toBeChecked()
    expect(
      within(group).getByRole("radio", { name: "An agency" })
    ).not.toBeChecked()
    await fillValidAccount(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))
    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1))
    expect(registerSpy.mock.calls[0]?.[0]).toMatchObject({
      workspaceMode: "business",
    })
  })

  it("registers an agency when the owner picks it", async () => {
    const user = userEvent.setup()
    const registerSpy = vi
      .spyOn(authApi, "register")
      .mockResolvedValue({ authenticated: false, confirmationRequired: true })
    render(<SignInForm initialMode="create-account" workspaceChoice />)
    await user.click(screen.getByRole("radio", { name: "An agency" }))
    await fillValidAccount(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))
    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1))
    expect(registerSpy.mock.calls[0]?.[0]).toMatchObject({
      workspaceMode: "agency",
    })
  })

  it("hides the workspace choice and registers a business while it is switched off", async () => {
    const user = userEvent.setup()
    const registerSpy = vi
      .spyOn(authApi, "register")
      .mockResolvedValue({ authenticated: false, confirmationRequired: true })
    render(<SignInPanel registrationAllowed initialMode="create-account" />)
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    expect(screen.queryByText(/agency/i)).not.toBeInTheDocument()
    await fillValidAccount(user)
    await user.click(screen.getByRole("button", { name: "Create account" }))
    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1))
    expect(registerSpy.mock.calls[0]?.[0]).not.toMatchObject({
      workspaceMode: "agency",
    })
  })

  it("does not offer the workspace choice to an invited person", () => {
    render(
      <SignInPanel
        registrationAllowed
        workspaceChoice
        inviteToken="invitation-token"
        initialMode="create-account"
      />
    )
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    expect(
      screen.getByText("Create an account with the invited email address.")
    ).toBeInTheDocument()
  })

  it("speaks to a business as much as to an agency", () => {
    const { container } = render(
      <SignInPanel
        registrationAllowed
        workspaceChoice
        initialMode="create-account"
      />
    )
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Create your NabaPresence account",
      })
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/new agency|your clients/i)
    expect(container.textContent).not.toMatch(/agency\.co\.uk/)
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
  it("notifies a controlled owner when the mode changes", async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<SignInForm mode="sign-in" onModeChange={onModeChange} />)

    await user.click(
      screen.getByRole("button", { name: "Switch to create account" })
    )

    expect(onModeChange).toHaveBeenCalledWith("create-account")
  })

  it("updates the page heading when the account action changes", async () => {
    const user = userEvent.setup()
    render(<SignInPanel />)

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sign in to NabaPresence",
      })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Switch to create account" })
    )

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Create your NabaPresence account",
      })
    ).toBeInTheDocument()
  })

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
      screen.getByRole("button", { name: "Switch to create account" })
    )

    expect(screen.getByLabelText("Email address")).not.toHaveAttribute(
      "aria-invalid"
    )
    expect(
      screen.getByRole("button", { name: "Switch to sign in" })
    ).toHaveAttribute("aria-pressed", "false")
    expect(
      screen.getByRole("button", { name: "Switch to create account" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Email address")).toHaveValue("not-an-email")
    expect(screen.getByLabelText("Password")).toHaveValue("correct-horse-9")
  })

  it("is one segmented toggle group of two pressed buttons", async () => {
    const user = userEvent.setup()
    render(<SignInForm />)
    const group = screen.getByRole("group", { name: "Account action" })
    expect(group).toHaveAttribute("data-slot", "segmented-control-track")
    const signIn = within(group).getByRole("button", {
      name: "Switch to sign in",
    })
    expect(signIn).toHaveAttribute("aria-pressed", "true")
    // Pressing the pressed mode is not a change: the form stays as it is.
    await user.click(signIn)
    expect(signIn).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument()
  })

  it("hints the email as the account's username for password managers", async () => {
    const user = userEvent.setup()
    render(<SignInForm />)
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveAttribute("autocomplete", "username")
    expect(email).toHaveAttribute("type", "email")
    expect(email).toHaveAttribute("inputmode", "email")
    expect(email).toHaveAttribute("autocapitalize", "none")
    await user.click(
      screen.getByRole("button", { name: "Switch to create account" })
    )
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "username"
    )
  })

  it("carries the typed email to Forgot password without the URL", async () => {
    const user = userEvent.setup()
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "sam@example.test")
    const link = screen.getByRole("link", { name: "Forgot password?" })
    expect(link).toHaveAttribute("href", "/forgot-password")
    link.addEventListener("click", (event) => event.preventDefault())
    await user.click(link)
    expect(window.sessionStorage.getItem("naba:reset-email")).toBe(
      "sam@example.test"
    )
  })

  it("folds the resend-confirmation help behind a disclosure", () => {
    const { container } = render(<SignInForm />)
    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute("open")
    expect(details).toHaveTextContent("Didn't receive a confirmation email?")
  })
})
