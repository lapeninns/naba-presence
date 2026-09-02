import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
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
})
