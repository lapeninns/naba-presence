import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VerificationChecks } from "@/components/inbox/verification-panel"

afterEach(() => vi.restoreAllMocks())

describe("VerificationChecks", () => {
  it("shows four passing cards and a ready verdict for a clean verification", () => {
    render(
      <VerificationChecks
        status="verified"
        verification={{ verdict: "pass", reasons: [] }}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Verification" })
    ).toBeInTheDocument()
    // Four cards, each saying its result in a word, not only a colour.
    expect(screen.getAllByText("Pass")).toHaveLength(4)
    expect(
      screen.getByText(
        "Ready to publish · every check passed on the latest draft"
      )
    ).toBeInTheDocument()
  })

  it("groups reasons into the four checks and names the blocking one in the verdict", () => {
    render(
      <VerificationChecks
        status="drafted"
        verification={{
          verdict: "fail",
          reasons: [
            {
              code: "personal_contact_data",
              severity: "fail",
              message: "The reply contains an email address or phone number.",
            },
            {
              code: "tone_length",
              severity: "warn",
              message: "The reply may be too long for the selected tone.",
            },
          ],
        }}
      />
    )
    expect(
      screen.getByText("Blocked · fix the failed checks to continue")
    ).toBeInTheDocument()
    expect(
      screen.getByText("This reply can’t be published yet")
    ).toBeInTheDocument()
    expect(screen.getByText("Fail")).toBeInTheDocument()
    expect(screen.getByText("Check")).toBeInTheDocument()
    expect(
      screen.getAllByText(
        "The reply contains an email address or phone number."
      ).length
    ).toBeGreaterThan(0)
    expect(
      screen.getByText("The reply may be too long for the selected tone.")
    ).toBeInTheDocument()
  })

  it("explains that verification has not run yet", () => {
    render(<VerificationChecks status="new" verification={null} />)
    expect(screen.getAllByText("Not run yet")).toHaveLength(4)
    expect(
      screen.getAllByText("Runs when you save a draft.").length
    ).toBeGreaterThan(0)
  })
})
