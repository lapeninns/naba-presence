import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { administrationReviewFixture } from "../helpers/administration-access-review"
import { lifecycleReviewFixture } from "../helpers/lifecycle-review"
import { googleLifecycleRequestSchema } from "@/lib/contracts/google-lifecycle"
import { AdministrationAccessWorkspace } from "@/components/locations/administration/access-workspace"
import { AdminsSection } from "@/components/locations/administration/admins"
import {
  AdministrationProvider,
  SectionGateNote,
  useAdministrationSection,
} from "@/components/locations/administration/context"
import { DangerZone } from "@/components/locations/administration/danger-zone"
import {
  CreateAdminDialog,
  InvitationsList,
} from "@/components/locations/administration/invitations"
import {
  StartVerification,
  VerificationHistory,
} from "@/components/locations/administration/verification"
import {
  GoogleUpdateSummary,
  VoiceOfMerchantSummary,
} from "@/components/locations/administration/voice-of-merchant"

// Each section reads `locationId` / `disabled` / `publishReason` from the
// AdministrationProvider context and runs its own useResourceMutation, so it
// can be exercised on its own — no tab shell, no capabilities GET.
type Section = {
  disabled?: boolean
  publishReason?: string | null
  locationName?: string
}

function renderSection(ui: ReactElement, section: Section = {}) {
  return renderWithProviders(
    <AdministrationProvider
      locationId="loc-1"
      locationName={section.locationName ?? "Camden Hotel"}
      disabled={section.disabled ?? false}
      publishReason={section.publishReason ?? null}
    >
      {ui.type === AdminsSection || ui.type === InvitationsList || ui.type === CreateAdminDialog ? <AdministrationAccessWorkspace>{ui}</AdministrationAccessWorkspace> : ui}
    </AdministrationProvider>
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** Stubs fetch; every PATCH succeeds (or fails with `failWith`) and its body is recorded. */
function stubPatch(failWith?: { status: number; code: string }) {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
    if (String(input).endsWith("/api/session")) return jsonResponse({ session: { userId: "owner", organisationId: "org", organisationName: "Fixture", displayName: "Owner", email: "owner@example.test", role: "owner", canPublish: true } })
    if (String(input).includes("/administration-lifecycle-reviews")) {
      if (init?.method === "POST") {
        const request = googleLifecycleRequestSchema.parse(JSON.parse(String(init.body)))
        bodies.push(request)
        return jsonResponse({ review: lifecycleReviewFixture(request) })
      }
      return jsonResponse({ items: [], nextCursor: null })
    }
    if (String(input).includes("/administration-access-workflows")) return jsonResponse({ items: [], nextCursor: null })
    if (String(input).includes("/administration-access-reviews") && init?.method === "POST") {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      return jsonResponse({ review: administrationReviewFixture(body) })
    }
    if (String(input).includes("/verification-workflows")) return jsonResponse({ workflows: [], nextCursor: null })
    if ((init as RequestInit | undefined)?.method === "PATCH") {
      bodies.push(JSON.parse((init as RequestInit).body as string))
      if (failWith)
        return jsonResponse(
          { error: failWith.code, message: failWith.code },
          failWith.status
        )
      return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
    }
    return jsonResponse({ locations: [] })
  })
  vi.stubGlobal("fetch", fetchMock)
  return {
    fetchMock,
    bodies,
    url: () =>
      String(
        fetchMock.mock.calls.find(
          ([, i]) => (i as RequestInit)?.method === "PATCH"
        )?.[0]
      ),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("administration context", () => {
  it("refuses to render a section outside the provider", () => {
    function Probe() {
      useAdministrationSection()
      return null
    }
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/inside <AdministrationTab>/)
  })

  it("only speaks the publish gate when editing itself is allowed", () => {
    const { unmount } = renderSection(<SectionGateNote />, {
      publishReason: "Publishing to Google is currently unavailable.",
    })
    expect(screen.getByRole("note")).toHaveTextContent(
      "Publishing to Google is currently unavailable."
    )
    unmount()
    renderSection(<SectionGateNote />, {
      disabled: true,
      publishReason: "Only owners and admins can edit this location.",
    })
    expect(screen.queryByRole("note")).not.toBeInTheDocument()
  })
})

describe("voice of merchant", () => {
  it("renders the verified badge from the Google leaf", () => {
    renderSection(
      <VoiceOfMerchantSummary data={{ hasVoiceOfMerchant: true }} />
    )
    expect(screen.getByText("Verified")).toBeInTheDocument()
    expect(
      screen.getByText("Google confirms you speak for this business.")
    ).toBeInTheDocument()
  })

  it("accepts Google's suggested update with the diff mask and toasts on success", async () => {
    const patch = stubPatch()
    renderSection(
      <GoogleUpdateSummary
        data={{
          diffMask: { paths: ["title", "websiteUri"] },
          location: { title: "Camden Hotel" },
        }}
      />
    )
    expect(screen.getByText(/Google suggests 2 changes/)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Accept Google's update" })
    )
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.url()).toContain("/api/locations/loc-1/administration")
    expect(patch.bodies[0]).toEqual({
      operation: "accept_google_update",
      confirmation: "accept_google_suggested_update",
      payload: {
        updateMask: ["title", "websiteUri"],
        location: { title: "Camden Hotel" },
      },
    })
    expect(
      await screen.findByText("Google's suggested update accepted")
    ).toBeInTheDocument()
  })

  it("says so when Google has nothing to suggest", () => {
    renderSection(<GoogleUpdateSummary data={{}} />)
    expect(
      screen.getByText("Google has not suggested any changes.")
    ).toBeInTheDocument()
  })
})

