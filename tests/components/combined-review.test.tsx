import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps, ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  combinedReviewNote,
  combinedRowResults,
  CombinedReviewSheet,
  type CombinedReviewRow,
} from "@/components/reviewed-write/combined-review"
import { Toaster } from "@/components/ui/toast"
import type { PublishStepResult } from "@/lib/editors/use-publish-flow"

const here = (field: string, noun?: string): CombinedReviewRow => ({
  key: `profile-${field}`,
  field,
  noun,
  before: "a",
  after: "b",
  route: "here",
  steps: ["save", "profile"],
})
const google = (field: string, waits = false, step = "listing"): CombinedReviewRow => ({
  key: `${step}-${field}`,
  field,
  before: "a",
  after: "b",
  route: "google",
  steps: [step],
  waitsForApprover: waits,
})

describe("combinedReviewNote", () => {
  it("says which changes save here first and which go to Google, from what is in the sheet", () => {
    expect(
      combinedReviewNote([
        here("Business name", "name"),
        here("Phone", "phone"),
        google("Primary category"),
      ])
    ).toBe(
      "Name and phone save here first, then go to Google with the primary category when you publish."
    )
  })

  it("covers a sheet of one kind only", () => {
    expect(combinedReviewNote([here("Business name", "name")])).toBe(
      "Name saves here first, then goes to Google when you publish."
    )
    expect(combinedReviewNote([google("Store code"), google("Labels")])).toBe(
      "Store code and labels go to Google when you publish."
    )
    expect(combinedReviewNote([])).toBeNull()
  })

  it("keeps a label's own capitals and shortens a long list", () => {
    expect(
      combinedReviewNote([
        google("Wi-Fi", false, "attributes"),
        google("Store code"),
        google("Labels"),
        google("Locality"),
        google("Postcode"),
      ])
    ).toBe("Wi-Fi, store code, labels and 2 more go to Google when you publish.")
  })

  it("never implies the copy fields stay off Google", () => {
    const note = combinedReviewNote([here("Business name", "name"), google("Store code")])
    expect(note).toBe(
      "Name saves here first, then goes to Google with the store code when you publish."
    )
  })

  it("promises no save or send while a request needs a different authorised user", () => {
    const note = combinedReviewNote([here("Business name", "name"), google("Store code", true)])
    expect(note).toBe(
      "The store code needs a different authorised user to approve it before anything is sent."
    )
    expect(note).not.toMatch(/save|another publisher|straight|No draft|reviewed, then/i)
    expect(
      combinedReviewNote([google("Store code", true), google("Wi-Fi", true, "attributes")])
    ).toBe("The store code and Wi-Fi need a different authorised user to approve them before anything is sent.")
  })
})

const step = (key: string, extra: Partial<PublishStepResult>): PublishStepResult => ({
  key,
  label: key,
  status: "pending",
  kind: key === "save" ? "local" : "google",
  verified: true,
  ...extra,
})

describe("combinedRowResults", () => {
  const rows = [here("Business name", "name"), google("Store code"), google("Wi-Fi", false, "attributes")]

  it("shows nothing before publishing", () => {
    expect(combinedRowResults(rows, [])).toEqual([])
  })

  it("gives each row the outcome of the steps that carry it", () => {
    const views = combinedRowResults(rows, [
      step("listing", { status: "done" }),
      step("save", { status: "done" }),
      step("profile", { status: "done" }),
      step("attributes", { status: "failed", outcome: "rejected", message: "Google refused it.", code: "PERMISSION_DENIED" }),
    ])
    expect(views.map((view) => [view.label, view.state])).toEqual([
      ["Business name", "confirmed_applied"],
      ["Store code", "confirmed_applied"],
      ["Wi-Fi", "rejected"],
    ])
    expect(views[2]?.errorCode).toBe("PERMISSION_DENIED")
  })

  it("says a saved-here row stopped short of Google when its publish never ran", () => {
    const views = combinedRowResults(rows, [
      step("listing", { status: "failed", outcome: "failed", message: "Couldn't send." }),
      step("save", {}),
      step("profile", {}),
      step("attributes", {}),
    ])
    expect(views[0]).toMatchObject({ state: "skipped", stateLabel: "Not sent — an earlier step failed" })
    expect(views[1]).toMatchObject({ state: "failed" })

    const later = combinedRowResults(rows, [
      step("listing", { status: "done" }),
      step("save", { status: "done" }),
      step("profile", { status: "failed", outcome: "failed", message: "Couldn't send." }),
      step("attributes", {}),
    ])
    expect(later[0]).toMatchObject({ state: "failed", detail: "Saved here. Couldn't send." })
    expect(later[2]).toMatchObject({ state: "skipped" })
  })

  it("shows a publish the server held for approval as awaiting approval with its reason, not sent", () => {
    const views = combinedRowResults([here("Business name", "name")], [
      step("save", { status: "done" }),
      step("profile", {
        status: "done",
        outcome: "awaiting_approval",
        message: "Sent for approval. Another publisher needs to approve this change before it goes to Google.",
      }),
    ])
    expect(views[0]).toMatchObject({ state: "awaiting_approval" })
    expect(String(views[0]?.detail)).toMatch(/Another publisher needs to approve/)
  })

  it("adds a step that carries no row only when it did something or failed", () => {
    const quiet = combinedRowResults([google("Store code")], [
      step("listing", { status: "done" }),
      step("profile", { status: "done", noop: true }),
    ])
    expect(quiet).toHaveLength(1)
    const loud = combinedRowResults([google("Store code")], [
      step("listing", { status: "done" }),
      step("profile", { status: "failed", message: "Stale." }),
    ])
    expect(loud.map((view) => view.label)).toEqual(["Store code", "profile"])
  })
})

