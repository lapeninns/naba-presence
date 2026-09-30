import { useState } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ChangeDiff,
  changeDiffLabels,
  outcomePhase,
  ReviewTime,
} from "@/components/editors/change-diff"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { PlaceActionApprovalSheet } from "@/components/locations/place-actions/place-action-approval-sheet"
import { LodgingReview } from "@/components/locations/profile/sections/lodging-review"
import { modalFooterClearance } from "@/components/ui/toast"
import { serviceReviewRows } from "@/components/locations/profile/sections/service-workspace"
import type { usePlaceActionReview } from "@/components/locations/place-actions/use-place-action-review"
import { renderWithProviders } from "../helpers/render"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const headers = () =>
  screen.getAllByRole("columnheader").map((cell) => cell.textContent)

describe("ChangeDiff column labels follow the outcome", () => {
  const rows = [{ field: "Pets allowed", before: "No", after: "Yes" }]

  it("claims Google's current value only before anything is sent", () => {
    render(<ChangeDiff rows={rows} caption="Review" />)
    expect(headers()).toEqual(["Field", "On Google now", "After publishing"])
  })

  it("labels a recorded request as the reviewed baseline and what was sent", () => {
    render(<ChangeDiff rows={rows} caption="Sent" phase="sent" />)
    expect(headers()).toEqual(["Field", "Before (reviewed)", "Sent"])
    expect(screen.queryByText("On Google now")).not.toBeInTheDocument()
    // Stacked mobile cells carry the same honest labels.
    const cells = screen.getAllByRole("cell")
    expect(cells.map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Before (reviewed)",
      "Sent",
    ])
  })

  it("dates the confirmed value once independently observed", () => {
    render(
      <ChangeDiff
        rows={rows}
        caption="Confirmed"
        phase="confirmed"
        confirmedAt="2026-09-30T10:01:00Z"
      />
    )
    const [, before, after] = headers()
    expect(before).toBe("Before")
    expect(after).toMatch(/^Now on Google \(confirmed 30 Sep.*\)$/)
    expect(after).not.toContain("2026-09-30T")
    expect(screen.getAllByRole("cell")[1]).toHaveAttribute("data-label", after)
  })

  it("derives the phase from a saved outcome", () => {
    expect(outcomePhase(null)).toBe("review")
    expect(outcomePhase(null, true)).toBe("sent")
    expect(outcomePhase({ confirmationState: "unresolved" })).toBe("sent")
    expect(outcomePhase({ confirmationState: "confirmed" })).toBe("confirmed")
    expect(changeDiffLabels("confirmed").afterLabel).toBe(
      "Now on Google (confirmed)"
    )
  })
})

describe("ChangeDiff unchanged rows", () => {
  it("shows an unchanged row once, neutral, as No change", () => {
    render(
      <ChangeDiff
        caption="Preferred"
        rows={[
          {
            field: "Link",
            before: "https://shop.example.test/second",
            after: "https://shop.example.test/second",
          },
          { field: "Preferred", before: "No", after: "Yes" },
        ]}
      />
    )
    const link = screen.getByRole("rowheader", { name: "Link" }).closest("tr")!
    expect(link).toHaveAttribute("data-state", "unchanged")
    expect(
      within(link).getAllByText("https://shop.example.test/second")
    ).toHaveLength(1)
    expect(within(link).getByText("No change")).toBeInTheDocument()
    expect(link.querySelector("del, ins")).toBeNull()
    const preferred = screen
      .getByRole("rowheader", { name: "Preferred" })
      .closest("tr")!
    expect(preferred).toHaveAttribute("data-state", "changed")
    expect(preferred.querySelector("del")).toHaveTextContent("No")
    expect(preferred.querySelector("ins")).toHaveTextContent("Yes")
  })
})

describe("ReviewTime", () => {
  it("shows local, readable time and keeps the machine value", () => {
    render(
      <p>
        Expires <ReviewTime value="2026-09-30T18:49:25.314657Z" />
      </p>
    )
    const time = document.querySelector("time")!
    expect(time).toHaveAttribute("dateTime", "2026-09-30T18:49:25.314657Z")
    expect(time.textContent).toMatch(/^30 Sep.*, \d{2}:\d{2}$/)
    expect(screen.queryByText(/2026-09-30T/)).not.toBeInTheDocument()
  })
})

describe("ReviewChangesSheet", () => {
  it("stops calling the old value 'On Google now' once a Google request was sent", () => {
    const props = {
      open: true,
      onOpenChange: () => {},
      rows: [
        { field: "Phone", before: "01223 000 000", after: "01223 277 217" },
      ],
      locationName: "Fixture",
      onPublish: () => {},
    }
    const { rerender } = render(<ReviewChangesSheet {...props} />)
    expect(headers()).toContain("On Google now")
    rerender(
      <ReviewChangesSheet
        {...props}
        results={[
          {
            key: "google",
            label: "Business details",
            status: "done",
            kind: "google",
          },
        ]}
      />
    )
    expect(headers()).toEqual(["Field", "Before (reviewed)", "Sent"])
  })
})

