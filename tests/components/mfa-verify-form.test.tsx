import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MfaVerifyForm } from "@/components/auth/mfa-verify-form"
import { ApiClientError } from "@/lib/api/client"
import * as mfaApi from "@/lib/api/mfa"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", {
    ...window.location,
    origin: "http://localhost",
    pathname: "/sign-in/verify",
    search: "",
    assign,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

const factors = {
  factors: [
    { id: "factor-1", friendlyName: "Phone" },
    { id: "factor-2", friendlyName: "Tablet" },
  ],
  expiresAt: "2026-10-11T10:05:00.000Z",
}

describe("MfaVerifyForm", () => {
  it("verifies the code from the chosen app and continues to the next path", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    const verify = vi
      .spyOn(mfaApi, "verifyMfaCode")
      .mockResolvedValue({ verified: true, purpose: "sign_in" })
    render(<MfaVerifyForm nextPath="/inbox?queue=needs_reply" />)
    await user.click(await screen.findByText(/Backup authenticator/))
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123 456"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "http://localhost/inbox?queue=needs_reply"
      )
    )
    expect(verify).toHaveBeenCalledWith({
      code: "123456",
      factorId: "factor-2",
    })
  })

  it("says how many attempts are left after a wrong code", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue({
      ...factors,
      factors: [factors.factors[0]!],
    })
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(400, "mfa_code_invalid", "no", {
        attemptsRemaining: 2,
      })
    )
    render(<MfaVerifyForm />)
    await screen.findByRole("button", { name: "Verify and sign in" })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Verify and sign in" })
      ).toBeEnabled()
    )
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "000000"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    expect(
      await screen.findByText("That code did not match. 2 attempts left.")
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("refuses a malformed code without calling the server", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    const verify = vi.spyOn(mfaApi, "verifyMfaCode")
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "12ab"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    expect(
      await screen.findByText(
        "Enter the 6-digit code from your authenticator app."
      )
    ).toBeInTheDocument()
    expect(verify).not.toHaveBeenCalled()
  })

  it("offers a fresh sign-in once the pending sign-in has expired", async () => {
    vi.spyOn(mfaApi, "pendingFactors").mockRejectedValue(
      new ApiClientError(401, "mfa_ticket_invalid", "expired")
    )
    render(<MfaVerifyForm />)
    // The card's own heading says so; no second alert repeats it.
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Your sign-in has expired",
    })
    expect(
      screen.getByText(
        "For your security, the code step ends after five minutes or five wrong codes. Sign in again to continue."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("Enter your code")).not.toBeInTheDocument()
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/sign-in"
    )
  })

  it("keeps the destination and moves focus to the heading when the code step expires on submit", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(401, "mfa_ticket_invalid", "expired")
    )
    render(<MfaVerifyForm nextPath="/inbox?queue=needs_reply" />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Enter your code" })
    ).toBeInTheDocument()
    await screen.findByText(/Backup authenticator/)
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Your sign-in has expired",
    })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finbox%3Fqueue%3Dneeds_reply"
    )
  })

  it("keeps one-time-code autofill and the digit pad on every box", async () => {
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    const group = screen.getByRole("group", { name: "6-digit code" })
    const boxes = Array.from(
      group.querySelectorAll<HTMLInputElement>(
        'input:not([aria-hidden="true"])'
      )
    )
    expect(boxes).toHaveLength(6)
    // The OS offers the texted or app code in box one; Base UI spreads it.
    expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code")
    for (const box of boxes) expect(box).toHaveAttribute("inputmode", "numeric")
    // The only field on the screen still takes focus on arrival.
    await waitFor(() => expect(boxes[0]).toHaveFocus())
  })

  it("spends one attempt per press: no auto-submit and no double submit", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    const verify = vi
      .spyOn(mfaApi, "verifyMfaCode")
      .mockReturnValue(new Promise(() => {}))
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    expect(verify).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    const busy = await screen.findByRole("button", { name: "Checking…" })
    // Pending, not disabled: it stays focusable and refuses a second press.
    expect(busy).toHaveAttribute("aria-busy", "true")
    expect(busy).toHaveAttribute("aria-disabled", "true")
    await user.click(busy)
    await user.keyboard("{Enter}")
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it("shows leaving on the account button, not on the verify button", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    const cancel = vi
      .spyOn(mfaApi, "cancelMfa")
      .mockReturnValue(new Promise(() => {}))
    const verify = vi.spyOn(mfaApi, "verifyMfaCode")
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    await user.click(
      screen.getByRole("button", { name: "Use a different account" })
    )
    const leaving = await screen.findByRole("button", { name: "Signing out…" })
    expect(leaving).toHaveAttribute("aria-busy", "true")
    const primary = screen.getByRole("button", { name: "Verify and sign in" })
    expect(primary).not.toHaveAttribute("aria-busy")
    await user.click(leaving)
    // Verifying while signing out does nothing either.
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(primary)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(verify).not.toHaveBeenCalled()
  })

  it("says to start over when codes are rate limited, and focuses the alert", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "Too many attempts.", {
        retryAfter: 600,
      })
    )
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Too many attempts.")
    expect(alert).toHaveTextContent(
      "For your security, codes are paused. Wait about 10 minutes, then choose Use a different account to sign in again."
    )
    await waitFor(() => expect(alert.parentElement).toHaveFocus())
  })

  it("falls back to a few minutes when the rate limit gives no wait", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(429, "auth_rate_limited", "Too many attempts.")
    )
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "For your security, codes are paused. Wait a few minutes, then choose Use a different account to sign in again."
    )
  })

  it("offers to load the apps again when that fails", async () => {
    const user = userEvent.setup()
    const load = vi
      .spyOn(mfaApi, "pendingFactors")
      .mockRejectedValueOnce(new ApiClientError(500, "internal_error", "no"))
      .mockResolvedValueOnce(factors)
    render(<MfaVerifyForm />)
    const alert = await screen.findByRole("alert")
    await waitFor(() => expect(alert.parentElement).toHaveFocus())
    expect(
      screen.getByRole("button", { name: "Verify and sign in" })
    ).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByText(/Backup authenticator/)
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Verify and sign in" })
    ).toBeEnabled()
  })

  it("names the app picker once and points at it after a wrong code", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "pendingFactors").mockResolvedValue(factors)
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(400, "mfa_code_invalid", "no", {
        attemptsRemaining: 1,
      })
    )
    render(<MfaVerifyForm />)
    await screen.findByText(/Backup authenticator/)
    expect(
      screen.getByRole("radiogroup", { name: "Which app are you using?" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("group", { name: "Which app are you using?" })
    ).not.toBeInTheDocument()
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "000000"
    )
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }))
    expect(
      await screen.findByText(
        "That code did not match. Check that the selected app is the one showing this code. 1 attempt left."
      )
    ).toBeInTheDocument()
    // A wrong code goes back to box one, not to an alert.
    const boxes = screen
      .getByRole("group", { name: "6-digit code" })
      .querySelectorAll<HTMLInputElement>('input:not([aria-hidden="true"])')
    await waitFor(() => expect(boxes[0]).toHaveFocus())
  })
})
