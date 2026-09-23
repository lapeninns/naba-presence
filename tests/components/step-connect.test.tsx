import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StepConnect } from "@/components/setup/step-connect"
import { Toaster } from "@/components/ui/toast"

const workspaceMock = vi.fn()
const attachMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => workspaceMock(),
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClientMutations: () => ({
    attachConnection: { mutate: attachMock, isPending: false, variables: undefined },
  }),
}))

function renderStep(onConnected = vi.fn()) {
  workspaceMock.mockReturnValue({
    query: {
      data: {
        connections: [
          { id: "c-live", googleEmail: "shared@lapen.test", status: "active", reconnectRequired: false },
          { id: "c-old", googleEmail: "old@lapen.test", status: "expired", reconnectRequired: true },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <StepConnect clientId="client-1" clientName="Lapen Inns" onConnected={onConnected} />
      </Toaster>
    </QueryClientProvider>
  )
  return onConnected
}

afterEach(() => vi.clearAllMocks())

describe("StepConnect", () => {
  it("files a connected login under the client and moves on", () => {
    const onConnected = renderStep()
    attachMock.mockImplementation((_input, options) => options.onSuccess())
    fireEvent.click(screen.getByRole("button", { name: "Use shared@lapen.test" }))
    expect(attachMock).toHaveBeenCalledWith(
      { clientId: "client-1", connectionId: "c-live" },
      expect.anything()
    )
    expect(onConnected).toHaveBeenCalledTimes(1)
  })

  it("offers no shortcut for a login that needs reconnecting", () => {
    renderStep()
    expect(screen.queryByRole("button", { name: "Use old@lapen.test" })).toBeNull()
    expect(screen.getByText("Needs reconnecting")).toBeInTheDocument()
  })
})
