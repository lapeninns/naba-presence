import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const getSession = vi.fn()
vi.mock("@/lib/server/session", () => ({ getSession: () => getSession() }))
vi.mock("@/components/settings/connections-workspace", () => ({
  ConnectionsWorkspace: () => <section aria-label="Connections workspace" />,
}))
vi.mock("@/components/app-shell/access-denied", () => ({
  AccessDenied: ({ area }: { area: string }) => (
    <p role="alert">No access to {area}</p>
  ),
}))

import SettingsConnectionsPage from "@/app/(dashboard)/settings/connections/page"

describe("Settings › Google connections page", () => {
  it.each(["owner", "admin"])("gives the %s the workspace", async (role) => {
    getSession.mockResolvedValue({ role })
    render(await SettingsConnectionsPage())
    expect(
      screen.getByRole("region", { name: "Connections workspace" })
    ).toBeInTheDocument()
  })

  it.each(["member", "viewer"])(
    "keeps the %s out, with no view-only copy",
    async (role) => {
      getSession.mockResolvedValue({ role })
      render(await SettingsConnectionsPage())
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No access to Google connections"
      )
      expect(
        screen.queryByRole("region", { name: "Connections workspace" })
      ).toBeNull()
    }
  )

  it("keeps a signed-out request out", async () => {
    getSession.mockResolvedValue(null)
    render(await SettingsConnectionsPage())
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })
})
