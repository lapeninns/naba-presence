import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("component harness", () => {
  it("renders into jsdom with jest-dom matchers", () => {
    render(<button type="button">Probe</button>)
    expect(screen.getByRole("button", { name: "Probe" })).toBeInTheDocument()
  })
})
