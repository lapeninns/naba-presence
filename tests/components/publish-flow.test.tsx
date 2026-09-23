import { renderHook, act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import {
  NOTHING_TO_SEND,
  usePublishFlow,
  type PublishStep,
} from "@/lib/editors/use-publish-flow"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toast"

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

describe("usePublishFlow", () => {
  it("runs the steps in order and reports each one", async () => {
    const order: string[] = []
    const steps: PublishStep[] = [
      {
        key: "save",
        label: "Save",
        run: async () => {
          order.push("save")
        },
      },
      {
        key: "publish",
        label: "Publish",
        run: async () => {
          order.push("publish")
        },
      },
    ]
    const { result } = renderHook(
      () => usePublishFlow({ steps: () => steps, successToast: "Published" }),
      { wrapper }
    )

    await act(async () => {
      await result.current.publish()
    })

    expect(order).toEqual(["save", "publish"])
    expect(result.current.results.map((step) => step.status)).toEqual([
      "done",
      "done",
    ])
    expect(result.current.error).toBeNull()
  })

  it("stops at the first failure and says which step failed", async () => {
    // The whole point of per-step results: an operator whose save landed but
    // whose publish did not must be able to see that, rather than infer it
    // from a single toast.
    const later = vi.fn()
    const steps: PublishStep[] = [
      { key: "save", label: "Save", run: async () => {} },
      {
        key: "publish",
        label: "Publish",
        run: async () => {
          throw new Error("Google said no")
        },
      },
      { key: "attributes", label: "Attributes", run: later },
    ]
    const { result } = renderHook(
      () => usePublishFlow({ steps: () => steps }),
      { wrapper }
    )

    await act(async () => {
      await result.current.publish()
    })

    expect(later).not.toHaveBeenCalled()
    expect(result.current.results.map((step) => step.status)).toEqual([
      "done",
      "failed",
      "pending",
    ])
    expect(result.current.error).toBeTruthy()
  })

  it("builds the steps when publishing starts, not on every render", async () => {
    // A step usually closes over the result of the one before it, which does
    // not exist while the editor is only being drawn.
    const build = vi.fn(() => [] as PublishStep[])
    const { result } = renderHook(() => usePublishFlow({ steps: build }), {
      wrapper,
    })
    expect(build).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.publish()
    })
    expect(build).toHaveBeenCalledTimes(1)
  })
})

describe("usePublishFlow no-op steps", () => {
  it("marks a step that found nothing to send, instead of calling it sent", async () => {
    const steps: PublishStep[] = [
      { key: "profile", label: "Profile", run: async () => NOTHING_TO_SEND },
      { key: "listing", label: "Listing", run: async () => ({ ok: true }) },
    ]
    const { result } = renderHook(
      () => usePublishFlow({ steps: () => steps }),
      { wrapper }
    )
    await act(async () => {
      await result.current.publish()
    })
    expect(result.current.results.map((step) => step.noop)).toEqual([
      true,
      false,
    ])
  })
})

describe("ReviewChangesSheet", () => {
  const conflictRows = [
    {
      field: "Phone",
      before: "01223 277 217",
      after: "01223 277 218",
      state: "conflict" as const,
    },
  ]

  it("will not publish over Google's change until that is acknowledged", async () => {
    const user = userEvent.setup()
    const publish = vi.fn()
    renderWithProviders(
      <ReviewChangesSheet
        open
        onOpenChange={() => {}}
        rows={conflictRows}
        locationName="Old Crown"
        onPublish={publish}
      />
    )
    const sheet = await screen.findByRole("dialog")
    const button = within(sheet).getByRole("button", {
      name: "Publish to Google",
    })
    expect(button).toBeDisabled()

    await user.click(within(sheet).getByRole("checkbox"))
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it("words each step by what actually happened", async () => {
    renderWithProviders(
      <ReviewChangesSheet
        open
        onOpenChange={() => {}}
        rows={[{ field: "Store code", before: "", after: "RIVER-2" }]}
        locationName="Old Crown"
        onPublish={vi.fn()}
        error="Google or our service is temporarily unavailable."
        results={[
          { key: "profile", label: "Publish name", status: "done", kind: "google", noop: true },
          { key: "listing", label: "Publish categories", status: "failed", kind: "google", message: "Google or our service is temporarily unavailable.", code: "google_unavailable" },
          { key: "attributes", label: "Publish attributes", status: "pending", kind: "google" },
        ]}
      />
    )
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText("Nothing to send")).toBeInTheDocument()
    expect(within(sheet).queryByText("Sent to Google")).toBeNull()
    expect(within(sheet).getByText("google_unavailable")).toBeInTheDocument()
    expect(
      within(sheet).getByText("Not sent — an earlier step failed")
    ).toBeInTheDocument()
    expect(within(sheet).getByRole("button", { name: "Try again" })).toBeEnabled()
  })

  it("publishes a plain change without asking for anything", async () => {
    renderWithProviders(
      <ReviewChangesSheet
        open
        onOpenChange={() => {}}
        rows={[{ field: "Phone", before: "01223 277 217", after: "01223 277 218" }]}
        locationName="Old Crown"
        onPublish={vi.fn()}
      />
    )
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    ).toBeEnabled()
    expect(within(sheet).queryByRole("checkbox")).toBeNull()
  })
})
