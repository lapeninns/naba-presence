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

import { Nav, NAV_ITEMS } from "@/components/app-shell/nav"

describe("primary nav prefetch policy", () => {
  it("prefetches the Home, Inbox and Locations routes", () => {
    render(<Nav />)
    for (const label of ["Home", "Inbox", "Locations"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "data-prefetch",
        "true"
      )
    }
    for (const label of ["Performance", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "data-prefetch",
        "false"
      )
    }
  })

  it("encodes the per-item prefetch flag in NAV_ITEMS", () => {
    for (const href of ["/home", "/inbox", "/locations"]) {
      expect(NAV_ITEMS.find((item) => item.href === href)?.prefetch).toBe(true)
    }
    for (const item of NAV_ITEMS.filter(
      (item) => item.href !== "/home" && item.href !== "/inbox" && item.href !== "/locations"
    )) {
      expect(item.prefetch).toBe(false)
    }
  })
})
