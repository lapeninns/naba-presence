import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PrivacyExportCard } from "@/components/settings/privacy-export-card"
import { Toaster } from "@/components/ui/toast"
import * as privacyApi from "@/lib/api/privacy"

afterEach(() => vi.restoreAllMocks())

describe("PrivacyExportCard", () => {
  it("exports the entered subject reference", async () => {
    const spy = vi.spyOn(privacyApi, "exportPrivacyData").mockResolvedValue()
    render(<Toaster><PrivacyExportCard /></Toaster>)
    fireEvent.change(screen.getByRole("textbox", { name: "Subject reference" }), { target: { value: "guest-4821" } })
    fireEvent.click(screen.getByRole("button", { name: "Download export" }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith("guest-4821"))
  })

  it("surfaces a not-found error without showing the code", async () => {
    const { ApiClientError } = await import("@/lib/api/client")
    vi.spyOn(privacyApi, "exportPrivacyData").mockRejectedValue(new ApiClientError(404, "privacy_subject_not_found", "x"))
    render(<Toaster><PrivacyExportCard /></Toaster>)
    fireEvent.change(screen.getByRole("textbox", { name: "Subject reference" }), { target: { value: "nobody" } })
    fireEvent.click(screen.getByRole("button", { name: "Download export" }))
    expect(await screen.findByText("No records matched that reference.")).toBeInTheDocument()
    expect(screen.queryByText(/privacy_subject_not_found/)).not.toBeInTheDocument()
  })
})
