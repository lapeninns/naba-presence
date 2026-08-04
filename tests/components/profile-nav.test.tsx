import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const pathnameMock = vi.fn(() => "/profile")
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ProfileNav } from "@/components/locations/profile-nav"

const CONTENT_AREAS = ["Profile", "Hours", "Menu", "Booking", "Details"]

describe("ProfileNav", () => {
  it("shows every area including Industry for an owner", () => {
    render(<ProfileNav role="owner" />)
    for (const label of [...CONTENT_AREAS, "Industry"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
  })

  it("hides Industry from a member, whose GET would 403", () => {
    render(<ProfileNav role="member" />)
    for (const label of CONTENT_AREAS) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole("link", { name: "Industry" })).not.toBeInTheDocument()
  })

  it("marks only the index active on /profile", () => {
    pathnameMock.mockReturnValue("/profile")
    render(<ProfileNav role="owner" />)
    // Exact-match, not prefix: a prefix rule would light up "Profile" on every
    // sub-route as well as the sub-route's own tab.
    const active = screen
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName("Profile")
  })

  it("marks only the sub-route active on /profile/hours", () => {
    pathnameMock.mockReturnValue("/profile/hours")
    render(<ProfileNav role="owner" />)
    const active = screen
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName("Hours")
  })

  it("uses labels that cannot collide with the primary nav", () => {
    // routing.spec.ts resolves nav links by accessible name; reusing
    // "Photos"/"Posts"/"Business profile" here would make those lookups
    // ambiguous on /profile routes.
    render(<ProfileNav role="owner" />)
    for (const reserved of ["Photos", "Posts", "Business profile"]) {
      expect(screen.queryByRole("link", { name: reserved })).not.toBeInTheDocument()
    }
  })
})
