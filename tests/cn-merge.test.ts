import { describe, expect, it } from "vitest"

import { cn } from "@/lib/utils"

describe("cn", () => {
  it("treats every type role as a font size, including the reading role", () => {
    expect(cn("text-reading", "text-ink")).toBe("text-reading text-ink")
    expect(cn("text-body", "text-reading")).toBe("text-reading")
  })

  it("treats the count role as a font size, not a colour", () => {
    expect(cn("text-count", "text-ink-muted")).toBe("text-count text-ink-muted")
    expect(cn("text-caption", "text-count")).toBe("text-count")
  })

  it("lets a caller's stacking layer replace a primitive's", () => {
    expect(cn("z-overlay", "z-popover")).toBe("z-popover")
    expect(cn("z-50", "z-toast")).toBe("z-toast")
  })

  it("lets a safe-area or docked padding replace a spacing step", () => {
    expect(cn("pb-4", "pb-dock")).toBe("pb-dock")
    expect(cn("pb-safe", "pb-dock")).toBe("pb-dock")
    expect(cn("pt-2", "pt-safe")).toBe("pt-safe")
    expect(cn("px-4", "px-safe")).toBe("px-safe")
  })
})
