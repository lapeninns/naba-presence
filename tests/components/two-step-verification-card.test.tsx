import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  groupSecret,
  TwoStepVerificationCard,
} from "@/components/settings/two-step-verification-card"
import * as mfaApi from "@/lib/api/mfa"
import type { MfaEnrollResponse } from "@/lib/contracts/auth"

const assign = vi.fn()
beforeEach(() => {
  vi.stubGlobal("location", {
    ...window.location,
    origin: "http://localhost",
    pathname: "/settings/security",
    search: "",
    assign,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  assign.mockReset()
})

const SECRET = "JBSWY3DPEHPK3PXPJBSW"
const enrollment: MfaEnrollResponse = {
  factorId: "factor-1",
  qrCode: "data:image/png;base64,AAAA",
  secret: SECRET,
  uri: `otpauth://totp/NabaPresence:owner%40example.test?secret=${SECRET}&issuer=NabaPresence`,
  factorNumber: 1,
}

/** Walks the card from idle to the scan step with the given enroll answer. */
async function openScanStep(answer: MfaEnrollResponse = enrollment) {
  const user = userEvent.setup()
  vi.spyOn(mfaApi, "startMfaEnrollment").mockResolvedValue(answer)
  render(
    <TwoStepVerificationCard
      factorCount={0}
      verifiedThisSession={false}
      email="owner@example.test"
    />
  )
  await user.click(
    screen.getByRole("button", { name: "Set up an authenticator app" })
  )
  await user.type(screen.getByLabelText("Your password"), "correct-horse-9")
  await user.click(screen.getByRole("button", { name: "Continue" }))
  await screen.findByRole("button", { name: "Turn on" })
  return user
}

describe("groupSecret", () => {
  it("groups the setup key in fours", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP")
    expect(groupSecret("ABCDEF")).toBe("ABCD EF")
    expect(groupSecret(" AB CD EF ")).toBe("ABCD EF")
  })
})

describe("TwoStepVerificationCard", () => {
  it("hints the account for password managers without sending it", async () => {
    const user = userEvent.setup()
    const start = vi
      .spyOn(mfaApi, "startMfaEnrollment")
      .mockResolvedValue(enrollment)
    const { container } = render(
      <TwoStepVerificationCard
        factorCount={0}
        verifiedThisSession={false}
        email="owner@example.test"
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Set up an authenticator app" })
    )
    const username = container.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]'
    )
    expect(username).toHaveValue("owner@example.test")
    expect(username).not.toBeVisible()
    await user.type(screen.getByLabelText("Your password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    // The payload is unchanged: password (and code), never the username.
    expect(start).toHaveBeenCalledWith({
      password: "correct-horse-9",
      code: undefined,
    })
  })

  it("offers the otpauth link, the grouped key and the QR code", async () => {
    await openScanStep()
    expect(
      screen.getByRole("link", { name: "Open in authenticator app" })
    ).toHaveAttribute("href", enrollment.uri)
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW")).toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: "QR code for your authenticator app" })
    ).toBeInTheDocument()
  })

  it("copies the raw key, not the grouped display", async () => {
    const user = await openScanStep()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    await user.click(screen.getByRole("button", { name: "Copy key" }))
    expect(writeText).toHaveBeenCalledWith(SECRET)
    expect(await screen.findByText("Copied")).toBeInTheDocument()
  })

  it("drops a link that is not an otpauth URI", async () => {
    await openScanStep({ ...enrollment, uri: "javascript:alert(1)" })
    expect(
      screen.queryByRole("link", { name: "Open in authenticator app" })
    ).not.toBeInTheDocument()
    // The manual routes still work.
    expect(screen.getByRole("button", { name: "Copy key" })).toBeInTheDocument()
  })

  it("does not pull the keyboard up over the setup routes", async () => {
    await openScanStep()
    const firstBox = screen.getByRole("textbox", { name: "6-digit code" })
    expect(firstBox).not.toHaveFocus()
    expect(firstBox).toHaveAttribute("autocomplete", "one-time-code")
    expect(firstBox).toHaveAttribute("inputmode", "numeric")
  })

  it("never logs the secret or the URI", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level)
    )
    await openScanStep()
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET)
      }
    }
  })

  it("turns the app on once, however often Turn on is pressed", async () => {
    const user = await openScanStep()
    const verify = vi
      .spyOn(mfaApi, "verifyMfaCode")
      .mockReturnValue(new Promise(() => {}))
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    // Six digits alone do not submit: a mistyped digit can still be fixed.
    expect(verify).not.toHaveBeenCalled()
    const submit = screen.getByRole("button", { name: "Turn on" })
    await user.click(submit)
    const busy = await screen.findByRole("button", { name: "Checking…" })
    expect(busy).toBeDisabled()
    await user.click(busy)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledWith({ code: "123456" })
  })
})
