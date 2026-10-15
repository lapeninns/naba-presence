import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { scope } = vi.hoisted(() => ({
  scope: { clientId: null as string | null },
}))

vi.mock("@/components/app-shell/shell-link", () => ({
  ShellLink: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/components/app-shell/client-context", () => ({
  useClientScope: () => scope.clientId,
}))
vi.mock("@/lib/workspace/mode", () => ({
  useWorkspaceMode: () => "agency",
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({
    isPending: false,
    isError: false,
    data: {
      items: [
        { id: "c1", name: "Journey Hospitality", health: "partially_checked" },
      ],
    },
  }),
  useOrgHealth: () => ({ tone: "attention", label: "2 clients need checking" }),
}))

import { ContextHealthChip } from "@/components/app-shell/context-health-chip"

describe("ContextHealthChip", () => {
  beforeEach(() => {
    scope.clientId = null
  })

  // DSK-05: the chip may shrink and truncate its words, so the full words
  // stay readable as the link's title.
  it("titles the chip with the organisation's full words", () => {
    render(<ContextHealthChip />)
    const chip = screen.getByRole("link", { name: "2 clients need checking" })
    expect(chip).toHaveAttribute("title", "2 clients need checking")
    expect(chip).toHaveAttribute("href", "/clients")
  })

  it("titles a client's chip with its name and health", () => {
    scope.clientId = "c1"
    render(<ContextHealthChip />)
    const chip = screen.getByRole("link", {
      name: "Journey Hospitality: Partially checked",
    })
    expect(chip).toHaveAttribute(
      "title",
      "Journey Hospitality: Partially checked"
    )
    expect(chip).toHaveAttribute("href", "/clients/c1")
  })
})
