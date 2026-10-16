// @vitest-environment node
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { usePendingUnreadDelta } from "@/lib/api/operational-notifications"

function Delta() {
  return <span>{usePendingUnreadDelta("badge")}</span>
}

describe("usePendingUnreadDelta on the server", () => {
  it("renders without a client-only snapshot and shows no change", () => {
    const client = new QueryClient()
    const html = renderToString(
      <QueryClientProvider client={client}>
        <Delta />
      </QueryClientProvider>
    )
    expect(html).toContain(">0<")
  })
})
