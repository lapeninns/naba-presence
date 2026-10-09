import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import AuthError from "@/app/(auth)/error"
import TeamLoading from "@/app/(dashboard)/team/loading"

describe("auth error boundary", () => {
  it("offers a retry and the way back to sign in, never the message", async () => {
    const reset = vi.fn()
    render(
      <AuthError
        error={Object.assign(new Error("secret detail"), { digest: "d1" })}
        reset={reset}
      />
    )
    expect(
      screen.getByRole("heading", { name: "This page didn’t load" })
    ).toBeInTheDocument()
    expect(screen.getByText("d1")).toBeInTheDocument()
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("link", { name: "Back to sign in" })[0]
    ).toHaveAttribute("href", "/sign-in")
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalled()
  })
})

describe("team loading state", () => {
  it("says what is loading", () => {
    render(<TeamLoading />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading your team")
  })
})
