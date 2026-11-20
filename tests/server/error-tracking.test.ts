import { afterEach, beforeEach, expect, it, vi } from "vitest"

import {
  reportException,
  startErrorTracking,
} from "@/lib/server/error-tracking"
import {
  markRequestAuthenticated,
  withRequestContext,
} from "@/lib/server/request-context"

const sentry = vi.hoisted(() => {
  const scope = {
    clear: vi.fn(),
    setTag: vi.fn(),
    setContext: vi.fn(),
    addBreadcrumb: vi.fn(),
  }
  return {
    scope,
    init: vi.fn(),
    isEnabled: vi.fn(() => false),
    withScope: (run: (value: typeof scope) => void) => run(scope),
    captureException: vi.fn(),
    flush: vi.fn(async () => true),
  }
})
vi.mock("@sentry/node", () => sentry)

beforeEach(() => {
  vi.clearAllMocks()
  sentry.isEnabled.mockReturnValue(false)
})
afterEach(() => vi.unstubAllEnvs())

it("does not initialize or capture without a configured DSN", async () => {
  vi.stubEnv("SENTRY_DSN", "")
  startErrorTracking()
  await reportException(new Error("ignored"), { event: "next.request_error" })
  expect(sentry.init).not.toHaveBeenCalled()
  expect(sentry.captureException).not.toHaveBeenCalled()
  expect(sentry.flush).not.toHaveBeenCalled()
})

it("captures call sites and coarse actor context but not the original message", async () => {
  vi.stubEnv("SENTRY_DSN", "https://example.invalid/1")
  startErrorTracking()
  expect(sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      defaultIntegrations: false,
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
    })
  )
  sentry.isEnabled.mockReturnValue(true)
  const id = crypto.randomUUID()
  const error = new Error(
    "User guest@example.test, Bearer payload\n    at injected"
  )
  await withRequestContext(id, async () => {
    markRequestAuthenticated()
    await reportException(error, {
      event: "api.unhandled_error",
      method: "GET",
    })
  })
  const [captured] = sentry.captureException.mock.calls[0]
  expect(captured.message).toBe("api.unhandled_error")
  expect(captured.stack).toContain("error-tracking.test.ts")
  expect(captured.stack).not.toMatch(/guest@example|payload|injected/)
  expect(sentry.scope.setContext).toHaveBeenCalledWith("request_correlation", {
    id,
  })
  expect(sentry.scope.setContext).toHaveBeenCalledWith("actor", {
    authenticated: true,
  })
  expect(sentry.scope.addBreadcrumb).toHaveBeenCalledWith(
    expect.objectContaining({
      category: "http",
      data: { method: "GET", route: undefined },
    })
  )
})
