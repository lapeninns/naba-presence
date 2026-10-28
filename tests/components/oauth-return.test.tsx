import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OAuthReturn } from "@/components/settings/oauth-return"
import { Toaster } from "@/components/ui/toast"

const replace = vi.fn()
let search = new URLSearchParams()
let pathname = "/settings/connections"
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
  usePathname: () => pathname,
}))
const connectMutate = vi.fn()
const useConnectionWorkspace = vi.fn()
// OAuthReturn mounts on every dashboard page: it takes only the connect
// mutation, never the polled connections query (settings-setup-auth-21).
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useStartGoogleConnect: () => ({ mutate: connectMutate, isPending: false }),
  useConnectionWorkspace: () => useConnectionWorkspace(),
}))
const modeMock = vi.fn(() => "agency")
vi.mock("@/lib/workspace/mode", () => ({ useWorkspaceMode: () => modeMock() }))

afterEach(() => {
  vi.clearAllMocks()
  modeMock.mockReturnValue("agency")
  search = new URLSearchParams()
  pathname = "/settings/connections"
})

describe("OAuthReturn", () => {
  it("shows a mapped error and a Try again action for ?google=error&status=502", () => {
    search = new URLSearchParams("google=error&status=502")
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    // Setup's words for the same failure (lib/setup/oauth-status.ts).
    expect(screen.getByText(/didn’t answer/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
    expect(screen.queryByText(/status=502/)).not.toBeInTheDocument()
  })

  it("clears the query and renders nothing for ?google=connected", () => {
    search = new URLSearchParams("google=connected")
    const { container } = render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(replace).toHaveBeenCalledWith("/settings/connections")
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it("shows the request id behind Details for support, says the outcome once, and still strips rid", () => {
    search = new URLSearchParams("google=error&status=400&rid=req_1")
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(
      screen.getByText(/choose Allow when Google asks/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Nothing was changed/)).toBeNull()
    const details = screen.getByText("Details for support").closest("details")!
    expect(within(details).getByText("req_1")).toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith("/settings/connections")
  })

  it("names the business, not the agency, in business mode", () => {
    modeMock.mockReturnValue("business")
    search = new URLSearchParams("google=error&status=403")
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(screen.getByText(/for this business\./)).toBeInTheDocument()
    expect(screen.queryByText(/agency|organisation/)).toBeNull()
  })

  it("doesn’t repeat itself when offline access was missing", () => {
    search = new URLSearchParams(
      "google=error&status=502&reason=google_offline_access_missing"
    )
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(screen.getByText(/didn’t grant lasting access/)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing was changed/)).toBeNull()
  })

  it("offers setting up a client after a plain new connection", () => {
    search = new URLSearchParams("google=connected")
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(
      screen.getByRole("link", { name: "Set up a client with it" })
    ).toHaveAttribute("href", "/clients/new")
  })

  it("words the business success so it is true whether or not a listing was linked for you", () => {
    modeMock.mockReturnValue("business")
    search = new URLSearchParams("google=connected")
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(
      screen.getByText(/Setup shows which of its listings are linked/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Link its locations from setup/)).toBeNull()
    expect(
      screen.getByRole("link", { name: "Add locations with it" })
    ).toHaveAttribute("href", "/setup")
  })

  it.each(["401", "403", "429"])(
    "still says nothing was changed for a %s, as Settings always has",
    (status) => {
      search = new URLSearchParams(`google=error&status=${status}`)
      render(
        <Toaster>
          <OAuthReturn />
        </Toaster>
      )
      expect(screen.getByText(/Nothing was changed\.$/)).toBeInTheDocument()
    }
  )

  it("offers setting up the different login that came back, which is usable", () => {
    search = new URLSearchParams("google=connected&mismatch=1")
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(
      screen.getByText("Connected a different Google account")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Set up a client with it" })
    ).toHaveAttribute("href", "/clients/new")
    // Its own copy says what happened; the plain-connection sentence isn't added.
    expect(screen.queryByText(/client setup\./)).toBeNull()
  })

  it.each(["reconnected=1", "limit=1", "mismatch=1&limit=1"])(
    "offers no set-up link after a %s result",
    (flag) => {
      search = new URLSearchParams(`google=connected&${flag}`)
      render(
        <Toaster>
          <OAuthReturn />
        </Toaster>
      )
      expect(screen.queryByRole("link", { name: /with it/ })).toBeNull()
    }
  )

  it("explains a consent that left out Business Profile access", () => {
    search = new URLSearchParams(
      "google=error&status=403&reason=google_scope_missing"
    )
    render(
      <Toaster>
        <OAuthReturn />
      </Toaster>
    )
    expect(screen.getByText("Permission not granted")).toBeInTheDocument()
    expect(
      screen.getByText(/leave the Business Profile permission ticked/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/don’t have permission to connect Google/i)
    ).toBeNull()
  })

  it("keeps a setup step's own parameters and retries into setup", () => {
    pathname = "/setup"
    search = new URLSearchParams(
      "client=c1&step=account&google=error&status=502&rid=r1"
    )
    const input = { clientId: "c1", returnTo: "/setup?client=c1&step=account" }
    render(
      <Toaster>
        <OAuthReturn connectInput={input} />
      </Toaster>
    )
    expect(replace).toHaveBeenCalledWith("/setup?client=c1&step=account")
    screen.getByRole("button", { name: "Try again" }).click()
    expect(connectMutate).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ onError: expect.any(Function) })
    )
    expect(useConnectionWorkspace).not.toHaveBeenCalled()
  })
})

describe("connectedMessage", () => {
  it("reports how many listings are catching up, never a review count", async () => {
    const { connectedMessage } =
      await import("@/components/settings/oauth-return")
    const message = connectedMessage({
      reconnected: true,
      mismatch: false,
      catchUp: 9,
    })
    expect(message.title).toBe("Reconnected")
    expect(message.description).toContain("9 listings")
    expect(message.description).not.toMatch(/\d+ (new )?reviews/)
  })

  it("says plainly when a different Google account came back", async () => {
    const { connectedMessage } =
      await import("@/components/settings/oauth-return")
    expect(
      connectedMessage({ reconnected: false, mismatch: true, catchUp: 0 }).title
    ).toBe("Connected a different Google account")
  })

  it("says when the plan's location limit stopped the automatic link", async () => {
    const { connectedMessage } =
      await import("@/components/settings/oauth-return")
    const message = connectedMessage({
      reconnected: false,
      mismatch: false,
      catchUp: 0,
      locationLimit: true,
    })
    expect(message.title).toBe("Connected, but no location was linked")
    expect(message.description).toMatch(/location limit/)
  })
})
