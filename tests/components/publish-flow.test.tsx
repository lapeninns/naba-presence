import {
  renderHook,
  act,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import {
  NOTHING_TO_SEND,
  PUBLISH_FAILURE_TOAST,
  publishOutcome,
  stepOutcome,
  usePublishFlow,
  type PublishStep,
} from "@/lib/editors/use-publish-flow"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ApiClientError } from "@/lib/api/client"
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
  it.each([
    { status: "succeeded", confirmationState: "confirmed", executionState: "unknown" },
    { status: "succeeded" },
  ])("continues after a successful result: %j", async (outcome) => {
    const later = vi.fn()
    const { result } = renderHook(() => usePublishFlow({ steps: () => [
      { key: "listing", label: "Listing", run: async () => ({ id: "attempt-1", idempotent: true, ...outcome }) },
      { key: "attributes", label: "Attributes", run: later },
    ] }), { wrapper })
    await act(async () => { expect(await result.current.publish()).toBe(true) })
    expect(later).toHaveBeenCalledOnce()
  })
  it.each([
    { status: "ambiguous", executionState: "unknown", confirmationState: "unresolved" },
    { status: "succeeded", executionState: "accepted", confirmationState: "pending" },
  ])("stops when the recorded outcome is not confirmed: %j", async (outcome) => {
    const later = vi.fn()
    const completed = vi.fn()
    const { result } = renderHook(() => usePublishFlow({
      steps: () => [
        { key: "listing", label: "Listing", run: async () => ({ id: "attempt-1", idempotent: false, ...outcome }) },
        { key: "attributes", label: "Attributes", run: later },
      ],
      onSuccess: completed,
    }), { wrapper })
    await act(async () => { expect(await result.current.publish()).toBe(false) })
    expect(later).not.toHaveBeenCalled()
    expect(completed).not.toHaveBeenCalled()
    expect(result.current.results[0]).toMatchObject({ status: "failed", code: "google_confirmation_required" })
    expect(result.current.error).toContain("Activity")
  })
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

describe("publish outcome", () => {
  it("is live only when every Google write that went out was read back", () => {
    expect(
      publishOutcome([
        { key: "save", label: "Save", status: "done", kind: "local" },
        {
          key: "hours",
          label: "Hours",
          status: "done",
          kind: "google",
          verified: true,
        },
      ])
    ).toBe("confirmed_applied")
    expect(
      publishOutcome([
        {
          key: "profile",
          label: "Profile",
          status: "done",
          kind: "google",
          verified: true,
        },
        {
          key: "attributes",
          label: "Attributes",
          status: "done",
          kind: "google",
        },
      ])
    ).toBe("sent")
    // A step that sent nothing has nothing to verify.
    expect(
      publishOutcome([
        {
          key: "attributes",
          label: "Attributes",
          status: "done",
          kind: "google",
          noop: true,
        },
      ])
    ).toBe("confirmed_applied")
  })

  it("words the success toast by the outcome the steps reached", async () => {
    const steps: PublishStep[] = [
      { key: "save", label: "Save", kind: "local", run: async () => {} },
      { key: "publish", label: "Publish", verified: true, run: async () => {} },
    ]
    const { result } = renderHook(
      () =>
        usePublishFlow({
          steps: () => steps,
          successToast: (outcome) => ({ outcome }),
        }),
      { wrapper }
    )
    await act(async () => {
      await result.current.publish()
    })
    const toasts = screen.getByRole("region", { name: "Notifications" })
    expect(await within(toasts).findByText("Live on Google")).toBeVisible()
    expect(within(toasts).queryByText("Sent to Google")).toBeNull()
  })
})

