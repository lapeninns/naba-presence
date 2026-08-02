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
  it("prefetches every primary route, including /performance", () => {
    render(<Nav />)
    for (const label of ["Home", "Inbox", "Locations", "Performance", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("data-prefetch", "true")
    }
  })

  it("encodes prefetch:true for every NAV_ITEMS entry", () => {
    for (const item of NAV_ITEMS) {
      expect(item.prefetch, `${item.href} prefetch`).toBe(true)
    }
  })
})
