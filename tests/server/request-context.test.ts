import { NextRequest } from "next/server"
import { afterEach, expect, it, vi } from "vitest"

import {
  INTERNAL_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/domain/request-id"
import { serverRequestId } from "@/lib/server/http"
import { requestFetch, withRequestContext } from "@/lib/server/request-context"
import { proxy } from "@/proxy"

afterEach(() => vi.unstubAllGlobals())

it("overwrites an inbound page correlation header without reflecting it", () => {
  const supplied = crypto.randomUUID()
  const response = proxy(
    new NextRequest("http://localhost/dashboard", {
      headers: { [INTERNAL_REQUEST_ID_HEADER]: supplied },
    })
  )
  const id = response.headers.get(REQUEST_ID_HEADER)
  expect(id).toMatch(/^[\da-f-]{36}$/)
  expect(id).not.toBe(supplied)
  expect(
    response.headers.get(`x-middleware-request-${INTERNAL_REQUEST_ID_HEADER}`)
  ).toBe(id)
})

it("does not trust the page-only correlation header on API routes", () => {
  const supplied = crypto.randomUUID()
  const request = new Request("http://localhost/api/test", {
    headers: {
      [INTERNAL_REQUEST_ID_HEADER]: supplied,
      [REQUEST_ID_HEADER]: "caller",
    },
  })
  expect(serverRequestId(request)).toEqual({
    id: expect.not.stringMatching(supplied),
    clientId: "caller",
  })
})

it("propagates the correct request ID independently across concurrent calls", async () => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  const destination = "https://provider.example.test/"
  const send = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(new Headers(init?.headers).get(REQUEST_ID_HEADER))
  )
  vi.stubGlobal("fetch", send)
  const echoes = await Promise.all(
    ids.map((id) =>
      withRequestContext(id, async () => {
        await Promise.resolve()
        const result = await requestFetch(destination, {
          headers: { "x-request-id": "caller", accept: "application/json" },
        })
        return result.text()
      })
    )
  )
  expect(echoes).toEqual(ids)
  expect(new Headers(send.mock.calls[0][1]?.headers).get("accept")).toBe(
    "application/json"
  )
})
