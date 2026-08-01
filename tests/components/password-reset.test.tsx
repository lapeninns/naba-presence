import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", assign })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe("ForgotPasswordForm", () => {
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
})

describe("ResetPasswordForm", () => {
  it("offers a fresh link instead of a form when the token is missing", () => {
    render(<ResetPasswordForm />)
    expect(
      screen.queryByLabelText("New password")
    ).not.toBeInTheDocument()
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

  it("updates the password and lands on /home", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockResolvedValue(undefined)
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/home"))
  })

  it("replaces the dead form with a recovery CTA when the token is rejected", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(400, "invalid_email_link", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse-9")
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
    await user.type(screen.getByLabelText("Confirm new password"), "correct-horse-9")
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

  it("rejects a locally-invalid password before contacting the server", async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(authApi, "completePasswordReset")
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correcthorse9x")
    await user.type(screen.getByLabelText("Confirm new password"), "correcthorse9x")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    // The requirements checklist also renders here, so the accessible
    // description concatenates both — match the error text, not the whole string.
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /Include at least one symbol\./
    )
  })
})
