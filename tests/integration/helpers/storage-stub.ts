import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"

/**
 * A local stand-in for Supabase Storage's REST API: the endpoints the
 * server-only adapter (lib/server/storage/supabase-storage.ts) calls, for
 * one private bucket, in memory. Every call but the signed upload needs the
 * secret key; the signed upload needs its token.
 */
export type StorageStub = {
  baseUrl: string
  secretKey: string
  bucket: string
  objects: Map<string, { bytes: Buffer; contentType: string }>
  calls: Array<{ method: string; path: string }>
  /** Every call answers 503 while set. */
  down: boolean
  stop(): Promise<void>
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export async function startStorageStub(): Promise<StorageStub> {
  const secretKey = `sb_secret_${randomBytes(8).toString("hex")}`
  const bucket = "naba-media-test"
  const objects = new Map<string, { bytes: Buffer; contentType: string }>()
  const tokens = new Map<string, string>()
  const calls: StorageStub["calls"] = []
  const stub = { down: false } as { down: boolean }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://stub")
    const path = decodeURIComponent(url.pathname)
    calls.push({ method: request.method ?? "", path })
    const send = (status: number, json: unknown) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(json))
    }
    const raw = await body(request)
    if (stub.down) return send(503, { error: "unavailable" })
    const authorised =
      request.headers.authorization === `Bearer ${secretKey}` &&
      request.headers.apikey === secretKey
    const signPrefix = `/storage/v1/object/upload/sign/${bucket}/`
    const objectPrefix = `/storage/v1/object/${bucket}/`
    if (path.startsWith(signPrefix)) {
      const key = path.slice(signPrefix.length)
      if (request.method === "POST") {
        if (!authorised) return send(403, { error: "unauthorized" })
        const token = randomBytes(12).toString("hex")
        tokens.set(token, key)
        return send(200, {
          url: `/object/upload/sign/${bucket}/${key}?token=${token}`,
        })
      }
      if (request.method === "PUT") {
        const token = url.searchParams.get("token") ?? ""
        if (tokens.get(token) !== key)
          return send(400, { statusCode: "403", error: "invalid_token" })
        if (objects.has(key))
          return send(400, { statusCode: "409", error: "Duplicate" })
        objects.set(key, {
          bytes: raw,
          contentType: String(request.headers["content-type"] ?? ""),
        })
        return send(200, { Key: `${bucket}/${key}` })
      }
    }
    if (!authorised) return send(403, { error: "unauthorized" })
    if (
      path === `/storage/v1/object/${bucket}` &&
      request.method === "DELETE"
    ) {
      const { prefixes } = JSON.parse(raw.toString("utf8")) as {
        prefixes: string[]
      }
      for (const key of prefixes) objects.delete(key)
      return send(
        200,
        prefixes.map((name) => ({ name }))
      )
    }
    if (path.startsWith(objectPrefix)) {
      const key = path.slice(objectPrefix.length)
      if (request.method === "GET") {
        const object = objects.get(key)
        if (!object) return send(400, { statusCode: "404", error: "not_found" })
        response.writeHead(200, {
          "content-type": object.contentType,
          "content-length": String(object.bytes.length),
        })
        return response.end(object.bytes)
      }
      if (request.method === "POST") {
        if (request.headers["x-upsert"] !== "false")
          return send(400, { error: "upsert must be off" })
        if (objects.has(key))
          return send(400, { statusCode: "409", error: "Duplicate" })
        objects.set(key, {
          bytes: raw,
          contentType: String(request.headers["content-type"] ?? ""),
        })
        return send(200, { Key: `${bucket}/${key}` })
      }
    }
    return send(404, { error: "no route" })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return Object.assign(stub, {
    baseUrl: `http://127.0.0.1:${port}`,
    secretKey,
    bucket,
    objects,
    calls,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  })
}
