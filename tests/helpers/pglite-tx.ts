import type { TransactionSql } from "postgres"

// A postgres.js-shaped transaction over PGlite that understands the helper
// forms the write pipeline uses -- nested fragments, `sql(identifier)`,
// `sql(row)` insert/update helpers and `sql.json()` -- rendering them into
// text + parameters. Shared by tests/gbp-write.test.ts and
// tests/mutation-operations.test.ts; tests/helpers/pglite-sql.ts is the
// lighter variant for plain loaders.

type QueryLike = { strings: readonly string[]; args: unknown[] }
type Helper =
  | { kind: "identifier"; name: string }
  | { kind: "list"; values: unknown[] }
  | { kind: "row"; row: Record<string, unknown> }
type JsonParam = { kind: "json"; value: unknown }
export type Runner = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

const isTemplate = (value: unknown): value is TemplateStringsArray =>
  Array.isArray(value) && "raw" in value
const isQuery = (value: unknown): value is QueryLike =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as QueryLike).strings) &&
  Array.isArray((value as QueryLike).args)
const isHelper = (value: unknown): value is Helper =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  ["identifier", "list", "row"].includes(String((value as Helper).kind))
const isJson = (value: unknown): value is JsonParam =>
  typeof value === "object" &&
  value !== null &&
  (value as JsonParam).kind === "json"
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

function pushParam(params: unknown[], value: unknown): string {
  if (isJson(value)) {
    params.push(JSON.stringify(value.value))
    return `$${params.length}::jsonb`
  }
  params.push(value)
  return `$${params.length}`
}

function render(
  query: QueryLike,
  params: unknown[] = []
): { text: string; params: unknown[] } {
  let text = query.strings[0]
  for (let i = 1; i < query.strings.length; i += 1) {
    const arg = query.args[i - 1]
    if (isQuery(arg)) {
      text += render(arg, params).text
    } else if (isHelper(arg)) {
      if (arg.kind === "identifier") text += quote(arg.name)
      else if (arg.kind === "list") {
        text += `(${arg.values.map((value) => pushParam(params, value)).join(",")})`
      } else {
        const entries = Object.entries(arg.row)
        text += /\bset\s*$/i.test(text)
          ? entries
              .map(
                ([column, value]) =>
                  `${quote(column)} = ${pushParam(params, value)}`
              )
              .join(", ")
          : `(${entries.map(([column]) => quote(column)).join(",")}) values (${entries.map(([, value]) => pushParam(params, value)).join(",")})`
      }
    } else {
      text += pushParam(params, arg)
    }
    text += query.strings[i]
  }
  return { text: text.replace(/\s+/g, " ").trim(), params }
}

export function pgliteSql(runner: Runner): TransactionSql {
  const fn = (first: unknown, ...rest: unknown[]) => {
    if (isTemplate(first)) {
      const query: QueryLike & { then: unknown } = {
        strings: first,
        args: rest,
        then<T>(
          onFulfilled: (rows: unknown[]) => T,
          onRejected?: (error: unknown) => T
        ) {
          const { text, params } = render(query)
          return runner
            .query(text, params)
            .then((result) => result.rows)
            .then(onFulfilled, onRejected)
        },
      }
      return query
    }
    if (typeof first === "string") return { kind: "identifier", name: first }
    if (Array.isArray(first)) return { kind: "list", values: first }
    return { kind: "row", row: first as Record<string, unknown> }
  }
  fn.json = (value: unknown): JsonParam => ({ kind: "json", value })
  return fn as unknown as TransactionSql
}
