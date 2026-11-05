import { render, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { scope, query } = vi.hoisted(() => ({
  scope: { clientId: null as string | null, mode: "agency" as string },
  query: {
    isPending: false,
    isError: false,
    items: [] as Array<{ id: string; name: string; health: string }>,
  },
}))

const JOURNEY = {
  id: "c1",
  name: "Journey Hospitality",
  health: "partially_checked",
}
const ATTENTION = [
  JOURNEY,
  { id: "c2", name: "Harbour Inns", health: "attention" },
  { id: "c3", name: "Lapen Inns", health: "attention" },
]

vi.mock("@/components/app-shell/client-context", () => ({
  useClientScope: () => scope.clientId,
}))
vi.mock("@/lib/workspace/mode", () => ({
  useWorkspaceMode: () => scope.mode,
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({
    isPending: query.isPending,
    isError: query.isError,
    data: { items: query.items },
  }),
}))

import {
  ShellHealthAnnouncer,
  useContextHealth,
} from "@/components/app-shell/context-health-chip"

// The toolbar's ContextHealthChip was retired (DIRECTION D8): the scope
// control carries the scope's health in words now. What remains is the
// hook (the More sheet's Connections row) and the shell's live announcer.
describe("useContextHealth", () => {
  beforeEach(() => {
    scope.clientId = null
    scope.mode = "agency"
    query.isPending = false
    query.isError = false
    query.items = ATTENTION
  })

  it("reports the organisation's words and links to Clients", () => {
    const { result } = renderHook(() => useContextHealth())
    expect(result.current).toMatchObject({
      tone: "attention",
      label: "2 clients need attention",
      href: "/clients",
      scopedName: null,
    })
  })

  it("reports a client's own health and links to it", () => {
    scope.clientId = "c1"
    const { result } = renderHook(() => useContextHealth())
    expect(result.current).toMatchObject({
      label: "Some listings not checked yet",
      href: "/clients/c1",
      scopedName: "Journey Hospitality",
    })
  })

  it("says the data may be stale after a failed refetch", () => {
    scope.clientId = "c1"
    query.isError = true
    const { result } = renderHook(() => useContextHealth())
    expect(result.current).toMatchObject({
      tone: "attention",
      label: "Data may be stale",
      scopedName: null,
    })
  })

  it("reports the whole business and links to Listings in business mode", () => {
    scope.mode = "business"
    scope.clientId = "c1"
    query.items = [{ ...JOURNEY, health: "healthy" }]
    const { result } = renderHook(() => useContextHealth())
    expect(result.current).toMatchObject({
      label: "All in sync",
      href: "/listings",
      scopedName: null,
    })
  })
})

describe("ShellHealthAnnouncer", () => {
  beforeEach(() => {
    scope.clientId = null
    scope.mode = "agency"
    query.isPending = false
    query.isError = false
    query.items = ATTENTION
  })

  it("stays silent on the first value and announces a change", () => {
    const { container, rerender } = render(<ShellHealthAnnouncer />)
    const region = container.querySelector("[aria-live='polite']")
    expect(region).toHaveTextContent("")
    query.items = ATTENTION.map((client) => ({
      ...client,
      health: "attention",
    }))
    rerender(<ShellHealthAnnouncer />)
    expect(region).toHaveTextContent(
      "Connection status: 3 clients need attention"
    )
  })

  it("says nothing while the list is pending", () => {
    query.isPending = true
    const { container, rerender } = render(<ShellHealthAnnouncer />)
    query.items = [{ ...JOURNEY, health: "attention" }]
    rerender(<ShellHealthAnnouncer />)
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent(
      ""
    )
  })
})

// MISSION S3: the More sheet's row, the announcer and the scope control
// (sidebar, tablet pill, phone chip) read one function, so the same data
// is worded the same at every size.
describe("one health wording for every size", () => {
  beforeEach(() => {
    scope.clientId = null
    scope.mode = "agency"
    query.isPending = false
    query.isError = false
  })

  it("matches scopeHealthWords for the roll-up and a scoped client", async () => {
    const { scopeHealthWords } = await import("@/lib/clients/scope-words")
    query.items = ATTENTION
    const roll = renderHook(() => useContextHealth()).result.current
    expect(roll.label).toBe(
      scopeHealthWords({
        mode: "agency",
        client: null,
        healths: ATTENTION.map((client) => client.health) as never,
      }).words
    )
    scope.clientId = "c2"
    const scoped = renderHook(() => useContextHealth()).result.current
    expect(scoped.label).toBe("Needs attention")
  })
})
