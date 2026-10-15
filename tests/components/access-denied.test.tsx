import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { toastAdd, shellBack } = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  shellBack: vi.fn(),
}))

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/connections",
}))
vi.mock("@/components/ui/toast", () => ({ toast: { add: toastAdd } }))
vi.mock("@/components/app-shell/breadcrumbs-context", () => ({
  useShellBack: shellBack,
}))

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

function renderWithSession(area = "Google connections") {
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
      <AccessDenied area={area} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  shellBack.mockReturnValue(null)
  Object.defineProperty(window, "location", {
    value: new URL("https://app.example.com/settings/connections"),
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  // Remove what a test defined so the next starts without a share sheet.
  // @ts-expect-error -- deleting an optional browser API
  delete navigator.share
  // @ts-expect-error -- deleting an optional browser API
  delete navigator.canShare
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

  it("copies the link and says so when there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ clipboard: { writeText } as unknown as Clipboard })
    render(<AccessDenied area="Google connections" />)

    await userEvent.click(
      screen.getByRole("button", { name: "Ask for access" })
    )

    expect(writeText).toHaveBeenCalledWith(
      "https://app.example.com/settings/connections"
    )
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Link copied", type: "success" })
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

  it("goes back to the shell's back target, not always the Inbox", () => {
    shellBack.mockReturnValue({ href: "/settings", label: "Settings" })
    renderWithSession()
    expect(
      screen.getByRole("link", { name: "Back to Settings" })
    ).toHaveAttribute("href", "/settings")
    expect(screen.queryByRole("link", { name: "Back to Inbox" })).toBeNull()
  })

  it("falls back to the Inbox only when the shell has no parent to offer", () => {
    shellBack.mockReturnValue(null)
    renderWithSession()
    expect(screen.getByRole("link", { name: "Back to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
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
})
