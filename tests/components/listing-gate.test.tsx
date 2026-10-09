import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { act, type ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ notFound: vi.fn() }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { notFound } from "next/navigation"
import { ListingGate } from "@/components/listings/listing-gate"
import { queryKeys } from "@/lib/queries/keys"

const listing = {
  id: "l1",
  name: "Old Crown",
  linked: true,
  clientId: null,
  clientName: null,
}
const clients: QueryClient[] = []
function mount(cached?: (typeof listing)[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  if (cached) client.setQueryData(queryKeys.locations, cached)
  render(
    <QueryClientProvider client={client}>
      <ListingGate locationId="l1" role="viewer">
        {(entry) => (
          <main id="main" tabIndex={-1}>
            <h1>{entry.name}</h1>
            <input aria-label="Draft" />
          </main>
        )}
      </ListingGate>
    </QueryClientProvider>
  )
  return client
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("ListingGate recovery", () => {
  it("focuses an actionable error and recovers when retry succeeds", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(response({ locations: [listing] }))
    vi.stubGlobal("fetch", fetcher)
    mount()
    const retry = await screen.findByRole("button", { name: "Try again" })
    expect(screen.getByRole("alert")).toHaveTextContent(/connection/i)
    expect(
      screen.getByRole("heading", { name: /couldn’t load/i })
    ).toHaveFocus()
    fireEvent.click(retry)
    expect(
      await screen.findByRole("heading", { name: "Old Crown" })
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus())
    expect(notFound).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404])(
    "does not turn a directory HTTP %s failure into a listing 404",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(response({ error: "http_error" }, status))
      )
      mount()
      const alert = await screen.findByRole("alert")
      expect(notFound).not.toHaveBeenCalled()
      if (status === 401)
        expect(
          screen.getByRole("link", { name: "Sign in again" })
        ).toHaveAttribute("href", expect.stringContaining("/sign-in?next="))
      if (status === 403) expect(alert).toHaveTextContent(/permission|access/i)
      if (status === 404)
        expect(
          screen.getByRole("button", { name: "Try again" })
        ).toBeInTheDocument()
    }
  )

  it("uses notFound only after a successful directory response excludes the listing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response({ locations: [] }))
    )
    mount()
    await waitFor(() => expect(notFound).toHaveBeenCalled())
  })

  it("retains cached content and edits when a background refresh fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ locations: [listing] }))
    vi.stubGlobal("fetch", fetcher)
    const client = mount([listing])
    fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
      target: { value: "Unsaved content" },
    })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    fetcher.mockRejectedValue(new TypeError("offline"))
    await act(() => client.invalidateQueries({ queryKey: queryKeys.locations }))
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "Unsaved content"
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(/connection/i)
    expect(notFound).not.toHaveBeenCalled()
  })

  it("waits for a refreshed directory before treating cached absence as not found", async () => {
    let resolve: ((value: Response) => void) | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          })
      )
    )
    mount([])
    expect(notFound).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    await act(async () => {
      resolve?.(response({ locations: [listing] }))
    })
    expect(
      await screen.findByRole("heading", { name: "Old Crown" })
    ).toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("does not trust a cached missing entry after a failed refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"))
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    client.setQueryData(queryKeys.locations, [])
    await client
      .fetchQuery({
        queryKey: queryKeys.locations,
        queryFn: () => Promise.reject(new TypeError("offline")),
      })
      .catch(() => undefined)
    render(
      <QueryClientProvider client={client}>
        <ListingGate locationId="l1" role="viewer">
          {() => <p>Listing</p>}
        </ListingGate>
      </QueryClientProvider>
    )
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
  })
})
