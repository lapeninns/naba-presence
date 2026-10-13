import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import DashboardError from "@/app/(dashboard)/error"
import DashboardNotFound from "@/app/(dashboard)/not-found"
import { queryKeys } from "@/lib/queries/keys"
import GlobalError from "@/app/global-error"
import NotFound from "@/app/not-found"

describe("route error boundary", () => {
  it("names the failed area, shows the digest and retries", async () => {
    const retry = vi.fn()
    const reset = vi.fn()
    render(
      <DashboardError
        error={Object.assign(new Error("secret detail"), { digest: "d-123" })}
        reset={reset}
        unstable_retry={retry}
      />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports hit an error" })
    ).toBeInTheDocument()
    expect(screen.getByText("d-123")).toBeInTheDocument()
    // The message itself can carry details the viewer should not see.
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    // Inside the dashboard the shell owns the one <main>; the boundary
    // renders its page frame (a div) and no landmark of its own.
    expect(screen.queryByRole("main")).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="page-frame"]')).not.toBeNull()
  })

  it("falls back to reset when retry is unavailable", async () => {
    const reset = vi.fn()
    render(<DashboardError error={new Error("x")} reset={reset} />)
    expect(screen.queryByText("Reference")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe("root pages", () => {
  it("the root 404 has one main, one h1 and a way back in", () => {
    render(<NotFound />)
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })

  it("the global error shows the digest in mono, never the message", () => {
    // global-error renders its own <html>; mount it into the document.
    render(
      <GlobalError
        error={Object.assign(new Error("secret detail"), { digest: "g-9" })}
        reset={vi.fn()}
      />,
      { container: document }
    )
    expect(screen.getByText("g-9").tagName).toBe("CODE")
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
  })
})

describe("dashboard 404", () => {
  function renderNotFound(role: string, workspaceMode: "agency" | "business") {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(queryKeys.session, {
      session: { role, workspaceMode },
    })
    render(
      <QueryClientProvider client={client}>
        <DashboardNotFound />
      </QueryClientProvider>
    )
    const section = screen.getByRole("region", { name: "Where to go instead" })
    return Array.from(section.querySelectorAll("a")).map((link) =>
      link.getAttribute("href")
    )
  }

  it("offers the registry's destinations for an agency owner", () => {
    expect(renderNotFound("owner", "agency")).toEqual([
      "/inbox",
      "/listings",
      "/clients",
      "/calendar",
      "/reports",
      "/notifications",
      "/team",
      "/settings",
    ])
    // Inside the shell: no landmark of its own.
    expect(screen.queryByRole("main")).not.toBeInTheDocument()
  })

  it("leaves Team out for a member and Clients out for a business", () => {
    expect(renderNotFound("member", "business")).toEqual([
      "/inbox",
      "/listings",
      "/calendar",
      "/reports",
      "/notifications",
      "/settings",
    ])
  })
})
