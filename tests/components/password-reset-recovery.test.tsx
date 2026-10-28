import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

// Recovery after a first answer: these tests need each request's
// transition to finish before the next press. React entangles every async
// action still in flight, so one request left hanging (as the in-flight
// tests in password-reset.test.tsx do on purpose) would keep every later
// button here pending. Nothing in this file may leave a request unresolved.

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.removeItem("naba:reset-email")
})

describe("ForgotPasswordForm recovery", () => {
  it("moves focus to the check-your-email stage", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset").mockResolvedValue(undefined)
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Check your email",
    })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(
      screen.getByText(
        "Not there after a few minutes? Check spam or promotions, then send another link. Only the newest link works."
      )
    ).toBeInTheDocument()
  })

  it("brings back the handed-over address, selected, for a different email", async () => {
    const user = userEvent.setup()
    window.sessionStorage.setItem("naba:reset-email", "sam@example.test")
    vi.spyOn(authApi, "requestPasswordReset").mockResolvedValue(undefined)
    const select = vi.spyOn(HTMLInputElement.prototype, "select")
    render(<ForgotPasswordForm />)
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    await user.click(
      await screen.findByRole("button", { name: "Use a different email" })
    )
    const field = screen.getByLabelText("Email address")
    expect(field).toHaveValue("sam@example.test")
    await waitFor(() => expect(field).toHaveFocus())
    // An email input exposes no selection range, so watch the call instead.
    expect(select.mock.contexts).toContain(field)
    // The send cleared the hand-over; the field no longer depends on it.
    expect(window.sessionStorage.getItem("naba:reset-email")).toBeNull()
  })

  it("says what failed, and what to do, when a resend is refused", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ApiClientError(429, "auth_rate_limited", "x", {
          retryAfter: 3540,
        })
      )
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    await user.click(
      await screen.findByRole("button", { name: "Send another link" })
    )
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(
      "Too many attempts. Try again in about 59 minutes."
    )
    expect(alert).toHaveClass("text-danger-ink")
  })

  it("announces a second identical resend as a fresh change", async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    vi.spyOn(authApi, "requestPasswordReset")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    const note =
      "Another link is on its way to a@example.test if it has an account."
    await user.click(
      await screen.findByRole("button", { name: "Send another link" })
    )
    expect(await screen.findByText(note)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Send another link" }))
    // Emptied while the second resend is in flight...
    await waitFor(() =>
      expect(screen.queryByText(note)).not.toBeInTheDocument()
    )
    release()
    // ...so the same words land as new text in the live region.
    expect(await screen.findByText(note)).toBeInTheDocument()
  })

  it("shows the connection problem when the request never arrives", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "requestPasswordReset").mockRejectedValue(
      new ApiClientError(0, "network_error", "x")
    )
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t reach NabaPresence.Check your connection and try again."
    )
  })

  it("clears an earlier alert when the address is submitted again", async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    vi.spyOn(authApi, "requestPasswordReset")
      .mockRejectedValueOnce(new ApiClientError(429, "auth_rate_limited", "x"))
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
    render(<ForgotPasswordForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts."
    )
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    await screen.findByRole("button", { name: "Sending…" })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    release()
    await screen.findByRole("heading", { name: "Check your email" })
  })
})

describe("ResetPasswordForm recovery", () => {
  it("points at the new password when the server lost track of it", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(503, "password_reset_outcome_unknown", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t confirm your new password was saved.Try signing in with the new password. If that doesn’t work, request another link."
    )
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Request another link" })
    ).toBeInTheDocument()
  })

  it("keeps the form after a dropped connection, then warns the password may be saved", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset")
      .mockRejectedValueOnce(new ApiClientError(0, "network_error", "x"))
      .mockRejectedValueOnce(new ApiClientError(400, "invalid_email_link", "x"))
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    await user.type(screen.getByLabelText("New password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t reach NabaPresence.Check your connection and try again."
    )
    expect(screen.getByLabelText("New password")).toBeInTheDocument()
    await user.click(
      await screen.findByRole("button", { name: "Update password" })
    )
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That link is invalid or has expired.If you pressed Update password before, your new password may already be saved. Try signing in with it, or request another link."
      )
    )
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
  })

  it("shows a refused password as a field error alone", async () => {
    const user = userEvent.setup()
    const breached =
      "This password has appeared in a known data breach, so it is easy to guess. Choose a different one."
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(400, "invalid_request", "x", [
        { code: "password_breached", path: ["password"], message: breached },
      ])
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    const field = screen.getByLabelText("New password")
    await user.type(field, "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(new RegExp(breached))
    )
    expect(field).toHaveFocus()
    expect(
      screen.queryByText("Check the highlighted fields.")
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
  })

  it("drops a stale length error as the person types", async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    const field = screen.getByLabelText("New password")
    await user.type(field, "short")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"))
    await user.type(field, "-but-longer-now")
    expect(field).not.toHaveAttribute("aria-invalid", "true")
    expect(
      screen.queryByText("Use at least 15 characters.")
    ).not.toBeInTheDocument()
    expect(field).toHaveFocus()
  })

  it("clears an earlier banner when the person submits again", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "completePasswordReset").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "x")
    )
    render(<ResetPasswordForm tokenHash="token-hash-value-long-enough" />)
    const field = screen.getByLabelText("New password")
    await user.type(field, "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Update password" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts."
    )
    await user.clear(field)
    await user.type(field, "short")
    await user.click(
      await screen.findByRole("button", { name: "Update password" })
    )
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"))
    expect(screen.queryByText("Too many attempts.")).not.toBeInTheDocument()
  })
})
