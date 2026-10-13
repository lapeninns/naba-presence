import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  useQuery,
} from "@tanstack/react-query"
import { act, render } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useMediaQuery } from "@/lib/hooks/use-media-query"
import { queryKeys } from "@/lib/queries/keys"
import { QueryProvider } from "@/lib/queries/provider"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const session = {
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  workspaceMode: "agency" as const,
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

/** A query of its own, first built (and added to the cache) as it renders. */
function DesktopOnly() {
  useQuery({ queryKey: ["desktop-only"], queryFn: () => new Promise(() => {}) })
  return <p>desktop</p>
}

/**
 * Desktop-only furniture, as the shell draws it: the server (and the
 * hydrating client) assume a phone, and the desktop children mount in the
 * re-render that corrects it.
 */
function Wide() {
  return useMediaQuery("(min-width: 768px)", false) ? <DesktopOnly /> : null
}

/** The dashboard layout's tree: the session hydrated under the provider. */
function Dashboard() {
  const server = new QueryClient()
  server.setQueryData(queryKeys.session, { session })
  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrate(server)}>
        <Wide />
      </HydrationBoundary>
    </QueryProvider>
  )
}

describe("QueryProvider scope reset", () => {
  // The provider watches the whole query cache for the session's scope. Its
  // first read comes before the HydrationBoundary below it fills the
  // session in, and a query built while a later component renders notifies
  // the cache synchronously, so an unbatched listener updated the provider
  // in the middle of that render: React's "Cannot update a component while
  // rendering a different component", on every dashboard page from 768px.
  it("does not update the provider while a desktop-only child renders", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const container = document.createElement("div")
    container.innerHTML = renderToString(<Dashboard />)
    document.body.append(container)
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      })
    )

    const view = render(<Dashboard />, { container, hydrate: true })
    await act(async () => {})

    expect(view.getByText("desktop")).toBeInTheDocument()
    expect(
      error.mock.calls.filter((args) =>
        String(args[0]).includes("while rendering a different component")
      )
    ).toEqual([])
  })
})
