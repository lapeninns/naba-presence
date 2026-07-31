import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { ApiClientError, apiFetch } from "@/lib/api/client"
import {
  __resetDraftSources,
  registerDraftSource,
  stashAllDrafts,
  takeStashedDraft,
} from "@/lib/api/draft-stash"

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

beforeEach(() => {
  sessionStorage.clear()
  __resetDraftSources()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("apiFetch", () => {
  it("returns parsed JSON on ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true })))
    await expect(apiFetch("/api/probe")).resolves.toEqual({ ok: true })
  })

  it("throws ApiClientError carrying status, code, details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, {
          error: "validation_failed",
          message: "The request did not pass validation.",
          details: [{ path: ["name"], message: "Required" }],
        })
      )
    )
    const error = (await apiFetch("/api/probe").catch((e) => e)) as ApiClientError
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.status).toBe(422)
    expect(error.code).toBe("validation_failed")
    expect(error.details).toEqual([{ path: ["name"], message: "Required" }])
  })

  it("survives non-JSON error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }))
    )
    const error = (await apiFetch("/api/probe").catch((e) => e)) as ApiClientError
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.status).toBe(502)
    expect(error.code).toBe("http_error")
  })

  it("validates with a schema and flags malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { count: "x" })))
    const error = await apiFetch("/api/probe", {
      schema: z.object({ count: z.number() }),
    }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.code).toBe("malformed_response")
  })

  it("stashes drafts and redirects on authentication_required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          error: "authentication_required",
          message: "Please sign in.",
        })
      )
    )
    const assign = vi.fn()
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/inbox",
      search: "?queue=needs_reply",
      assign,
    })
    registerDraftSource("review:42", () => "half-written reply")
    await expect(apiFetch("/api/probe")).rejects.toBeInstanceOf(ApiClientError)
    expect(sessionStorage.getItem("naba:draft:review:42")).toBe(
      "half-written reply"
    )
    expect(assign).toHaveBeenCalledWith(
      "/sign-in?next=" + encodeURIComponent("/inbox?queue=needs_reply")
    )
  })

  it("a throwing snapshot does not stop other sources from stashing or block the 401 redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          error: "authentication_required",
          message: "Please sign in.",
        })
      )
    )
    const assign = vi.fn()
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/inbox",
      search: "?queue=needs_reply",
      assign,
    })
    registerDraftSource("broken", () => {
      throw new Error("snapshot exploded")
    })
    registerDraftSource("review:42", () => "half-written reply")
    await expect(apiFetch("/api/probe")).rejects.toBeInstanceOf(ApiClientError)
    expect(sessionStorage.getItem("naba:draft:review:42")).toBe(
      "half-written reply"
    )
    expect(assign).toHaveBeenCalledWith(
      "/sign-in?next=" + encodeURIComponent("/inbox?queue=needs_reply")
    )
  })
})

describe("apiFetch request construction", () => {
  it("sends method, JSON content-type, and a stringified body for a POST", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => jsonResponse(200, { ok: true })
    )
    vi.stubGlobal("fetch", fetchMock)
    await apiFetch("/api/x", { method: "POST", body: { a: 1 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/x")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toEqual({ "content-type": "application/json" })
    expect(init?.body).toBe(JSON.stringify({ a: 1 }))
  })

  it("sends no headers or body for a bodyless GET", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => jsonResponse(200, { ok: true })
    )
    vi.stubGlobal("fetch", fetchMock)
    await apiFetch("/api/probe")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe("GET")
    expect(init?.headers).toBeUndefined()
    expect(init?.body).toBeUndefined()
  })

  it("forwards an AbortSignal to fetch by reference", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => jsonResponse(200, { ok: true })
    )
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    await apiFetch("/api/probe", { signal: controller.signal })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.signal).toBe(controller.signal)
  })
})

describe("draft stash", () => {
  it("takeStashedDraft reads once and clears", () => {
    registerDraftSource("k", () => "v")
    stashAllDrafts()
    expect(takeStashedDraft("k")).toBe("v")
    expect(takeStashedDraft("k")).toBeNull()
  })

  it("unregister stops stashing; null snapshots are skipped", () => {
    const un = registerDraftSource("gone", () => "x")
    un()
    registerDraftSource("empty", () => null)
    stashAllDrafts()
    expect(sessionStorage.getItem("naba:draft:gone")).toBeNull()
    expect(sessionStorage.getItem("naba:draft:empty")).toBeNull()
  })

  it("empty-string snapshots are skipped", () => {
    registerDraftSource("blank", () => "")
    stashAllDrafts()
    expect(sessionStorage.getItem("naba:draft:blank")).toBeNull()
  })
})
