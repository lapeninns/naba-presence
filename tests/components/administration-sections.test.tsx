import { render, screen, waitFor, within } from "@testing-library/react"
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
import { ReviewedCompletionVerification } from "@/components/locations/administration/verification-completion"
import { ReviewedStartVerification } from "@/components/locations/administration/verification-start"

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
      {ui.type === AdminsSection ||
      ui.type === InvitationsList ||
      ui.type === CreateAdminDialog ? (
        <AdministrationAccessWorkspace>{ui}</AdministrationAccessWorkspace>
      ) : (
        ui
      )}
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
    if (String(input).includes("/capabilities"))
      return jsonResponse({
        capabilities: { canEditCanonical: true, canPublish: true },
      })
    if (String(input).endsWith("/api/session"))
      return jsonResponse({
        session: {
          userId: "owner",
          organisationId: "org",
          organisationName: "Fixture",
          displayName: "Owner",
          email: "owner@example.test",
          role: "owner",
          canPublish: true,
          workspaceMode: "agency",
        },
      })
    if (String(input).includes("/administration-lifecycle-reviews")) {
      if (init?.method === "POST") {
        const request = googleLifecycleRequestSchema.parse(
          JSON.parse(String(init.body))
        )
        bodies.push(request)
        return jsonResponse({ review: lifecycleReviewFixture(request) })
      }
      return jsonResponse({ items: [], nextCursor: null })
    }
    if (String(input).includes("/administration-access-workflows"))
      return jsonResponse({ items: [], nextCursor: null })
    if (
      String(input).includes("/administration-access-reviews") &&
      init?.method === "POST"
    ) {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      return jsonResponse({ review: administrationReviewFixture(body) })
    }
    if (String(input).includes("/verification-workflows"))
      return jsonResponse({ workflows: [], nextCursor: null })
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

