import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import * as healthHook from "@/lib/queries/use-connection-health"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DisconnectedBanner", () => {
  it("warns and links to connections when Google is disconnected", () => {
    vi.spyOn(healthHook, "useConnectionHealth").mockReturnValue({
      status: "disconnected",
      label: "Google disconnected",
    })
    render(<DisconnectedBanner />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google is not connected"
    )
    expect(
      screen.getByRole("link", { name: "Manage connection" })
    ).toHaveAttribute("href", "/settings/connections")
  })

  it("renders nothing while a connection is live", () => {
    vi.spyOn(healthHook, "useConnectionHealth").mockReturnValue({
      status: "connected",
      label: "Live data",
    })
    const { container } = render(<DisconnectedBanner />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
