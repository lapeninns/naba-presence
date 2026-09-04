import {
  onlineManager,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { QueryPending, QueryStates } from "@/components/ui/query-states"
import {
  describeActionError,
  GENERIC_ERROR_COPY,
  TIMEOUT_ERROR_COPY,
} from "@/lib/errors/action-errors"
import { makeQueryClient } from "@/lib/queries/query-client"

describe("the shared query client", () => {
  it("does not pause queries when the browser thinks it is offline", () => {
    // networkMode "online" (the library default) PAUSES a query when
    // navigator.onLine is false: status stays "pending", no request is made
    // and no error is ever thrown. Every pending state in this app is a
    // skeleton, so that produced a grey screen that never resolved and never
    // explained itself. No request timeout can fix it — there is no request.
    const defaults = makeQueryClient().getDefaultOptions()
    expect(defaults.queries?.networkMode).toBe("offlineFirst")
  })

  it("does not pause mutations either", () => {
    // A paused mutation leaves "Publish to Google" on "Publishing…" forever.
    const defaults = makeQueryClient().getDefaultOptions()
    expect(defaults.mutations?.networkMode).toBe("offlineFirst")
  })
})

describe("describeActionError", () => {
  it("tells a timed-out request apart from a generic failure", () => {
    // AbortSignal.timeout() rejects with a DOMException named TimeoutError,
    // not a TypeError, so this used to fall through to "Something went wrong".
    const timeout = new Error("timed out")
    timeout.name = "TimeoutError"
    expect(describeActionError(timeout)).toBe(TIMEOUT_ERROR_COPY)
    expect(describeActionError(timeout)).not.toBe(GENERIC_ERROR_COPY)

    const aborted = new Error("aborted")
    aborted.name = "AbortError"
    expect(describeActionError(aborted)).toBe(TIMEOUT_ERROR_COPY)
  })

  it("still says something went wrong for an error it cannot name", () => {
    expect(describeActionError(new Error("???"))).toBe(GENERIC_ERROR_COPY)
  })
})

describe("QueryPending", () => {
  it("says what it is waiting for, in a region a screen reader announces", () => {
    // Every Skeleton is aria-hidden and aria-busy on a plain div announces
    // nothing, so without a label this component is silent as well as blank.
    render(<QueryPending label="Reading the opening hours from Google…" />)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Reading the opening hours from Google…")
  })

  it("stays a plain placeholder when no caller named the wait", () => {
    render(<QueryPending />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("carries a label through QueryStates", () => {
    render(
      <QueryStates
        status="pending"
        pendingLabel="Reading the photos from Google…"
        error="never"
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading the photos from Google…"
    )
  })
})

function Probe() {
  const query = useQuery({
    queryKey: ["probe"],
    queryFn: async () => "loaded",
    retry: false,
  })
  return <p>{query.isPending ? "pending" : query.isError ? "error" : String(query.data)}</p>
}

afterEach(() => onlineManager.setOnline(true))

describe("a query issued while the browser reports itself offline", () => {
  it("still runs, instead of pausing on a skeleton forever", async () => {
    // The exact condition behind "it feels like it's not working". On the
    // library's default networkMode ("online") react-query PAUSES the query:
    // status stays "pending", the queryFn is never called and no error is
    // thrown, so every skeleton in this app renders forever. Driving
    // onlineManager is how react-query itself decides — spying on
    // navigator.onLine does not reach it, because the manager caches its own
    // state from window online/offline events.
    onlineManager.setOnline(false)
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText("loaded")).toBeInTheDocument())
  })
})
