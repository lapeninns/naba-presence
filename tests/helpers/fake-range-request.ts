import { EventEmitter } from "node:events"
import type { IncomingMessage, RequestOptions } from "node:http"
import { PassThrough } from "node:stream"

/**
 * Stands in for node:https `request` in front of Pwned Passwords, so no test
 * calls the real API. Use with `vi.mock("node:https", () => ({ request:
 * vi.fn() }))` and `vi.mocked(request).mockImplementation(fakeRangeRequest(…))`.
 */
export type RangeReply =
  /** The service answers with this status and body. */
  | { status: number; body: string }
  /** The connection fails before any answer. */
  | { error: Error }
  /** A 200 whose body breaks off part-way. */
  | { bodyError: Error }
  /** No answer at all, until the caller gives up. */
  | "hang"

export type FakeRangeRequest = {
  options: RequestOptions
  destroyed: boolean
}

export function fakeRangeRequest(
  reply: RangeReply | ((options: RequestOptions) => RangeReply),
  sent: FakeRangeRequest[] = []
) {
  return ((
    options: RequestOptions,
    onResponse: (res: IncomingMessage) => void
  ) => {
    const record: FakeRangeRequest = { options, destroyed: false }
    sent.push(record)
    const req = Object.assign(new EventEmitter(), {
      destroy() {
        record.destroyed = true
        return req
      },
      end() {
        queueMicrotask(() => {
          if (record.destroyed) return
          const answer = typeof reply === "function" ? reply(options) : reply
          if (answer === "hang") return
          if ("error" in answer) {
            req.emit("error", answer.error)
            return
          }
          const res = Object.assign(new PassThrough(), {
            statusCode: "status" in answer ? answer.status : 200,
          })
          onResponse(res as unknown as IncomingMessage)
          if ("bodyError" in answer) {
            res.write("0".repeat(35))
            res.destroy(answer.bodyError)
          } else {
            res.end(answer.body)
          }
        })
        return req
      },
    })
    return req
  }) as unknown as typeof import("node:https").request
}

/** A range body, records joined the way the API joins them. */
export function rangeBody(records: string[]) {
  return records.join("\r\n")
}
