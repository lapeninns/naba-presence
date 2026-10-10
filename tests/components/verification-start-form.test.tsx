import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { VerificationStartForm } from "@/components/locations/administration/verification-start-form"
import { fetchGoogleVerificationOptions } from "@/lib/api/google-verification-options"
import type { VerificationChoice, VerificationOptionsResponse } from "@/lib/contracts/google-verification-options"
import type { VerificationReviewInput } from "@/lib/contracts/google-verification-review"

vi.mock("@/lib/api/google-verification-options")
const id = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64)
const base: VerificationOptionsResponse = { locationId: id, googleLocationName: "locations/camden", languageCode: "en-GB", customerLocationOnly: false, contextProvided: false, contextHash: hash, checkedAt: "2026-09-30T01:00:00Z", options: [] }
afterEach(() => vi.resetAllMocks())
function fixture(choice: VerificationChoice, customerLocationOnly: boolean | null = false) {
  vi.mocked(fetchGoogleVerificationOptions).mockResolvedValue({ ...base, customerLocationOnly, options: [choice] })
  const preview = vi.fn<(value: VerificationReviewInput) => void>()
  render(<VerificationStartForm locationId={id} blocked={false} busy={false} onPreview={preview} />)
  return preview
}
async function select() {
  await userEvent.click(screen.getByRole("button", { name: "Check available methods" }))
  await userEvent.click(await screen.findByRole("radio"))
}
describe("verification method-specific fields", () => {
  it.each([false, null])("holds the email username fixed when eligibility is %s", async (userNameEditable) => {
    const preview = fixture({ id: hash, kind: "email", method: "EMAIL", user: "fixed", domain: "example.test", userNameEditable })
    await select()
    expect(screen.getByLabelText("Email username")).toHaveAttribute("readonly")
    await userEvent.click(screen.getByRole("button", { name: "Review verification request" }))
    expect(preview).toHaveBeenCalledWith({ optionId: hash, payload: { method: "EMAIL", languageCode: "en-GB", emailAddress: "fixed@example.test" } })
  })
  it.each(["SMS", "PHONE_CALL"] as const)("shows the exact eligible %s destination without an editor", async (method) => {
    const preview = fixture({ id: hash, kind: "phone", method, phoneNumber: "+44 20 1234 5678" })
    await select()
    expect(screen.getByLabelText("Eligible phone destination")).toHaveAttribute("readonly")
    await userEvent.click(screen.getByRole("button", { name: "Review verification request" }))
    expect(preview).toHaveBeenCalledWith({ optionId: hash, payload: { method, languageCode: "en-GB", phoneNumber: "+44 20 1234 5678" } })
  })
  it("requires a postcard contact while showing the offered address and delivery estimate", async () => {
    const preview = fixture({ id: hash, kind: "address", method: "ADDRESS", business: "Camden", address: { regionCode: "GB", addressLines: ["1 Public Street"] }, expectedDeliveryDays: 14 })
    await select()
    expect(screen.getByText(/1 Public Street/)).toBeInTheDocument()
    expect(screen.getByText(/14 days/)).toBeInTheDocument()
    const review = screen.getByRole("button", { name: "Review verification request" }); expect(review).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Postcard contact name"), "Front desk")
    await userEvent.click(review)
    expect(preview).toHaveBeenCalledWith({ optionId: hash, payload: { method: "ADDRESS", languageCode: "en-GB", mailerContact: "Front desk" } })
  })
  it.each([true, null])("requires fresh private context when customer-only eligibility is %s", async (customerLocationOnly) => {
    const preview = fixture({ id: hash, kind: "auto", method: "AUTO" }, customerLocationOnly)
    await select()
    expect(screen.getByRole("button", { name: "Review verification request" })).toBeDisabled()
    await userEvent.click(screen.getByRole("checkbox", { name: "Provide a private service-business address" }))
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Street address"), "2 Private Street")
    await userEvent.type(screen.getByLabelText("Town or city"), "London")
    await userEvent.type(screen.getByLabelText("Postcode"), "NW1 1AA")
    await userEvent.type(screen.getByLabelText("Address recipients"), "Operations")
    await select()
    expect(fetchGoogleVerificationOptions).toHaveBeenLastCalledWith(id, { languageCode: "en-GB", context: { address: { regionCode: "GB", addressLines: ["2 Private Street"], locality: "London", postalCode: "NW1 1AA", recipients: ["Operations"] } } })
    await userEvent.click(screen.getByRole("button", { name: "Review verification request" }))
    expect(preview).toHaveBeenCalledWith({ optionId: hash, payload: { method: "AUTO", languageCode: "en-GB", context: { address: { regionCode: "GB", addressLines: ["2 Private Street"], locality: "London", postalCode: "NW1 1AA", recipients: ["Operations"] } } } })
  })
  it("hands off an external method without a submit control", async () => {
    const preview = fixture({ id: hash, kind: "external", method: "VETTED_PARTNER", reason: "partner_required" })
    await select()
    expect(screen.getByText(/must be completed through Google/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review verification request" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open Google Business Profile" })).toHaveAttribute("href", "https://business.google.com/")
    expect(preview).not.toHaveBeenCalled()
  })
})
