import { act, renderHook, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ListingChangeRequests } from "@/components/locations/listing-change-requests"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import * as listingChangesApi from "@/lib/api/listing-changes"
import {
  LISTING_CHANGE_AWAITING_APPROVAL,
  type ListingChangeRequest,
} from "@/lib/contracts/listing-changes"
import {
  usePublishFlow,
  type PublishStep,
} from "@/lib/editors/use-publish-flow"

const LOCATION = "33333333-3333-4333-8333-333333333333"

function change(
  overrides: Partial<ListingChangeRequest> = {}
): ListingChangeRequest {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    intentId: "22222222-2222-4222-8222-222222222222",
    kind: "hours_publish",
    label: "Publish opening hours",
    locationId: LOCATION,
    target: null,
    fieldMask: ["regularHours"],
    payloadHash: "b".repeat(64),
    outcome: "awaiting_approval",
    errorCode: null,
    author: { id: "44444444-4444-4444-8444-444444444444", name: "Ada" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isOwn: false,
    canDecide: true,
    ...overrides,
  }
}

describe("ListingChangeRequests", () => {
  afterEach(() => vi.restoreAllMocks())

  it("offers a second publisher approve and reject, and approves the exact request shown", async () => {
    vi.spyOn(listingChangesApi, "fetchListingChangeRequests").mockResolvedValue(
      [
        change(),
        change({
          id: "55555555-5555-4555-8555-555555555555",
          kind: "media_create",
        }),
      ]
    )
    const decide = vi
      .spyOn(listingChangesApi, "decideListingChangeRequest")
      .mockResolvedValue({
        changeRequest: change({ outcome: "confirmed_applied" }),
        operation: {
          operationId: change().id,
          outcome: "confirmed_applied",
        },
      })
    renderWithProviders(
      <ListingChangeRequests locationId={LOCATION} editor="hours" />
    )

    expect(
      await screen.findByText("Publish opening hours: waiting for approval")
    ).toBeInTheDocument()
    // Only this editor's requests: the photo request belongs to the photos tab.
    expect(screen.getAllByTestId("listing-change-requests")).toHaveLength(1)
    expect(screen.getByText(/Ada asked/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("button", { name: "Approve and send" })
    )
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0]?.slice(0, 3)).toEqual([
      LOCATION,
      change().id,
      { decision: "approve", payloadHash: "b".repeat(64) },
    ])
    expect(await screen.findByText("Live on Google")).toBeInTheDocument()
  })

  it("lets the author withdraw but never approve their own request", async () => {
    vi.spyOn(listingChangesApi, "fetchListingChangeRequests").mockResolvedValue(
      [change({ isOwn: true, canDecide: false })]
    )
    renderWithProviders(
      <ListingChangeRequests locationId={LOCATION} editor="hours" />
    )

    expect(
      await screen.findByRole("button", { name: "Withdraw" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Approve and send" })
    ).toBeNull()
    expect(screen.getByText(/You asked/)).toBeInTheDocument()
  })

  it("asks for nothing where listing approval is off", async () => {
    const fetchRequests = vi.spyOn(
      listingChangesApi,
      "fetchListingChangeRequests"
    )
    const { container } = renderWithProviders(
      <ListingChangeRequests
        locationId={LOCATION}
        editor="hours"
        enabled={false}
      />
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fetchRequests).not.toHaveBeenCalled()
    expect(
      container.querySelector("[data-testid=listing-change-requests]")
    ).toBeNull()
  })
})

describe("usePublishFlow with a parked step", () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return (
      <QueryClientProvider client={client}>
        <Toaster>{children}</Toaster>
      </QueryClientProvider>
    )
  }

  it("reports the step as awaiting approval, not failed, and never says sent", async () => {
    const steps: PublishStep[] = [
      { key: "save", label: "Save", kind: "local", run: async () => ({}) },
      {
        key: "publish",
        label: "Publish",
        verified: true,
        run: async () => {
          throw new ApiClientError(
            202,
            LISTING_CHANGE_AWAITING_APPROVAL,
            "Sent for approval.",
            { outcome: "awaiting_approval" }
          )
        },
      },
    ]
    const { result } = renderHook(
      () =>
        usePublishFlow({
          steps: () => steps,
          successToast: {
            outcome: "sent",
            title: "Opening hours sent to Google",
          },
        }),
      { wrapper }
    )
    let ok = false
    await act(async () => {
      ok = await result.current.publish()
    })
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.results[1]).toMatchObject({
      status: "done",
      outcome: "awaiting_approval",
    })
    expect(await screen.findByText("Sent for approval")).toBeInTheDocument()
    expect(screen.queryByText("Opening hours sent to Google")).toBeNull()
  })
})
