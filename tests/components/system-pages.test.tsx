import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const { shellBack, pathState } = vi.hoisted(() => ({
  shellBack: vi.fn(),
  pathState: { current: "/reports" },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => pathState.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/components/app-shell/breadcrumbs-context", () => ({
  useShellBack: shellBack,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import DashboardError from "@/app/(dashboard)/error"
import DashboardLoading from "@/app/(dashboard)/loading"
import {
  BoundaryErrorState,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"
import DashboardNotFound from "@/app/(dashboard)/not-found"
import { queryKeys } from "@/lib/queries/keys"
import GlobalError from "@/app/global-error"
import NotFound, { metadata as rootNotFoundMetadata } from "@/app/not-found"
import {
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
} from "@/components/app-shell/boundary"

describe("route error boundary", () => {
  it("names the failed area, shows the digest and retries", async () => {
    const retry = vi.fn()
    const reset = vi.fn()
    render(
      <DashboardError
        error={Object.assign(new Error("secret detail"), { digest: "d-123" })}
        reset={reset}
        unstable_retry={retry}
      />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports hit an error" })
    ).toBeInTheDocument()
    expect(screen.getByText("d-123")).toBeInTheDocument()
    // The message itself can carry details the viewer should not see.
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    // Inside the dashboard the shell owns the one <main>; the boundary
    // renders its page frame (a div) and no landmark of its own.
    expect(screen.queryByRole("main")).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="page-frame"]')).not.toBeNull()
  })

  it("prefers the stable retry, which re-fetches the segment's server data", async () => {
    const retry = vi.fn()
    const unstable_retry = vi.fn()
    const reset = vi.fn()
    render(
      <DashboardError
        error={new Error("x")}
        reset={reset}
        retry={retry}
        unstable_retry={unstable_retry}
      />
    )
    const button = screen.getByRole("button", { name: "Try again" })
    button.focus()
    await userEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(unstable_retry).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    expect(button).not.toHaveAttribute("disabled")
    expect(document.activeElement).toBe(button)
  })

  it("falls back to reset when retry is unavailable", async () => {
    const reset = vi.fn()
    render(<DashboardError error={new Error("x")} reset={reset} />)
    expect(screen.queryByText("Reference")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe("boundaryButtonClass", () => {
  it.each(["primary", "outline", "ghost"] as const)(
    "draws the %s hover fill for a fine pointer only (no sticky hover on touch)",
    (variant) => {
      const classes = boundaryButtonClass(variant).split(" ")
      expect(classes.filter((c) => c.startsWith("hover:"))).toEqual([])
      expect(classes.some((c) => c.startsWith("hover-fine:hover:"))).toBe(true)
    }
  )
})

describe("BoundaryErrorState", () => {
  it("announces what happened, retries, and offers one quiet way out", async () => {
    const reset = vi.fn()
    render(
      <BoundaryErrorState
        title="This client page hit an error"
        description="Your clients are unaffected."
        onReset={reset}
        homeHref="/clients"
        homeLabel="All clients"
      />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("This client page hit an error")
    expect(alert).toHaveTextContent("Your clients are unaffected.")
    // One primary action; the way out is the only other control.
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("link", { name: "All clients" })).toHaveAttribute(
      "href",
      "/clients"
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("defaults the way out to the Inbox", () => {
    render(<BoundaryErrorState title="x" description="y" onReset={vi.fn()} />)
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })
})

describe("root pages", () => {
  it("the root 404 has one main, one h1 and a way back in", () => {
    render(<NotFound />)
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })

  it("the root 404 names the product in its banner and offers one way back", () => {
    render(<NotFound />)
    expect(screen.getByRole("banner")).toHaveTextContent("NabaPresence")
    expect(screen.getByRole("main")).not.toHaveTextContent("NabaPresence")
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })

  it("the global error shows the digest in mono, never the message", () => {
    // global-error renders its own <html>; mount it into the document.
    render(
      <GlobalError
        error={Object.assign(new Error("secret detail"), { digest: "g-9" })}
        reset={vi.fn()}
      />,
      { container: document }
    )
    expect(screen.getByText("g-9").tagName).toBe("CODE")
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
  })

  it("the global error never says agency: it cannot know the workspace mode", () => {
    render(<GlobalError error={new Error("x")} reset={vi.fn()} />, {
      container: document,
    })
    expect(document.body.textContent).not.toMatch(/agency|client/i)
    expect(document.body.textContent).toMatch(/in your workspace/)
  })

  it("the global error says nothing was changed, and names the reference only when there is one", () => {
    const { rerender } = render(
      <GlobalError error={new Error("x")} reset={vi.fn()} />,
      { container: document }
    )
    expect(document.body.textContent).toMatch(/Nothing was changed\./)
    expect(document.body.textContent).not.toMatch(/reference/i)
    rerender(
      <GlobalError
        error={Object.assign(new Error("x"), { digest: "g-1" })}
        reset={vi.fn()}
      />
    )
    expect(screen.getByText(/^Error reference/)).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/share the error reference/)
  })

  it("the global error retries with retry first, from a button that is never disabled", () => {
    const reset = vi.fn()
    const unstable_retry = vi.fn()
    const retry = vi.fn()
    // A document of its own: the roots earlier tests mounted on `document`
    // would otherwise be the ones that see the click.
    const own = document.implementation.createHTMLDocument()
    render(
      <GlobalError
        error={new Error("x")}
        reset={reset}
        unstable_retry={unstable_retry}
        retry={retry}
      />,
      { container: own, baseElement: own.body }
    )
    const button = own.querySelector("button")!
    expect(button.textContent).toBe("Try again")
    expect(button.hasAttribute("disabled")).toBe(false)
    act(() => button.click())
    expect(retry).toHaveBeenCalledTimes(1)
    expect(unstable_retry).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  it("the global error has a banner, one main and one primary", () => {
    render(<GlobalError error={new Error("x")} reset={vi.fn()} />, {
      container: document,
    })
    expect(screen.getByRole("banner")).toHaveTextContent("NabaPresence")
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })

  it("the global error puts back a stored theme, which the root layout would have applied", async () => {
    window.localStorage.setItem("theme", "dark")
    try {
      render(<GlobalError error={new Error("x")} reset={vi.fn()} />, {
        container: document,
      })
      await waitFor(() => expect(document.documentElement).toHaveClass("dark"))
    } finally {
      window.localStorage.removeItem("theme")
    }
  })
})

describe("dashboard loading", () => {
  it("is one busy status that says the page is loading", () => {
    render(<DashboardLoading />)
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading this page")
    // The list-row shapes are decoration only, hidden from assistive tech.
    const skeletons = status.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
    // The title bar is one page-title line tall, as PageHeader's h1 is.
    expect(skeletons[0]!.parentElement).toHaveClass("text-page-title")
    expect(skeletons[0]).toHaveClass("h-lh")
    for (const skeleton of Array.from(skeletons)) {
      expect(skeleton.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(status.querySelector("main")).toBeNull()
  })
})

describe("dashboard 404", () => {
  function renderNotFound(
    workspaceMode: "agency" | "business" = "agency",
    path = "/clients/00000000-0000-4000-8000-000000000000"
  ) {
    pathState.current = path
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(queryKeys.session, {
      session: { role: "owner", workspaceMode },
    })
    return render(
      <QueryClientProvider client={client}>
        <DashboardNotFound />
      </QueryClientProvider>
    )
  }

  it("says the same words as the root 404: one title, one sentence, one verb", () => {
    shellBack.mockReturnValue(null)
    const dashboard = renderNotFound()
    const dashboardTitle = screen.getByRole("heading", { level: 1 }).textContent
    const dashboardBody = screen.getByText(NOT_FOUND_DESCRIPTION).textContent
    const dashboardVerb = screen
      .getByRole("link", { name: /^Back to / })
      .textContent?.split(" ")
      .slice(0, 2)
      .join(" ")
    dashboard.unmount()

    render(<NotFound />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      dashboardTitle
    )
    expect(screen.getByText(NOT_FOUND_DESCRIPTION).textContent).toBe(
      dashboardBody
    )
    expect(
      screen
        .getByRole("link", { name: /^Back to / })
        .textContent?.split(" ")
        .slice(0, 2)
        .join(" ")
    ).toBe(dashboardVerb)
    expect(dashboardTitle).toBe(NOT_FOUND_TITLE)
    // The tab title says it too.
    expect(String(rootNotFoundMetadata.title)).toContain(NOT_FOUND_TITLE)
  })

  it("goes up to the shell's back target, not always the Inbox", () => {
    shellBack.mockReturnValue({ href: "/clients", label: "Clients" })
    renderNotFound()
    expect(
      screen.getByRole("link", { name: "Back to Clients" })
    ).toHaveAttribute("href", "/clients")
    expect(screen.queryByRole("link", { name: "Back to Inbox" })).toBeNull()
  })

  it("falls back to the Inbox when the shell has no parent", () => {
    shellBack.mockReturnValue(null)
    renderNotFound()
    expect(screen.getByRole("link", { name: "Back to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })

  it("keeps the raw address behind Details for support, closed", () => {
    shellBack.mockReturnValue(null)
    const path = "/clients/00000000-0000-4000-8000-000000000000"
    const { container } = renderNotFound("agency", path)
    const details = container.querySelector(
      'details[data-slot="support-details"]'
    )
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute("open")
    expect(details).toHaveTextContent("Details for support")
    expect(details).toHaveTextContent(path)
    expect(screen.queryByText(/You asked for/)).toBeNull()
  })

  it("does not repeat the shell's destinations", () => {
    shellBack.mockReturnValue(null)
    renderNotFound()
    expect(
      screen.queryByRole("region", { name: "Where to go instead" })
    ).toBeNull()
    expect(screen.queryByRole("link", { name: /^Reports$/ })).toBeNull()
    // Inside the shell: no landmark of its own.
    expect(screen.queryByRole("main")).not.toBeInTheDocument()
  })

  it("opens the command palette to search", async () => {
    shellBack.mockReturnValue(null)
    renderNotFound()
    const opened = vi.fn()
    document.addEventListener("np:open-command-palette", opened)
    await userEvent.click(
      screen.getByRole("button", { name: /Search clients and listings/ })
    )
    document.removeEventListener("np:open-command-palette", opened)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it("says listings, not clients, to a business", () => {
    shellBack.mockReturnValue({ href: "/listings", label: "Listings" })
    renderNotFound("business", "/listings/00000000-0000-4000-8000-000000000000")
    expect(
      screen.getByRole("button", { name: /Search listings/ })
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/client|agency/i)
  })
})
