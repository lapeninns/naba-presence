import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  useResourceMutation,
  type ResourceMutationOptions,
} from "@/lib/queries/use-resource-mutation"

const KEY: QueryKey = ["locations", "loc-1", "hours"]

function Harness(options: ResourceMutationOptions<{ ok: true }, string>) {
  const mutation = useResourceMutation(options)
  return (
    <div>
      <button
        onClick={() => mutation.mutate("payload")}
        disabled={mutation.isPending}
      >
        Save
      </button>
      <p>status: {mutation.status}</p>
    </div>
  )
}

function renderHarness(options: ResourceMutationOptions<{ ok: true }, string>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Seed a cached query so invalidation is observable.
  client.setQueryData(KEY, { seeded: true })
  render(
    <QueryClientProvider client={client}>
      <Toaster>
        <Harness {...options} />
      </Toaster>
    </QueryClientProvider>
  )
  return client
}

afterEach(() => vi.restoreAllMocks())

describe("useResourceMutation", () => {
  it("invalidates the given keys, toasts the success copy and runs onSuccess with the result", async () => {
    const onSuccess = vi.fn()
    const mutationFn = vi.fn(async (variables: string) => ({
      ok: true as const,
      variables,
    }))
    const client = renderHarness({
      mutationFn,
      invalidate: [KEY],
      successToast: "Opening hours saved",
      onSuccess,
    })

    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Opening hours saved")).toBeInTheDocument()
    expect(mutationFn).toHaveBeenCalledWith("payload", expect.anything())
    expect(onSuccess).toHaveBeenCalledWith(
      { ok: true, variables: "payload" },
      "payload"
    )
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(true)
    expect(screen.getByText("status: success")).toBeInTheDocument()
  })

  it("toasts an outcome message in its outcome's words and kind, so a sent write is not a success", async () => {
    renderHarness({
      mutationFn: async () => ({ ok: true as const }),
      successToast: { outcome: "sent", title: "Opening hours sent to Google" },
    })

    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    const title = await screen.findByText("Opening hours sent to Google")
    const toast = title.closest("[data-slot=toast]") as HTMLElement
    // The info glyph, not the success check.
    expect(toast.querySelector(".text-info-solid")).not.toBeNull()
    expect(toast.querySelector(".text-success-solid")).toBeNull()
  })

  it("fills an outcome message's default words when it names none", async () => {
    renderHarness({
      mutationFn: async () => ({ ok: true as const }),
      successToast: { outcome: "saved_locally" },
    })

    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Saved here")).toBeInTheDocument()
    expect(
      screen.getByText(/isn’t on Google until you publish it/)
    ).toBeInTheDocument()
  })

  it("accepts a custom invalidate function and a success toast derived from the result", async () => {
    const invalidate = vi.fn()
    const client = renderHarness({
      mutationFn: async () => ({ ok: true as const }),
      invalidate,
      successToast: (_data, variables) => `Saved ${variables}`,
    })

    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Saved payload")).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false)
  })

  it("skips the success toast when none is configured or the function returns null", async () => {
    renderHarness({
      mutationFn: async () => ({ ok: true as const }),
      successToast: () => null,
    })
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("status: success")
    expect(
      document.querySelector('[data-slot="toast"]')
    ).not.toBeInTheDocument()
  })

  it("toasts the humanised action error and hands the same copy to onError", async () => {
    const onError = vi.fn()
    const error = new ApiClientError(
      403,
      "permission_denied",
      "raw server text"
    )
    renderHarness({
      mutationFn: async () => Promise.reject(error),
      invalidate: [KEY],
      onError,
    })

    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(
      await screen.findByText("You do not have permission to do that.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith(
      error,
      "You do not have permission to do that.",
      "payload"
    )
    expect(screen.getByText("status: error")).toBeInTheDocument()
  })

  it("does not invalidate on error", async () => {
    const client = renderHarness({
      mutationFn: async () => Promise.reject(new Error("nope")),
      invalidate: [KEY],
    })
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("status: error")
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false)
  })

  it("lets a call site inject its own error copy", async () => {
    const errorToast = vi.fn(
      (error: unknown) => `Custom: ${(error as Error).message}`
    )
    const onError = vi.fn()
    renderHarness({
      mutationFn: async () => Promise.reject(new Error("nope")),
      errorToast,
      onError,
    })

    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Custom: nope")).toBeInTheDocument()
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        "Custom: nope",
        "payload"
      )
    )
  })

  describe("intent ids across retries", () => {
    function IntentHarness(
      options: ResourceMutationOptions<{ ok: true }, string>
    ) {
      const mutation = useResourceMutation(options)
      return (
        <div>
          <button onClick={() => mutation.mutate("draft one")}>Send one</button>
          <button onClick={() => mutation.mutate("draft two")}>Send two</button>
          <p>status: {mutation.status}</p>
        </div>
      )
    }

    function renderIntent(
      options: ResourceMutationOptions<{ ok: true }, string>
    ) {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Toaster>
            <IntentHarness {...options} />
          </Toaster>
        </QueryClientProvider>
      )
    }

    const ambiguous = () =>
      new ApiClientError(502, "google_mutation_ambiguous", "unclear")

    it("resends the same intent when retrying a write that may have applied", async () => {
      const seen: (string | undefined)[] = []
      const mutationFn = vi.fn(async (_v: string, intent) => {
        seen.push(intent.intentId)
        if (seen.length === 1) throw ambiguous()
        return { ok: true as const }
      })
      renderIntent({ mutationFn })
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await screen.findByText("status: error")
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await screen.findByText("status: success")
      expect(seen).toHaveLength(2)
      expect(seen[0]).toEqual(expect.any(String))
      expect(seen[1]).toBe(seen[0])
    })

    it("mints a new intent once the input changed (an edit)", async () => {
      const seen: (string | undefined)[] = []
      renderIntent({
        mutationFn: async (_v: string, intent) => {
          seen.push(intent.intentId)
          throw ambiguous()
        },
      })
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await screen.findByText("status: error")
      await userEvent.click(screen.getByRole("button", { name: "Send two" }))
      await waitFor(() => expect(seen).toHaveLength(2))
      expect(seen[1]).not.toBe(seen[0])
    })

    it("mints a new intent after a definite failure and after a success", async () => {
      const seen: (string | undefined)[] = []
      renderIntent({
        mutationFn: async (_v: string, intent) => {
          seen.push(intent.intentId)
          if (seen.length === 1)
            throw new ApiClientError(409, "hours_stale", "stale")
          return { ok: true as const }
        },
      })
      const send = screen.getByRole("button", { name: "Send one" })
      await userEvent.click(send)
      await screen.findByText("status: error")
      await userEvent.click(send)
      await screen.findByText("status: success")
      await userEvent.click(send)
      await waitFor(() => expect(seen).toHaveLength(3))
      expect(new Set(seen).size).toBe(3)
    })

    it("keeps an uncertain call's intent through a success on another item", async () => {
      const seen: { variables: string; intentId: string | undefined }[] = []
      renderIntent({
        mutationFn: async (variables: string, intent) => {
          seen.push({ variables, intentId: intent.intentId })
          if (variables === "draft one" && seen.length === 1) throw ambiguous()
          return { ok: true as const }
        },
      })
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await screen.findByText("status: error")
      await userEvent.click(screen.getByRole("button", { name: "Send two" }))
      await screen.findByText("status: success")
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await waitFor(() => expect(seen).toHaveLength(3))
      expect(seen[2]).toEqual({
        variables: "draft one",
        intentId: seen[0].intentId,
      })
    })

    it("remembers the call that failed, not the last one started", async () => {
      const seen: { variables: string; intentId: string | undefined }[] = []
      let failFirst: (error: Error) => void = () => {}
      renderIntent({
        mutationFn: (variables: string, intent) => {
          seen.push({ variables, intentId: intent.intentId })
          if (variables === "draft one" && seen.length === 1) {
            return new Promise((_resolve, reject) => {
              failFirst = reject
            })
          }
          return Promise.resolve({ ok: true as const })
        },
      })
      // One starts, two starts and succeeds, then one fails uncertainly.
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await userEvent.click(screen.getByRole("button", { name: "Send two" }))
      await waitFor(() => expect(seen).toHaveLength(2))
      await act(async () => {
        failFirst(ambiguous())
      })
      await userEvent.click(screen.getByRole("button", { name: "Send one" }))
      await waitFor(() => expect(seen).toHaveLength(3))
      expect(seen[2].intentId).toBe(seen[0].intentId)
      expect(seen[2].intentId).not.toBe(seen[1].intentId)
    })

    it("keys the retry on intentKey when the call reads its input from render state", async () => {
      const seen: (string | undefined)[] = []
      let revision = 1
      renderIntent({
        mutationFn: async (_v: string, intent) => {
          seen.push(intent.intentId)
          throw ambiguous()
        },
        intentKey: () => revision,
      })
      const send = screen.getByRole("button", { name: "Send one" })
      await userEvent.click(send)
      await screen.findByText("status: error")
      await userEvent.click(send)
      await waitFor(() => expect(seen).toHaveLength(2))
      revision = 2
      await userEvent.click(send)
      await waitFor(() => expect(seen).toHaveLength(3))
      expect(seen[1]).toBe(seen[0])
      expect(seen[2]).not.toBe(seen[1])
    })
  })
})
