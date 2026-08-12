import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VerificationPanel } from "@/components/inbox/verification-panel"

afterEach(() => vi.restoreAllMocks())

describe("VerificationPanel", () => {
  it("shows a quiet clean line without a verdict badge", () => {
    render(
      <VerificationPanel
        status="verified"
        verification={{ verdict: "pass", reasons: [] }}
      />
    )
    expect(screen.getByRole("heading", { name: "Verification" })).toBeInTheDocument()
    expect(screen.getByText("No issues found in this reply.")).toBeInTheDocument()
    expect(screen.queryByText("Passed")).not.toBeInTheDocument()
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
    expect(screen.queryByText("Failed")).not.toBeInTheDocument()
    expect(screen.getByText("Blocking")).toBeInTheDocument()
    expect(screen.getByText("Warning")).toBeInTheDocument()
    expect(
      screen.getByText("The reply contains an email address or phone number.")
    ).toBeInTheDocument()
    expect(
      screen.getByText("The reply may be too long for the selected tone.")
    ).toBeInTheDocument()
  })

  it("explains that verification has not run yet", () => {
    render(<VerificationPanel status="new" verification={null} />)
    expect(screen.getByRole("heading", { name: "Verification" })).toBeInTheDocument()
    expect(screen.getByText("Runs as soon as you save a draft.")).toBeInTheDocument()
    expect(screen.queryByText("Pending")).not.toBeInTheDocument()
  })
})
