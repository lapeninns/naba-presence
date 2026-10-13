import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ShareSetupLink } from "@/components/setup/share-setup-link"

describe("ShareSetupLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, "", "/")
  })

  it("shares the allow-listed setup link, never the OAuth return params", async () => {
    window.history.replaceState(
      null,
      "",
      "/setup?client=c1&step=locations&onboardingDraft=d1&google=connected&status=ok&rid=r9&reason=x"
    )
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, share, canShare: () => true })
    render(<ShareSetupLink title="Approve" text="Please approve." />)
    await userEvent.click(screen.getByRole("button", { name: "Share setup link" }))
    expect(share).toHaveBeenCalledWith({
      url: `${window.location.origin}/setup?client=c1&step=locations&onboardingDraft=d1`,
      title: "Approve",
      text: "Please approve.",
    })
    expect(await screen.findByText("Shared.")).toBeInTheDocument()
  })

  it("shows the same link to copy by hand when share and copy both fail", async () => {
    window.history.replaceState(null, "", "/setup?client=c1&rid=secret")
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    })
    render(<ShareSetupLink />)
    await userEvent.click(screen.getByRole("button", { name: "Share setup link" }))
    expect(
      await screen.findByText(`${window.location.origin}/setup?client=c1`)
    ).toBeInTheDocument()
    expect(screen.queryByText(/secret/)).toBeNull()
  })
})
