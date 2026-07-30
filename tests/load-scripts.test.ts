import { describe, expect, it } from "vitest"

import {
  parsePrometheusHistogramP95,
  parseLoadArgs,
  summarizeLoad,
} from "../scripts/load/common.mjs"

describe("REL-501 load script contract", () => {
  it("defaults to a five-minute run and accepts the binding CLI flags", () => {
    expect(parseLoadArgs(["--base-url", "http://127.0.0.1:3200"])).toMatchObject(
      {
        baseUrl: "http://127.0.0.1:3200",
        durationSeconds: 300,
      }
    )
    expect(
      parseLoadArgs([
        "--base-url=http://127.0.0.1:3200",
        "--duration",
        "12",
      ])
    ).toMatchObject({
      baseUrl: "http://127.0.0.1:3200",
      durationSeconds: 12,
    })
  })

  it("prints the exact required latency summary shape", () => {
    expect(
      summarizeLoad({
        sent: 5,
        ok: 4,
        failed: 1,
        durationsMs: [10, 20, 30, 40, 50],
      })
    ).toEqual({
      sent: 5,
      ok: 4,
      failed: 1,
      p50Ms: 30,
      p95Ms: 50,
      p99Ms: 50,
    })
  })

  it("reads the tenant transaction p95 from an OTLP Prometheus histogram", () => {
    expect(
      parsePrometheusHistogramP95(`
nabapresence_tenant_transaction_duration_milliseconds_bucket{outcome="success",le="10"} 90
nabapresence_tenant_transaction_duration_milliseconds_bucket{outcome="success",le="50"} 95
nabapresence_tenant_transaction_duration_milliseconds_bucket{outcome="success",le="+Inf"} 100
`)
    ).toBe(50)
  })
})
