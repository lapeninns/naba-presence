import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MfaStepUpHost } from "@/components/auth/mfa-step-up-host"
import { MfaStepUpPrompt } from "@/components/auth/mfa-step-up-prompt"
import {
  ApiClientError,
  apiFetch,
  isMfaStepUpError,
  MFA_STEP_UP_EVENT,
} from "@/lib/api/client"
import * as mfaApi from "@/lib/api/mfa"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function raise(code: "mfa_step_up_required" | "mfa_enrollment_required") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(MFA_STEP_UP_EVENT, { detail: { code } })
    )
  })
}

describe("apiFetch and the step-up event", () => {
  it("raises the event on a sensitive action's 403 and still throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "mfa_step_up_required", message: "Confirm it’s you." },
          { status: 403 }
        )
      )
    )
    const heard = vi.fn()
    window.addEventListener(MFA_STEP_UP_EVENT, heard)
    const error = await apiFetch("/api/settings", {
      method: "PATCH",
      body: {},
    }).catch((caught: unknown) => caught)
    window.removeEventListener(MFA_STEP_UP_EVENT, heard)
    expect(isMfaStepUpError(error)).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
    expect((heard.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      code: "mfa_step_up_required",
    })
  })

  it("stays quiet for a background refetch and for other 403s", async () => {
    const heard = vi.fn()
    window.addEventListener(MFA_STEP_UP_EVENT, heard)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "mfa_step_up_required" }, { status: 403 })
      )
    )
    await apiFetch("/api/x", { background: true }).catch(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "permission_denied" }, { status: 403 })
      )
    )
    await apiFetch("/api/x", { method: "POST" }).catch(() => {})
    window.removeEventListener(MFA_STEP_UP_EVENT, heard)
    expect(heard).not.toHaveBeenCalled()
  })
})

describe("MfaStepUpPrompt", () => {
  it("asks for the password and code, and verifies", async () => {
    const user = userEvent.setup()
    const stepUp = vi.spyOn(mfaApi, "stepUpMfa").mockResolvedValue({
      verified: true,
      proofExpiresAt: "2026-10-11T12:15:00.000Z",
    })
    render(<MfaStepUpPrompt />)
    expect(screen.queryByText("Confirm it’s you")).toBeNull()
    raise("mfa_step_up_required")
    expect(await screen.findByText("Confirm it’s you")).toBeTruthy()
    await user.type(screen.getByLabelText("Password"), "secret-password")
    await user.type(screen.getByLabelText("6-digit code"), "123 456")
    await user.click(screen.getByText("The code is from my backup app"))
    await user.click(screen.getByRole("button", { name: "Verify" }))
    expect(await screen.findByText("You’re verified")).toBeTruthy()
    expect(stepUp).toHaveBeenCalledWith({
      password: "secret-password",
      code: "123456",
      factor: "backup",
    })
  })

  it("says when the code did not match and keeps the dialog open", async () => {
    const user = userEvent.setup()
    vi.spyOn(mfaApi, "stepUpMfa").mockRejectedValue(
      new ApiClientError(400, "mfa_code_invalid", "Invalid code")
    )
    render(<MfaStepUpPrompt />)
    raise("mfa_step_up_required")
    await user.type(await screen.findByLabelText("Password"), "pw")
    await user.type(screen.getByLabelText("6-digit code"), "000000")
    await user.click(screen.getByRole("button", { name: "Verify" }))
    expect(await screen.findByText(/That code did not match/)).toBeTruthy()
  })

  it("does not send an empty form", async () => {
    const user = userEvent.setup()
    const stepUp = vi.spyOn(mfaApi, "stepUpMfa")
    render(<MfaStepUpPrompt />)
    raise("mfa_step_up_required")
    await user.click(await screen.findByRole("button", { name: "Verify" }))
    expect(await screen.findByText("Enter your password.")).toBeTruthy()
    expect(stepUp).not.toHaveBeenCalled()
  })

  it("sends an unenrolled owner to the enrollment screen", async () => {
    render(<MfaStepUpPrompt />)
    raise("mfa_enrollment_required")
    expect(await screen.findByText("Set up two-step verification")).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Set up now" }).getAttribute("href")
      ).toBe("/settings/security")
    )
  })
})

describe("MfaStepUpHost", () => {
  it("renders nothing until an action asks for a code", () => {
    const { container } = render(<MfaStepUpHost />)
    expect(container.innerHTML).toBe("")
    expect(screen.queryByText("Confirm it’s you")).toBeNull()
  })

  it("loads the prompt on the first event and opens it for that event", async () => {
    render(<MfaStepUpHost />)
    raise("mfa_step_up_required")
    expect(await screen.findByText("Confirm it’s you")).toBeTruthy()
  })

  it("opens enrollment when the first event is mfa_enrollment_required", async () => {
    render(<MfaStepUpHost />)
    raise("mfa_enrollment_required")
    expect(await screen.findByText("Set up two-step verification")).toBeTruthy()
  })
})
