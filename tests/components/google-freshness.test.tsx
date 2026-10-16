import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GoogleFreshness } from "@/components/inbox/google-freshness"
import * as clientsHook from "@/lib/queries/use-clients"

function stubClients(state: "fresh" | "data_delayed") {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: {
      items: [
        {
          id: "c1",
          linkedCount: 1,
          freshness: {
            state,
            lastSuccessfulCheckAt: new Date(Date.now() - 300_000).toISOString(),
          },
        },
      ],
    },
  } as unknown as ReturnType<typeof clientsHook.useClients>)
}

afterEach(() => vi.restoreAllMocks())

describe("GoogleFreshness", () => {
  it("takes the caller's layout when the data is current", () => {
    stubClients("fresh")
    const { container } = render(
      <GoogleFreshness className="max-desk:hidden min-w-0 truncate" />
    )
    expect(screen.getByText(/Google checked/)).toBeInTheDocument()
    const note = container.firstElementChild!
    expect(note).toHaveClass("min-w-0", "truncate", "max-desk:hidden")
    expect(note).toHaveClass("text-ink-muted")
  })

  it("takes the caller's layout when the data is delayed, in the warning ink", () => {
    stubClients("data_delayed")
    const { container } = render(
      <GoogleFreshness className="max-desk:hidden min-w-0 truncate" />
    )
    const note = container.firstElementChild!
    expect(note).toHaveTextContent("delayed, retrying")
    // A delay used to ignore the caller's classes, so it could overflow a
    // header that had folded the routine line away.
    expect(note).toHaveClass("min-w-0", "truncate", "max-desk:hidden")
    expect(note).toHaveClass("text-warning-ink")
    expect(note).not.toHaveClass("text-ink-muted")
  })
})
