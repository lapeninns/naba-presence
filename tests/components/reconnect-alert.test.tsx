import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReconnectAlert } from "@/components/settings/reconnect-alert"
import type { ConnectionSummary } from "@/lib/api/connections"
import { reconnectReason } from "@/lib/connections/reconnect-reason"

const connectMutate = vi.fn()
let connections: ConnectionSummary[] = []
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => ({
    query: { data: { connections } },
    connect: { mutate: connectMutate, isPending: false },
  }),
}))

function connection(overrides: Partial<ConnectionSummary>): ConnectionSummary {
  return {
    id: "c1",
    googleEmail: "venues@lapen.test",
    status: "revoked",
    notificationsEnabled: false,
    lastRefreshAt: null,
    lastErrorCode: "invalid_grant",
    refreshTokenExpiresAt: null,
    reconnectRequired: true,
    createdAt: "2026-09-18T10:00:00.000Z",
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  connections = []
})

describe("reconnectReason", () => {
  const now = Date.parse("2026-09-26T00:00:00Z")
  it("reads a passed refresh-token expiry as expired, even behind invalid_grant", () => {
    expect(
      reconnectReason(
        { status: "revoked", lastErrorCode: "invalid_grant", refreshTokenExpiresAt: "2026-09-25T10:00:00Z" },
        now
      )
    ).toBe("expired")
  })
  it("reads invalid_grant with no expiry as revoked", () => {
    expect(reconnectReason({ status: "revoked", lastErrorCode: "invalid_grant" }, now)).toBe("revoked")
  })
  it("reads a scope failure as a missing permission", () => {
    expect(reconnectReason({ status: "revoked", lastErrorCode: "insufficient_scope" }, now)).toBe(
      "permission_missing"
    )
  })
  it("reads a transient expiry as expired", () => {
    expect(reconnectReason({ status: "expired", lastErrorCode: "google_unauthenticated" }, now)).toBe(
      "expired"
    )
  })
})

describe("ReconnectAlert", () => {
  it("says a revoked grant was revoked, and reconnects that account", async () => {
    connections = [connection({})]
    render(<ReconnectAlert />)
    expect(screen.getByText("Google access was revoked")).toBeInTheDocument()
    // Reconnect first explains what signing in again does, then targets
    // exactly that connection when the operator continues to Google.
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(connectMutate).not.toHaveBeenCalled()
    fireEvent.click(
      await screen.findByRole("button", { name: /Continue to Google/ })
    )
    expect(connectMutate).toHaveBeenCalledWith({ reconnectConnectionId: "c1" })
  })

  it("says an expired sign-in expired, with the date", () => {
    connections = [connection({ refreshTokenExpiresAt: "2026-01-02T10:00:00.000Z" })]
    render(<ReconnectAlert />)
    expect(screen.getByText("Google sign-in expired")).toBeInTheDocument()
    expect(screen.getByText(/expired on 2 January 2026/)).toBeInTheDocument()
  })

  it("renders nothing when every connection is healthy", () => {
    connections = [connection({ reconnectRequired: false, status: "active" })]
    const { container } = render(<ReconnectAlert />)
    expect(container).toBeEmptyDOMElement()
  })
})
