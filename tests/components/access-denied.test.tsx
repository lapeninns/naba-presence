import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { toastAdd, pathState } = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  pathState: { current: "/settings/connections" },
}))

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => pathState.current,
}))
// The shell's own back target is computed from the path and the lists it
// already holds; the lists are empty here so no request is made.
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({ data: undefined }),
}))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({ data: undefined }),
}))
vi.mock("@/components/ui/toast", () => ({ toast: { add: toastAdd } }))

import {
  AccessDenied,
  AccessDeniedPage,
} from "@/components/app-shell/access-denied"
import { queryKeys } from "@/lib/queries/keys"

function setNavigator(value: Partial<Navigator>) {
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(navigator, key, {
      value: entry,
      configurable: true,
    })
  }
}

function setLocation(href: string) {
  const url = new URL(href)
  pathState.current = url.pathname
  Object.defineProperty(window, "location", { value: url, configurable: true })
}

function renderWithSession(
  area = "Google connections",
  extra: Partial<ComponentProps<typeof AccessDenied>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, {
    session: {
      role: "viewer",
      workspaceMode: "agency",
      displayName: "Sam Viewer",
      email: "sam@example.com",
      organisationName: "Acme Agency",
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <AccessDenied area={area} {...extra} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setLocation("https://app.example.com/settings/connections")
})

afterEach(() => {
  vi.clearAllMocks()
  // Remove what a test defined so the next starts without a share sheet.
  // @ts-expect-error -- deleting an optional browser API
  delete navigator.share
  // @ts-expect-error -- deleting an optional browser API
  delete navigator.canShare
  // @ts-expect-error -- deleting an optional browser API
  delete navigator.clipboard
})

describe("AccessDenied", () => {
  it("says what is closed and who can open it, without a status code", () => {
    // Every gated route used to redirect silently, which is indistinguishable
    // from a bug to the person who followed the link.
    render(<AccessDenied area="Google connections" />)
    expect(
      screen.getByRole("heading", {
        name: /You don.t have access to this page/,
        level: 1,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Google connections is limited to an owner or admin/)
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/403/)
    expect(document.body.textContent).not.toMatch(/No access/)
  })

  it("renders no landmark of its own", () => {
    // Settings already owns the page's single <main>; a second one breaks the
    // pinned landmark-no-duplicate-main rule.
    const { container } = render(<AccessDenied area="Operations" />)
    expect(container.querySelector("main")).toBeNull()
  })

  it("brings its own frame when the route has none, still without a main", () => {
    // The page frame is a div: AppShell owns the one <main id="main">.
    const { container } = render(<AccessDeniedPage area="Team" />)
    expect(container.querySelectorAll('[data-slot="page-frame"]')).toHaveLength(
      1
    )
    expect(container.querySelector("main")).toBeNull()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("leads with Ask for access, before any other control", () => {
    render(<AccessDenied area="Google connections" />)
    const buttons = screen.getAllByRole("button")
    expect(buttons[0]).toHaveAccessibleName("Ask for access")
  })

  it("hands the request and this page's address to the share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share, clipboard: { writeText } as unknown as Clipboard })
    renderWithSession()

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(share).toHaveBeenCalledTimes(1)
    const data = share.mock.calls[0][0]
    expect(data.url).toBe("https://app.example.com/settings/connections")
    expect(data.text).toContain("access to Google connections")
    expect(data.text).toContain("Sam Viewer")
    expect(writeText).not.toHaveBeenCalled()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("copies the request and the link together when there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ clipboard: { writeText } as unknown as Clipboard })
    renderWithSession()

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain("access to Google connections")
    expect(copied).toContain("Sam Viewer")
    expect(copied).toContain("https://app.example.com/settings/connections")
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Request copied", type: "success" })
    )
  })

  it("offers one copy path, not a second near-duplicate button", () => {
    renderWithSession()
    expect(
      screen.queryByRole("button", { name: /Copy an access request/ })
    ).toBeNull()
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("puts the request and link in the toast when neither share nor copy works", async () => {
    // No share sheet and no clipboard: the person gets the text to copy by hand.
    setNavigator({
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      } as unknown as Clipboard,
    })
    renderWithSession()

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        description: expect.stringContaining(
          "https://app.example.com/settings/connections"
        ),
      })
    )
    const { description, title } = toastAdd.mock.calls[0][0]
    expect(description).toContain("access to Google connections")
    expect(title).not.toMatch(/address bar/)
  })

  it("never shares the query string or hash of the address bar", async () => {
    // Google's OAuth return params can sit in the address bar of a page.
    setLocation(
      "https://app.example.com/settings/connections?google=connected&status=ok&rid=req-1&reason=denied#token"
    )
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share })
    renderWithSession()

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(share.mock.calls[0][0].url).toBe(
      "https://app.example.com/settings/connections"
    )
  })

  it("on /setup shares only the params that reach the same review", async () => {
    setLocation(
      "https://app.example.com/setup?client=c1&step=team&google=connected&status=ok&rid=req-1&reason=denied"
    )
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share })
    renderWithSession("Client setup")

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(share.mock.calls[0][0].url).toBe(
      "https://app.example.com/setup?client=c1&step=team"
    )
  })

  it("is quiet when the person closes the share sheet", async () => {
    const abort = new DOMException("closed", "AbortError")
    const writeText = vi.fn()
    setNavigator({
      share: vi.fn().mockRejectedValue(abort),
      clipboard: { writeText } as unknown as Clipboard,
    })
    render(<AccessDenied area="Google connections" />)

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(writeText).not.toHaveBeenCalled()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it.each([
    ["/settings/connections", "Back to Settings", "/settings"],
    ["/clients/new", "Back to Clients", "/clients"],
    // A top-level page has no parent, so the way back is the Inbox.
    ["/team", "Back to Inbox", "/inbox"],
  ])("on %s goes back as the shell's back control does", (path, name, href) => {
    setLocation(`https://app.example.com${path}`)
    renderWithSession()
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href)
    expect(screen.getAllByRole("link", { name: /^Back to / })).toHaveLength(1)
  })

  it("keeps the address behind Details for support, closed", () => {
    const { container } = render(<AccessDenied area="Google connections" />)
    const details = container.querySelector(
      'details[data-slot="support-details"]'
    )
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute("open")
    expect(details).toHaveTextContent("Details for support")
    expect(details).toHaveTextContent("/settings/connections")
    // The path is not in the sentence or the heading.
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toContain(
      "/settings/connections"
    )
  })

  it("names who can grant access, defaulting to owners and admins", () => {
    const { unmount } = renderWithSession()
    expect(
      screen.getByText(
        "Owners and admins in Acme Agency. They change roles on the Team page."
      )
    ).toBeInTheDocument()
    unmount()
    // Billing is owner-only: only an owner can make someone an owner.
    renderWithSession("Billing", {
      whoCanHelp: "the owner",
      whoCanGrant: "Owners",
    })
    expect(
      screen.getByText(
        "Owners in Acme Agency. They change roles on the Team page."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Owners and admins in/)).toBeNull()
  })
})
