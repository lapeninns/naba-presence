import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import TeamLoading from "@/app/(dashboard)/team/loading"
import { ROLE_MATRIX } from "@/lib/settings/roles"

describe("team loading", () => {
  it("is one busy status that names what is loading and owns no main", () => {
    const { container } = render(<TeamLoading />)
    const status = screen.getAllByRole("status")[0]
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent(/^Loading your team$/)
    expect(container.querySelector("main")).toBeNull()
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("draws the roles card with a row per capability, not one block", () => {
    const { container } = render(<TeamLoading />)
    const roles = container.querySelector("[data-slot='team-roles-skeleton']")
    expect(roles).not.toBeNull()
    expect(roles!.children).toHaveLength(ROLE_MATRIX.length + 1)
  })

  it("draws flat bars that pulse only when motion is welcome", () => {
    const { container } = render(<TeamLoading />)
    const bars = container.querySelectorAll("[data-slot='skeleton']")
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      expect(bar.className).not.toMatch(/(^|\s)animate-/)
    }
  })
})