describe("verification", () => {
  it("offers reviewed PIN entry only for supported pending methods", () => {
    const patch = stubPatch()
    renderSection(<VerificationHistory data={{ verifications: [
      { name: "locations/camden/verifications/1", method: "SMS", state: "PENDING" },
      { name: "locations/camden/verifications/2", method: "VETTED_PARTNER", state: "PENDING" },
    ] }} />)
    expect(screen.getAllByLabelText("PIN from Google")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Review PIN completion" })).toBeDisabled()
    expect(screen.getByText(/This pending method cannot accept a PIN here/)).toBeInTheDocument()
    expect(patch.bodies).toHaveLength(0)
  })

  it("retains read-only method discovery behind the publish gate and explains why", () => {
    stubPatch()
    renderSection(
      <StartVerification />,
      {
        publishReason: "Publishing to Google is currently unavailable.",
      }
    )
    expect(
      screen.getByRole("button", { name: "Check available methods" })
    ).toBeEnabled()
    expect(screen.getByRole("note")).toHaveTextContent(
      "Publishing to Google is currently unavailable."
    )
  })
})

describe("admins", () => {
  const admins = {
    admins: [
      { admin: "owner@camden.test", role: "PRIMARY_OWNER" },
      {
        name: "locations/camden/admins/2",
        admin: "manager@camden.test",
        role: "MANAGER",
      },
    ],
  }

  it("offers role + remove controls for a manager but never for the primary owner", () => {
    renderSection(<AdminsSection data={admins} />)
    expect(
      screen.getByRole("button", { name: "Remove manager@camden.test" })
    ).toBeEnabled()
    expect(screen.getByRole("button", { name: "Review role change" })).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: /remove owner@camden\.test/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText("Role for owner@camden.test")
    ).not.toBeInTheDocument()
  })

  it("keeps the remove button inert while the location name is unknown", () => {
    renderSection(<AdminsSection data={admins} />, { locationName: "" })
    expect(
      screen.getByRole("button", { name: "Remove manager@camden.test" })
    ).toBeDisabled()
  })

  it("saves an administrator removal review through the typed-name confirmation without sending", async () => {
    const patch = stubPatch()
    renderSection(<AdminsSection data={admins} />)
    await userEvent.click(
      screen.getByRole("button", { name: "Remove manager@camden.test" })
    )
    expect(screen.getByText("Remove this administrator?")).toBeInTheDocument()
    await userEvent.type(
      screen.getByLabelText(/type the location's name/i),
      "camden hotel"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Review administrator removal" })
    )
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "delete_admin",
      payload: { name: "locations/camden/admins/2" },
    })
    expect(await screen.findByText("Administrator removal review saved")).toBeInTheDocument()
    expect(patch.fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })
})

