import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SettingsGroup } from "@/components/ui/settings-row"

vi.mock("@/lib/server/session", () => ({
  getSession: vi.fn(async () => ({ role: "member" })),
}))
vi.mock("@/lib/server/prefetch", () => ({
  prefetch: vi.fn(async () => undefined),
  notificationSettingsPrefetch: () => [],
}))
vi.mock("@/lib/queries/hydration-boundary", () => ({
  HydrationBoundary: ({ children }: { children: React.ReactNode }) => children,
}))
// The real groups, so their own `mt-6 first:mt-0` is what the page lays out.
vi.mock("@/components/settings/notification-preferences", () => ({
  NotificationPreferences: ({ role }: { role: string | null }) => (
    <>
      <SettingsGroup label="In the app" data-role={role ?? ""}>
        <li>In-app row</li>
      </SettingsGroup>
      <SettingsGroup label="By email">
        <li>Email row</li>
      </SettingsGroup>
    </>
  ),
}))

import SettingsNotificationsPage from "@/app/(dashboard)/settings/notifications/page"

describe("Settings › Notifications page", () => {
  it("is one header with no tab row: the settings section list is the way round", async () => {
    render(await SettingsNotificationsPage())
    const header = screen.getByRole("banner")
    expect(
      screen.getByRole("heading", { level: 1, name: "Notifications" })
    ).toBeInTheDocument()
    expect(header.querySelector("nav")).toBeNull()
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("puts the first group first in its own column, so the header sits one section gap above it", async () => {
    // As siblings of the header, the first group's mt-6 stacked on the
    // pane's 24px flex gap: 48px under the header, 24px on every other page.
    const { container } = render(await SettingsNotificationsPage())
    const header = screen.getByRole("banner")
    const groups = container.querySelectorAll('[data-slot="settings-group"]')
    expect(groups).toHaveLength(2)
    const column = header.nextElementSibling
    expect(column).not.toBeNull()
    expect(column?.firstElementChild).toBe(groups[0])
    expect(groups[0].className).toContain("first:mt-0")
    expect(groups[1].parentElement).toBe(column)
    // The column adds no gap of its own: the second group's mt-6 alone
    // spaces the two, as on every other settings page.
    expect(column?.className).not.toMatch(/\bgap-/)
  })

  it("passes the signed-in role to the choices", async () => {
    const { container } = render(await SettingsNotificationsPage())
    expect(
      container.querySelector('[data-slot="settings-group"]')
    ).toHaveAttribute("data-role", "member")
  })
})
