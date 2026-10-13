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
  })

  it("docks to the bottom edge with the first change, with labelled buttons", () => {
    render(footer({ status: "edited", isDirty: true }))
    const bar = screen.getByRole("region", { name: "Editor actions" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toMatch(/max-md:fixed/)
    expect(bar.className).not.toMatch(/max-md:hidden/)
    expect(screen.getByRole("button", { name: "Discard" })).toHaveTextContent(
      "Discard"
    )
    expect(screen.getByRole("button", { name: "Save here" })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeEnabled()
  })

  it("keeps a conflict on screen even without local edits", () => {
    render(footer({ status: "conflict", isDirty: true, canDiscard: false }))
    expect(
      screen.getByRole("region", { name: "Editor actions" })
    ).toHaveAttribute("data-docked", "bottom")
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
