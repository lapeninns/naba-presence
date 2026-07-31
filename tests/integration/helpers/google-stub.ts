import { once } from "node:events"
import { createServer, type Server } from "node:http"

export type GoogleStubCall = {
  method: string
  path: string
  body: unknown
}

export type GoogleStubResponse = {
  status: number
  json?: unknown
  delayMs?: number
}

type Handler = (call: GoogleStubCall) => GoogleStubResponse
type Rule = {
  method: string
  pathIncludes: string
  handler: Handler
}

export type GoogleStub = {
  baseUrl: string
  calls: GoogleStubCall[]
  respond(
    matcher: { method: string; pathIncludes: string },
    handler: Handler
  ): void
  reset(): void
  stop(): Promise<void>
}

export async function startGoogleStub(): Promise<GoogleStub> {
  const calls: GoogleStubCall[] = []
  const rules: Rule[] = []
  const server: Server = createServer(async (request, response) => {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const contentType = request.headers["content-type"] ?? ""
    const call: GoogleStubCall = {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      body: raw
        ? contentType.includes("application/json")
          ? JSON.parse(raw)
          : contentType.includes("application/x-www-form-urlencoded")
            ? Object.fromEntries(new URLSearchParams(raw))
            : raw
        : undefined,
    }
    calls.push(call)
    const rule = rules.find(
      (candidate) =>
        candidate.method === call.method &&
        call.path.includes(candidate.pathIncludes)
    )
    const result = rule ? rule.handler(call) : defaultResponse(call)
    if (result.delayMs) {
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, result.delayMs)),
        once(response, "close"),
      ])
    }
    if (response.destroyed) return
    response.writeHead(result.status, {
      "content-type": "application/json",
    })
    response.end(JSON.stringify(result.json ?? {}))
  })
  const configuredPort = process.env.GOOGLE_STUB_PORT
  const port = configuredPort ? Number.parseInt(configuredPort, 10) : 0
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("GOOGLE_STUB_PORT must be a valid TCP port.")
  }
  server.listen(port, "127.0.0.1")
  await once(server, "listening")
  const { port: listeningPort } = server.address() as { port: number }
  return {
    baseUrl: `http://127.0.0.1:${listeningPort}`,
    calls,
    respond(
      matcher: { method: string; pathIncludes: string },
      handler: Handler
    ) {
      rules.unshift({ ...matcher, handler })
    },
    reset() {
      calls.length = 0
      rules.length = 0
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function defaultResponse(call: GoogleStubCall): GoogleStubResponse {
  if (call.method === "PUT" && call.path.endsWith("/reply")) {
    const body = call.body as { comment?: string }
    return {
      status: 200,
      json: {
        comment: body?.comment ?? "",
        updateTime: "2026-08-20T10:00:00.000Z",
      },
    }
  }
  if (call.method === "DELETE" && call.path.endsWith("/reply")) {
    return { status: 200, json: {} }
  }
  if (call.method === "GET" && call.path.includes("/reviews/")) {
    return {
      status: 200,
      json: { reviewId: "stub", comment: "" },
    }
  }
  return {
    status: 404,
    json: { error: { status: "NOT_FOUND" } },
  }
}
