import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GoogleFreshness } from "@/components/inbox/google-freshness"
import * as clientsHook from "@/lib/queries/use-clients"

function stubClients(
  state: "up_to_date" | "data_delayed" | "action_needed",
  {
    reason = null,
    ageMs = 300_000,
  }: { reason?: string | null; ageMs?: number } = {}
) {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: {
      items: [
        {
          id: "c1",
          linkedCount: 1,
          freshness: {
            state,
            reason,
            lastSuccessfulCheckAt: new Date(Date.now() - ageMs).toISOString(),
          },
        },
      ],
    },
  } as unknown as ReturnType<typeof clientsHook.useClients>)
}

afterEach(() => vi.restoreAllMocks())

describe("GoogleFreshness", () => {
  it("takes the caller's layout when the data is current", () => {
    stubClients("up_to_date")
    const { container } = render(
      <GoogleFreshness className="hidden min-w-0 truncate desk:block" />
    )
    expect(screen.getByText(/Google checked/)).toBeInTheDocument()
    const note = container.firstElementChild!
    expect(note).toHaveClass("min-w-0", "truncate", "hidden desk:block")
    expect(note).toHaveClass("text-ink-muted")
  })

  it("takes the caller's layout when the data is delayed, in the warning ink", () => {
    stubClients("data_delayed")
    const { container } = render(
      <GoogleFreshness className="hidden min-w-0 truncate desk:block" />
    )
    const note = container.firstElementChild!
    expect(note).toHaveTextContent("delayed, retrying")
    // A delay used to ignore the caller's classes, so it could overflow a
    // header that had folded the routine line away.
    expect(note).toHaveClass("min-w-0", "truncate", "hidden desk:block")
    expect(note).toHaveClass("text-warning-ink")
    expect(note).not.toHaveClass("text-ink-muted")
  })

  it("names what a person must do when checks are blocked", () => {
    stubClients("action_needed", { reason: "reconnect_required" })
    const { container } = render(<GoogleFreshness />)
    const note = container.firstElementChild!
    expect(note).toHaveTextContent(/Google checked .+ · reconnect needed$/)
    expect(note).toHaveClass("text-warning-ink")
  })

  it("reads “just now” in lower case, mid-sentence", () => {
    stubClients("up_to_date", { ageMs: 0 })
    render(<GoogleFreshness />)
    expect(screen.getByText("Google checked just now")).toBeInTheDocument()
  })

  describe("across clients (agency scope)", () => {
    function stubTwo(second: string | null) {
      const entry = (lastSuccessfulCheckAt: string | null) => ({
        state: "up_to_date",
        reason: null,
        lastSuccessfulCheckAt,
      })
      vi.spyOn(clientsHook, "useClients").mockReturnValue({
        data: {
          items: [
            {
              id: "c1",
              linkedCount: 1,
              freshness: entry(new Date(Date.now() - 300_000).toISOString()),
            },
            { id: "c2", linkedCount: 2, freshness: entry(second) },
          ],
        },
      } as unknown as ReturnType<typeof clientsHook.useClients>)
    }

    it("dates the scope by its least recently checked client", () => {
      stubTwo(new Date(Date.now() - 3 * 3_600_000).toISOString())
      render(<GoogleFreshness />)
      expect(
        screen.getByText(/Google checked 3 h(ou)?rs? ago/)
      ).toBeInTheDocument()
    })

    it("does not date the scope by the checked clients while another was never checked", () => {
      stubTwo(null)
      const { container } = render(<GoogleFreshness />)
      expect(container.firstElementChild).toHaveTextContent(
        "Google not checked for every listing yet"
      )
      expect(screen.queryByText(/Google checked/)).not.toBeInTheDocument()
    })

    it("dates a filtered client by its own check", () => {
      stubTwo(null)
      render(<GoogleFreshness clientId="c1" />)
      expect(screen.getByText(/Google checked 5 min/)).toBeInTheDocument()
    })
  })
})
