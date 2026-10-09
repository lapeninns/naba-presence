import type { PGlite } from "@electric-sql/pglite"
import type { TransactionSql } from "postgres"

// A postgres.js-shaped `sql` that runs tagged-template queries against
// PGlite, so server loaders can be executed against real PostgreSQL
// semantics without a database server. Same approach as
// tests/permissions.test.ts, plus `sql.unsafe` (raw SQL text, used for
// column names) and a log of every statement executed.

type QueryLike = { strings: readonly string[]; args: unknown[] }
type BuilderLike = { first: unknown[] }
type UnsafeLike = { unsafe: string }

function isTaggedTemplateCall(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value
}

function isQueryLike(value: unknown): value is QueryLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as QueryLike).strings) &&
    Array.isArray((value as QueryLike).args)
  )
}

function isBuilderLike(value: unknown): value is BuilderLike {
  return (
    typeof value === "object" &&
    value !== null &&
    !isQueryLike(value) &&
    Array.isArray((value as BuilderLike).first)
  )
}

function isUnsafeLike(value: unknown): value is UnsafeLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UnsafeLike).unsafe === "string"
  )
}

export function render(
  query: QueryLike,
  params: unknown[] = []
): { text: string; params: unknown[] } {
  let text = query.strings[0]
  for (let i = 1; i < query.strings.length; i++) {
    const arg = query.args[i - 1]
    if (isQueryLike(arg)) {
      text += render(arg, params).text
    } else if (isUnsafeLike(arg)) {
      text += arg.unsafe
    } else if (isBuilderLike(arg)) {
      text +=
        "(" +
        arg.first
          .map((value) => {
            params.push(value)
            return `$${params.length}`
          })
          .join(",") +
        ")"
    } else {
      params.push(arg)
      text += `$${params.length}`
    }
    text += query.strings[i]
  }
  return { text: text.replace(/\s+/g, " ").trim(), params }
}

export type ExecutedStatement = { text: string; params: unknown[] }

export function pgliteSql(db: PGlite): {
  sql: TransactionSql
  executed: ExecutedStatement[]
} {
  const executed: ExecutedStatement[] = []
  const fn = (first: unknown, ...args: unknown[]) => {
    if (isTaggedTemplateCall(first)) {
      const query = {
        strings: first,
        args,
        then<T>(
          onFulfilled: (rows: unknown[]) => T,
          onRejected?: (error: unknown) => T
        ) {
          const rendered = render(query)
          executed.push(rendered)
          return db
            .query(rendered.text, rendered.params)
            .then((result) => result.rows)
            .then(onFulfilled, onRejected)
        },
      }
      return query
    }
    return { first }
  }
  const sql = Object.assign(fn, {
    unsafe: (text: string) => ({ unsafe: text }),
  })
  return { sql: sql as unknown as TransactionSql, executed }
}
