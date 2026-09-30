import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { administrationReviewFixture } from "../helpers/administration-access-review"
import { lifecycleAttemptFixture, lifecycleReviewFixture } from "../helpers/lifecycle-review"
import { googleLifecycleRequestSchema } from "@/lib/contracts/google-lifecycle"
import { lifecycleAttemptSchema } from "@/lib/contracts/google-lifecycle-review"
import {
  AccessTab,
  VerificationTab,
} from "@/components/locations/administration"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const available = (data: unknown) => ({ data, error: null })
const ADMIN = { administration: {
  voice: available({ hasVoiceOfMerchant: true }), verifications: available({ verifications: [] }),
  verificationOptions: available({ options: [{ verificationMethod: "PHONE_CALL" }] }), googleUpdated: available(null),
  locationAdmins: available({ admins: [
    { admin: "owner@camden.test", role: "PRIMARY_OWNER" },
    { name: "locations/camden/admins/2", admin: "manager@camden.test", role: "MANAGER" },
  ] }),
  accountAdmins: available({ accountAdmins: [] }), invitations: available({ invitations: [] }),
  accountName: "accounts/1", googleLocationName: "locations/camden", canManage: true, writesEnabled: true,
} }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function stub(caps: unknown) {
  let lifecycleReview = lifecycleReviewFixture()
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/administration-lifecycle-reviews")) {
      if (init?.method !== "POST") return jsonResponse({ items: [], nextCursor: null })
      if (url.endsWith("/execute")) return jsonResponse({ attempt: lifecycleAttemptSchema.parse({ ...lifecycleAttemptFixture(), request: lifecycleReview.request, operation: lifecycleReview.request.operation, postcondition: lifecycleReview.request.operation === "transfer_location" ? "location_transferred_between_accounts" : "location_absent_from_managed_account" }) })
      if (url.endsWith("/administration-lifecycle-reviews")) lifecycleReview = lifecycleReviewFixture(googleLifecycleRequestSchema.parse(JSON.parse(String(init.body))))
      else lifecycleReview = { ...lifecycleReview, changeSet: { ...lifecycleReview.changeSet, approvedBy: "manager" } }
      return jsonResponse({ review: lifecycleReview })
    }
    if (url.includes("/administration-access-workflows")) return jsonResponse({ items: [], nextCursor: null })
    if (url.includes("/administration-access-reviews") && init?.method === "POST") return jsonResponse({ review: administrationReviewFixture(JSON.parse(String(init.body))) })
    if (url === "/api/session") return jsonResponse({ session: { userId: "manager", organisationId: "org", organisationName: "Agency", displayName: "Manager", email: "manager@example.test", role: "owner", canPublish: true } })
    if (url.includes("/verification-state")) return jsonResponse({ locationId: "00000000-0000-4000-8000-000000000001", googleLocationName: "locations/camden", checkedAt: "2026-09-30T01:00:00Z", verifications: [], merchant: { hasVoiceOfMerchant: true, hasBusinessAuthority: true, action: "none", hasPendingVerification: false }, merchantError: null })
    if (url.includes("/verification-workflows")) return jsonResponse({ workflows: [], nextCursor: null })
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: caps })
    if (url.includes("/administration")) return jsonResponse(ADMIN)
    return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
  })
  vi.stubGlobal("fetch", fetchMock); return fetchMock
}

