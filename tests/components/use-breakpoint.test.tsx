import { render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  useBreakpoint,
  useHydratedBreakpoint,
} from "@/lib/hooks/use-media-query"

afterEach(() => {
  vi.unstubAllGlobals()
})

/** matchMedia that matches exactly the queries it is given. */
function stubMatching(...matching: string[]) {
  const matchMedia = vi.fn((query: string) => ({
    matches: matching.includes(query),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal("matchMedia", matchMedia)
  return matchMedia
}

function Wide() {
  return <output>{String(useBreakpoint("md"))}</output>
}

function Hydrated() {
  return <output>{String(useHydratedBreakpoint("md"))}</output>
}

describe("useBreakpoint", () => {
  it("asks matchMedia the Tailwind query for the name", () => {
    const matchMedia = stubMatching("(min-width: 48rem)")
    render(<Wide />)
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 48rem)")
    expect(screen.getByRole("status")).toHaveTextContent("true")
  })

  it("reports a phone as below the breakpoint", () => {
    stubMatching()
    render(<Wide />)
    expect(screen.getByRole("status")).toHaveTextContent("false")
  })
})

describe("useHydratedBreakpoint", () => {
  it("is unknown in the server render, whatever the guess would be", () => {
    stubMatching()
    expect(renderToString(<Hydrated />)).toContain("null")
  })

  it("answers once the client renders", () => {
    stubMatching()
    render(<Hydrated />)
    expect(screen.getByRole("status")).toHaveTextContent("false")
  })
})
