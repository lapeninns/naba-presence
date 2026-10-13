import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/listings/listings-board", () => ({
  ListingsBoard: ({
    role,
    bulkEnabled,
  }: {
    role: string | null
    bulkEnabled: boolean
  }) => (
    <p>
      board for {role} · bulk {String(bulkEnabled)}
    </p>
  ),
}))

import { ListingsBoard } from "@/components/listings/listings-board-entry"

describe("ListingsBoard entry", () => {
  it("renders the board it loads, with the page's props", async () => {
    render(<ListingsBoard role="owner" bulkEnabled />)
    expect(await screen.findByText("board for owner · bulk true")).toBeTruthy()
  })
})
