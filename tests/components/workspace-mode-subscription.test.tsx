import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import type { SessionResponse } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"
import { useSessionRole } from "@/lib/queries/use-session"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * `useWorkspaceMode` reads the session from the cache. It used to re-check
 * on every cache event, so a reader keyed by the role (the location
 * directory) that built its query while rendering, once a new session named
 * the role, re-rendered the mode's readers from inside its own render:
 * "Cannot update a component while rendering a different component".
 */

afterEach(() => {
  vi.restoreAllMocks()
})

const sessionOf = (
  workspaceMode: "agency" | "business",
  role: "owner" | "admin" = "owner"
): SessionResponse => ({
  session: {
    userId: "u",
    organisationId: "o",
    organisationName: "Lapen Inns",
    workspaceMode,
    displayName: "Aman Shrestha",
    email: "a@example.test",
    role,
    canPublish: true,
  },
})

/** Builds a query keyed by the role while it renders, as the shell does. */
function RoleKeyedReader() {
  const role = useSessionRole()
  useQuery({
    queryKey: ["directory", role],
    queryFn: () => new Promise<never>(() => {}),
  })
  return null
}

function ModeReader() {
  return <p>{useWorkspaceMode()}</p>
}

/**
 * The shell's shape: a parent that reads the mode re-renders the role-keyed
 * reader in the same pass as, and before, a sibling with its own mode read.
 */
function Shell() {
  return (
    <div data-mode={useWorkspaceMode()}>
      <RoleKeyedReader />
      <ModeReader />
    </div>
  )
}

function renderReaders(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  )
}

it("follows a new session without updating another component mid-render", async () => {
  const error = vi.spyOn(console, "error")
  const client = new QueryClient()
  client.setQueryData(queryKeys.session, sessionOf("agency"))
  client.setQueryData(["directory", "owner"], [])
  renderReaders(client)
  expect(screen.getByText("agency")).toBeInTheDocument()

  // A new session names a role the reader has no query for yet.
  await act(async () => {
    client.setQueryData(queryKeys.session, sessionOf("business", "admin"))
  })

  expect(screen.getByText("business")).toBeInTheDocument()
  const warnings = error.mock.calls
    .map(([message]) => String(message))
    .filter((message) => message.includes("Cannot update a component"))
  expect(warnings).toEqual([])
})

it("falls back to agency when the session leaves the cache", async () => {
  const client = new QueryClient()
  client.setQueryData(queryKeys.session, sessionOf("business"))
  renderReaders(client)
  expect(screen.getByText("business")).toBeInTheDocument()

  await act(async () => {
    client.removeQueries({ queryKey: queryKeys.session })
  })

  expect(screen.getByText("agency")).toBeInTheDocument()
})
