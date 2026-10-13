import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"

function avatar(props: React.ComponentProps<typeof Avatar> = {}) {
  render(
    <Avatar data-testid="avatar" {...props}>
      <AvatarFallback>OC</AvatarFallback>
    </Avatar>
  )
  return screen.getByTestId("avatar")
}

describe("Avatar", () => {
  it("is neutral: the avatar fill and ink, never a status hue", () => {
    const el = avatar()
    expect(el).toHaveClass("bg-avatar-bg", "text-avatar-ink")
    expect(el.className).not.toMatch(/(success|warning|danger|info)-/)
    expect(screen.getByText("OC")).toBeInTheDocument()
  })

  it("keeps the default size (32px) for existing callers, and md is the same", () => {
    expect(avatar()).toHaveClass("size-8", "rounded-(--np-radius-pill)")
  })

  it.each([
    ["sm", "size-6"],
    ["md", "size-8"],
    ["list", "size-(--np-avatar-list)"],
    ["lg", "size-11"],
    ["xl", "size-16"],
  ] as const)("draws size %s as %s", (size, cls) => {
    const el = avatar({ size })
    expect(el).toHaveAttribute("data-size", size)
    expect(el).toHaveClass(cls)
  })

  it("draws a hairline ring for logos, matching the shape", () => {
    const round = avatar({ ring: true })
    expect(round).toHaveAttribute("data-ring")
    expect(round).toHaveClass(
      "after:border",
      "after:border-line",
      "after:rounded-(--np-radius-pill)"
    )
  })

  it("draws the square shape with a matching ring", () => {
    const square = avatar({ shape: "square", ring: true, size: "list" })
    expect(square).toHaveClass(
      "rounded-(--np-radius-control)",
      "after:rounded-(--np-radius-control)"
    )
  })

  it("lets a caller's colour classes replace the neutral ones", () => {
    const el = avatar({ className: "bg-ink text-canvas" })
    expect(el).toHaveClass("bg-ink", "text-canvas")
    expect(el).not.toHaveClass("bg-avatar-bg")
    expect(el).not.toHaveClass("text-avatar-ink")
  })
})
