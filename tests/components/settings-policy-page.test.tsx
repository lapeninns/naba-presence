import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/server/session", () => ({
  getSession: vi.fn(async () => session.current),
}))
vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn(async () => false) }))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ BILLING_ENABLED: false }),
}))
vi.mock("@/lib/server/org-features", () => ({
  isOrgFeatureEnabled: vi.fn(async () => false),
}))
vi.mock("@/lib/server/prefetch", () => ({
  prefetch: vi.fn(async () => undefined),
  replyPolicyPrefetch: () => [],
}))
vi.mock("@/lib/queries/hydration-boundary", () => ({
  HydrationBoundary: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/settings/policy-form", () => ({
  PolicyForm: ({ role }: { role: string | null }) => (
    <form aria-label="Reply policy form" data-role={role ?? ""} />
  ),
}))
vi.mock("@/components/settings/usage-card", () => ({
  UsageCard: () => <section aria-label="AI credits" />,
}))

import SettingsReplyPolicyPage from "@/app/(dashboard)/settings/policy/page"

/** The page returns the async body as an element; resolve it to render. */
async function renderPage() {
  const page = (await SettingsReplyPolicyPage()) as React.ReactElement<
    Record<string, unknown>
  >
  const Body = page.type as (props: unknown) => Promise<React.ReactNode>
  return render(await Body(page.props))
}

describe("Settings › Reply policy page", () => {
  beforeEach(() => {
    session.current = null
  })

  it.each(["owner", "admin", "member", "viewer"])(
    "opens for a %s as one header and the form, with no tab row",
    async (role) => {
      session.current = {
        role,
        workspaceMode: "agency",
        organisationId: "org-1",
      }
      await renderPage()
      const header = screen.getByRole("banner")
      expect(
        screen.getByRole("heading", { level: 1, name: "Reply policy" })
      ).toBeInTheDocument()
      expect(header.querySelector("nav")).toBeNull()
      expect(screen.queryByRole("navigation")).toBeNull()
      // The form decides what this role may change (read-only for member
      // and viewer); the page never turns anyone away.
      expect(
        screen.getByRole("form", { name: "Reply policy form" })
      ).toHaveAttribute("data-role", role)
    }
  )
})