describe("AccessTab (read + non-destructive)", () => {
  it("gates a member without firing the 403 GET", async () => {
    const fetchMock = stub({ canEditCanonical: false, canPublish: false })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText(/available to owners and admins/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/administration"))).toBe(false)
  })
  it("humanises admin roles", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("Primary owner")).toBeInTheDocument()
    expect(screen.queryByText("PRIMARY_OWNER")).not.toBeInTheDocument()
  })
  it("shows a distinguishable pending state per invitation button, not both at once", async () => {
    let resolvePatch: (() => void) | undefined
    const patchGate = new Promise<void>((resolve) => { resolvePatch = resolve })
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/administration-access-workflows")) return jsonResponse({ items: [], nextCursor: null })
      if (url.includes("/administration-access-reviews") && init?.method === "POST") {
        await patchGate
        return jsonResponse({ review: administrationReviewFixture(JSON.parse(String(init.body))) })
      }
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/administration") && (init as RequestInit | undefined)?.method === "PATCH") {
        await patchGate
        return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
      }
      if (url.includes("/administration")) {
        return jsonResponse({
          administration: {
            ...ADMIN.administration,
            invitations: available({ invitations: [{ name: "accounts/1/invitations/pending-1", role: "MANAGER" }] }),
          },
        })
      }
      return jsonResponse({ id: "m", status: "succeeded", idempotent: false })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    const acceptButton = await screen.findByRole("button", { name: "Review acceptance" })
    const declineButton = screen.getByRole("button", { name: "Review decline" })

    await userEvent.click(acceptButton)

    // Only the clicked (Accept) button flips to its pending label — Decline
    // stays showing its idle label, just disabled while the shared mutation
    // is in flight.
    expect(await screen.findByRole("button", { name: "Reviewing…" })).toBeInTheDocument()
    expect(declineButton).toBeInTheDocument()
    expect(declineButton).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Declining…" })).not.toBeInTheDocument()

    resolvePatch?.()
    await waitFor(() => expect(screen.getByRole("button", { name: "Review acceptance" })).toBeEnabled())
  })

  it("create-admin saves the exact review without sending an access mutation", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /add administrator/i }))
    await userEvent.type(screen.getByLabelText(/email/i), "new@camden.test")
    await userEvent.click(screen.getByRole("button", { name: /review invitation/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/administration-access-reviews") && init?.method === "POST")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("create_admin")
      expect(body).toEqual({ operation: "create_admin", payload: { scope: "location", admin: "new@camden.test", role: "MANAGER" } })
    })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })
})

describe("AccessTab (danger zone)", () => {
  it("delete-location requires an exact review, approval, typed name and separate send consent", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /delete this location/i }))
    expect(screen.getByText(/business and customer reviews may remain on Search or Maps/)).toBeInTheDocument()
    expect(screen.queryByText(/Google deletes its reviews/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
    await userEvent.click(await screen.findByRole("button", { name: "Approve lifecycle request" }))
    const confirm = await screen.findByRole("button", { name: "Send approved deletion" })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
    expect(confirm).toBeDisabled()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved lifecycle request to Google." }))
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => {
      const sends = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/execute") && init?.method === "POST")
      expect(sends).toHaveLength(1)
      expect(JSON.parse(String(sends[0][1]?.body))).toEqual({ expectedPayloadHash: "a".repeat(64) })
    })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })

  it("delete-location never wires to the app-side unlink route", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /delete this location/i }))
    await userEvent.click(screen.getByRole("button", { name: "Prepare deletion review" }))
    await waitFor(() => {
      const review = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/administration-lifecycle-reviews") && init?.method === "POST")
      expect(JSON.parse(String(review?.[1]?.body))).toEqual({ operation: "delete_location", payload: {} })
    })
    // The location directory query legitimately reads /api/location-links in
    // the background (unrelated to this action), but nothing about deleting
    // this location may ever issue the app-side soft-unlink DELETE against it.
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => String(u).includes("/api/location-links") && (init as RequestInit)?.method === "DELETE"
      )
    ).toBe(false)
  })

  it("keeps app unlinking distinct and points at Connections", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(
      await screen.findByText(/Unlink this app location under/i)
    ).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /connections/i })
    expect(link).toHaveAttribute("href", "/settings/connections")
  })

  it("remove-administrator requires the typed name and saves an exact review before any send", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /remove manager@camden\.test/i }))
    const confirm = screen.getByRole("button", { name: "Review administrator removal" })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden Hotel")
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/administration-access-reviews") && init?.method === "POST")
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body).toEqual({
        operation: "delete_admin",
        payload: { name: "locations/camden/admins/2" },
      })
    })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })

  it("never offers to remove the primary owner", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await screen.findByText("Primary owner")
    expect(screen.queryByRole("button", { name: /remove owner@camden\.test/i })).not.toBeInTheDocument()
  })

  it("transfer-location reviews an exact destination before approval, typed-name consent and a single send", async () => {
    const fetchMock = stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await userEvent.click(await screen.findByRole("button", { name: /transfer this location/i }))
    const continueButton = screen.getByRole("button", { name: /continue/i })
    expect(continueButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/destination google account/i), "accounts/999")
    expect(continueButton).toBeEnabled()
    await userEvent.click(continueButton)

    expect(await screen.findByText(/can change your management access/)).toBeInTheDocument()
    expect(screen.getByText(/accounts\/999 · MANAGER/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Approve lifecycle request" }))
    const confirm = await screen.findByRole("button", { name: "Send approved transfer" })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Type the listing name: Camden Hotel"), "Camden Hotel")
    expect(confirm).toBeDisabled()
    await userEvent.click(screen.getByRole("checkbox", { name: "Send this exact approved lifecycle request to Google." }))
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => {
      const review = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/administration-lifecycle-reviews") && init?.method === "POST")
      const body = JSON.parse(String(review?.[1]?.body))
      expect(body).toEqual({
        operation: "transfer_location",
        payload: { destinationAccount: "accounts/999" },
      })
    })
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/execute") && init?.method === "POST")).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  })

  it("renders the danger zone as a section <h2> under the area's h1, never a second page heading", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    const heading = await screen.findByRole("heading", { name: /danger zone/i })
    expect(heading.tagName).toBe("H2")
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0)
  })
})

