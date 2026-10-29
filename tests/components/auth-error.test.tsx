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

  it("re-fetches with retry, not a bare re-render, when Next passes it", async () => {
    const reset = vi.fn()
    const retry = vi.fn()
    const unstable_retry = vi.fn()
    render(
      <AuthError
        error={new Error("x")}
        reset={reset}
        retry={retry}
        unstable_retry={unstable_retry}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(unstable_retry).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })
})

describe("team loading state", () => {
  it("says what is loading", () => {
    render(<TeamLoading />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading your team")
  })
})
