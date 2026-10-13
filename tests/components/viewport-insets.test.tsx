import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  useKeyboardInset,
  ViewportInsets,
} from "@/components/app-shell/viewport-insets"

/** A visualViewport double: a real EventTarget with settable geometry. */
class FakeVisualViewport extends EventTarget {
  height = 800
  offsetTop = 0
  scale = 1

  set(
    geometry: Partial<
      Pick<FakeVisualViewport, "height" | "offsetTop" | "scale">
    >
  ) {
    Object.assign(this, geometry)
    this.dispatchEvent(new Event("resize"))
  }
}

let viewport: FakeVisualViewport
let frames: FrameRequestCallback[]

/** Run the queued animation frames, as the browser would before paint. */
function flushFrames() {
  act(() => {
    const queued = frames
    frames = []
    for (const callback of queued) callback(0)
  })
}

const root = () => document.documentElement

beforeEach(() => {
  viewport = new FakeVisualViewport()
  frames = []
  vi.stubGlobal("visualViewport", viewport)
  vi.stubGlobal("innerHeight", 800)
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = []
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function InsetReadout() {
  return <output>{useKeyboardInset()}</output>
}

describe("ViewportInsets", () => {
  it("writes the resting viewport on mount", () => {
    render(<ViewportInsets />)
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("0px")
    expect(root().style.getPropertyValue("--np-visual-viewport-height")).toBe(
      "800px"
    )
    expect(root().dataset.keyboard).toBeUndefined()
  })

  it("tracks the keyboard opening and closing, once per frame", () => {
    render(<ViewportInsets />)

    // iOS: the layout viewport keeps its 800px; the visible part shrinks and
    // is panned down 20px to reveal the focused field.
    viewport.set({ height: 470, offsetTop: 20 })
    viewport.set({ height: 460, offsetTop: 20 })
    expect(frames).toHaveLength(1)
    flushFrames()
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("320px")
    expect(root().style.getPropertyValue("--np-visual-viewport-height")).toBe(
      "460px"
    )
    expect(root().dataset.keyboard).toBe("open")

    viewport.set({ height: 800, offsetTop: 0 })
    flushFrames()
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("0px")
    expect(root().dataset.keyboard).toBeUndefined()
  })

  it("does not call a collapsing toolbar a keyboard", () => {
    render(<ViewportInsets />)
    viewport.set({ height: 720 })
    flushFrames()
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("80px")
    expect(root().dataset.keyboard).toBeUndefined()
  })

  it("reads a pinch zoom as no keyboard", () => {
    render(<ViewportInsets />)
    viewport.set({ height: 400, offsetTop: 100, scale: 2 })
    flushFrames()
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("0px")
    expect(root().dataset.keyboard).toBeUndefined()
  })

  it("removes its listeners and its marks on unmount", () => {
    const remove = vi.spyOn(viewport, "removeEventListener")
    const { unmount } = render(<ViewportInsets />)
    viewport.set({ height: 400 })
    flushFrames()
    expect(root().dataset.keyboard).toBe("open")

    unmount()
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function))
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function))
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("")
    expect(root().style.getPropertyValue("--np-visual-viewport-height")).toBe(
      ""
    )
    expect(root().dataset.keyboard).toBeUndefined()

    // Nothing is listening any more, so nothing is scheduled.
    viewport.set({ height: 300 })
    expect(frames).toHaveLength(0)
  })

  it("is a no-op without visualViewport", () => {
    vi.stubGlobal("visualViewport", undefined)
    render(<ViewportInsets />)
    expect(root().style.getPropertyValue("--np-keyboard-inset")).toBe("")
    expect(root().dataset.keyboard).toBeUndefined()
  })
})

describe("useKeyboardInset", () => {
  it("follows the keyboard in JS", () => {
    render(<InsetReadout />)
    expect(screen.getByRole("status")).toHaveTextContent("0")
    viewport.set({ height: 500 })
    flushFrames()
    expect(screen.getByRole("status")).toHaveTextContent("300")
  })

  it("reads 0 without visualViewport", () => {
    vi.stubGlobal("visualViewport", undefined)
    render(<InsetReadout />)
    expect(screen.getByRole("status")).toHaveTextContent("0")
  })
})
