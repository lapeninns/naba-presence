import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import ConfirmEmailPage from "@/app/(auth)/confirm-email/page"

async function renderPage(params: {
  token_hash?: string
  inviteToken?: string
}) {
  render(await ConfirmEmailPage({ searchParams: Promise.resolve(params) }))
}

describe("email confirmation interstitial (W6-05)", () => {
  it("posts the token back to /auth/confirm only when the button is pressed", async () => {
    await renderPage({ token_hash: "h".repeat(40) })
    const button = screen.getByRole("button", { name: "Confirm and sign in" })
    const form = button.closest("form")!
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/auth/confirm")
    expect(button).toHaveAttribute("type", "submit")
    const fields = Object.fromEntries(new FormData(form))
    expect(fields).toEqual({ token_hash: "h".repeat(40), type: "email" })
  })

  it("carries an invitation token through", async () => {
    await renderPage({ token_hash: "h".repeat(40), inviteToken: "inv-1" })
    const button = screen.getByRole("button", {
      name: "Confirm and accept invitation",
    })
    expect(Object.fromEntries(new FormData(button.closest("form")!))).toEqual({
      token_hash: "h".repeat(40),
      type: "email",
      inviteToken: "inv-1",
    })
  })

  it("offers no button for a link without a token", async () => {
    await renderPage({})
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    // The heading says what happened, and the body names the way on.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This confirmation link is incomplete",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Didn’t receive a confirmation email\?/)
    ).toBeInTheDocument()
  })

  it("lets only the first press post, and shows it is under way", async () => {
    await renderPage({ token_hash: "h".repeat(40) })
    const button = screen.getByRole("button", { name: "Confirm and sign in" })
    const form = button.closest("form")!
    // fireEvent returns false when the handler prevented the default.
    let first = false
    act(() => {
      first = fireEvent.submit(form)
    })
    expect(first).toBe(true)
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button).toHaveTextContent("Confirming…")
    let second = true
    act(() => {
      second = fireEvent.submit(form)
    })
    expect(second).toBe(false)
  })

  it("is ready again when the page comes back from the back-forward cache", async () => {
    await renderPage({ token_hash: "h".repeat(40) })
    const form = screen.getByRole("button").closest("form")!
    act(() => {
      fireEvent.submit(form)
    })
    act(() => {
      const event = new Event("pageshow") as PageTransitionEvent
      Object.defineProperty(event, "persisted", { value: true })
      window.dispatchEvent(event)
    })
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy")
    expect(fireEvent.submit(form)).toBe(true)
  })
})
