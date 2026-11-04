import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import SetupLoading from "@/app/(dashboard)/setup/loading"
import { SetupStepSkeleton } from "@/components/setup/setup-step-skeleton"

describe("setup loading", () => {
  it("names the wait once, for screen readers, and keeps the bars silent", () => {
    const { container } = render(<SetupLoading />)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Loading setup")
    expect(status).toHaveClass("sr-only")
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(container.querySelector("main")).toBeNull()
    expect(container.firstElementChild).toHaveAttribute(
      "data-slot",
      "page-frame"
    )
  })

  it("switches rail and phone stepper on the wizard's named container", () => {
    const { container } = render(<SetupLoading />)
    // The same `@container/setup` the wizard uses, so both fold at one width.
    expect(container.querySelector(".\\@container\\/setup")).not.toBeNull()
    expect(
      container.querySelector(".hidden.\\@3xl\\/setup\\:flex")
    ).not.toBeNull()
    expect(container.querySelector(".\\@3xl\\/setup\\:hidden")).not.toBeNull()
    expect(container.querySelector(".\\@3xl\\:flex")).toBeNull()
  })

  it("draws one rail row per step of the flow", () => {
    const { container } = render(
      <SetupStepSkeleton label="Loading your setup" steps={7} />
    )
    const rail = container.querySelector(".hidden.\\@3xl\\/setup\\:flex")
    expect(rail?.children).toHaveLength(7)
    expect(screen.getByRole("status")).toHaveTextContent("Loading your setup")
  })
})
