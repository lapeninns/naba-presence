import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VerificationPanel } from "@/components/inbox/verification-panel"

afterEach(() => vi.restoreAllMocks())

describe("VerificationPanel", () => {
  it("shows the Passed verdict and no reasons when clean", () => {
    render(
      <VerificationPanel
        status="verified"
        verification={{ verdict: "pass", reasons: [] }}
      />
    )
    expect(screen.getByText("Passed")).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })

  it("lists every verification reason with its message for a failed verdict", () => {
    render(
      <VerificationPanel
        status="drafted"
        verification={{
          verdict: "fail",
          reasons: [
            { code: "personal_contact_data", severity: "fail", message: "The reply contains an email address or phone number." },
            { code: "tone_length", severity: "warn", message: "The reply may be too long for the selected tone." },
          ],
        }}
      />
    )
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(
      screen.getByText("The reply contains an email address or phone number.")
    ).toBeInTheDocument()
    expect(
      screen.getByText("The reply may be too long for the selected tone.")
    ).toBeInTheDocument()
  })

  it("renders a Pending verdict when there is no verification yet", () => {
    render(<VerificationPanel status="new" verification={null} />)
    expect(screen.getByText("Pending")).toBeInTheDocument()
  })
})
