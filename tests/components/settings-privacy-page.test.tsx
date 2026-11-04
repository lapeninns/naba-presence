import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  session: { role: "owner", organisationId: "org-1" } as {
    role: string
    organisationId: string
  } | null,
  featureOn: true,
}))

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/server/session", () => ({
  getSession: vi.fn(async () => state.session),
}))
vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(async (_org: string, run: (sql: unknown) => unknown) =>
    run({})
  ),
}))
vi.mock("@/lib/server/org-features", () => ({
  isOrgFeatureEnabled: vi.fn(async () => state.featureOn),
}))
vi.mock("@/components/settings/privacy-settings", () => ({
  PrivacySettings: ({ access }: { access: string }) => (
    <section aria-label="Privacy requests">{`access ${access}`}</section>
  ),
}))
vi.mock("@/components/app-shell/access-denied", () => ({
  AccessDenied: ({ area }: { area: string }) => <p>{`No access to ${area}`}</p>,
}))

import SettingsPrivacyPage from "@/app/(dashboard)/settings/privacy/page"

describe("Settings › Data and privacy page", () => {
  beforeEach(() => {
    state.session = { role: "owner", organisationId: "org-1" }
    state.featureOn = true
  })

  it.each([
    ["owner", "manage"],
    ["admin", "read"],
  ])(
    "is one header with no tab row for an %s: the settings section list is the way round",
    async (role, access) => {
      state.session = { role, organisationId: "org-1" }
      render(await SettingsPrivacyPage())
      const header = screen.getByRole("banner")
      expect(
        screen.getByRole("heading", { level: 1, name: "Data and privacy" })
      ).toBeInTheDocument()
      expect(header.querySelector("nav")).toBeNull()
      expect(screen.queryByRole("navigation")).toBeNull()
      expect(
        screen.getByRole("region", { name: "Privacy requests" })
      ).toHaveTextContent(`access ${access}`)
    }
  )

  it.each(["member", "viewer"])(
    "keeps a %s out, with no view-only page",
    async (role) => {
      state.session = { role, organisationId: "org-1" }
      render(await SettingsPrivacyPage())
      expect(
        screen.getByText("No access to Data and privacy")
      ).toBeInTheDocument()
      expect(screen.queryByRole("banner")).toBeNull()
    }
  )

  it("keeps a signed-out visitor out", async () => {
    state.session = null
    render(await SettingsPrivacyPage())
    expect(
      screen.getByText("No access to Data and privacy")
    ).toBeInTheDocument()
  })

  it("is a 404 while the organisation's privacy feature is off", async () => {
    state.featureOn = false
    await expect(SettingsPrivacyPage()).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
