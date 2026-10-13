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
    await user.type(screen.getByRole("textbox", { name: "6-digit code" }), "123 456")
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
    await user.type(screen.getByRole("textbox", { name: "6-digit code" }), "000000")
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
    await user.type(screen.getByRole("textbox", { name: "6-digit code" }), "12ab")
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
    expect(
      await screen.findByText("Your sign-in has expired.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Sign in again" })
    ).toBeInTheDocument()
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
    expect(busy).toBeDisabled()
    await user.click(busy)
    expect(verify).toHaveBeenCalledTimes(1)
  })
})
