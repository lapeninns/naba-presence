import { fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useKeepFocusClear } from "@/lib/editors/use-keep-focus-clear"

function Harness() {
  const root = useRef<HTMLDivElement>(null)
  useKeepFocusClear(root)
  return (
    <div ref={root}>
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <div data-slot="field" data-testid="field">
          <input aria-label="Item name" />
          <p>Give this item a name.</p>
        </div>
      </div>
      <div data-slot="editor-frame-footer" data-testid="footer" />
    </div>
  )
}

function bounds(element: Element, top: number, bottom: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 300,
    width: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("focused editor fields", () => {
  it("keeps the helper above a clipped scroll pane when the footer is below the viewport", () => {
    vi.stubGlobal("innerHeight", 390)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    render(<Harness />)
    const scroller = screen.getByTestId("scroller")
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 390 },
      clientTop: { value: 0 },
      scrollBy: { value: vi.fn() },
    })
    bounds(scroller, -32, 358)
    bounds(screen.getByTestId("field"), 285.5, 377.5)
    bounds(screen.getByRole("textbox"), 305.5, 341.5)
    bounds(screen.getByTestId("footer"), 541.5, 601.5)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 31.5 })
  })

  it("keeps the footer as the tighter boundary within a taller scroll pane", () => {
    vi.stubGlobal("innerHeight", 1000)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    render(<Harness />)
    const scroller = screen.getByTestId("scroller")
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 692 },
      clientTop: { value: 0 },
      scrollBy: { value: vi.fn() },
    })
    bounds(scroller, 308, 1000)
    bounds(screen.getByTestId("field"), 832, 908)
    bounds(screen.getByRole("textbox"), 852, 888)
    bounds(screen.getByTestId("footer"), 900, 960)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 20 })
  })

  it("uses window scrolling when no inner scroll pane exists", () => {
    vi.stubGlobal("innerHeight", 1000)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {})
    render(<Harness />)
    bounds(screen.getByTestId("field"), 832, 908)
    bounds(screen.getByRole("textbox"), 852, 888)
    bounds(screen.getByTestId("footer"), 900, 960)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroll).toHaveBeenCalledWith({ top: 20 })
  })

  it("retains top clearance when the field is above the toolbar", () => {
    vi.stubGlobal("innerHeight", 1000)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    render(<Harness />)
    const scroller = screen.getByTestId("scroller")
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 1000 },
      clientTop: { value: 0 },
      scrollBy: { value: vi.fn() },
    })
    bounds(scroller, 0, 1000)
    bounds(screen.getByTestId("field"), 10, 86)
    bounds(screen.getByRole("textbox"), 30, 66)
    bounds(screen.getByTestId("footer"), 900, 960)

    fireEvent.focusIn(screen.getByRole("textbox"))

    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: -42 })
  })
})

describe("the on-screen keyboard opening under a focused field", () => {
  // A docked bar grows by the keyboard's height only once ViewportInsets has
  // written --np-keyboard-inset, a frame after the visualViewport resize. The
  // field must be measured against the risen bar, not the closed one.
  it("measures the docked bar after the keyboard inset is written", () => {
    vi.stubGlobal("innerHeight", 844)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal("cancelAnimationFrame", () => {})
    const viewport = Object.assign(new EventTarget(), {
      height: 844,
      offsetTop: 0,
    })
    vi.stubGlobal("visualViewport", viewport)
    const flush = () => frames.splice(0).forEach((frame) => frame(0))
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {})

    function DockedHarness() {
      const root = useRef<HTMLDivElement>(null)
      useKeepFocusClear(root)
      return (
        <div ref={root}>
          <input aria-label="Opening time" />
          <div data-slot="editor-frame-footer">
            <div data-docked="bottom" data-testid="bar" />
          </div>
        </div>
      )
    }
    render(<DockedHarness />)
    const input = screen.getByRole("textbox")
    const bar = screen.getByTestId("bar")
    bounds(input, 452, 496)
    bounds(bar, 763, 844)
    input.focus()
    flush()
    expect(scroll).not.toHaveBeenCalled()

    // The keyboard opens: the visual viewport shrinks by 336px.
    viewport.height = 508
    viewport.dispatchEvent(new Event("resize"))
    // Frame one: ViewportInsets writes the inset; the bar rises over it.
    flush()
    bounds(bar, 427, 844)
    expect(scroll).not.toHaveBeenCalled()
    // Frame two: measured against the risen bar, less the 12px gap.
    flush()
    expect(scroll).toHaveBeenCalledWith({ top: 496 - (427 - 12) })
  })

  // Typing the first change docks the bar while the field keeps focus (and
  // the keyboard is often already up): no focus or resize event follows, so
  // the bar arriving must re-check the field itself.
  it("re-checks the focused field when a docked bar arrives", async () => {
    vi.stubGlobal("innerHeight", 844)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal("cancelAnimationFrame", () => {})
    const flush = () => frames.splice(0).forEach((frame) => frame(0))
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {})

    function DockingHarness() {
      const root = useRef<HTMLDivElement>(null)
      useKeepFocusClear(root)
      return (
        <div ref={root}>
          <input aria-label="Business name" />
          <div data-slot="editor-frame-footer" data-testid="footer">
            <div data-testid="bar" />
          </div>
        </div>
      )
    }
    render(<DockingHarness />)
    const input = screen.getByRole("textbox")
    const bar = screen.getByTestId("bar")
    bounds(input, 720, 760)
    bounds(screen.getByTestId("footer"), 900, 900)
    bounds(bar, 900, 900)
    input.focus()
    flush()
    expect(scroll).not.toHaveBeenCalled()

    // The first change: the bar docks over the bottom edge.
    bounds(bar, 763, 844)
    bar.setAttribute("data-docked", "bottom")
    await Promise.resolve()
    flush()
    expect(scroll).toHaveBeenCalledWith({ top: 760 - (763 - 12) })
  })
})
