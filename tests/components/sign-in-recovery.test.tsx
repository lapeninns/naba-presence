// Retry and resend behaviour of the sign-in surface. Kept apart from
// sign-in-form.test.tsx on purpose: that file's success tests leave a
// navigation promise that never settles, and React keeps every later async
// transition in the same file pending with it, so a button never leaves its
// pending label there.
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ResendConfirmationButton } from "@/components/auth/resend-confirmation-button"
import { SignInForm } from "@/components/auth/sign-in-form"
import { ApiClientError } from "@/lib/api/client"
import * as authApi from "@/lib/api/auth"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("sign-in retry", () => {
  it("clears the last answer on a new attempt, so a repeat is announced afresh", async () => {
    const user = userEvent.setup()
    let release: (error: unknown) => void = () => {}
    vi.spyOn(authApi, "signIn")
      .mockRejectedValueOnce(
        new ApiClientError(401, "invalid_credentials", "server copy")
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            release = reject
          })
      )
    render(<SignInForm />)
    await user.type(screen.getByLabelText("Email address"), "a@example.test")
    await user.type(screen.getByLabelText("Password"), "wrong-password-9")
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email or password is incorrect."
    )
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    // While the second attempt waits, the old answer is gone rather than
    // taking focus as if it were the reply.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    )
    release(new ApiClientError(401, "invalid_credentials", "server copy"))
    const alert = await screen.findByRole("alert")
    await waitFor(() => expect(alert.parentElement).toHaveFocus())
  })
})

describe("resend confirmation", () => {
  it("keeps its live region in the accessibility tree while it is empty", () => {
    const { container } = render(
      <ResendConfirmationButton email="sam@example.test" />
    )
    const region = container.querySelector("[aria-live='polite']")
    expect(region).toBeInTheDocument()
    expect(region).toBeEmptyDOMElement()
    // Visually hidden, never display:none, so what is written in is read out.
    expect(region).not.toHaveClass("hidden")
    expect(region).not.toHaveClass("empty:hidden")
    expect(region).toHaveClass("empty:sr-only")
  })

  it("stays on screen as Send another link, with a neutral result", async () => {
    const user = userEvent.setup()
    const resend = vi
      .spyOn(authApi, "resendConfirmation")
      .mockResolvedValue(undefined)
    render(<ResendConfirmationButton email=" sam@example.test " />)
    const button = screen.getByRole("button", {
      name: "Resend confirmation email",
    })
    await user.click(button)
    expect(resend).toHaveBeenCalledWith("sam@example.test")
    expect(
      await screen.findByText(
        "A new confirmation link is on its way to sam@example.test if it still needs confirming."
      )
    ).toBeInTheDocument()
    const again = await screen.findByRole("button", {
      name: "Send another link",
    })
    expect(again).toBe(button)
    await user.click(again)
    expect(resend).toHaveBeenCalledTimes(2)
  })

  it("offers the first label again for a corrected address", async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, "resendConfirmation").mockResolvedValue(undefined)
    const { rerender } = render(
      <ResendConfirmationButton email="sam@example.test" />
    )
    await user.click(screen.getByRole("button"))
    await screen.findByRole("button", { name: "Send another link" })
    rerender(<ResendConfirmationButton email="sam@example.co.uk" />)
    expect(
      screen.getByRole("button", { name: "Resend confirmation email" })
    ).toBeInTheDocument()
  })

  it("sends nothing for an empty address and says so itself", async () => {
    const user = userEvent.setup()
    const resend = vi.spyOn(authApi, "resendConfirmation")
    render(<ResendConfirmationButton email="" />)
    await user.click(screen.getByRole("button"))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your email address above first."
    )
    expect(resend).not.toHaveBeenCalled()
  })

  it("sends the invitation along and titles an outage for its surface", async () => {
    const user = userEvent.setup()
    const resend = vi
      .spyOn(authApi, "resendConfirmation")
      .mockRejectedValue(
        new ApiClientError(503, "auth_provider_unavailable", "x")
      )
    render(
      <ResendConfirmationButton
        email="sam@example.test"
        inviteToken="inv-1"
        surface="invitation"
        variant="button"
      />
    )
    await user.click(screen.getByRole("button"))
    expect(resend).toHaveBeenCalledWith("sam@example.test", "inv-1")
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Accepting invitations is temporarily unavailable. This is a problem on our side. Try again shortly."
    )
  })

  it("asks for a whole address when what is typed is not one", async () => {
    const user = userEvent.setup()
    render(<ResendConfirmationButton email="sam@" />)
    await user.click(screen.getByRole("button"))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an email address like name@example.co.uk."
    )
  })
})
