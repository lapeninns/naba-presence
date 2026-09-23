import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OAuthReturn } from "@/components/settings/oauth-return"
import { Toaster } from "@/components/ui/toast"

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}))
const connectMutate = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => ({ connect: { mutate: connectMutate, isPending: false } }),
}))

afterEach(() => {
  vi.clearAllMocks()
  search = new URLSearchParams()
})

describe("OAuthReturn", () => {
  it("shows a mapped error and a Try again action for ?google=error&status=502", () => {
    search = new URLSearchParams("google=error&status=502")
    render(<Toaster><OAuthReturn /></Toaster>)
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
    expect(screen.queryByText(/status=502/)).not.toBeInTheDocument()
  })

  it("clears the query and renders nothing for ?google=connected", () => {
    search = new URLSearchParams("google=connected")
    const { container } = render(<Toaster><OAuthReturn /></Toaster>)
    expect(replace).toHaveBeenCalledWith("/settings/connections")
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it("explains a consent that left out Business Profile access", () => {
    search = new URLSearchParams("google=error&status=403&reason=google_scope_missing")
    render(<Toaster><OAuthReturn /></Toaster>)
    expect(screen.getByText("Permission not granted")).toBeInTheDocument()
    expect(screen.getByText(/leave the Business Profile permission ticked/i)).toBeInTheDocument()
    expect(screen.queryByText(/don’t have permission to connect Google/i)).toBeNull()
  })
})
