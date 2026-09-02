import "server-only"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"
import postgres, {
  type JSONValue,
  type Parameter,
  type Sql,
  type TransactionSql,
} from "postgres"

import { getServerEnv } from "@/lib/server/env"

declare global {
  var __nabaSql: Sql | undefined
}

const tracer = trace.getTracer("nabapresence.database")
const meter = metrics.getMeter("nabapresence.database")
const tenantTransactionDuration = meter.createHistogram(
  "nabapresence.tenant_transaction.duration",
  {
    description: "Tenant-scoped PostgreSQL transaction duration",
    unit: "ms",
  }
)
const tenantTransactionCount = meter.createCounter(
  "nabapresence.tenant_transaction.count",
  {
    description: "Tenant-scoped PostgreSQL transaction outcomes",
  }
)

export function getDatabase(): Sql {
  if (!globalThis.__nabaSql) {
    globalThis.__nabaSql = postgres(getServerEnv().DATABASE_URL, {
      max: getServerEnv().DATABASE_POOL_MAX,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      connection: {
        statement_timeout: 30_000,
        idle_in_transaction_session_timeout: 60_000,
      },
    })
  }
  return globalThis.__nabaSql
}

/**
 * Anything that can build a jsonb parameter: the pooled `Sql`, a
 * `TransactionSql` from `withTenant`, or a test double that implements `json`.
 */
export type JsonSql = { json: Sql["json"] }

/**
 * Builds a jsonb column parameter from any value: `sql.json(value)` after a
 * JSON round-trip that strips `undefined` members, prototypes, Dates (to ISO
 * strings) and anything else postgres.js refuses to serialise. This is THE
 * way to write a jsonb column; do not inline
 * `sql.json(JSON.parse(JSON.stringify(x)) as never)` again.
 *
 * `undefined` and `null` both become the JSON literal `null` (a non-null
 * jsonb). Use `jsonColumnOrNull` when the column itself should be SQL NULL.
 */
export function jsonColumn(sql: JsonSql, value: unknown): Parameter {
  return sql.json(JSON.parse(JSON.stringify(value ?? null)) as JSONValue)
}

/** `jsonColumn`, except `undefined`/`null` write SQL NULL instead of jsonb null. */
export function jsonColumnOrNull(
  sql: JsonSql,
  value: unknown
): Parameter | null {
  return value === undefined || value === null ? null : jsonColumn(sql, value)
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
