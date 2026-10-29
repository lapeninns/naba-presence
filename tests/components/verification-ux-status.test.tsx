import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VerificationTab } from "@/components/locations/administration/verification-tab"
import { verificationStandingPill } from "@/components/locations/administration/verification-observation"
import { ApiClientError } from "@/lib/api/client"
import { fetchSession } from "@/lib/api/session"
import { fetchLocationCapabilities } from "@/lib/api/locations"
import { fetchGoogleVerificationState } from "@/lib/api/google-verification-state"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import type {
  ObservedMerchantState,
  VerificationStateResponse,
} from "@/lib/contracts/google-verification-state"
import type { SessionResponse } from "@/lib/contracts/session"
import {
  completionLocationId as locationId,
  completionRequest as request,
} from "../helpers/verification-completion"

vi.mock("@/lib/api/session")
vi.mock("@/lib/api/locations")
vi.mock("@/lib/api/google-verification-state")
vi.mock("@/lib/api/google-verification-workflows")
vi.mock("@/lib/api/google-verification-completion-attempt")
vi.mock("@/lib/api/google-verification-completion-reviews")
vi.mock("@/lib/api/google-verification-reviews")
vi.mock("@/lib/api/google-verification-options")

const session: SessionResponse = {
  session: {
    userId: "manager",
    organisationId: "org",
    organisationName: "Agency",
    displayName: "Manager",
    email: "manager@example.test",
    role: "owner",
    canPublish: true,
    workspaceMode: "agency",
  },
}
const merchant = (
  overrides: Partial<ObservedMerchantState> = {}
): ObservedMerchantState => ({
  hasVoiceOfMerchant: false,
  hasBusinessAuthority: true,
  action: "verify",
  hasPendingVerification: false,
  ...overrides,
})
const state = (
  overrides: Partial<VerificationStateResponse> = {}
): VerificationStateResponse => ({
  locationId,
  googleLocationName: "locations/camden",
  checkedAt: "2026-09-30T01:00:00Z",
  verifications: [],
  merchant: merchant(),
  merchantError: null,
  ...overrides,
})

beforeEach(() => {
  vi.mocked(fetchSession).mockResolvedValue(session)
  vi.mocked(fetchLocationCapabilities).mockResolvedValue({
    canEditCanonical: true,
    canPublish: true,
    resources: { administration: { state: "available" } },
  })
  vi.mocked(fetchGoogleVerificationState).mockResolvedValue(state())
  vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({
    workflows: [],
    nextCursor: null,
  })
})
afterEach(() => vi.resetAllMocks())

function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <VerificationTab locationId={locationId} locationName="Camden Hotel" />
    </QueryClientProvider>
  )
}
const precedes = (first: HTMLElement, second: HTMLElement) =>
  Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
  )