describe("VerificationTab", () => {
  it("answers whether Google trusts the listing, without the access controls", async () => {
    stub({ canEditCanonical: true, canPublish: true })
    renderWithProviders(
      <VerificationTab locationId="loc-1" locationName="Camden Hotel" />
    )
    expect(
      await screen.findByRole("heading", { name: "How Google sees this listing" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Start a new verification" })
    ).toBeInTheDocument()
    // Who may edit the listing is a different question, asked on its own tab.
    expect(screen.queryByText("Primary owner")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /delete this location/i })
    ).not.toBeInTheDocument()
  })
})

describe("AccessTab (roster truthfulness)", () => {
  const lifecycleReviewId = "22222222-2222-4222-8222-222222222222"
  const accessReviewId = "10000000-0000-4000-8000-000000000001"
  const session = { session: { userId: "manager", organisationId: "org", organisationName: "Agency", displayName: "Manager", email: "manager@example.test", role: "owner", canPublish: true } }
  function stubRoster({ administration, lifecycleItems = [], lifecycleAttempt, accessItems = [], accessAttempt }: {
    administration: () => Promise<Response> | Response
    lifecycleItems?: unknown[]; lifecycleAttempt?: unknown
    accessItems?: unknown[]; accessAttempt?: unknown
  }) {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/administration-lifecycle-reviews")) return url.endsWith("/execute") && lifecycleAttempt ? jsonResponse({ attempt: lifecycleAttempt }) : jsonResponse({ items: lifecycleItems, nextCursor: null })
      if (url.includes("/administration-access-workflows")) return jsonResponse({ items: accessItems, nextCursor: null })
      if (url.includes("/administration-access-reviews") && url.endsWith("/execute")) return jsonResponse({ attempt: accessAttempt })
      if (url === "/api/session") return jsonResponse(session)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/administration")) return administration()
      return jsonResponse({ items: [], nextCursor: null })
    })
    vi.stubGlobal("fetch", fetchMock); return fetchMock
  }

  it("shows unavailable counts, not zero, when the Google roster read fails", async () => {
    const failed = { data: null, error: "google_unavailable" }
    stubRoster({ administration: () => jsonResponse({ administration: { ...ADMIN.administration, locationAdmins: failed, accountAdmins: failed, invitations: failed } }) })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("People count unavailable · invitation count unavailable · Google could not be read")).toBeInTheDocument()
    expect(screen.getByText("Count unavailable")).toBeInTheDocument()
    expect(screen.queryByText(/0 people/)).not.toBeInTheDocument()
    expect(screen.queryByText(/0 invitations/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Read from Google/)).not.toBeInTheDocument()
  })

  it("says which part failed when only the invitations read fails", async () => {
    stubRoster({ administration: () => jsonResponse({ administration: { ...ADMIN.administration, invitations: { data: null, error: "google_unavailable" } } }) })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("2 people · invitation count unavailable · Part of this list could not be read from Google")).toBeInTheDocument()
  })

  it("explains a confirmed deletion and disables every access write", async () => {
    stubRoster({
      administration: () => jsonResponse(ADMIN),
      lifecycleItems: [{ reviewId: lifecycleReviewId, createdAt: "2026-09-30T08:00:00.000Z", request: { operation: "delete_location", payload: {} }, attemptId: lifecycleReviewId }],
      lifecycleAttempt: { ...lifecycleAttemptFixture(), reviewId: lifecycleReviewId },
    })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("This location was deleted from Google")).toBeInTheDocument()
    expect(screen.getByText(/may no longer apply/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add administrator/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /remove manager@camden\.test/i })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: /role for manager@camden\.test/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Transfer this location" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Delete this location" })).toBeDisabled()
  })

  it("explains a confirmed transfer that left this account", async () => {
    const transfer = { operation: "transfer_location", payload: { destinationAccount: "accounts/999" } }
    stubRoster({
      administration: () => jsonResponse(ADMIN),
      lifecycleItems: [{ reviewId: lifecycleReviewId, createdAt: "2026-09-30T08:00:00.000Z", request: transfer, attemptId: lifecycleReviewId }],
      lifecycleAttempt: { ...lifecycleAttemptFixture(), reviewId: lifecycleReviewId, request: transfer, operation: "transfer_location", postcondition: "location_transferred_between_accounts" },
    })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText("This location moved to another Google account")).toBeInTheDocument()
    expect(screen.getAllByText(/moved to accounts\/999/).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /remove manager@camden\.test/i })).toBeDisabled()
  })

  it("keeps access writes available after a rejected lifecycle outcome", async () => {
    stubRoster({
      administration: () => jsonResponse(ADMIN),
      lifecycleItems: [{ reviewId: lifecycleReviewId, createdAt: "2026-09-30T08:00:00.000Z", request: { operation: "delete_location", payload: {} }, attemptId: lifecycleReviewId }],
      lifecycleAttempt: { ...lifecycleAttemptFixture(), reviewId: lifecycleReviewId, executionState: "rejected", confirmationState: "unrecorded", postcondition: "unresolved" },
    })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    await waitFor(() => expect(screen.getByRole("button", { name: /remove manager@camden\.test/i })).toBeEnabled())
    expect(screen.queryByText("This location was deleted from Google")).not.toBeInTheDocument()
  })

  it("shows the roster as updating and disables row actions until Google's list after a confirmed change arrives", async () => {
    const request = { operation: "delete_admin", payload: { name: "locations/camden/admins/2" } }
    const confirmed = { id: accessReviewId, reviewId: accessReviewId, payloadHash: "a".repeat(64), request, target: "locations/camden/admins/2", status: "succeeded", executionState: "accepted", confirmationState: "confirmed", idempotent: false, observation: null, postcondition: "administrator_absent", pendingInvitation: null, error: null }
    let reads = 0
    let release: (() => void) | undefined
    const refreshed = new Promise<void>((resolve) => { release = resolve })
    stubRoster({
      administration: async () => {
        reads += 1
        if (reads === 1) return jsonResponse(ADMIN)
        await refreshed
        return jsonResponse({ administration: { ...ADMIN.administration, locationAdmins: available({ admins: [{ admin: "owner@camden.test", role: "PRIMARY_OWNER" }] }) } })
      },
      accessItems: [{ reviewId: accessReviewId, createdAt: "2026-09-30T08:00:00.000Z", request, attemptId: accessReviewId, executionState: "accepted", confirmationState: "confirmed" }],
      accessAttempt: confirmed,
    })
    renderWithProviders(<AccessTab locationId="loc-1" locationName="Camden Hotel" />)
    expect(await screen.findByText(/2 people · 0 invitations · Read from Google at/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole("button", { name: "Open outcome" }))
    expect(await screen.findByText("Reviewed administrator no longer listed")).toBeInTheDocument()
    expect(await screen.findByText(/Updating from Google… Counts refresh/)).toBeInTheDocument()
    expect(screen.queryByText(/2 people/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /remove manager@camden\.test/i })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: /role for manager@camden\.test/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /add administrator/i })).toBeDisabled()
    expect(reads).toBe(2)
    release?.()
    expect(await screen.findByText(/1 person · 0 invitations · Read from Google at/)).toBeInTheDocument()
    expect(screen.queryByText(/Updating from Google/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /remove manager@camden\.test/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add administrator/i })).toBeEnabled()
  })
})

