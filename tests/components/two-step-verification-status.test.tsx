import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ENROLLED_FLAG,
  SETUP_LIMITS,
  TwoStepVerificationCard,
} from "@/components/settings/two-step-verification-card"
import { ApiClientError } from "@/lib/api/client"
import * as mfaApi from "@/lib/api/mfa"
import type { MfaEnrollResponse } from "@/lib/contracts/auth"
import { MFA_MAX_ATTEMPTS, MFA_TICKET_TTL_SECONDS } from "@/lib/server/mfa"

// The card's status, outcome and error copy (p6-F09). Its own file: a
// confirmed setup leaves the card's transition pending for good (it waits
// on the reload), and React entangles later transitions in the same module
// instance with it, so that case runs last here.

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
  window.sessionStorage.clear()
})

const SECRET = "JBSWY3DPEHPK3PXPJBSW"
const enrollment: MfaEnrollResponse = {
  factorId: "factor-1",
  qrCode: "data:image/png;base64,AAAA",
  secret: SECRET,
  uri: `otpauth://totp/NabaPresence:owner%40example.test?secret=${SECRET}&issuer=NabaPresence`,
  factorNumber: 1,
}

async function openScanStep() {
  const user = userEvent.setup()
  vi.spyOn(mfaApi, "startMfaEnrollment").mockResolvedValue(enrollment)
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

describe("TwoStepVerificationCard status and outcomes", () => {
  const card = (
    props: Partial<Parameters<typeof TwoStepVerificationCard>[0]> = {}
  ) =>
    render(
      <TwoStepVerificationCard
        factorCount={0}
        verifiedThisSession={false}
        {...props}
      />
    )
  const status = () =>
    document.querySelector('[data-slot="mfa-status"]') as HTMLElement

  it("says Off with a plain sentence, and why owners and admins need it", () => {
    card({ requiredForYou: true })
    expect(status()).toHaveTextContent(
      "OffSigning in needs only your password."
    )
    expect(status()).toHaveTextContent(
      "Owners and admins need this before they publish, approve, or change the team, Google connections or settings."
    )
    // No apps yet: nothing to remove, so no removal note.
    expect(screen.queryByText(/You can’t remove an app here/)).toBeNull()
  })

  it("says nothing about owners and admins to anyone else", () => {
    card()
    expect(screen.queryByText(/Owners and admins need this/)).toBeNull()
  })

  it("says On, and never tells a person to sign in again", () => {
    card({ factorCount: 1, verifiedThisSession: false })
    expect(status()).toHaveTextContent(
      "OnWith one authenticator app. Add a backup in case you lose that device."
    )
    expect(
      screen.getByText(
        "You signed in to this session without a code. You’ll enter one the next time you sign in."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Sign in again/)).toBeNull()
    expect(screen.getByText(/You can’t remove an app here/)).toBeInTheDocument()
  })

  it("says a verified session plainly, and offers nothing more at two apps", () => {
    card({ factorCount: 2, verifiedThisSession: true, requiredForYou: true })
    expect(status()).toHaveTextContent(
      "OnWith an authenticator app and a backup."
    )
    expect(
      screen.getByText("This session is verified with a code.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Owners and admins need this/)).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText(/You can’t remove an app here/)).toBeInTheDocument()
  })

  it("says why the password is asked again", async () => {
    const user = userEvent.setup()
    card()
    await user.click(
      screen.getByRole("button", { name: "Set up an authenticator app" })
    )
    expect(screen.getByLabelText("Your password")).toHaveAccessibleDescription(
      "We ask again because this changes how you sign in."
    )
  })

  it("states the setup limits up front", async () => {
    await openScanStep()
    expect(
      screen.getByText(/Setup closes after 5 minutes or 5 wrong codes\./)
    ).toBeInTheDocument()
  })

  it("keeps the copy's limits in step with the server's", () => {
    expect(SETUP_LIMITS.minutes * 60).toBe(MFA_TICKET_TTL_SECONDS)
    expect(SETUP_LIMITS.wrongCodes).toBe(MFA_MAX_ATTEMPTS)
  })

  it("shows the tries the server says are left after a wrong code", async () => {
    const user = await openScanStep()
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(400, "mfa_code_invalid", "Invalid code", {
        attemptsRemaining: 2,
      })
    )
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(screen.getByRole("button", { name: "Turn on" }))
    expect(
      await screen.findByText(
        "That code did not match. Try the code your app shows now. 2 tries left."
      )
    ).toBeInTheDocument()
    expect(window.sessionStorage.getItem(ENROLLED_FLAG)).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it("says setup stopped, for time or wrong codes, and goes back to the start", async () => {
    const user = await openScanStep()
    vi.spyOn(mfaApi, "verifyMfaCode").mockRejectedValue(
      new ApiClientError(400, "mfa_ticket_invalid", "Expired")
    )
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(screen.getByRole("button", { name: "Turn on" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Setup stopped.")
    expect(alert).toHaveTextContent(
      "It closes after 5 minutes or 5 wrong codes. The new app was not added. Start again."
    )
    expect(screen.queryByText(/timed out/)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Set up an authenticator app" })
    ).toBeInTheDocument()
  })

  it.each([
    [
      "support_session_forbidden",
      "A support session can’t change two-step verification.",
    ],
    [
      "mfa_password_account_required",
      "Two-step verification needs an email and password sign-in.",
    ],
  ])("words %s for this card", async (code, title) => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "startMfaEnrollment").mockRejectedValue(
      new ApiClientError(
        code === "support_session_forbidden" ? 403 : 409,
        code,
        "x"
      )
    )
    card()
    await user.click(
      screen.getByRole("button", { name: "Set up an authenticator app" })
    )
    await user.type(screen.getByLabelText("Your password"), "correct-horse-9")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(title)
    expect(screen.queryByText(/invitations/)).toBeNull()
  })

  it("says it is on once after the reload, then forgets", async () => {
    window.sessionStorage.setItem(ENROLLED_FLAG, "1")
    const { unmount } = card({ factorCount: 1, verifiedThisSession: true })
    const alert = await screen.findByRole("status")
    expect(alert).toHaveTextContent("Two-step verification is on.")
    expect(window.sessionStorage.getItem(ENROLLED_FLAG)).toBeNull()
    unmount()
    card({ factorCount: 1, verifiedThisSession: true })
    expect(screen.queryByText("Two-step verification is on.")).toBeNull()
  })

  it("says a backup was added after the second app", async () => {
    window.sessionStorage.setItem(ENROLLED_FLAG, "2")
    card({ factorCount: 2, verifiedThisSession: true })
    expect(await screen.findByText("Backup app added.")).toBeInTheDocument()
  })

  // Last: its transition never settles (see the note at the top).
  it("sets the success flag only after the server confirms, before the reload", async () => {
    const user = await openScanStep()
    vi.spyOn(mfaApi, "verifyMfaCode").mockResolvedValue({
      verified: true,
      purpose: "enroll",
    } as Awaited<ReturnType<typeof mfaApi.verifyMfaCode>>)
    await user.type(
      screen.getByRole("textbox", { name: "6-digit code" }),
      "123456"
    )
    await user.click(screen.getByRole("button", { name: "Turn on" }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(window.sessionStorage.getItem(ENROLLED_FLAG)).toBe("1")
  })
})
