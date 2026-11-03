import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/settings",
  useSearchParams: () => new URLSearchParams(),
}))

import HubLoading from "@/app/(dashboard)/clients/[clientId]/loading"
import SettingsLoading from "@/app/(dashboard)/clients/[clientId]/settings/loading"

describe("client route loading", () => {
  it("draws the hub's actions row and one KPI strip, with the loading words for screen readers only", () => {
    const { container } = render(<HubLoading />)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Loading this client…")
    expect(status).toHaveClass("sr-only")
    expect(container.querySelectorAll(".\\@container\\/kpi")).toHaveLength(1)
    expect(container.querySelector("main")).toBeNull()
  })

  it("draws the settings outline on its own route, not the hub's", () => {
    const { container } = render(<SettingsLoading />)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading this client’s settings…"
    )
    expect(screen.queryByText("Loading this client…")).toBeNull()
    expect(container.firstElementChild).toHaveClass(
      "max-w-(--np-page-default-width)"
    )
    expect(container.querySelector("main")).toBeNull()
  })
})
