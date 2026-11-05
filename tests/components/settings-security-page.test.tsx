import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  mfaEnabled: true,
  session: {
    role: "owner",
    email: "owner@example.test",
    mfaFactorCount: 0,
    aal: "aal1",
  } as {
    role: string
    email: string
    mfaFactorCount?: number
    aal?: string
  },
}))

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/server/mfa", () => ({
  isMfaEnabled: () => state.mfaEnabled,
}))
vi.mock("@/lib/server/session", () => ({
  requireSession: vi.fn(async () => state.session),
}))
vi.mock("@/components/settings/two-step-verification-card", () => ({
  TwoStepVerificationCard: (props: {
    factorCount: number
    verifiedThisSession: boolean
    requiredForYou: boolean
  }) => (
    <section aria-label="Two-step verification">
      <p>{`factors ${props.factorCount}`}</p>
      <p>{`verified ${props.verifiedThisSession}`}</p>
      <p>{`required ${props.requiredForYou}`}</p>
    </section>
  ),
}))

import SettingsSecurityPage from "@/app/(dashboard)/settings/security/page"

describe("Settings › Sign-in security page", () => {
  beforeEach(() => {
    state.mfaEnabled = true
    state.session = {
      role: "owner",
      email: "owner@example.test",
      mfaFactorCount: 0,
      aal: "aal1",
    }
  })

  it.each(["owner", "admin", "member", "viewer"])(
    "is one header with no tab row for a %s: the settings section list is the way round",
    async (role) => {
      state.session.role = role
      render(await SettingsSecurityPage())
      const header = screen.getByRole("banner")
      expect(
        screen.getByRole("heading", { level: 1, name: "Sign-in security" })
      ).toBeInTheDocument()
      expect(header.querySelector("nav")).toBeNull()
      expect(screen.queryByRole("navigation")).toBeNull()
      expect(
        screen.getByRole("region", { name: "Two-step verification" })
      ).toBeInTheDocument()
    }
  )

  it("tells only owners and admins it is required, from the session's role", async () => {
    state.session.role = "admin"
    const { unmount } = render(await SettingsSecurityPage())
    expect(screen.getByText("required true")).toBeInTheDocument()
    unmount()
    state.session.role = "member"
    render(await SettingsSecurityPage())
    expect(screen.getByText("required false")).toBeInTheDocument()
  })

  it("passes the session's factors and level, never a guess", async () => {
    state.session = { ...state.session, mfaFactorCount: 2, aal: "aal2" }
    render(await SettingsSecurityPage())
    expect(screen.getByText("factors 2")).toBeInTheDocument()
    expect(screen.getByText("verified true")).toBeInTheDocument()
  })

  it("is a 404 while two-step verification is switched off", async () => {
    state.mfaEnabled = false
    await expect(SettingsSecurityPage()).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