describe("verification status pill", () => {
  it.each([
    [
      "Google says verified",
      merchant({ hasVoiceOfMerchant: true, action: "none" }),
      "Verified",
      "healthy",
    ],
    [
      "Google says not verified, request pending",
      merchant({ hasPendingVerification: true }),
      "In progress",
      "pending",
    ],
    [
      "Google says not verified and asks to wait",
      merchant({ action: "wait" }),
      "In progress",
      "pending",
    ],
    ["Google says not verified", merchant(), "Not verified", "attention"],
    [
      "Google did not report the answer",
      merchant({ hasVoiceOfMerchant: null, action: "unknown" }),
      "Unknown",
      "neutral",
    ],
    ["Google's standing could not be read", null, "Unknown", "neutral"],
  ] as const)("maps %s to %s", (_case, value, label, tone) => {
    expect(verificationStandingPill(value)).toEqual({ label, tone })
  })
  it.each([merchant({ hasVoiceOfMerchant: null, action: "unknown" }), null])(
    "never says Not verified when Google gave no answer (%#)",
    async (value) => {
      vi.mocked(fetchGoogleVerificationState).mockResolvedValue(
        state({
          merchant: value,
          merchantError: value
            ? null
            : "verification_merchant_state_unavailable",
        })
      )
      fixture()
      await screen.findByText("Verification status is unknown")
      const status = screen.getByRole("region", {
        name: "How Google sees this listing",
      })
      expect(
        within(status).getByText("Unknown", { exact: true })
      ).toBeInTheDocument()
      expect(
        screen.queryByText("Not verified", { exact: true })
      ).not.toBeInTheDocument()
    }
  )
  it("re-checks Google from the card with one tap", async () => {
    vi.mocked(fetchGoogleVerificationState).mockResolvedValue(
      state({
        merchant: merchant({ hasVoiceOfMerchant: true, action: "none" }),
      })
    )
    fixture()
    await screen.findByText(
      "Verified. Google confirms you manage this listing."
    )
    expect(
      within(
        screen.getByRole("region", { name: "How Google sees this listing" })
      ).getByText("Verified", { exact: true })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Check again" }))
    await waitFor(() =>
      expect(fetchGoogleVerificationState).toHaveBeenCalledTimes(2)
    )
  })
})

describe("verification read failures and loading", () => {
  it("offers a reconnect and a retry inside the one error, and claims nothing about PIN requests", async () => {
    vi.mocked(fetchGoogleVerificationState).mockRejectedValue(
      new ApiClientError(
        409,
        "google_reconnect_required",
        "private provider echo"
      )
    )
    fixture()
    await screen.findByText("Current Google state could not be read")
    expect(
      screen.getByText(
        /Google access has expired\. Reconnect the account, then check again\./
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/This does not mean the listing is unverified/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Changes stay paused until Google can be read/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Reconnect Google" })
    ).toHaveAttribute("href", "/settings/connections")
    // One message for one cause: no paused banner, no "no PIN request" claim, no second refresh warning.
    expect(
      screen.queryByText("Verification changes are paused")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Google has no PIN request waiting/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/Google’s PIN requests can’t be read right now/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Not verified", { exact: true })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("private provider echo")).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Check Google again" })
    )
    await waitFor(() =>
      expect(fetchGoogleVerificationState).toHaveBeenCalledTimes(2)
    )
  })
  it("keeps the paused banner for a permissions cause, once", async () => {
    vi.mocked(fetchLocationCapabilities).mockRejectedValue(
      new Error("private echo")
    )
    fixture()
    await screen.findByRole("button", {
      name: "Check publishing permissions again",
    })
    expect(screen.getAllByText("Verification changes are paused")).toHaveLength(
      1
    )
  })
  it("stays neutral while Google is being read, with sends still blocked", async () => {
    vi.mocked(fetchGoogleVerificationState).mockReturnValue(
      new Promise(() => {})
    )
    fixture()
    expect(
      await screen.findByText("Reading current verification state from Google…")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Reading PIN requests from Google…")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Verification changes are paused")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Google has no PIN request waiting/)
    ).not.toBeInTheDocument()
    // The gate itself is unchanged: the start form cannot review or send yet.
    expect(
      (
        await screen.findAllByText(
          /Check current Google verification state before reviewing or sending a request/
        )
      ).length
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText("Verification changes are paused")
    ).not.toBeInTheDocument()
  })
})

describe("next step for an unverified listing", () => {
  it("puts Start a new verification right after the answer when Google asks for it and nothing is pending", async () => {
    fixture()
    await screen.findByText(
      "Google hasn't yet confirmed you can manage this listing"
    )
    const start = screen.getByRole("region", {
      name: "Start a new verification",
    })
    const pin = screen.getByRole("region", { name: "PINs and saved reviews" })
    expect(
      precedes(
        screen.getByRole("region", { name: "How Google sees this listing" }),
        start
      )
    ).toBe(true)
    expect(precedes(start, pin)).toBe(true)
    expect(
      screen.getByText("Not verified", { exact: true })
    ).toBeInTheDocument()
  })
  it("keeps the PIN tools first while a request is pending", async () => {
    vi.mocked(fetchGoogleVerificationState).mockResolvedValue(
      state({
        verifications: [request],
        merchant: merchant({ hasPendingVerification: true }),
      })
    )
    fixture()
    const pin = await screen.findByRole("region", {
      name: "Enter the PIN from Google",
    })
    expect(
      precedes(
        pin,
        screen.getByRole("region", { name: "Start a new verification" })
      )
    ).toBe(true)
    expect(
      screen.getByText(
        /A verification request is already pending\. Enter its PIN or check it before starting another\./
      )
    ).toBeInTheDocument()
  })
  it("tells a verified listing up front that Google would refuse a new request", async () => {
    vi.mocked(fetchGoogleVerificationState).mockResolvedValue(
      state({
        merchant: merchant({ hasVoiceOfMerchant: true, action: "none" }),
      })
    )
    fixture()
    await screen.findByText(
      "Verified. Google confirms you manage this listing."
    )
    const start = screen.getByRole("region", {
      name: "Start a new verification",
    })
    expect(
      within(start).getByText(
        "Google already confirms you manage this listing, so it would refuse a new verification request."
      )
    ).toBeInTheDocument()
    expect(
      within(start).getByRole("button", { name: "Check available methods" })
    ).toBeEnabled()
  })
})
