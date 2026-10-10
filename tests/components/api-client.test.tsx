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
      `${window.location.origin}/sign-in?next=` +
        encodeURIComponent("/inbox?queue=needs_reply")
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
      `${window.location.origin}/sign-in?next=` +
        encodeURIComponent("/inbox?queue=needs_reply")
    )
  })
})

describe("apiFetch 401 rule", () => {
  const unauthorized = () =>
    jsonResponse(401, {
      error: "authentication_required",
      message: "Please sign in.",
    })

  it("a background 401 throws without stashing drafts or navigating", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()))
    const assign = vi.fn()
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/inbox",
      search: "",
      assign,
    })
    registerDraftSource("review:42", () => "half-written reply")
    const error = (await apiFetch("/api/probe", { background: true }).catch(
      (e) => e
    )) as ApiClientError
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error.status).toBe(401)
    expect(error.code).toBe("authentication_required")
    expect(assign).not.toHaveBeenCalled()
    expect(sessionStorage.getItem("naba:draft:review:42")).toBeNull()
  })

  it("a foreground 401 (background omitted or false) still redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()))
    const assign = vi.fn()
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/inbox",
      search: "",
      assign,
    })
    await expect(
      apiFetch("/api/probe", { background: false })
    ).rejects.toBeInstanceOf(ApiClientError)
    expect(assign).toHaveBeenCalledWith(
      `${window.location.origin}/sign-in?next=` +
        encodeURIComponent("/inbox")
    )
  })

  it("a background 401 with a different code is an ordinary error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { error: "invalid_token" }))
    )
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const error = (await apiFetch("/api/probe", { background: true }).catch(
      (e) => e
    )) as ApiClientError
    expect(error.code).toBe("invalid_token")
    expect(assign).not.toHaveBeenCalled()
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
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "Idempotency-Key": expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
    })
    expect(init?.body).toBe(JSON.stringify({ a: 1 }))
  })

  it("mints a fresh intent per mutation and resends a given one unchanged", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => jsonResponse(200, { ok: true })
    )
    vi.stubGlobal("fetch", fetchMock)
    const intentId = "9b2f6a3e-4c1d-4e8f-9a7b-2c3d4e5f6a7b"
    await apiFetch("/api/x", { method: "DELETE" })
    await apiFetch("/api/x", { method: "DELETE" })
    await apiFetch("/api/x", { method: "PUT", body: {}, intentId })
    const keys = fetchMock.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"]
    )
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[2]).toBe(intentId)
  })

  it("carries the intent on a failed mutation's error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse(502, { error: "google_mutation_ambiguous", message: "x" })
      )
    )
    const intentId = "9b2f6a3e-4c1d-4e8f-9a7b-2c3d4e5f6a7b"
    await expect(
      apiFetch("/api/x", { method: "POST", body: {}, intentId })
    ).rejects.toMatchObject({ code: "google_mutation_ambiguous", intentId })
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
