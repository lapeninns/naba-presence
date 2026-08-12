import { screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OpsHealthPanel } from "@/components/settings/ops-health-panel"
import { renderWithProviders } from "../helpers/render"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const HEALTH = {
  generatedAt: "2026-08-09T12:00:00.000Z",
  sync: {
    running: 0,
    pending: 1,
    failed: 2,
    lastSuccessfulReviewUpdate: "2026-08-08T10:00:00.000Z",
    oldestOutstandingAt: null,
  },
  webhooks: { backlog: 3, oldestBacklogAt: null, failures24h: 1 },
  connections: [{ status: "active", count: 1 }],
  publish24h: [{ status: "succeeded", count: 4 }],
  replyRejections30d: [],
  providerTotalDivergence30d: 0,
  failedWebhookEvents: 1,
  deadWebhookEvents: 0,
  oldestFailedEventAgeSeconds: 120,
  ambiguousPublishAttempts: 0,
  staleStartedAttempts: 0,
  dueJobBacklog: 2,
  checkpointFailures24h: 0,
  connectionErrors24h: 0,
  schedulerHeartbeatAt: "2026-08-09T11:55:00.000Z",
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("OpsHealthPanel", () => {
  it("renders health metrics and replay for failed webhooks", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/api/operations/health")) return jsonResponse(HEALTH)
      if (url.includes("/api/webhooks/google/pubsub/failures")) {
        return jsonResponse({
          items: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              eventType: "NEW_REVIEW",
              status: "failed",
              retryCount: 1,
              nextAttemptAt: null,
              lastErrorCode: "sync_failed",
              receivedAt: "2026-08-09T10:00:00.000Z",
            },
          ],
        })
      }
      if (url.includes("/api/webhooks/google/pubsub/replay")) {
        expect((init as RequestInit).method).toBe("POST")
        return jsonResponse({ status: "processed", sync: {} })
      }
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithProviders(<OpsHealthPanel />)

    expect(await screen.findByText("System health")).toBeInTheDocument()
    expect(screen.getByText("Due job backlog")).toBeInTheDocument()
    expect(await screen.findByText("NEW_REVIEW")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument()
  })
})