describe("AccessTab partial read recovery", () => {
  it("retries an account-admin failure while keeping listing admins visible", async () => {
    let reads = 0
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/capabilities"))
        return jsonResponse({
          capabilities: { canEditCanonical: true, canPublish: true },
        })
      if (url.includes("/administration")) {
        reads += 1
        return jsonResponse({
          administration: {
            ...ADMIN.administration,
            accountAdmins:
              reads === 1
                ? {
                    data: null,
                    error: "private provider text",
                    failure: "transient",
                  }
                : available({
                    accountAdmins: [
                      { admin: "account@test.invalid", role: "PRIMARY_OWNER" },
                    ],
                  }),
          },
        })
      }
      return jsonResponse({ locations: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    renderWithProviders(
      <AccessTab locationId="loc-1" locationName="Camden Hotel" />
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry account admins" })
    )
    expect(screen.getByText("owner@camden.test")).toBeInTheDocument()
    expect(await screen.findByText("account@test.invalid")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("heading", { name: "Account admins" })).toHaveFocus())
    expect(screen.queryByText("private provider text")).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => !init?.method || init.method === "GET"
      )
    ).toBe(true)
  })

  it.each(["permission_denied", "reconnect_required"])(
    "gives an actionable %s explanation rather than waiting advice",
    async (failure) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) => {
          if (String(input).includes("/capabilities"))
            return jsonResponse({
              capabilities: { canEditCanonical: true, canPublish: true },
            })
          if (String(input).includes("/administration"))
            return jsonResponse({
              administration: {
                ...ADMIN.administration,
                accountAdmins: {
                  data: null,
                  error: "private provider text",
                  failure,
                },
              },
            })
          return jsonResponse({ locations: [] })
        })
      )
      renderWithProviders(
        <AccessTab locationId="loc-1" locationName="Camden Hotel" />
      )
      expect(
        await screen.findByRole("link", { name: "Check Google connections" })
      ).toHaveAttribute("href", "/settings/connections")
      expect(
        screen.queryByText(/refreshing in a moment/i)
      ).not.toBeInTheDocument()
      expect(screen.getByText("owner@camden.test")).toBeInTheDocument()
    }
  )
})

it("keeps successful listing admins visible when the retry request itself fails", async () => {
  let reads = 0
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    if (String(input).includes("/capabilities"))
      return jsonResponse({
        capabilities: { canEditCanonical: true, canPublish: true },
      })
    if (String(input).includes("/administration")) {
      reads += 1
      if (reads > 1) return jsonResponse({ error: "http_error" }, 503)
      return jsonResponse({
        administration: {
          ...ADMIN.administration,
          accountAdmins: {
            data: null,
            error: "private provider text",
            failure: "transient",
          },
        },
      })
    }
    return jsonResponse({ locations: [] })
  })
  vi.stubGlobal("fetch", fetcher)
  renderWithProviders(
    <AccessTab locationId="loc-1" locationName="Camden Hotel" />
  )
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry account admins" })
  )
  expect(
    await screen.findByText(/last loaded details are still shown/i)
  ).toBeInTheDocument()
  expect(screen.getByText("owner@camden.test")).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "Retry account admins" })
  ).toBeEnabled()
  expect(
    fetcher.mock.calls.every(
      ([, init]) => !init?.method || init.method === "GET"
    )
  ).toBe(true)
})
