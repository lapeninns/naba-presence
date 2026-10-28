import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AdministrationProvider } from "@/components/locations/administration/context"
import { verificationActionMessage } from "@/components/locations/administration/use-verification-action"
import { ReviewedCompletionVerification } from "@/components/locations/administration/verification-completion"
import { verificationPinHint } from "@/components/locations/administration/verification-pin-field"
import { savedWorkflowStage } from "@/components/locations/administration/verification-saved-workflows"
import { VerificationStartForm } from "@/components/locations/administration/verification-start-form"
import { ApiClientError } from "@/lib/api/client"
import {
  approveGoogleVerificationCompletion,
  previewGoogleVerificationCompletion,
} from "@/lib/api/google-verification-completion-reviews"
import { fetchGoogleVerificationOptions } from "@/lib/api/google-verification-options"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import type { ObservedVerification } from "@/lib/contracts/google-verification-state"
import {
  completionLocationId as locationId,
  completionRequest as request,
  completionReview as review,
  completionWorkflow as workflow,
} from "../helpers/verification-completion"

vi.mock("@/lib/api/google-verification-completion-reviews")
vi.mock("@/lib/api/google-verification-completion-attempt")
vi.mock("@/lib/api/google-verification-workflows")
vi.mock("@/lib/api/google-verification-state")
vi.mock("@/lib/api/google-verification-options")

beforeEach(() => {
  vi.mocked(previewGoogleVerificationCompletion).mockResolvedValue(review)
  vi.mocked(approveGoogleVerificationCompletion).mockResolvedValue({
    ...review,
    changeSet: { ...review.changeSet, approvedBy: locationId },
  })
  vi.mocked(fetchGoogleVerificationWorkflows).mockResolvedValue({
    workflows: [],
    nextCursor: null,
  })
})
afterEach(() => vi.resetAllMocks())

function completion(
  verifications: readonly ObservedVerification[] = [request]
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdministrationProvider
        locationId={locationId}
        locationName="Camden Hotel"
        disabled={false}
        publishReason={null}
      >
        <ReviewedCompletionVerification verifications={verifications} />
      </AdministrationProvider>
    </QueryClientProvider>
  )
}
async function preview() {
  await userEvent.type(screen.getByLabelText("PIN from Google"), "001234")
  await userEvent.click(
    screen.getByRole("button", { name: "Review PIN completion" })
  )
  await screen.findByRole("button", { name: "Approve PIN completion" })
}

describe("verification action messages", () => {
  it.each([
    [
      "verification_not_required",
      "Google already confirms you manage this listing. No new request is needed.",
    ],
    [
      "verification_already_pending",
      "A verification request is already pending with Google. Enter its PIN or check it first.",
    ],
    [
      "verification_state_unknown",
      "Google hasn’t said a new verification can start here. Check Google’s current state, or continue in Google Business Profile.",
    ],
    [
      "verification_in_progress",
      "Another verification request is being checked or sent. Check its saved status.",
    ],
    [
      "verification_context_required",
      "Add the private service-business address, then check methods again.",
    ],
    [
      "mfa_enrollment_required",
      "Set up two-step verification to approve or send verification requests.",
    ],
  ])("says what %s means", (code, message) => {
    expect(
      verificationActionMessage(
        new ApiClientError(409, code, "private provider echo"),
        "start"
      )
    ).toBe(message)
  })
  it("asks for the two-step code, and for the PIN again on a PIN send", () => {
    const error = new ApiClientError(
      403,
      "mfa_step_up_required",
      "private provider echo"
    )
    expect(verificationActionMessage(error, "start")).toBe(
      "Confirm it’s you with two-step verification, then try this action again."
    )
    expect(verificationActionMessage(error, "complete")).toBe(
      "Confirm it’s you with two-step verification, then try again. If you were sending, type the PIN again."
    )
  })
  it("keeps the existing fallbacks", () => {
    expect(
      verificationActionMessage(
        new ApiClientError(500, "internal", "echo"),
        "start"
      )
    ).toMatch(/^This action could not finish/)
    expect(
      verificationActionMessage(
        new ApiClientError(404, "not_found", "echo"),
        "start"
      )
    ).toMatch(/^No saved outcome is available yet/)
    expect(
      verificationActionMessage(new TypeError("lost"), "complete")
    ).toMatch(/^The action response could not be read/)
  })
  it("shows the step-up copy, not a generic failure, when approval needs two-step verification", async () => {
    vi.mocked(approveGoogleVerificationCompletion).mockRejectedValue(
      new ApiClientError(403, "mfa_step_up_required", "private provider echo")
    )
    completion()
    await preview()
    await userEvent.click(
      screen.getByRole("button", { name: "Approve PIN completion" })
    )
    expect(
      await screen.findByText(/^Confirm it’s you with two-step verification/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/could not finish/)).not.toBeInTheDocument()
    expect(screen.queryByText("private provider echo")).not.toBeInTheDocument()
  })
})

