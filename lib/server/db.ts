import "server-only"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"
import postgres, { type Sql, type TransactionSql } from "postgres"

import { getServerEnv } from "@/lib/server/env"

declare global {
  var __nabaSql: Sql | undefined
}

const tracer = trace.getTracer("nabareview.database")
const meter = metrics.getMeter("nabareview.database")
const tenantTransactionDuration = meter.createHistogram(
  "nabareview.tenant_transaction.duration",
  {
    description: "Tenant-scoped PostgreSQL transaction duration",
    unit: "ms",
  }
)
const tenantTransactionCount = meter.createCounter(
  "nabareview.tenant_transaction.count",
  {
    description: "Tenant-scoped PostgreSQL transaction outcomes",
  }
)

export function getDatabase(): Sql {
  if (!globalThis.__nabaSql) {
    globalThis.__nabaSql = postgres(getServerEnv().DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    })
  }
  return globalThis.__nabaSql
}

export async function withTenant<T>(
  organisationId: string,
  callback: (sql: TransactionSql) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    "database.tenant_transaction",
    { attributes: { "tenant.id": organisationId } },
    async (span) => {
      const startedAt = performance.now()
      let outcome = "success"
      try {
        return (await getDatabase().begin(async (transaction) => {
          await transaction`
            select set_config('app.organisation_id', ${organisationId}, true)
          `
          return callback(transaction)
        })) as T
      } catch (error) {
        outcome = "error"
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        const attributes = {
          "tenant.id": organisationId,
          outcome,
        }
        tenantTransactionDuration.record(
          performance.now() - startedAt,
          attributes
        )
        tenantTransactionCount.add(1, attributes)
        span.setAttribute("outcome", outcome)
        span.end()
      }
    }
  )
}
