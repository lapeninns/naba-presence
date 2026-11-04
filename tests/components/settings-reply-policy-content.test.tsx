import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/db", () => ({ withTenant: vi.fn(async () => true) }))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ BILLING_ENABLED: false }),
}))
vi.mock("@/lib/server/org-features", () => ({
  isOrgFeatureEnabled: vi.fn(async () => true),
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
vi.mock("@/components/settings/workspace-mode-card", () => ({
  WorkspaceModeCard: () => <section aria-label="Workspace type" />,
}))
vi.mock("@/components/settings/usage-card", () => ({
  UsageCard: () => <section aria-label="AI credits" />,
}))

import { ReplyPolicyContent } from "@/app/(dashboard)/settings/reply-policy-content"

type Session = Parameters<typeof ReplyPolicyContent>[0]["session"]

const session = (role: string, workspaceMode: "agency" | "business") =>
  ({
    role,
    workspaceMode,
    organisationId: "org-1",
  }) as unknown as Session

describe("Reply policy, the desk's settings home", () => {
  it("is one header and the form, with no tab row: the layout's section list is the way round", async () => {
    render(await ReplyPolicyContent({ session: session("owner", "agency") }))
    const header = screen.getByRole("banner")
    expect(
      screen.getByRole("heading", { level: 1, name: "Reply policy" })
    ).toBeInTheDocument()
    expect(header.querySelector("nav")).toBeNull()
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(
      screen.getByRole("form", { name: "Reply policy form" })
    ).toBeVisible()
  })

  it("speaks the workspace's own words in each mode", async () => {
    render(await ReplyPolicyContent({ session: session("member", "business") }))
    expect(screen.getByText(/^Your business’s name/)).toBeInTheDocument()
  })

  it("keeps the workspace-type card for the owner only", async () => {
    const { unmount } = render(
      await ReplyPolicyContent({ session: session("owner", "agency") })
    )
    expect(
      screen.getByRole("region", { name: "Workspace type" })
    ).toBeInTheDocument()
    unmount()
    render(await ReplyPolicyContent({ session: session("admin", "agency") }))
    expect(screen.queryByRole("region", { name: "Workspace type" })).toBeNull()
  })
})
