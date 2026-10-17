import { createHash } from "node:crypto"
import { request } from "node:https"

import {
  type Attributes,
  type Span,
  type SpanOptions,
  type Tracer,
  type TracerProvider,
  context,
  trace,
} from "@opentelemetry/api"
import { createPatchedFetcher } from "next/dist/server/lib/patch-fetch"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { assertPasswordNotBreached } from "@/lib/server/breached-password"
import { ApiError } from "@/lib/server/http"
import { fakeRangeRequest, rangeBody } from "../helpers/fake-range-request"

/**
 * The SHA-1 prefix is derived from the password, so it must not leave the
 * server in telemetry either. Next.js wraps the global fetch and names its
 * span `fetch GET <url>` with the full URL in `http.url`, whatever
 * `opentelemetry: { ignore: true }` says. This records every span the real
 * Next.js fetch wrapper exports, proves the recorder sees a prefix when one is
 * sent through fetch, and then holds that the breached-password check exports
 * no span carrying the prefix, the suffix or the password.
 */

vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({
    PASSWORD_AUTH_ENABLED: true,
    BREACHED_PASSWORD_CHECK_ENABLED: true,
  }),
}))
vi.mock("node:https", () => ({ request: vi.fn() }))

const PASSWORD = "correct horse battery staple"
const HASH = createHash("sha1")
  .update(PASSWORD, "utf8")
  .digest("hex")
  .toUpperCase()
const PREFIX = HASH.slice(0, 5)
const SUFFIX = HASH.slice(5)
const RANGE_URL = `https://api.pwnedpasswords.com/range/${PREFIX}`

type Exported = {
  names: string[]
  attributes: Attributes
  events: unknown[]
}

const exported: Exported[] = []

class RecordingSpan implements Span {
  private readonly record: Exported

  constructor(name: string, options?: SpanOptions) {
    this.record = {
      names: [name],
      attributes: { ...options?.attributes },
      events: [],
    }
    exported.push(this.record)
  }

  spanContext() {
    return {
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: 1,
    }
  }
  setAttribute(key: string, value: unknown) {
    this.record.attributes[key] = value as Attributes[string]
    return this
  }
  setAttributes(attributes: Attributes) {
    Object.assign(this.record.attributes, attributes)
    return this
  }
  addEvent(name: string, attributes?: unknown) {
    this.record.events.push({ name, attributes })
    return this
  }
  addLink() {
    return this
  }
  addLinks() {
    return this
  }
  setStatus(status: unknown) {
    this.record.events.push({ status })
    return this
  }
  updateName(name: string) {
    this.record.names.push(name)
    return this
  }
  end() {}
  isRecording() {
    return true
  }
  recordException(exception: unknown) {
    this.record.events.push({ exception: String(exception) })
  }
}

const tracer: Tracer = {
  startSpan: (name, options) => new RecordingSpan(name, options),
  startActiveSpan: ((name: string, ...rest: unknown[]) => {
    const fn = rest.at(-1) as (span: Span) => unknown
    const options =
      rest.length > 1 && typeof rest[0] === "object"
        ? (rest[0] as SpanOptions)
        : undefined
    const span = new RecordingSpan(name, options)
    return context.with(trace.setSpan(context.active(), span), () => fn(span))
  }) as Tracer["startActiveSpan"],
}

const provider: TracerProvider = { getTracer: () => tracer }

/** Stands in for the network under Next.js's wrapper. */
const transport = vi.fn(async () => new Response(rangeBody([`${SUFFIX}:42`])))

function everythingExported() {
  return JSON.stringify(exported).toUpperCase()
}

beforeAll(() => {
  expect(trace.setGlobalTracerProvider(provider)).toBe(true)
  // The real Next.js fetch wrapper, outside a request's work store, which is
  // how a route handler's server code reaches it.
  const nextFetch = createPatchedFetcher(
    transport as typeof fetch,
    {
      workAsyncStorage: { getStore: () => undefined },
      workUnitAsyncStorage: { getStore: () => undefined },
    } as never
  )
  vi.stubGlobal("fetch", nextFetch)
})

afterAll(() => {
  vi.unstubAllGlobals()
  trace.disable()
})

beforeEach(() => {
  exported.length = 0
  transport.mockClear()
  vi.mocked(request).mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("breached-password telemetry", () => {
  it("records the prefix when the range is fetched through Next.js's fetch (the recorder works)", async () => {
    const init = { opentelemetry: { ignore: true } } as RequestInit
    await fetch(RANGE_URL, init)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(exported.length).toBeGreaterThan(0)
    expect(exported.flatMap((span) => span.names)).toContain(
      `fetch GET ${RANGE_URL}`
    )
    expect(exported.map((span) => span.attributes["http.url"])).toContain(
      RANGE_URL
    )
  })

  it("exports no span carrying the prefix, the suffix or the password", async () => {
    vi.mocked(request).mockImplementation(
      fakeRangeRequest({ status: 200, body: rangeBody([`${SUFFIX}:42`]) })
    )
    const error = await assertPasswordNotBreached(PASSWORD).catch((e) => e)
    const all = everythingExported()
    expect(all).not.toContain(PREFIX)
    expect(all).not.toContain(SUFFIX)
    expect(all).not.toContain(PASSWORD.toUpperCase())
    expect(all).not.toContain("PWNEDPASSWORDS")
    // The check really ran and found the hit, through node:https.
    expect(error).toBeInstanceOf(ApiError)
    expect(request).toHaveBeenCalledTimes(1)
    expect(transport).not.toHaveBeenCalled()
  })

  it("exports nothing carrying the prefix when the check fails open either", async () => {
    vi.mocked(request).mockImplementation(
      fakeRangeRequest({ error: new Error("ECONNREFUSED") })
    )
    const outcome = await assertPasswordNotBreached(PASSWORD).catch((e) => e)
    expect(everythingExported()).not.toContain(PREFIX)
    expect(outcome).toBeUndefined()
    expect(transport).not.toHaveBeenCalled()
  })
})
