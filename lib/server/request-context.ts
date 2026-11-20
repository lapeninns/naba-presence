import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

import { REQUEST_ID_HEADER } from "@/lib/domain/request-id"

type RequestIdentity = {
  requestId: string
  authenticated?: boolean
}

const requestScope = new AsyncLocalStorage<RequestIdentity>()

export function requestContext() {
  return requestScope.getStore()
}

export function withRequestContext<T>(requestId: string, run: () => T): T {
  return requestScope.run({ requestId }, run)
}

export function markRequestAuthenticated(): void {
  const context = requestContext()
  if (context) context.authenticated = true
}

/** Send only the server-generated correlation ID, never client identity or headers. */
export const requestFetch: typeof fetch = (input, init) => {
  const context = requestContext()
  if (!context) return fetch(input, init)
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  )
  headers.set(REQUEST_ID_HEADER, context.requestId)
  return fetch(input, { ...init, headers })
}
