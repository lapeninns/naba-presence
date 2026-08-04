import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }))

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { Nav, navItemsFor } from "@/components/app-shell/nav"

describe("primary nav prefetch policy", () => {
  it("prefetches every primary route, including /performance", () => {
    render(<Nav multiLocation />)
    for (const label of [
      "Overview",
      "Reviews",
      "Business profile",
      "Photos",
      "Posts",
      "Locations",
      "Performance",
      "Settings",
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("data-prefetch", "true")
    }
  })

  it("encodes prefetch:true for every nav entry, conditional ones included", () => {
    for (const item of navItemsFor({ multiLocation: true })) {
      expect(item.prefetch, `${item.href} prefetch`).toBe(true)
    }
  })
})

describe("single-business nav", () => {
  it("omits Locations for an org with one location", () => {
    render(<Nav multiLocation={false} />)
    expect(screen.queryByRole("link", { name: "Locations" })).not.toBeInTheDocument()
    // The flat business routes are the point of delisting it.
    expect(screen.getByRole("link", { name: "Business profile" })).toHaveAttribute("href", "/profile")
  })

  it("restores Locations for an org with several", () => {
    render(<Nav multiLocation />)
    expect(screen.getByRole("link", { name: "Locations" })).toHaveAttribute("href", "/locations")
  })

  it("marks exactly one item active", () => {
    // usePathname is mocked to "/home" at the top of this file.
    render(<Nav multiLocation={false} />)
    const active = screen
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"))
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAccessibleName("Overview")
  })
})