describe("verification", () => {
  it("offers reviewed PIN entry only for supported pending methods", () => {
    const patch = stubPatch()
    renderSection(
      <ReviewedCompletionVerification
        verifications={[
          {
            name: "locations/camden/verifications/1",
            method: "SMS",
            providerState: "PENDING",
            phase: "pending",
            createTime: null,
          },
          {
            name: "locations/camden/verifications/2",
            method: "VETTED_PARTNER",
            providerState: "PENDING",
            phase: "pending",
            createTime: null,
          },
        ]}
      />
    )
    expect(screen.getAllByLabelText("PIN from Google")).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: "Review PIN completion" })
    ).toBeDisabled()
    expect(
      screen.getByText(/This pending method cannot accept a PIN here/)
    ).toBeInTheDocument()
    expect(patch.bodies).toHaveLength(0)
  })

  it("retains read-only method discovery behind the publish gate and explains why", () => {
    stubPatch()
    renderSection(<ReviewedStartVerification />, {
      publishReason: "Publishing to Google is currently unavailable.",
    })
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
    // One control per row for the role: choosing a role saves its review.
    expect(
      screen.getByRole("combobox", { name: "Role for manager@camden.test" })
    ).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Review role change" })
    ).not.toBeInTheDocument()
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

  it("saves an administrator removal review in one step without sending; the typed name waits for the send step", async () => {
    const patch = stubPatch()
    renderSection(<AdminsSection data={admins} />)
    await userEvent.click(
      screen.getByRole("button", { name: "Remove manager@camden.test" })
    )
    // Creating a review sends nothing, so no confirmation dialog stands in the way.
    expect(
      screen.queryByText("Remove this administrator?")
    ).not.toBeInTheDocument()
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "delete_admin",
      payload: { name: "locations/camden/admins/2" },
    })
    expect(
      await screen.findByText("Administrator removal review saved")
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("region", { name: "Review access request" })
    ).toBeInTheDocument()
    expect(
      patch.fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBe(false)
  })

  it("saves a role-change review as soon as a different role is chosen, and nothing for the listed role", async () => {
    const patch = stubPatch()
    renderSection(<AdminsSection data={admins} />)
    const select = screen.getByRole("combobox", {
      name: "Role for manager@camden.test",
    })
    await userEvent.click(select)
    await userEvent.click(
      await screen.findByRole("option", { name: "Manager" })
    )
    expect(patch.bodies).toHaveLength(0)
    await userEvent.click(select)
    await userEvent.click(await screen.findByRole("option", { name: "Owner" }))
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "update_admin",
      payload: { name: "locations/camden/admins/2", role: "OWNER" },
    })
    expect(
      await screen.findByText("Administrator role review saved")
    ).toBeInTheDocument()
    expect(
      patch.fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBe(false)
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
    expect(screen.getByText("Owner invitation")).toBeInTheDocument()
    expect(
      screen.getByText(
        "For the connected Google account · waiting for your answer"
      )
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Review decline" })
    )
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "decline_invitation",
      payload: { name: "accounts/1/invitations/pending-1" },
    })
    expect(
      await screen.findByText("Decline ready to approve")
    ).toBeInTheDocument()
  })

  it("says what each invitation grants: the role and the place it is for", () => {
    stubPatch()
    renderSection(
      <InvitationsList
        data={{
          invitations: [
            {
              name: "accounts/1/invitations/pending-1",
              role: "MANAGER",
              targetLocation: { locationName: "Camden Hotel" },
            },
            {
              name: "accounts/1/invitations/pending-2",
              role: "OWNER",
              targetAccount: { accountName: "Camden Group" },
            },
          ],
        }}
      />
    )
    expect(screen.getByText("Manager invitation")).toBeInTheDocument()
    expect(
      screen.getByText("To manage Camden Hotel · waiting for your answer")
    ).toBeInTheDocument()
    expect(screen.getByText("Owner invitation")).toBeInTheDocument()
    expect(
      screen.getByText("To manage Camden Group · waiting for your answer")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Invitation", { exact: true })
    ).not.toBeInTheDocument()
  })

  it("lists nothing to do when there are no invitations", () => {
    renderSection(<InvitationsList data={{ invitations: [] }} />)
    expect(screen.getByText("No invitations to answer.")).toBeInTheDocument()
  })

  it("validates the email before sending and resets the form on success", async () => {
    const patch = stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    const send = screen.getByRole("button", { name: "Review invitation" })
    expect(send).toBeDisabled()
    const email = screen.getByLabelText(/email/i)
    await userEvent.type(email, "not-an-email")
    // Nothing interrupts the typing: the address is checked on leaving the field.
    expect(
      screen.queryByText("Enter a valid email address.")
    ).not.toBeInTheDocument()
    expect(email).not.toHaveAttribute("aria-invalid")
    await userEvent.tab()
    expect(
      await screen.findByText("Enter a valid email address.")
    ).toBeInTheDocument()
    expect(email).toHaveAttribute("aria-invalid", "true")
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
    expect(
      await screen.findByText("Invitation ready to approve")
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Invite someone" })
      ).not.toBeInTheDocument()
    )
  })

  it("reviews the invitation when Enter is pressed in the email field", async () => {
    const patch = stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    expect(
      screen.getByRole("button", { name: "Review invitation" })
    ).toHaveAttribute("type", "submit")
    const email = screen.getByLabelText("Email address")
    await userEvent.type(email, "not-an-email{Enter}")
    // Enter on an address that isn't valid yet says why, and sends nothing.
    expect(
      await screen.findByText("Enter a valid email address.")
    ).toBeInTheDocument()
    expect(patch.bodies).toHaveLength(0)
    await userEvent.clear(email)
    await userEvent.type(email, "new@camden.test{Enter}")
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "create_admin",
      payload: { scope: "location", admin: "new@camden.test", role: "MANAGER" },
    })
    // The saved review takes the form's place on the same sheet.
    expect(
      await screen.findByRole("heading", { name: "Review invitation" })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument()
  })

  it("labels the role and scope pickers by their visible labels and gives the email field identifier keyboard hints", async () => {
    stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent(
      "Manager"
    )
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveTextContent(
      "This location"
    )
    const email = screen.getByLabelText("Email address")
    expect(email).toHaveAttribute("type", "email")
    expect(email).toHaveAttribute("inputmode", "email")
    expect(email).toHaveAttribute("autocapitalize", "none")
    expect(email).toHaveAttribute("autocorrect", "off")
    expect(email).toHaveAttribute("spellcheck", "false")
  })

  it("says what the chosen role and scope grant, tied to each picker", async () => {
    stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    const role = screen.getByRole("combobox", { name: "Role" })
    expect(role).toHaveAccessibleDescription(
      /Can’t manage people or remove the listing/
    )
    const scope = screen.getByRole("combobox", { name: "Scope" })
    expect(scope).toHaveAccessibleDescription("Only this listing.")
    await userEvent.click(role)
    await userEvent.click(await screen.findByRole("option", { name: "Owner" }))
    await waitFor(() =>
      expect(role).toHaveAccessibleDescription(
        /plus managing people and removing the listing/
      )
    )
    await userEvent.click(scope)
    await userEvent.click(
      await screen.findByRole("option", { name: "The whole Google account" })
    )
    await waitFor(() =>
      expect(scope).toHaveAccessibleDescription(
        "Every listing in this Google account."
      )
    )
  })

  it("replaces the footer buttons on each step instead of restyling the same ones", async () => {
    stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    const reviewButton = screen.getByRole("button", {
      name: "Review invitation",
    })
    await userEvent.type(
      screen.getByLabelText("Email address"),
      "new@camden.test"
    )
    await userEvent.click(reviewButton)
    // The review step's secondary button sits where the form's primary one
    // was: a fresh node, never one eased from primary to secondary.
    expect(
      await screen.findByRole("button", { name: "Check saved access outcome" })
    ).toBeInTheDocument()
    expect(reviewButton.isConnected).toBe(false)
  })

  it("asks before a stray Escape throws a typed invitee away, and clears it on discard", async () => {
    stubPatch()
    renderSection(<CreateAdminDialog />)
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    await userEvent.type(
      screen.getByLabelText("Email address"),
      "new@camden.test"
    )
    await userEvent.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", {
      name: "Discard your changes?",
    })
    await userEvent.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "new@camden.test"
    )
    await userEvent.keyboard("{Escape}")
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Invite someone" })
      ).not.toBeInTheDocument()
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Invite someone" })
    )
    expect(screen.getByLabelText("Email address")).toHaveValue("")
  })

  it("hides the trigger behind the edit gate", () => {
    renderSection(<CreateAdminDialog />, {
      disabled: true,
      publishReason: "Only owners and admins can edit this location.",
    })
    expect(
      screen.getByRole("button", { name: "Invite someone" })
    ).toBeDisabled()
  })
  it("blocks the invitation trigger behind a shared unresolved Google-write gate", () => {
    const patch = stubPatch()
    renderSection(<CreateAdminDialog />, {
      disabled: false,
      publishReason:
        "Resolve the saved lifecycle outcome before another Google change.",
    })
    expect(
      screen.getByRole("button", { name: "Invite someone" })
    ).toBeDisabled()
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
      screen.getByRole("button", { name: "Request deletion" })
    ).toBeDisabled()
    expect(screen.getAllByRole("note")).toHaveLength(2)
  })

  it("prepares an exact deletion review without a direct provider-write request", async () => {
    const patch = stubPatch()
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Request deletion" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Prepare deletion review" })
    )
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "delete_location",
      payload: {},
    })
    expect(
      await screen.findByRole("button", { name: "Approve lifecycle request" })
    ).toBeInTheDocument()
    expect(
      patch.fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")
    ).toBe(false)
  })

  it("clears the destination account when the transfer dialog is closed", async () => {
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    await userEvent.type(
      screen.getByLabelText(/destination google account/i),
      "accounts/999"
    )
    // The ✕ with typed text asks first; discarding closes the dialog.
    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard changes" })
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Transfer this location" })
    )
    expect(screen.getByLabelText(/destination google account/i)).toHaveValue("")
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled()
  })

  it("accepts a phone-capitalised destination and trailing space, and previews the exact account name", async () => {
    const patch = stubPatch()
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    const destination = screen.getByLabelText(/destination google account/i)
    expect(destination).toHaveAttribute("autocapitalize", "none")
    expect(destination).toHaveAttribute("autocorrect", "off")
    expect(destination).toHaveAttribute("spellcheck", "false")
    await userEvent.type(destination, "Accounts/999 ")
    expect(
      screen.queryByText(/Select an exact Google account resource/)
    ).not.toBeInTheDocument()
    await userEvent.type(destination, "{Enter}")
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "transfer_location",
      payload: { destinationAccount: "accounts/999" },
    })
  })

  it("explains an account name the server would reject and keeps the review closed", async () => {
    const patch = stubPatch()
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    await userEvent.type(
      screen.getByLabelText(/destination google account/i),
      "accounts/9 9{Enter}"
    )
    expect(
      screen.getByText(
        "Enter an account ID such as accounts/123456789 or 123456789."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled()
    expect(patch.bodies).toHaveLength(0)
  })

  it("waits for the person to leave the destination field before saying its format is wrong", async () => {
    stubPatch()
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    const destination = screen.getByLabelText(/destination google account/i)
    expect(destination).toHaveAccessibleDescription(
      "The account ID, for example accounts/123456789 or just 123456789."
    )
    await userEvent.type(destination, "accounts/")
    expect(screen.queryByText(/Enter an account ID/)).not.toBeInTheDocument()
    await userEvent.tab()
    expect(
      screen.getByText(
        "Enter an account ID such as accounts/123456789 or 123456789."
      )
    ).toBeInTheDocument()
    expect(destination).toHaveAttribute("aria-invalid", "true")
  })

  it("accepts a bare account ID and previews exactly the account name the prefix would have sent", async () => {
    const patch = stubPatch()
    renderSection(<DangerZone />)
    await userEvent.click(
      screen.getByRole("button", { name: "Transfer this location" })
    )
    await userEvent.type(
      screen.getByLabelText(/destination google account/i),
      "123456789"
    )
    const next = screen.getByRole("button", {
      name: "Continue to transfer review",
    })
    expect(next).toBeEnabled()
    await userEvent.click(next)
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toEqual({
      operation: "transfer_location",
      payload: { destinationAccount: "accounts/123456789" },
    })
  })

  it("names the listing in each dialog and keeps the review step's wording honest", async () => {
    stubPatch()
    renderSection(<DangerZone />)
    expect(
      screen.getByRole("button", { name: "Request deletion" })
    ).toBeEnabled()
    await userEvent.click(
      screen.getByRole("button", { name: "Request deletion" })
    )
    const deletion = screen.getByRole("dialog", {
      name: "Request deletion of Camden Hotel",
    })
    expect(deletion).toHaveTextContent(
      "Nothing is deleted or sent to Google at this step."
    )
    await userEvent.click(
      within(deletion).getByRole("button", { name: "Close" })
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Transfer this location" })
    )
    expect(
      screen.getByRole("dialog", {
        name: "Transfer Camden Hotel to another Google account",
      })
    ).toBeInTheDocument()
  })

  it("says why both entry points wait while the listing name loads", () => {
    stubPatch()
    renderSection(<DangerZone />, { locationName: "" })
    expect(
      screen.getByRole("button", { name: "Transfer this location" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Request deletion" })
    ).toBeDisabled()
    expect(screen.getAllByRole("note").map((note) => note.textContent)).toEqual(
      [
        "Not available until the listing name loads. Reload the page if this stays.",
        "Not available until the listing name loads. Reload the page if this stays.",
      ]
    )
  })
})
