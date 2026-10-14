import { render, screen } from "@testing-library/react"
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
  it("draws no bar on a phone while the editor is clean, and never docks it", () => {
    render(footer({}))
    const bar = screen.getByRole("region", { name: "Editor actions" })
    expect(bar).not.toHaveAttribute("data-docked")
    expect(bar.className).toMatch(/max-md:hidden/)
    // No dock spacer either: a clean editor reserves no room for a bar.
    expect(document.querySelector('[data-slot="action-bar-spacer"]')).toBeNull()
    // The desk keeps the clean bar, its actions present but disabled.
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeDisabled()
  })

  it("docks to the bottom edge with the first change, with labelled buttons", () => {
    render(footer({ status: "edited", isDirty: true }))
    const bar = screen.getByRole("region", { name: "Editor actions" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toMatch(/max-md:fixed/)
    expect(bar.className).not.toMatch(/max-md:hidden/)
    // The ActionBar's dock: an in-flow spacer keeps the last field
    // reachable above the fixed bar.
    expect(
      bar.parentElement?.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
    expect(screen.getByRole("button", { name: "Discard" })).toHaveTextContent(
      "Discard"
    )
    expect(screen.getByRole("button", { name: "Save here" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled()
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
