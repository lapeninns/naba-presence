import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { NewClientForm } from "@/components/clients/client-form"
import { Toaster } from "@/components/ui/toast"
import { QueryProvider } from "@/lib/queries/provider"

afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

const renderForm = () =>
  render(
    <QueryProvider>
      <Toaster>
        <NewClientForm />
      </Toaster>
    </QueryProvider>
  )

describe("NewClientForm", () => {
  it("gives the name field touch-friendly keyboard hints", () => {
    renderForm()
    const name = screen.getByRole("textbox", { name: /Client name/ })
    expect(name).toHaveAttribute("autocomplete", "off")
    expect(name).toHaveAttribute("autocapitalize", "words")
    expect(name).toHaveAttribute("enterkeyhint", "go")
  })

  it("asks for a name and keeps focus on the field", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    expect(screen.getByText("Give the client a name.")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /Client name/ })).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("explains the next steps as an ordered list", () => {
    renderForm()
    expect(
      screen.getByRole("heading", { name: "What happens next" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })
})
