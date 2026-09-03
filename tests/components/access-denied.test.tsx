import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { AccessDenied, AccessDeniedPage } from "@/components/app-shell/access-denied"

describe("AccessDenied", () => {
  it("says what is closed and who can open it", () => {
    // Every gated route used to redirect silently, which is indistinguishable
    // from a bug to the person who followed the link.
    render(<AccessDenied area="Google connections" />)
    expect(
      screen.getByRole("heading", { name: /You don.t have access to this page/, level: 1 })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Google connections is limited to an owner or admin/)
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute(
      "href",
      "/home"
    )
  })

  it("renders no landmark of its own", () => {
    // Settings already owns the page's single <main>; a second one breaks the
    // pinned landmark-no-duplicate-main rule.
    const { container } = render(<AccessDenied area="Operations" />)
    expect(container.querySelector("main")).toBeNull()
  })

  it("brings its own frame when the route has none", () => {
    const { container } = render(<AccessDeniedPage area="Team access" />)
    expect(container.querySelectorAll("main")).toHaveLength(1)
  })
})
