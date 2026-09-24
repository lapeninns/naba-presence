import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StepConnect } from "@/components/setup/step-connect"
import { Toaster } from "@/components/ui/toast"
import * as connectionsApi from "@/lib/api/connections"

const workspaceMock = vi.fn()
const attachMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => workspaceMock(),
}))
// The step also reads the OAuth callback's `?google=` result from the URL.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClientMutations: () => ({
    attachConnection: {
      mutate: attachMock,
      isPending: false,
      variables: undefined,
    },
  }),
}))

function renderStep(onConnected = vi.fn()) {
  workspaceMock.mockReturnValue({
    query: {
      data: {
        connections: [
          {
            id: "c-live",
            googleEmail: "shared@lapen.test",
            status: "active",
            reconnectRequired: false,
          },
          {
            id: "c-old",
            googleEmail: "old@lapen.test",
            status: "expired",
            reconnectRequired: true,
          },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <StepConnect
          clientId="client-1"
          clientName="Lapen Inns"
          onConnected={onConnected}
        />
      </Toaster>
    </QueryClientProvider>
  )
  return onConnected
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("StepConnect", () => {
  it("files a connected login under the client and moves on", () => {
    const onConnected = renderStep()
    attachMock.mockImplementation((_input, options) => options.onSuccess())
    fireEvent.click(
      screen.getByRole("button", { name: "Use shared@lapen.test" })
    )
    expect(attachMock).toHaveBeenCalledWith(
      { clientId: "client-1", connectionId: "c-live" },
      expect.anything()
    )
    expect(onConnected).toHaveBeenCalledTimes(1)
  })

  it("offers no shortcut for a login that needs reconnecting", () => {
    renderStep()
    expect(
      screen.queryByRole("button", { name: "Use old@lapen.test" })
    ).toBeNull()
    expect(screen.getByText("Needs reconnecting")).toBeInTheDocument()
  })

  it("reconnects a broken login and comes back to this step", async () => {
    const start = vi
      .spyOn(connectionsApi, "startGoogleConnect")
      .mockResolvedValue({ authorizationUrl: "https://accounts.example/auth" })
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    renderStep()
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect old@lapen.test" })
    )
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        clientId: "client-1",
        returnTo: "/setup?client=client-1&step=connect",
        reconnectConnectionId: "c-old",
      })
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accounts.example/auth")
    )
    vi.unstubAllGlobals()
  })

  it("names the fresh sign-in as signing in with Google", () => {
    renderStep()
    expect(
      screen.getByRole("button", { name: "Sign in with Google" })
    ).toBeInTheDocument()
  })

  it("shows a failed attach inline", () => {
    renderStep()
    attachMock.mockImplementation((_input, options) =>
      options.onError(new Error("nope"))
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Use shared@lapen.test" })
    )
    expect(screen.getByTestId("setup-attach-error")).toHaveTextContent(
      "Couldn’t use that account"
    )
  })
})
