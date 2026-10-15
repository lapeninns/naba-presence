import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", {
    ...window.location,
    pathname: "/",
    search: "",
    assign,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe("ForgotPasswordForm", () => {
  it("starts with the address typed on the sign-in form", () => {
    window.sessionStorage.setItem("naba:reset-email", "sam@example.test")
    render(<ForgotPasswordForm />)
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "sam@example.test"
    )
    window.sessionStorage.removeItem("naba:reset-email")
  })

  it("confirms without revealing whether the account exists", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset").mockResolvedValue(undefined)
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent(
      "If an account exists for a@example.test, a reset link is on its way."
    )
    expect(
      screen.queryByRole("button", { name: "Send reset link" })
    ).not.toBeInTheDocument()
  })

  it("tells the user when they are rate limited", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "x")
    )
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts."
    )
  })

  it("sends one request while the first is in flight", async () => {
    const user = userEvent.setup()
    const request = vi
      .spyOn(authApi, "requestPasswordReset")
      .mockReturnValue(new Promise(() => {}))
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    const busy = await screen.findByRole("button", { name: "Sending…" })
    expect(busy).toBeDisabled()
    await user.click(busy)
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe("ResetPasswordForm", () => {
  it("offers a fresh link instead of a form when the token is missing", () => {
    render(<ResetPasswordForm />)
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toHaveAttribute("href", "/forgot-password")
  })

  it("treats a truncated token like a missing one", () => {
    render(<ResetPasswordForm tokenHash="short" />)
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
  })

  it("treats a token over the 512-char upper bound like a missing one", () => {
    render(<ResetPasswordForm tokenHash={"a".repeat(513)} />)
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
  })

  it("updates the password and lands on /inbox", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockResolvedValue({ mfaRequired: false })
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/inbox`)
    )
  })

  it("replaces the dead form with a recovery CTA when the token is rejected", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(400, "invalid_email_link", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That link is invalid or has expired."
    )
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toBeInTheDocument()
  })

  it("keeps the form for a non-terminal error", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts."
    )
    // The token may still be good, so the form stays — unlike the dead-token case.
    expect(screen.getByLabelText("New password")).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Request another link" })
    ).not.toBeInTheDocument()
  })

  it("rejects a too-short password before contacting the server", async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(authApi, "completePasswordReset")
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "short!1")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    // The requirements checklist also renders here, so the accessible
    // description concatenates both — match the error text, not the whole string.
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /Use at least 12 characters\./
    )
  })

  it("has a single new-password field and no confirmation", () => {
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    expect(screen.queryByLabelText(/confirm/i)).not.toBeInTheDocument()
    const field = screen.getByLabelText("New password")
    expect(field).toHaveAttribute("autocomplete", "new-password")
    expect(
      document.querySelectorAll('input[autocomplete="new-password"]')
    ).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: "Show password" })
    ).toBeInTheDocument()
  })

  it("submits a letters-only password of 12 or more characters", async () => {
    const user = userEvent.setup()
    const complete = vi
      .spyOn(authApi, "completePasswordReset")
      .mockResolvedValue({ mfaRequired: false })
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(
      screen.getByLabelText("New password"),
      "correct horse battery"
    )
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({
        tokenHash: "token-hash-value-long-enough",
        password: "correct horse battery",
      })
    )
  })

  it("updates once while a request is in flight, sending no username", async () => {
    const user = userEvent.setup()
    const complete = vi
      .spyOn(authApi, "completePasswordReset")
      .mockReturnValue(new Promise(() => {}))
    const { container } = render(
      <ResetPasswordForm tokenHash="token-hash-value-long-enough" />
    )
    // The password-manager hint is there but empty, hidden and unfocusable.
    const username = container.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]'
    )
    expect(username).toHaveValue("")
    expect(username).not.toBeVisible()
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    const busy = await screen.findByRole("button", { name: "Updating…" })
    expect(busy).toBeDisabled()
    await user.click(busy)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith({
      tokenHash: "token-hash-value-long-enough",
      password: "correct-horse-9",
    })
  })
})