describe("invitations", () => {
  it("declines an invitation with its own pending label and toasts", async () => {
    const patch = stubPatch()
    renderSection(
      <InvitationsList
        data={{
          invitations: [
            { name: "accounts/1/invitations/pending-1", role: "OWNER" },
          ],
        }}
      />
    )
    expect(screen.getByText("Owner")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Review decline" }))
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "decline_invitation",
      payload: { name: "accounts/1/invitations/pending-1" },
    })
    expect(await screen.findByText("Invitation decline review saved")).toBeInTheDocument()
  })

  it("lists nothing to do when there are no invitations", () => {
    renderSection(<InvitationsList data={{ invitations: [] }} />)
    expect(screen.getByText("No pending invitations.")).toBeInTheDocument()
  })

  it("validates the email before sending and resets the form on success", async () => {
    const patch = stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Add administrator" })
    )
    const send = screen.getByRole("button", { name: "Review invitation" })
    expect(send).toBeDisabled()
    const email = screen.getByLabelText(/email/i)
    await userEvent.type(email, "not-an-email")
    expect(
      await screen.findByText("Enter a valid email address.")
    ).toBeInTheDocument()
    expect(send).toBeDisabled()
    await userEvent.clear(email)
    await userEvent.type(email, "new@camden.test")
    expect(send).toBeEnabled()
    await userEvent.click(send)
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "create_admin",
      payload: { scope: "location", admin: "new@camden.test", role: "MANAGER" },
    })
    expect(await screen.findByText("Administrator invitation review saved")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Add an administrator" })).not.toBeInTheDocument()
    )
  })

  it("hides the trigger behind the edit gate", () => {
    renderSection(<CreateAdminDialog />, {
      disabled: true,
      publishReason: "Only owners and admins can edit this location.",
    })
    expect(
      screen.getByRole("button", { name: "Add administrator" })
    ).toBeDisabled()
  })
  it("blocks the invitation trigger behind a shared unresolved Google-write gate", () => {
    const patch = stubPatch()
    renderSection(<CreateAdminDialog />, { disabled: false, publishReason: "Resolve the saved lifecycle outcome before another Google change." })
    expect(screen.getByRole("button", { name: "Add administrator" })).toBeDisabled()
    expect(patch.bodies).toHaveLength(0)
  })
})

describe("danger zone", () => {
  it("disables both destructive entry points behind the publish gate", () => {
    renderSection(<DangerZone />, {
      publishReason: "Publishing to Google is currently unavailable.",
    })
    expect(
      screen.getByRole("button", { name: "Transfer this location" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Delete this location" })
    ).toBeDisabled()
    expect(screen.getAllByRole("note")).toHaveLength(2)
  })

  it("prepares an exact deletion review without a direct provider-write request", async () => {
    const patch = stubPatch()
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Delete this location" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "delete_location",
      payload: {},
    })
    expect(
      await screen.findByRole("button", { name: "Approve lifecycle request" })
    ).toBeInTheDocument()
    expect(patch.fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })

  it("clears the destination account when the transfer dialog is cancelled", async () => {
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    await userEvent.type(
      screen.getByLabelText(/destination google account/i),
      "accounts/999"
    )
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    expect(screen.getByLabelText(/destination google account/i)).toHaveValue("")
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled()
  })
})