describe("ReviewChangesSheet", () => {
  it("keeps an unresolved outcome visible and prevents immediate resubmission", async () => {
    const publish = vi.fn()
    renderWithProviders(<ReviewChangesSheet open onOpenChange={() => {}} rows={[{ field: "Opening date", before: "March 2000", after: "Not set" }]}
      locationName="Old Crown" onPublish={publish} error="Check Activity before publishing again."
      results={[
        { key: "listing", label: "Opening date", status: "failed", code: "google_confirmation_required" },
        { key: "attributes", label: "Attributes", status: "pending" },
      ]} />)
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText("Not confirmed")).toBeInTheDocument()
    expect(within(sheet).getByText("Not sent — an earlier step needs confirmation")).toBeInTheDocument()
    const retry = within(sheet).getByRole("button", { name: "Try again" })
    expect(retry).toBeDisabled()
    await userEvent.click(retry)
    expect(publish).not.toHaveBeenCalled()
  })
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
          {
            key: "profile",
            label: "Publish name",
            status: "done",
            kind: "google",
            noop: true,
          },
          {
            key: "listing",
            label: "Publish categories",
            status: "failed",
            kind: "google",
            message: "Google or our service is temporarily unavailable.",
            code: "google_unavailable",
          },
          {
            key: "attributes",
            label: "Publish attributes",
            status: "pending",
            kind: "google",
          },
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
    expect(
      within(sheet).getByRole("button", { name: "Try again" })
    ).toBeEnabled()
  })

  it("says live only for a finished step whose endpoint verified it", async () => {
    renderWithProviders(
      <ReviewChangesSheet
        open
        onOpenChange={() => {}}
        rows={[{ field: "Phone", before: "1", after: "2" }]}
        locationName="Old Crown"
        onPublish={vi.fn()}
        results={[
          { key: "save", label: "Save here", status: "done", kind: "local" },
          {
            key: "profile",
            label: "Publish name",
            status: "done",
            kind: "google",
            verified: true,
          },
          {
            key: "attributes",
            label: "Publish attributes",
            status: "done",
            kind: "google",
          },
        ]}
      />
    )
    const sheet = await screen.findByRole("dialog")
    const rows = within(sheet).getAllByRole("listitem")
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
      "saved_locally",
      "confirmed_applied",
      "sent",
    ])
    expect(rows[1]).toHaveTextContent("Live on Google")
    expect(rows[2]).toHaveTextContent("Sent to Google")
    expect(rows[2]).not.toHaveTextContent("Live on Google")
  })

  it("publishes a plain change without asking for anything", async () => {
    renderWithProviders(
      <ReviewChangesSheet
        open
        onOpenChange={() => {}}
        rows={[
          { field: "Phone", before: "01223 277 217", after: "01223 277 218" },
        ]}
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

describe("uncertain replacement review", () => {
  it("blocks unresolved rows and explains uncertainty without claiming a concurrent edit", () => {
    renderWithProviders(
      <ReviewChangesSheet
        open
        onOpenChange={() => {}}
        rows={[
          {
            field: "Soup",
            before: "A, B",
            after: "C, D",
            blocking: true,
            explanation: "These entries cannot be matched reliably.",
          },
        ]}
        locationName="Riverside"
        onPublish={() => {}}
      />
    )
    expect(
      screen.getByRole("button", { name: "Publish to Google" })
    ).toBeDisabled()
    expect(
      screen.getByText("These entries cannot be matched reliably.")
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/after you started editing/)
    ).not.toBeInTheDocument()
  })
})

describe("publication error scope", () => {
  it.each([
    {
      kind: "google" as const,
      noop: false,
      expected: "Earlier steps were sent to Google.",
    },
    {
      kind: "local" as const,
      noop: false,
      expected:
        "Completed local saves are kept. No Google step completed successfully.",
    },
    {
      kind: "google" as const,
      noop: true,
      expected: "Google refused this change",
    },
  ])(
    "reports $kind success accurately when noop=$noop before rejection",
    async ({ kind, noop, expected }) => {
      const { result } = renderHook(
        () =>
          usePublishFlow({
            steps: () => [
              {
                key: "first",
                label: "First",
                kind,
                run: async () => (noop ? NOTHING_TO_SEND : undefined),
              },
              {
                key: "failed",
                label: "Attributes",
                run: async () => {
                  throw new ApiClientError(403, "PERMISSION_DENIED", "raw")
                },
              },
            ],
          }),
        { wrapper }
      )
      await act(async () => {
        await result.current.publish()
      })
      expect(result.current.error).toContain(expected)
      expect(result.current.error).not.toContain("Nothing was changed")
      expect(result.current.results[0]).toMatchObject({
        status: "done",
        kind,
        noop,
      })
      expect(result.current.results[1]).toMatchObject({
        status: "failed",
        message: result.current.error,
      })
      // The toast only says it stopped; the reason sits on the step, once.
      expect(await screen.findByText(PUBLISH_FAILURE_TOAST)).toBeVisible()
      expect(result.current.results[1]?.reason).toBe(
        "Google refused this change: the connected login doesn’t have permission for it."
      )
      if (noop)
        expect(result.current.error).not.toContain("Earlier steps were sent")
    }
  )

  it.each(["TimeoutError", "AbortError"])(
    "does not claim zero writes after %s on the first Google step",
    async (name) => {
      const { result } = renderHook(
        () =>
          usePublishFlow({
            steps: () => [
              {
                key: "first",
                label: "Publish",
                run: async () => {
                  throw new DOMException("unconfirmed", name)
                },
              },
            ],
          }),
        { wrapper }
      )
      await act(async () => {
        await result.current.publish()
      })
      expect(result.current.error).toContain("may have applied")
      expect(result.current.error).not.toContain("Nothing was changed")
      expect(result.current.results[0].message).toBe(result.current.error)
    }
  )
})

describe("usePublishFlow outcomes and intents", () => {
  it("takes each finished step's outcome from the route's answer", async () => {
    const steps: PublishStep[] = [
      {
        key: "post",
        label: "Post",
        verified: true,
        run: async () => ({
          status: "published",
          operation: { operationId: "op-1", outcome: "awaiting_confirmation" },
        }),
      },
    ]
    const { result } = renderHook(
      () => usePublishFlow({ steps: () => steps }),
      { wrapper }
    )
    await act(async () => {
      await result.current.publish()
    })
    // Verified endpoint or not, the server's own word wins: Google has not
    // shown the change yet, so nothing may call it live.
    expect(stepOutcome(result.current.results[0]!)).toBe(
      "awaiting_confirmation"
    )
    expect(publishOutcome(result.current.results)).toBe("awaiting_confirmation")
  })

  it("reports an ambiguous failure as not confirmed and resends its intent on retry", async () => {
    const seen: (string | undefined)[] = []
    const body = { expectedCanonicalRevision: "4" }
    let fail = true
    const steps: PublishStep[] = [
      {
        key: "hours",
        label: "Hours",
        run: async (intent) => {
          seen.push(intent.idFor(body))
          if (fail)
            throw new ApiClientError(
              502,
              "google_mutation_ambiguous",
              "unclear",
              undefined,
              { intentId: seen.at(-1) }
            )
          return {
            operation: { operationId: "op", outcome: "confirmed_applied" },
          }
        },
      },
    ]
    const { result } = renderHook(
      () => usePublishFlow({ steps: () => steps }),
      { wrapper }
    )
    await act(async () => {
      await result.current.publish()
    })
    const failed = result.current.results[0]!
    expect(stepOutcome(failed)).toBe("uncertain")
    expect(failed.intentId).toBe(seen[0])

    fail = false
    await act(async () => {
      await result.current.publish()
    })
    expect(seen[1]).toBe(seen[0])
    expect(stepOutcome(result.current.results[0]!)).toBe("confirmed_applied")

    // A later publish of the same body is a new action.
    await act(async () => {
      await result.current.publish()
    })
    expect(seen[2]).not.toBe(seen[1])
  })

  it("sends a changed body under a new intent even after an ambiguous failure", async () => {
    const seen: (string | undefined)[] = []
    let body = { expectedCanonicalRevision: "4" }
    const steps: PublishStep[] = [
      {
        key: "hours",
        label: "Hours",
        run: async (intent) => {
          seen.push(intent.idFor(body))
          throw new ApiClientError(502, "google_mutation_ambiguous", "unclear")
        },
      },
    ]
    const { result } = renderHook(
      () => usePublishFlow({ steps: () => steps }),
      { wrapper }
    )
    await act(async () => {
      await result.current.publish()
    })
    body = { expectedCanonicalRevision: "5" }
    await act(async () => {
      await result.current.publish()
    })
    expect(seen[1]).not.toBe(seen[0])
  })
})
