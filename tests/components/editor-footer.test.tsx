import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { EditorFooter } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"

function footer(props: Partial<React.ComponentProps<typeof EditorFooter>>) {
  return (
    <EditorFooter
      status="in_sync"
      isDirty={false}
      onReview={vi.fn()}
      onDiscard={vi.fn()}
      onSave={vi.fn()}
      {...props}
    />
  )
}

describe("EditorFooter", () => {
  it("draws no bar while the editor is clean, at any width", () => {
    render(footer({}))
    expect(screen.queryByRole("region", { name: "Editor actions" })).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    // No dock spacer either: a clean editor reserves no room for a bar.
    expect(document.querySelector('[data-slot="action-bar-spacer"]')).toBeNull()
  })

  it("docks one row with the first change: status, one primary, an overflow", () => {
    render(footer({ status: "edited", isDirty: true }))
    const bar = screen.getByRole("region", { name: "Editor actions" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toMatch(/max-md:fixed/)
    // One row: the dock's nowrap is not overridden by a wrapping bar.
    expect(bar.className).not.toMatch(/max-md:flex-wrap/)
    // The ActionBar's dock: an in-flow spacer keeps the last field
    // reachable above the fixed bar.
    expect(
      bar.parentElement?.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled()
    // The phone's overflow is named, and a touch-sized icon button.
    expect(screen.getByRole("button", { name: "More actions" })).toHaveClass(
      "md:hidden"
    )
    // Every other word on a phone lives in that menu; from md it is inline.
    expect(screen.getByRole("button", { name: "Save here" })).toHaveClass(
      "max-md:hidden"
    )
    expect(screen.getByRole("button", { name: "Discard edits" })).toHaveClass(
      "max-md:hidden"
    )
  })

  it("leaves out the secondaries that have nothing to act on", () => {
    // Drift that is already saved here: something to publish, nothing local
    // to save or throw away.
    render(
      footer({
        status: "unpublished",
        isDirty: true,
        canDiscard: false,
      })
    )
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Discard edits" })).toBeNull()
  })

  it("keeps Save here out of the bar for a resource with no copy of its own", () => {
    render(footer({ status: "edited", isDirty: true, onSave: undefined }))
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    expect(screen.getByRole("button", { name: "Discard edits" })).toBeEnabled()
  })

  it("runs the same handlers from the inline buttons and the overflow menu", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    const onReview = vi.fn()
    render(
      footer({
        status: "edited",
        isDirty: true,
        onSave,
        onDiscard,
        onReview,
      })
    )
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    expect(onReview).toHaveBeenCalledTimes(1)
    // Inline (from md).
    await user.click(screen.getByRole("button", { name: "Save here" }))
    await user.click(screen.getByRole("button", { name: "Discard edits" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
    // The phone's overflow menu.
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(await screen.findByRole("menuitem", { name: "Save here" }))
    expect(onSave).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Discard edits" })
    )
    expect(onDiscard).toHaveBeenCalledTimes(2)
  })

  it("disables Save here, in the bar and the menu, with the reason in a note", async () => {
    const user = userEvent.setup()
    render(
      footer({
        status: "edited",
        isDirty: true,
        saveDisabledReason: "Only the name is saved here.",
      })
    )
    expect(screen.getByRole("button", { name: "Save here" })).toBeDisabled()
    expect(screen.getByRole("note")).toHaveTextContent(
      "Only the name is saved here."
    )
    // Two rows only while there is a reason to give.
    expect(
      screen.getByRole("region", { name: "Editor actions" }).className
    ).toMatch(/max-md:flex-wrap/)
    await user.click(screen.getByRole("button", { name: "More actions" }))
    expect(
      await screen.findByRole("menuitem", { name: "Save here" })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("says Saving… in the status while a save runs", () => {
    render(footer({ status: "edited", isDirty: true, saving: true }))
    expect(
      screen.getByRole("region", { name: "Editor actions" })
    ).toHaveTextContent("saving…")
  })

  it("blocks Review changes with the reason in a note", () => {
    render(
      footer({
        status: "edited",
        isDirty: true,
        disabledReason: "Publishing is paused.",
      })
    )
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeDisabled()
    expect(screen.getByRole("note")).toHaveTextContent("Publishing is paused.")
  })

  it("keeps a conflict on screen even without local edits", () => {
    render(footer({ status: "conflict", isDirty: true, canDiscard: false }))
    expect(
      screen.getByRole("region", { name: "Editor actions" })
    ).toHaveAttribute("data-docked", "bottom")
  })

  it("starts at the form column beside a desk label rail only when asked", () => {
    const { unmount } = render(footer({ status: "edited", isDirty: true }))
    expect(
      screen.getByRole("region", { name: "Editor actions" }).className
    ).not.toMatch(/--np-form-rail-w/)
    unmount()
    render(footer({ status: "edited", isDirty: true, rail: true }))
    expect(
      screen.getByRole("region", { name: "Editor actions" }).className
    ).toContain("desk:ml-[calc(var(--np-form-rail-w)+--spacing(6))]")
  })

  it("keeps the view-only bar inline, with the reason in words", () => {
    render(footer({ readOnlyReason: "Your role can only look." }))
    const bar = screen.getByRole("region", { name: "Editor actions" })
    expect(bar).not.toHaveAttribute("data-docked")
    expect(bar).toHaveTextContent("View-only access. Your role can only look.")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("describes a partial save once, for assistive tech only", () => {
    render(
      footer({
        status: "edited",
        isDirty: true,
        saveDescription: "Save here keeps the name only.",
      })
    )
    const save = screen.getByRole("button", { name: "Save here" })
    expect(save).toHaveAccessibleDescription("Save here keeps the name only.")
    expect(screen.getByText("Save here keeps the name only.")).toHaveClass(
      "sr-only"
    )
  })
})

describe("EditorFrame inside an area", () => {
  it("keeps the title for assistive tech and leaves the status pill to the header", () => {
    render(
      <EditorFrame title="Food menu" titleHidden statusLabel="No menu">
        <p>fields</p>
      </EditorFrame>
    )
    expect(
      screen.getByRole("heading", { level: 2, name: "Food menu" })
    ).toHaveClass("sr-only")
    expect(screen.queryByText("No menu")).toBeNull()
  })

  it("keeps the visible heading and pill for stacked frames", () => {
    render(
      <EditorFrame title="Administrators" statusLabel="2 people">
        <p>fields</p>
      </EditorFrame>
    )
    expect(
      screen.getByRole("heading", { level: 2, name: "Administrators" })
    ).not.toHaveClass("sr-only")
    expect(screen.getByText("2 people")).toBeInTheDocument()
  })
})

describe("EditorFrame head", () => {
  it("rules the visible head off from the fields with one hairline", () => {
    render(
      <EditorFrame title="Administrators" gateReason="Your role can only look.">
        <p>fields</p>
      </EditorFrame>
    )
    const head = document.querySelector('[data-slot="editor-frame-head"]')
    expect(head).toHaveClass("border-b", "border-line")
    expect(head).toHaveTextContent("Your role can only look.")
  })

  it("draws no rule over a lone gate inside an area", () => {
    render(
      <EditorFrame title="Hours" titleHidden gateReason="Publishing is paused.">
        <p>fields</p>
      </EditorFrame>
    )
    const head = document.querySelector('[data-slot="editor-frame-head"]')
    expect(head).not.toHaveClass("border-b")
    expect(head).toHaveTextContent("Publishing is paused.")
  })
})