describe("action link approval diff", () => {
  it("renders the untouched link and type of a make-preferred change as unchanged", () => {
    const link = {
      name: "locations/fixture/placeActionLinks/2",
      uri: "https://shop.example.test/second",
      placeActionType: "SHOP_ONLINE",
      isPreferred: false,
      providerType: "MERCHANT",
      isEditable: true,
      createTime: null,
      updateTime: null,
    }
    const request = {
      operation: "update",
      name: link.name,
      payload: {
        uri: link.uri,
        placeActionType: "SHOP_ONLINE",
        isPreferred: true,
      },
    }
    const workflow = {
      open: true,
      setOpen: () => {},
      busy: false,
      stale: false,
      unresolved: false,
      uncertain: false,
      error: null,
      revision: 0,
      outcome: {
        executionState: "accepted",
        confirmationState: "confirmed",
        observedAt: "2026-09-30T10:01:00Z",
      },
      review: {
        request,
        target: "locations/fixture",
        observedAt: "2026-09-30T10:00:00Z",
        changeSet: {
          id: "11111111-1111-4111-8111-111111111111",
          locationName: "Fixture Shop",
          approvedBy: "owner",
          canApprove: true,
          requiresSecondApprover: false,
          expiresAt: "2027-01-01T12:00:00Z",
          baseline: {
            collection: "locations/fixture/placeActionLinks",
            supportedTypes: ["SHOP_ONLINE"],
            unsupportedTypes: [],
            links: [link],
          },
        },
      },
      check: () => {},
      send: () => {},
      approve: () => {},
    } as unknown as ReturnType<typeof usePlaceActionReview>
    render(<PlaceActionApprovalSheet workflow={workflow} disabled={false} />)
    const dialog = within(
      screen.getByRole("dialog", { name: "Review action link change" })
    )
    for (const field of ["Link", "Action type"]) {
      const row = dialog.getByRole("rowheader", { name: field }).closest("tr")!
      expect(row).toHaveAttribute("data-state", "unchanged")
      expect(within(row).getByText("No change")).toBeInTheDocument()
    }
    expect(
      dialog.getByRole("rowheader", { name: "Preferred" }).closest("tr")
    ).toHaveAttribute("data-state", "changed")
    expect(headers()[1]).toBe("Before")
    expect(
      dialog.queryByText(/2027-01-01T|2026-09-30T/)
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('time[datetime="2027-01-01T12:00:00Z"]')
    ).toHaveTextContent(/1 Jan 2027/)
  })
})

describe("lodging outcome presentation", () => {
  const review = {
    id: "11111111-1111-4111-8111-111111111111",
    locationName: "Fixture Hotel",
    targetResourceName: "locations/fixture",
    payloadHash: "b".repeat(64),
    baselineHash: "a".repeat(64),
    payload: {
      pets: { petsAllowed: true },
      metadata: { updateTime: "2026-09-30T19:47:30.711Z" },
    },
    baseline: { pets: { petsAllowed: false } },
    updateMask: ["pets.petsAllowed", "metadata.updateTime"],
    requestedBy: "owner",
    approvedBy: "owner",
    requiresSecondApprover: false,
    canApprove: true,
    expiresAt: "2027-01-01T12:00:00Z",
  }
  const attempt = {
    id: "22222222-2222-4222-8222-222222222222",
    reviewId: review.id,
    targetResourceName: "locations/fixture",
    status: "succeeded",
    idempotent: true,
    executionState: "accepted",
    createdAt: "2026-09-30T10:00:00Z",
    errorCode: null,
  }
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    })

  it("withdraws the unresolved warning once confirmed and relabels the diff", async () => {
    let sent = false
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method === "PATCH") {
          sent = true
          return response({
            id: attempt.id,
            status: "succeeded",
            idempotent: false,
            executionState: "accepted",
            confirmationState: "unresolved",
          })
        }
        return sent
          ? response({
              attempt: {
                ...attempt,
                confirmationState: "confirmed",
                observedAt: "2026-09-30T10:01:00Z",
              },
            })
          : response(
              {
                error: "lodging_attempt_not_found",
                message: "No saved attempt.",
              },
              404
            )
      })
    )
    renderWithProviders(
      <LodgingReview
        locationId="fixture"
        payload={review.payload}
        updateMask={review.updateMask}
        googleHash={review.baselineHash}
        saved={[review]}
        disabled={false}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Review approved lodging change" })
    )
    const dialog = within(
      screen.getByRole("dialog", { name: "Review changes" })
    )
    expect(headers()).toContain("On Google now")
    // The auto-added "Data confirmed accurate at" value reads as a time.
    expect(dialog.queryByText(/2026-09-30T19:47/)).not.toBeInTheDocument()
    expect(
      document.querySelector('time[datetime="2026-09-30T19:47:30.711Z"]')
    ).not.toBeNull()
    const consent = dialog.getByRole("checkbox", {
      name: "Send these exact approved lodging changes to Google.",
    })
    await waitFor(() => expect(consent).toBeEnabled())
    await userEvent.click(consent)
    await userEvent.click(
      dialog.getByRole("button", { name: "Send approved lodging changes" })
    )
    const warning =
      "Google confirmation is unresolved. Check the saved outcome before another change."
    expect(await screen.findByText(warning)).toBeInTheDocument()
    expect(headers()).toEqual(["Field", "Before (reviewed)", "Sent"])
    await userEvent.click(
      dialog.getByRole("button", { name: "Read saved lodging outcome" })
    )
    expect(
      await dialog.findByText("Independently confirmed")
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText(warning)).not.toBeInTheDocument()
    )
    expect(
      screen.getByText("Lodging details confirmed by Google")
    ).toBeInTheDocument()
    expect(headers()[1]).toBe("Before")
    expect(headers()[2]).toMatch(/^Now on Google \(confirmed 30 Sep/)
  })
})