describe("PIN completion copy and hierarchy", () => {
  it.each([
    ["EMAIL", "Enter the code from Google’s email."],
    ["SMS", "Enter the code from Google’s text message."],
    ["PHONE_CALL", "Enter the code from Google’s phone call."],
    ["ADDRESS", "Enter the code from Google’s postcard."],
    [null, "Enter the code Google sent you."],
  ])("tells the %s recipient where the PIN is", (method, lead) => {
    expect(verificationPinHint(method)).toBe(
      `${lead} Leading zeros count. The PIN isn’t saved, so you’ll type it again to send.`
    )
  })
  it("hints where the pending request's PIN arrived, with the label unchanged", () => {
    completion()
    expect(
      screen.getByLabelText("PIN from Google")
    ).toHaveAccessibleDescription(
      /^Enter the code from Google’s text message\./
    )
  })
  it("never says no PIN request is waiting before Google has been read", () => {
    completion([])
    expect(
      screen.queryByText(/Google has no PIN request waiting/)
    ).not.toBeInTheDocument()
  })
  it("offers the saved-outcome check only once a review is approved", async () => {
    completion()
    await preview()
    expect(
      screen.getByText(
        "Approving doesn’t send anything. To send, someone with the PIN Google sent types it again. It isn’t saved here."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Approve this PIN completion before sending it to Google."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Check saved PIN outcome" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Refresh this review" })
    ).toBeEnabled()
    await userEvent.click(
      screen.getByRole("button", { name: "Approve PIN completion" })
    )
    await screen.findByLabelText("Re-enter reviewed PIN")
    expect(
      screen.getByText("This PIN completion is approved.")
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText("Re-enter reviewed PIN")
    ).toHaveAccessibleDescription(
      /Type the same PIN again\. A different PIN needs a new review and approval\./
    )
    expect(
      screen.getByRole("button", { name: "Check saved PIN outcome" })
    ).toBeEnabled()
  })
  it("tells a second approver that the sender needs the PIN", async () => {
    vi.mocked(previewGoogleVerificationCompletion).mockResolvedValue({
      ...review,
      changeSet: {
        ...review.changeSet,
        requiresSecondApprover: true,
        canApprove: false,
      },
    })
    completion()
    await preview()
    expect(
      screen.getByText(
        /^A different authorised owner or admin must approve this request\. They’ll find it under Saved PIN completions, and whoever sends needs the PIN\.$/
      )
    ).toBeInTheDocument()
  })
})

describe("saved workflow stage", () => {
  const flags = { expired: false, lostSend: false, invalidated: false }
  it("names who acts next on a two-person review this viewer cannot approve", () => {
    expect(
      savedWorkflowStage(
        { ...workflow, requiresSecondApprover: true, canApprove: false },
        flags
      )
    ).toBe("Waiting for another manager")
  })
  it("keeps the other stages as they were", () => {
    expect(
      savedWorkflowStage(
        { ...workflow, requiresSecondApprover: true, canApprove: true },
        flags
      )
    ).toBe("Awaiting approval")
    expect(savedWorkflowStage(workflow, flags)).toBe("Awaiting approval")
    expect(
      savedWorkflowStage(
        {
          ...workflow,
          approvedBy: locationId,
          requiresSecondApprover: true,
          canApprove: false,
        },
        flags
      )
    ).toBe("Approved review")
    expect(
      savedWorkflowStage(
        { ...workflow, requiresSecondApprover: true, canApprove: false },
        { ...flags, expired: true }
      )
    ).toBe("Review expired")
  })
})

describe("start form errors and reasons", () => {
  const hash = "a".repeat(64)
  function startForm(standing: "verified" | "pending" | null = null) {
    vi.mocked(fetchGoogleVerificationOptions).mockResolvedValue({
      locationId,
      googleLocationName: "locations/camden",
      languageCode: "en-GB",
      customerLocationOnly: false,
      contextProvided: false,
      contextHash: hash,
      checkedAt: "2026-09-30T01:00:00Z",
      options: [
        {
          id: hash,
          kind: "address",
          method: "ADDRESS",
          business: "Camden",
          address: { regionCode: "GB", addressLines: ["1 Public Street"] },
          expectedDeliveryDays: 14,
        },
      ],
    })
    const onPreview = vi.fn()
    render(
      <VerificationStartForm
        locationId={locationId}
        blocked={false}
        busy={false}
        standing={standing}
        onPreview={onPreview}
      />
    )
    return onPreview
  }
  it("explains a disabled Review beside it and marks the empty postcard contact after it is left", async () => {
    startForm()
    await userEvent.click(
      screen.getByRole("button", { name: "Check available methods" })
    )
    await userEvent.click(await screen.findByRole("radio"))
    const review = screen.getByRole("button", {
      name: "Review verification request",
    })
    expect(review).toBeDisabled()
    expect(review).toHaveAccessibleDescription(
      "Enter who should receive the postcard."
    )
    const contact = screen.getByLabelText("Postcard contact name")
    expect(contact).not.toHaveAttribute("aria-invalid")
    await userEvent.click(contact)
    await userEvent.tab()
    expect(contact).toHaveAttribute("aria-invalid", "true")
    expect(contact).toHaveAccessibleDescription(
      /Enter who should receive the postcard\./
    )
    await userEvent.type(contact, "Front desk")
    expect(contact).not.toHaveAttribute("aria-invalid")
    expect(review).toBeEnabled()
    expect(review).not.toHaveAttribute("aria-describedby")
  })
  it("names the address field that blocks the methods check", async () => {
    startForm()
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "Provide a private service-business address",
      })
    )
    const check = screen.getByRole("button", {
      name: "Check available methods",
    })
    expect(check).toBeDisabled()
    expect(check).toHaveAccessibleDescription(
      "Enter the first line of the address before checking methods."
    )
    const street = screen.getByLabelText("Street address")
    expect(street).not.toHaveAttribute("aria-invalid")
    await userEvent.click(street)
    await userEvent.tab()
    expect(street).toHaveAttribute("aria-invalid", "true")
    await userEvent.type(street, "2 Private Street")
    expect(check).toBeEnabled()
  })
  it("names an invalid language tag after the field is left", async () => {
    startForm()
    const language = screen.getByLabelText("Verification language")
    await userEvent.clear(language)
    await userEvent.type(language, "1")
    await userEvent.tab()
    expect(language).toHaveAttribute("aria-invalid", "true")
    expect(language).toHaveAccessibleDescription(
      /Enter a language tag such as en-GB\./
    )
    expect(
      screen.getByRole("button", { name: "Check available methods" })
    ).toHaveAccessibleDescription(
      "Enter a language tag such as en-GB before checking methods."
    )
  })
  it("warns a verified listing without disabling discovery or Review", async () => {
    const onPreview = startForm("verified")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Google already confirms you manage this listing, so it would refuse a new verification request."
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Check available methods" })
    )
    await userEvent.click(await screen.findByRole("radio"))
    await userEvent.type(
      screen.getByLabelText("Postcard contact name"),
      "Front desk"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Review verification request" })
    )
    expect(onPreview).toHaveBeenCalledOnce()
  })
})
