import { vi } from "vitest"

import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"

export const ACCOUNT = "6f1d4c55-9a43-4f8e-8f2b-7a104b0c7f0e"
export const DRAFT = "9a434f8e-1f2b-4a10-8b0c-7f0e6f1d4c55"
export const CONNECTION = "4b0c7f0e-6f1d-4c55-9a43-1f8e1f2b7a10"
export const CLIENT = "1f2b7a10-4b0c-4f0e-8f1d-4c559a431f8e"
export const USER = "7a104b0c-7f0e-4f1d-8c55-9a431f8e1f2b"
export const HASH = "a".repeat(64)
export const CHECKED_AT = "2026-10-14T10:05:00.000Z"

export function draftFixture(
  overrides: Partial<GoogleOnboardingDraft> = {}
): GoogleOnboardingDraft {
  return {
    id: DRAFT,
    accountId: ACCOUNT,
    accountName: "Old Crown",
    connectionId: CONNECTION,
    clientId: CLIENT,
    requestedBy: USER,
    providerRequestId: USER,
    revision: 3,
    payload: { title: "The Old Crown", languageCode: "en-GB" },
    payloadHash: HASH,
    matchResult: null,
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    expiresAt: "2026-11-14T10:00:00.000Z",
    ...overrides,
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function errorResponse(status: number, error: string, message = error) {
  return jsonResponse({ error, message }, status)
}

type Handler = (
  url: URL,
  init: RequestInit | undefined
) => Response | Promise<Response>

/**
 * Stubs the network boundary: `fetch` answers from the handler, and every
 * call it received is kept as `{ method, path, query, body }` for assertions.
 * A request the handler does not know fails the test loudly.
 */
export function stubNetwork(handler: Handler) {
  const calls: Array<{
    method: string
    path: string
    query: Record<string, string>
    body: unknown
  }> = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      })
      return handler(url, init)
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  return { calls, fetchMock }
}