describe("toasts clear an open sheet footer", () => {
  function footer(rect: Partial<DOMRect>) {
    const root = document.createElement("div")
    root.innerHTML =
      '<div data-slot="sheet-content"><div data-slot="sheet-footer"></div></div>'
    const node = root.querySelector('[data-slot="sheet-footer"]')!
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect)
    return root
  }

  it("lifts the stack by the footer height when the footer runs under the toast column", () => {
    // 1280x800 with a 640px right sheet whose footer is 72px tall.
    const root = footer({
      width: 640,
      height: 72,
      top: 728,
      bottom: 800,
      left: 640,
      right: 1280,
    })
    expect(modalFooterClearance(root, { width: 1280, height: 800 })).toBe(72)
  })

  it("leaves the stack alone with no footer, a hidden footer or one clear of the column", () => {
    expect(
      modalFooterClearance(document.createElement("div"), {
        width: 1280,
        height: 800,
      })
    ).toBe(0)
    expect(modalFooterClearance(footer({}), { width: 1280, height: 800 })).toBe(
      0
    )
    expect(
      modalFooterClearance(
        footer({
          width: 400,
          height: 72,
          top: 728,
          bottom: 800,
          left: 0,
          right: 400,
        }),
        { width: 1280, height: 800 }
      )
    ).toBe(0)
  })

  it("applies the clearance to the viewport's bottom offset while a sheet is open", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const hit = this.getAttribute("data-slot") === "sheet-footer"
        return {
          width: hit ? 640 : 0,
          height: hit ? 80 : 0,
          top: hit ? window.innerHeight - 80 : 0,
          bottom: hit ? window.innerHeight : 0,
          left: 0,
          right: hit ? window.innerWidth : 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect
      }
    )
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open review</button>
          <ReviewChangesSheet open={open} onOpenChange={setOpen} rows={[{ field: "Phone", before: "1", after: "2" }]} locationName="Fixture" onPublish={() => {}} />
        </>
      )
    }
    renderWithProviders(<Harness />)
    const viewport = () =>
      document.querySelector('[data-slot="toast-viewport"]') as HTMLElement
    await waitFor(() => expect(viewport()).not.toBeNull())
    expect(viewport().style.getPropertyValue("--toast-footer-clearance")).toBe("0px")
    await userEvent.click(screen.getByRole("button", { name: "Open review" }))
    await waitFor(() =>
      expect(viewport().style.getPropertyValue("--toast-footer-clearance")).toBe("80px")
    )
    expect(viewport().className).toContain(
      "sm:bottom-[calc(max(16px,env(safe-area-inset-bottom))+var(--toast-footer-clearance,0px))]"
    )
  })
})

describe("service review rows", () => {
  const change = {
    baseline: { serviceItems: [{ freeFormServiceItem: { category: "gcid:doctor", label: { displayName: "Consultation", description: "Initial appointment" } } }] },
    payload: { serviceItems: [{ freeFormServiceItem: { category: "gcid:doctor", label: { displayName: "Consultation", description: "Follow-up appointment" } } }] },
  }

  it("uses the category display name from Google's metadata", () => {
    const rows = serviceReviewRows(change, [{ name: "categories/gcid:doctor", displayName: "Doctor", serviceTypes: [] }])
    expect(rows?.[0].before).toBe("Consultation · Doctor · Initial appointment · No price")
    expect(JSON.stringify(rows)).not.toContain("gcid")
  })

  it("never shows the raw gcid token without metadata", () => {
    const rows = serviceReviewRows(change, [])
    expect(rows?.[0].after).toContain("Doctor")
    expect(JSON.stringify(rows)).not.toContain("gcid")
  })
})
