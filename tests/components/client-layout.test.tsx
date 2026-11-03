import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { state, notFound } = vi.hoisted(() => ({
  state: {
    role: "owner",
    row: undefined as
      { id: string; name: string; archived: boolean } | undefined,
  },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("next/navigation", () => ({
  notFound,
  usePathname: () => "/clients/x",
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/server/session", () => ({
  getSession: async () => ({ organisationId: "org", role: state.role }),
}))
vi.mock("@/lib/server/workspace-redirect", () => ({
  redirectOutOfClientLayer: () => {},
}))
vi.mock("@/lib/server/permissions", () => ({
  clientVisibilityPredicate: () => "",
}))
vi.mock("@/lib/server/db", () => ({
  withTenant: async () => (state.row ? [state.row] : []),
}))
vi.mock("@/components/app-shell/client-context", () => ({
  ClientScopeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="scope">{children}</div>
  ),
}))

import ClientLayout from "@/app/(dashboard)/clients/[clientId]/layout"

const ID = "00000000-0000-4000-8000-000000000001"
const mount = async () =>
  render(
    await ClientLayout({
      params: Promise.resolve({ clientId: ID }),
      children: <p>hub</p>,
    })
  )

beforeEach(() => {
  notFound.mockClear()
  state.role = "owner"
  state.row = { id: ID, name: "Old Crown Group", archived: false }
})

describe("client layout", () => {
  it("scopes the shell to a visible client", async () => {
    await mount()
    expect(screen.getByTestId("scope")).toHaveTextContent("hub")
  })

  it("answers not found for a client this session cannot see", async () => {
    state.row = undefined
    await expect(mount()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("tells an owner where to restore an archived client, in one short sentence", async () => {
    state.row = { id: ID, name: "Old Crown Group", archived: true }
    await mount()
    expect(screen.getByText("Old Crown Group is archived")).toBeInTheDocument()
    const line = screen.getByText("Restore it from the archived clients.")
    expect(line.textContent!.length).toBeLessThanOrEqual(44)
    expect(
      screen.getByRole("link", { name: "View archived clients" })
    ).toHaveAttribute("href", "/clients?view=archived")
  })

  it("tells a member who can restore it, without a restore link", async () => {
    state.role = "member"
    state.row = { id: ID, name: "Old Crown Group", archived: true }
    await mount()
    expect(
      screen.getByText("An owner or admin can restore it.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Back to clients" })
    ).toHaveAttribute("href", "/clients")
  })
})