/**
 * The safety gates the sheet shares with the editors' review sheet
 * (tests/components/publish-flow.test.tsx, ReviewChangesSheet).
 */
describe("CombinedReviewSheet gates", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderSheet(props: Partial<ComponentProps<typeof CombinedReviewSheet>>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <Toaster>{children}</Toaster>
      </QueryClientProvider>
    )
    const base = {
      open: true,
      onOpenChange: () => {},
      rows: [here("Phone", "phone")],
      locationName: "Old Crown",
      onPublish: vi.fn(),
    }
    const view = render(<CombinedReviewSheet {...base} {...props} />, { wrapper: Wrapper })
    return {
      ...view,
      rerenderSheet: (next: Partial<ComponentProps<typeof CombinedReviewSheet>>) =>
        view.rerender(<CombinedReviewSheet {...base} {...props} {...next} />),
    }
  }

  const conflict = (field: string, noun: string): CombinedReviewRow => ({
    ...here(field, noun),
    before: "01223 277 217",
    after: "01223 277 218",
    state: "conflict",
  })

  it("will not publish over Google's change until that is acknowledged", async () => {
    const user = userEvent.setup()
    const publish = vi.fn()
    renderSheet({ rows: [conflict("Phone", "phone")], onPublish: publish })
    const sheet = await screen.findByRole("dialog", { name: "Review changes" })
    const button = within(sheet).getByRole("button", { name: "Publish to Google" })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(publish).not.toHaveBeenCalled()

    await user.click(within(sheet).getByRole("checkbox"))
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it("asks again after the sheet reopens", async () => {
    const user = userEvent.setup()
    const { rerenderSheet } = renderSheet({ rows: [conflict("Phone", "phone")] })
    const sheet = await screen.findByRole("dialog", { name: "Review changes" })
    await user.click(within(sheet).getByRole("checkbox"))
    await waitFor(() =>
      expect(within(sheet).getByRole("button", { name: "Publish to Google" })).toBeEnabled()
    )

    rerenderSheet({ open: false })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull())
    rerenderSheet({ open: true })
    const again = await screen.findByRole("dialog", { name: "Review changes" })
    expect(within(again).getByRole("checkbox")).not.toBeChecked()
    expect(within(again).getByRole("button", { name: "Publish to Google" })).toBeDisabled()
  })

  it("asks again when a different change would overwrite Google", async () => {
    const user = userEvent.setup()
    const { rerenderSheet } = renderSheet({ rows: [conflict("Phone", "phone")] })
    const sheet = await screen.findByRole("dialog", { name: "Review changes" })
    await user.click(within(sheet).getByRole("checkbox"))
    await waitFor(() =>
      expect(within(sheet).getByRole("button", { name: "Publish to Google" })).toBeEnabled()
    )

    rerenderSheet({ rows: [conflict("Phone", "phone"), conflict("Website", "website")] })
    await waitFor(() =>
      expect(within(sheet).getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    )
    expect(within(sheet).getByRole("checkbox")).not.toBeChecked()
  })

  it("blocks an unresolved comparison and says why, without claiming a concurrent edit", async () => {
    renderSheet({
      rows: [
        {
          ...google("Soup"),
          before: "A, B",
          after: "C, D",
          blocking: true,
          explanation: "These entries cannot be matched reliably.",
        },
      ],
    })
    const sheet = await screen.findByRole("dialog", { name: "Review changes" })
    expect(within(sheet).getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(within(sheet).getByText("These entries cannot be matched reliably.")).toBeInTheDocument()
    expect(within(sheet).queryByText(/after you started editing/)).toBeNull()
  })

  it("keeps an unconfirmed outcome visible and prevents immediate resubmission", async () => {
    const user = userEvent.setup()
    const publish = vi.fn()
    renderSheet({
      rows: [google("Opening date"), google("Wi-Fi", false, "attributes")],
      onPublish: publish,
      error: "Check Activity before publishing again.",
      results: [
        step("listing", { status: "failed", code: "google_confirmation_required" }),
        step("attributes", {}),
      ],
    })
    const sheet = await screen.findByRole("dialog", { name: "Review changes" })
    expect(within(sheet).getByText("Not confirmed")).toBeInTheDocument()
    expect(
      within(sheet).getByText("Not sent — an earlier step needs confirmation")
    ).toBeInTheDocument()
    const retry = within(sheet).getByRole("button", { name: "Try again" })
    expect(retry).toBeDisabled()
    await user.click(retry)
    expect(publish).not.toHaveBeenCalled()
  })

  it("shows the receipt of a Google step whose answer was lost, and none for a local save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      )
    )
    const { rerenderSheet } = renderSheet({
      rows: [google("Store code")],
      error: "We couldn’t tell whether Google applied it.",
      results: [
        step("listing", { status: "failed", outcome: "uncertain", intentId: "intent-lost" }),
      ],
    })
    const sheet = await screen.findByRole("dialog", { name: "Review changes" })
    expect(sheet.querySelector('[data-receipt-id="intent-lost"]')).not.toBeNull()

    rerenderSheet({
      rows: [here("Phone", "phone")],
      results: [
        step("save", { status: "failed", outcome: "uncertain", intentId: "intent-local" }),
        step("profile", {}),
      ],
    })
    await waitFor(() => expect(sheet.querySelector("[data-receipt-id]")).toBeNull())
  })
})
