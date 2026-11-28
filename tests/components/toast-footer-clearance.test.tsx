import { useState } from "react"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { toastFooterClearance } from "@/components/ui/use-toast-footer-clearance"
import { renderWithProviders } from "../helpers/render"

afterEach(() => vi.restoreAllMocks())

describe("toasts clear sheet and reply footers", () => {
  function footer(rect: Partial<DOMRect>, reply = false) {
    const root = document.createElement("div")
    root.innerHTML = reply
      ? '<div data-slot="composer-footer" data-docked="bottom"></div>'
      : '<div data-slot="sheet-content"><div data-slot="sheet-footer"></div></div>'
    const node = root.querySelector('[data-slot$="-footer"]')!
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
    expect(toastFooterClearance(root, { width: 1280, height: 800 })).toBe(72)
  })

  it("clears the desktop reply footer even when the pane ends above the screen edge", () => {
    const root = footer(
      {
        width: 730,
        height: 64,
        top: 726,
        bottom: 790,
        left: 550,
        right: 1280,
      },
      true
    )
    expect(toastFooterClearance(root, { width: 1280, height: 800 })).toBe(74)
  })

  it("leaves the stack alone with no footer, a hidden footer or one clear of the column", () => {
    expect(
      toastFooterClearance(document.createElement("div"), {
        width: 1280,
        height: 800,
      })
    ).toBe(0)
    expect(toastFooterClearance(footer({}), { width: 1280, height: 800 })).toBe(
      0
    )
    expect(
      toastFooterClearance(
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
          <ReviewChangesSheet
            open={open}
            onOpenChange={setOpen}
            rows={[{ field: "Phone", before: "1", after: "2" }]}
            locationName="Fixture"
            onPublish={() => {}}
          />
        </>
      )
    }
    renderWithProviders(<Harness />)
    const viewport = () =>
      document.querySelector('[data-slot="toast-viewport"]') as HTMLElement
    await waitFor(() => expect(viewport()).not.toBeNull())
    expect(viewport().style.getPropertyValue("--toast-footer-clearance")).toBe(
      "0px"
    )
    await userEvent.click(screen.getByRole("button", { name: "Open review" }))
    await waitFor(() =>
      expect(
        viewport().style.getPropertyValue("--toast-footer-clearance")
      ).toBe("80px")
    )
    // The stack sits on the bottom edge at every width; the clearance and
    // the bar that owns the edge both feed --toast-bottom, the larger wins.
    expect(viewport().className).toContain("bottom-(--toast-bottom)")
    expect(viewport().className).toContain(
      "[--toast-bottom:calc(max(var(--toast-edge),var(--toast-footer-clearance))+var(--toast-gap))]"
    )
  })
})
