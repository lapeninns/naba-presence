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

const LOGINS = [
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
]

function renderStep(
  onConnected = vi.fn(),
  {
    connections = LOGINS,
    attachedConnectionId,
  }: { connections?: unknown[]; attachedConnectionId?: string | null } = {}
) {
  workspaceMock.mockReturnValue({
    query: {
      data: { connections },
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
          business={false}
          attachedConnectionId={attachedConnectionId}
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
      screen.getByRole("button", { name: "Use this account shared@lapen.test" })
    )
    expect(attachMock).toHaveBeenCalledWith(
      { clientId: "client-1", connectionId: "c-live" },
      expect.anything()
    )
    expect(onConnected).toHaveBeenCalledTimes(1)
  })

  it("leads with the connected login, ahead of a new sign-in", () => {
    renderStep()
    const use = screen.getByRole("button", {
      name: "Use this account shared@lapen.test",
    })
    expect(use).toHaveAttribute("data-slot", "option-row")
    expect(use).toHaveAttribute("id", "setup-connect-use-first")
    expect(use).toHaveTextContent("Use this account")
    const signIn = screen.getByRole("button", { name: "Sign in with Google" })
    expect(
      use.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", {
        name: "Or sign in with another Google account",
      })
    ).toBeInTheDocument()
  })

  it("offers no shortcut for a login that needs reconnecting", () => {
    renderStep()
    expect(
      screen.queryByRole("button", {
        name: /^Use this account old@lapen\.test/,
      })
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
      screen.getByRole("button", { name: "Use this account shared@lapen.test" })
    )
    expect(screen.getByTestId("setup-attach-error")).toHaveTextContent(
      "Couldn’t use that account"
    )
  })

  it("lists the client's own login first, as the one it keeps using", () => {
    const onConnected = renderStep(vi.fn(), {
      connections: [
        {
          id: "c-other",
          googleEmail: "other@lapen.test",
          status: "active",
          reconnectRequired: false,
        },
        ...LOGINS,
      ],
      attachedConnectionId: "c-live",
    })
    const keep = screen.getByRole("button", {
      name: "Keep using this account shared@lapen.test",
    })
    expect(keep).toHaveAttribute("id", "setup-connect-use-first")
    expect(keep).toHaveTextContent("Connected to Lapen Inns")
    // The same attach as any other row.
    attachMock.mockImplementation((_input, options) => options.onSuccess())
    fireEvent.click(keep)
    expect(attachMock).toHaveBeenCalledWith(
      { clientId: "client-1", connectionId: "c-live" },
      expect.anything()
    )
    expect(onConnected).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("button", { name: "Use this account other@lapen.test" })
    ).not.toHaveTextContent("Connected to")
  })

  it("draws the sign-in tile only when there is no login to reuse", () => {
    renderStep()
    expect(document.querySelector(".lucide-link-2")).toBeNull()
  })

  it("offers no list of logins when none was ever connected", () => {
    renderStep(vi.fn(), { connections: [] })
    expect(document.querySelector(".lucide-link-2")).not.toBeNull()
    expect(
      screen.getByRole("heading", { name: "Connect a Google account" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", {
        name: "Use an account already connected",
      })
    ).toBeNull()
  })
})
