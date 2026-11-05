import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import ClientsLoading from "@/app/(dashboard)/clients/loading"
import NewClientLoading from "@/app/(dashboard)/clients/new/loading"

describe("clients route loading", () => {
  it("draws the index skeleton at the wide page width, with no second main", () => {
    const { container } = render(<ClientsLoading />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading clients…")
    expect(container.querySelector("main")).toBeNull()
    expect(container.firstElementChild).toHaveClass(
      "max-w-(--np-page-max-width)"
    )
  })

  it("splits the header's actions at the header's own 480px breakpoint", () => {
    const { container } = render(<ClientsLoading />)
    const actions = container.querySelector(
      "[aria-hidden] > div:last-child"
    ) as HTMLElement
    expect(actions).toHaveClass("@max-[480px]:w-full")
  })

  it("draws the new-client form's narrow skeleton rather than the index's table", () => {
    const { container } = render(<NewClientLoading />)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading the new client form…"
    )
    expect(container.querySelector("main")).toBeNull()
    expect(container.firstElementChild).toHaveClass(
      "max-w-(--np-page-narrow-width)"
    )
    expect(screen.queryByText("Loading clients…")).toBeNull()
  })
})
