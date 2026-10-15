import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render as renderPlain, screen } from "@testing-library/react"
import type NextLink from "next/link"
import type { ComponentProps, ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({
  billingEnabled: false,
  getSession: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<typeof NextLink>) => (
    <a href={String(href)} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ BILLING_ENABLED: stubs.billingEnabled }),
}))
vi.mock("@/lib/server/session", () => ({ getSession: stubs.getSession }))
vi.mock("next/navigation", () => ({
  notFound: stubs.notFound,
  redirect: stubs.redirect,
  usePathname: () => "/settings/billing",
}))
vi.mock("@/components/settings/settings-nav", () => ({
  SettingsNav: () => <nav aria-label="Settings sections" />,
}))
vi.mock("@/components/settings/billing-card", () => ({
  BillingCard: () => <section aria-label="Billing card" />,
}))
vi.mock("@/components/settings/billing-confirming", () => ({
  BillingConfirming: () => <section aria-label="Billing confirming" />,
}))
vi.mock("@/components/settings/usage-card", () => ({
  UsageCard: () => <section aria-label="Usage card" />,
}))
vi.mock("@/components/settings/plan-usage-card", () => ({
  PlanUsageCard: () => <section aria-label="Plan usage card" />,
}))

import BillingConfirmingPage, {
  generateMetadata as confirmingMetadata,
} from "@/app/(dashboard)/settings/billing/confirming/page"
import SettingsBillingPage, {
  generateMetadata as billingMetadata,
} from "@/app/(dashboard)/settings/billing/page"
import SettingsUsagePage, {
  generateMetadata as usageMetadata,
} from "@/app/(dashboard)/settings/usage/page"

// The dashboard layout's QueryProvider, as the 404's role and mode reads need.
function render(ui: ReactElement) {
  return renderPlain(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  )
}

const owner = { role: "owner", organisationId: "o1" }
// A thenable, so awaiting it (reading the query string) is observable.
let query: Record<string, string> = {}
const awaited = vi.fn()
const searchParams = () =>
  ({
    then: (resolve: (value: Record<string, string>) => void) => {
      awaited()
      resolve(query)
    },
  }) as unknown as Promise<Record<string, string>>

beforeEach(() => {
  stubs.getSession.mockResolvedValue(owner)
})
afterEach(() => {
  vi.clearAllMocks()
  query = {}
  stubs.billingEnabled = false
})

const pages = [
  ["billing", () => SettingsBillingPage({ searchParams: searchParams() })],
  ["billing/confirming", () => BillingConfirmingPage()],
  ["usage", () => SettingsUsagePage()],
] as const

describe("settings billing routes with billing off", () => {
  it.each(pages)(
    "%s renders the shared 404 itself, before reading anything",
    async (_name, call) => {
      render(await call())
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "This page doesn’t exist",
        })
      ).toBeInTheDocument()
      // notFound() is what put the 404 behind hydration (MEA-02).
      expect(stubs.notFound).not.toHaveBeenCalled()
      expect(stubs.getSession).not.toHaveBeenCalled()
      expect(awaited).not.toHaveBeenCalled()
      // None of the enabled page's content or its tab row.
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText(/card|confirming/i)
      ).not.toBeInTheDocument()
    }
  )

  it("does not prefetch the destinations it offers", async () => {
    render(await pages[0][1]())
    const links = screen.getAllByRole("link")
    expect(links.length).toBeGreaterThan(1)
    for (const link of links)
      expect(link).toHaveAttribute("data-prefetch", "false")
  })

  it.each([
    ["billing", billingMetadata],
    ["billing/confirming", confirmingMetadata],
    ["usage", usageMetadata],
  ] as const)(
    "%s metadata is the 404's and keeps it out of indexes",
    (_n, meta) => {
      expect(meta()).toEqual({
        title: "Page not found · NabaPresence",
        robots: { index: false, follow: false },
      })
    }
  )
})

describe("settings billing routes with billing on", () => {
  beforeEach(() => {
    stubs.billingEnabled = true
  })

  it("billing keeps its header, tab row and card for the owner", async () => {
    render(await SettingsBillingPage({ searchParams: searchParams() }))
    expect(stubs.getSession).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Billing" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("navigation", { name: "Settings sections" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Billing card")).toBeInTheDocument()
    expect(
      screen.queryByText("This page doesn’t exist")
    ).not.toBeInTheDocument()
  })

  it("billing sends a Checkout return to Confirming", async () => {
    query = { checkout: "returned" }
    await SettingsBillingPage({ searchParams: searchParams() })
    expect(stubs.redirect).toHaveBeenCalledWith("/settings/billing/confirming")
  })

  it("billing and confirming still say access denied to anyone but the owner", async () => {
    stubs.getSession.mockResolvedValue({ role: "admin", organisationId: "o1" })
    render(await SettingsBillingPage({ searchParams: searchParams() }))
    expect(screen.queryByLabelText("Billing card")).not.toBeInTheDocument()
    expect(
      screen.queryByText("This page doesn’t exist")
    ).not.toBeInTheDocument()
  })

  it("usage and confirming render their own screens", async () => {
    render(await SettingsUsagePage())
    expect(screen.getByLabelText("Usage card")).toBeInTheDocument()
    render(await BillingConfirmingPage())
    expect(screen.getByLabelText("Billing confirming")).toBeInTheDocument()
  })

  it.each([
    ["billing", billingMetadata, "Billing · NabaPresence"],
    [
      "billing/confirming",
      confirmingMetadata,
      "Confirming subscription · NabaPresence",
    ],
    ["usage", usageMetadata, "Usage · NabaPresence"],
  ] as const)("%s keeps its own title", (_n, meta, title) => {
    expect(meta()).toEqual({ title })
  })
})
