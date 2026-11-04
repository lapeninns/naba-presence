import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({
  current: { role: "owner" } as { role: string } | null,
}))

vi.mock("@/lib/server/session", () => ({
  getSession: vi.fn(async () => session.current),
}))
vi.mock("@/lib/server/prefetch", () => ({
  prefetch: vi.fn(async () => undefined),
}))
vi.mock("@/lib/server/operations-prefetch", () => ({
  operationsPrefetch: () => [],
}))
vi.mock("@/lib/queries/hydration-boundary", () => ({
  HydrationBoundary: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/settings/operations-view", () => ({
  OperationsView: () => <section aria-label="Operations health" />,
}))
vi.mock("@/components/app-shell/access-denied", () => ({
  AccessDenied: ({ area }: { area: string }) => <p>{`No access to ${area}`}</p>,
}))

import SettingsOperationsPage from "@/app/(dashboard)/settings/operations/page"

describe("Settings › Operations page", () => {
  beforeEach(() => {
    session.current = { role: "owner" }
  })

  it.each(["owner", "admin"])(
    "is one header with no tab row for an %s: the settings section list is the way round",
    async (role) => {
      session.current = { role }
      render(await SettingsOperationsPage())
      const header = screen.getByRole("banner")
      expect(
        screen.getByRole("heading", { level: 1, name: "Operations" })
      ).toBeInTheDocument()
      expect(header.querySelector("nav")).toBeNull()
      expect(screen.queryByRole("navigation")).toBeNull()
      expect(
        screen.getByRole("region", { name: "Operations health" })
      ).toBeInTheDocument()
    }
  )

  it.each(["member", "viewer"])(
    "keeps a %s out, with no view-only page",
    async (role) => {
      session.current = { role }
      render(await SettingsOperationsPage())
      expect(screen.getByText("No access to Operations")).toBeInTheDocument()
      expect(screen.queryByRole("banner")).toBeNull()
      expect(
        screen.queryByRole("region", { name: "Operations health" })
      ).toBeNull()
    }
  )

  it("keeps a signed-out visitor out", async () => {
    session.current = null
    render(await SettingsOperationsPage())
    expect(screen.getByText("No access to Operations")).toBeInTheDocument()
  })
})
