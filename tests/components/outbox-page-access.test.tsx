import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const { prefetch } = vi.hoisted(() => ({ prefetch: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/outbox",
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/server/session", () => ({
  getSession: async () => ({ role: "viewer" }),
}))
vi.mock("@/lib/server/prefetch", () => ({ prefetch }))
vi.mock("@/lib/server/outbox-prefetch", () => ({ outboxPrefetch: vi.fn() }))

import OutboxPage from "@/app/(dashboard)/outbox/page"

describe("/outbox for a viewer", () => {
  it("names every role that has an Outbox and reads nothing", async () => {
    const page = await OutboxPage({ searchParams: Promise.resolve({}) })
    render(
      <QueryClientProvider client={new QueryClient()}>
        {page}
      </QueryClientProvider>
    )
    expect(
      screen.getByText(/Outbox is limited to an owner, admin or member\./)
    ).toBeInTheDocument()
    expect(prefetch).not.toHaveBeenCalled()
  })
})
