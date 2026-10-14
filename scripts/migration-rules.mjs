// Migration rules shared by scripts/db-migrate.mjs, scripts/ci/migration-policy.mjs
// and tests/migration-contract.test.ts. Pure: no database, no git.

export const NO_TRANSACTION_MARKER = "-- migrate:no-transaction"

/** New migrations: a 4-digit zero-padded version and a snake_case name. */
export const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/

/**
 * Files that predate the naming rule. `20260729000400_…` was renamed from a
 * duplicate `0004` in SEC-101 and is already recorded under that version in
 * deployed databases, so it can never be renamed. It is not a sequence
 * number: it is ignored when finding the highest version.
 */
export const LEGACY_MIGRATION_FILES = [
  "20260729000400_remove_local_demo_data.sql",
]

/** Versions that were never used. Git history has no `0021` file. */
export const KNOWN_VERSION_GAPS = ["0021"]

/** @param {string} file */
export const versionNumber = (file) => Number(file.slice(0, 4))

/**
 * The version a migration file records in `schema_migration`: its basename
 * without `.sql`.
 * @param {string} file
 */
export const migrationVersion = (file) => file.replace(/\.sql$/, "")

/**
 * Sorted versions of the `.sql` files in a directory listing. Shared by
 * db:status and the required-migrations manifest test, so both agree with
 * db:migrate on what a version is.
 * @param {string[]} files
 */
export function listMigrationVersions(files) {
  return files
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map(migrationVersion)
}

/**
 * The database db:migrate and db:status act on. The admin URL wins over the
 * runtime URL, so `DIRECT_DATABASE_URL=... pnpm db:status` checks the same
 * database `DIRECT_DATABASE_URL=... pnpm db:migrate` changed, even when a
 * local .env supplies DATABASE_URL.
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
export const migrationDatabaseUrl = (env) =>
  env.DIRECT_DATABASE_URL ?? env.DATABASE_URL

/**
 * `host:port/database` of a connection URL, without credentials or query, so
 * an operator can see which database a script checked.
 * @param {string} url
 */
export function describeDatabaseTarget(url) {
  try {
    const parsed = new URL(url)
    const port = parsed.port || "5432"
    return `${parsed.hostname}:${port}${parsed.pathname}`
  } catch {
    return "(unparseable database URL)"
  }
}

/**
 * Compare applied versions with the repository's.
 * - pending: in the repository, not applied (sorted as in the repository).
 * - unknown: applied, not in the repository (sorted); the database may be
 *   ahead of the code.
 * @param {Iterable<string>} applied
 * @param {string[]} repositoryVersions
 * @returns {{ pending: string[], unknown: string[] }}
 */
export function compareMigrations(applied, repositoryVersions) {
  const appliedSet = new Set(applied)
  const known = new Set(repositoryVersions)
  return {
    pending: repositoryVersions.filter((version) => !appliedSet.has(version)),
    unknown: [...appliedSet].filter((version) => !known.has(version)).sort(),
  }
}

/**
 * Highest sequence number among non-legacy files.
 * @param {string[]} files
 */
export function highestVersion(files) {
  return Math.max(
    0,
    ...files
      .filter((file) => !LEGACY_MIGRATION_FILES.includes(file))
      .filter((file) => MIGRATION_FILE_PATTERN.test(file))
      .map(versionNumber)
  )
}

/**
 * Blank out comments, string literals, quoted identifiers and dollar-quoted
 * bodies, keeping the text's length and newlines, so top-level statements
 * and their keywords can be found with plain string operations.
 * `keepIdentifiers` leaves quoted identifiers in place, for reading names.
 *
 * @param {string} text
 * @param {{ keepIdentifiers?: boolean }} [options]
 */
export function maskSql(text, { keepIdentifiers = false } = {}) {
  const out = text.split("")
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " "
  }
  const wordBefore = (/** @type {number} */ k) => /[\w$]/.test(text[k] ?? "")
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    let end = -1
    if (c === "-" && next === "-") {
      end = text.indexOf("\n", i)
      if (end === -1) end = text.length
    } else if (c === "/" && next === "*") {
      let depth = 1
      end = i + 2
      while (end < text.length && depth > 0) {
        const pair = text.slice(end, end + 2)
        if (pair === "/*" || pair === "*/") {
          depth += pair === "/*" ? 1 : -1
          end += 2
        } else {
          end += 1
        }
      }
    } else if (c === '"' && keepIdentifiers) {
      const close = text.indexOf('"', i + 1)
      i = close === -1 ? text.length : close + 1
      continue
    } else if (c === "'" || c === '"') {
      const backslashEscapes =
        c === "'" && /[eE]/.test(text[i - 1] ?? "") && !wordBefore(i - 2)
      end = i + 1
      while (end < text.length) {
        if (backslashEscapes && text[end] === "\\") end += 2
        else if (text[end] === c && text[end + 1] === c) end += 2
        else if (text[end] === c) {
          end += 1
          break
        } else end += 1
      }
    } else if (c === "$" && !wordBefore(i - 1)) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64))
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length)
        end = close === -1 ? text.length : close + tag[0].length
      }
    }
    if (end === -1) {
      i += 1
    } else {
      blank(i, Math.min(end, text.length))
      i = end
    }
  }
  return out.join("")
}

/**
 * Top-level statements of a masked SQL text, with offsets into the original.
 *
 * @param {string} masked
 */
function statements(masked) {
  /** @type {{ start: number, end: number, words: string[] }[]} */
  const result = []
  let start = 0
  for (let i = 0; i <= masked.length; i += 1) {
    if (i < masked.length && masked[i] !== ";") continue
    const segment = masked.slice(start, i)
    const lead = segment.search(/\S/)
    if (lead !== -1) {
      result.push({
        start: start + lead,
        end: Math.min(i + 1, masked.length),
        words: segment.trim().toLowerCase().split(/\s+/),
      })
    }
    start = i + 1
  }
  return result
}

/** @param {string[]} words */
function isTransactionControl([first, second]) {
  if (first === "start" || first === "prepare") return second === "transaction"
  return [
    "begin",
    "commit",
    "end",
    "rollback",
    "abort",
    "savepoint",
    "release",
  ].includes(first)
}

/** @param {string[]} words */
const isOuterBegin = (words) => words[0] === "begin"

/** @param {string[]} words */
const isOuterCommit = (words) =>
  (words[0] === "commit" || words[0] === "end") &&
  words[1] !== "prepared" &&
  !words.includes("chain")

/**
 * Decide how db:migrate runs one migration file.
 *
 * Transactional files (the default) run inside a transaction owned by the
 * runner, so the self-record check can roll the whole file back. A file may
 * keep its historical outer `begin;` / `commit;` pair: the runner blanks that
 * pair out (keeping newlines, so error positions still match the file). Any
 * other top-level transaction control (`commit`, `end`, `rollback`,
 * `savepoint`, ...) is rejected: the file must instead opt out with
 * `-- migrate:no-transaction` on its first line. Comments, strings and
 * dollar-quoted bodies (PL/pgSQL `begin ... end;`) are ignored.
 *
 * A no-transaction file is split into its top-level statements, which the
 * runner sends one at a time: PostgreSQL runs a multi-statement query string
 * as one implicit transaction, where `create index concurrently` is refused.
 *
 * @param {string} file
 * @param {string} text
 * @returns {{ transactional: boolean, body: string, statements?: string[] }}
 */
export function prepareMigration(file, text) {
  if (text.split("\n", 1)[0].trim() === NO_TRANSACTION_MARKER) {
    return {
      transactional: false,
      body: text,
      statements: statements(maskSql(text)).map(({ start, end }) =>
        text.slice(start, end)
      ),
    }
  }

  const found = statements(maskSql(text))
  const lineOf = (/** @type {number} */ offset) =>
    text.slice(0, offset).split("\n").length
  const first = found[0]
  const last = found.at(-1)
  const opens = first !== undefined && isOuterBegin(first.words)
  const closes =
    last !== undefined && last !== first && isOuterCommit(last.words)
  if (opens !== closes) {
    const at = opens ? first : last
    throw new Error(
      `${file}:${lineOf(at?.start ?? 0)}: an outer begin; needs a matching ` +
        `final commit; (or mark the file ${NO_TRANSACTION_MARKER})`
    )
  }

  const strip = opens && closes ? [first, last] : []
  const stray = found.find(
    (statement) =>
      !strip.includes(statement) && isTransactionControl(statement.words)
  )
  if (stray) {
    throw new Error(
      `${file}:${lineOf(stray.start)}: transaction control ` +
        `(${stray.words.slice(0, 2).join(" ")}) inside a migration; the ` +
        `runner owns the transaction. Remove it, or mark the file ` +
        `${NO_TRANSACTION_MARKER} on its first line`
    )
  }

  let body = text
  for (const { start, end } of strip) {
    body =
      body.slice(0, start) +
      body.slice(start, end).replace(/[^\n]/g, " ") +
      body.slice(end)
  }
  return { transactional: true, body }
}

// ---------------------------------------------------------------------------
// Lock timeout and the expand/contract rule (docs/ci.md, "Migration safety")
// ---------------------------------------------------------------------------

/** Header line: `-- migrate:lock-timeout 30s` (or `0` for no limit). */
export const LOCK_TIMEOUT_MARKER = "-- migrate:lock-timeout"

/** Header line: `-- migrate:contract <reason>`, required for contract DDL. */
export const CONTRACT_MARKER = "-- migrate:contract"

/**
 * How long a transactional migration waits for a table lock before failing,
 * so DDL queued behind a long transaction cannot stall every request queued
 * behind it. A lock-timeout failure rolls the file back; re-run db:migrate.
 */
export const DEFAULT_LOCK_TIMEOUT = "5s"

const LOCK_TIMEOUT_PATTERN = /^(0|[1-9]\d*(ms|s|min)?)$/

/**
 * The leading comment block (the lines before the first statement), where
 * the `-- migrate:*` header markers live.
 * @param {string} text
 */
function headerLines(text) {
  const lines = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    if (!trimmed.startsWith("--")) break
    lines.push(trimmed)
  }
  return lines
}

/** @param {string} line @param {string} marker */
const markerValue = (line, marker) =>
  line === marker || line.startsWith(`${marker} `)
    ? line.slice(marker.length).trim()
    : null

/**
 * The `lock_timeout` db:migrate sets for one file, or null for none. A
 * `-- migrate:lock-timeout <value>` header wins; otherwise `fallback`
 * (MIGRATION_LOCK_TIMEOUT, else DEFAULT_LOCK_TIMEOUT) applies to
 * transactional files only. A no-transaction file gets one only from its own
 * header: a `create index concurrently` that times out waiting for old
 * transactions leaves an invalid index behind.
 *
 * @param {string} file
 * @param {string} text
 * @param {{ transactional: boolean, fallback?: string }} options
 * @returns {string | null} a validated value such as `5s`, or null
 */
export function migrationLockTimeout(
  file,
  text,
  { transactional, fallback = DEFAULT_LOCK_TIMEOUT }
) {
  const declared = headerLines(text)
    .map((line) => markerValue(line, LOCK_TIMEOUT_MARKER))
    .find((value) => value !== null)
  const value = declared ?? (transactional ? fallback : null)
  if (value === null || value === undefined) return null
  if (!LOCK_TIMEOUT_PATTERN.test(value)) {
    throw new Error(
      `${file}: lock timeout "${value}" must be 0 or an integer with ms, s ` +
        `or min (${LOCK_TIMEOUT_MARKER} 30s)`
    )
  }
  return value === "0" ? null : value
}

/**
 * The reason a file gives in its `-- migrate:contract <reason>` header, or
 * null when it has none (a bare marker with no reason does not count).
 * @param {string} text
 */
export function contractReason(text) {
  for (const line of headerLines(text)) {
    const value = markerValue(line, CONTRACT_MARKER)
    if (value) return value
  }
  return null
}

const IDENTIFIER = String.raw`(?:"[^"]+"|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w$]*))?`

/** @param {string} name */
const tableKey = (name) =>
  name
    .replace(/[\s"]/g, "")
    .replace(/^public\./, "")
    .toLowerCase()

/**
 * Contract-type or table-locking DDL that the expand/contract rule
 * (docs/ci.md, "Migration safety") keeps out of an ordinary expand migration:
 * it breaks the code still running against the old schema, makes rollback
 * to the previous deployment unsafe, or holds a long ACCESS EXCLUSIVE lock.
 * Tables the same file creates are new, so changing them is not flagged.
 *
 * Flagged: `drop table`, `drop column`, any `rename`, and, on a table the
 * file did not create, `alter column ... type`, `set not null`, `drop
 * default`, `add column ... not null` without a default, and `create index`
 * without `concurrently`. A file that means it carries a
 * `-- migrate:contract <reason>` header and ships in its own PR, after the
 * code that stopped depending on the old shape.
 *
 * @param {string} text
 * @returns {{ line: number, operation: string }[]}
 */
export function contractOperations(text) {
  const masked = maskSql(text, { keepIdentifiers: true })
  const lineOf = (/** @type {number} */ offset) =>
    text.slice(0, offset).split("\n").length
  const found = statements(masked).map((statement) => ({
    ...statement,
    sql: masked
      .slice(statement.start, statement.end)
      .replace(/;\s*$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  }))

  const createTable = new RegExp(
    String.raw`^create (?:(?:global|local) )?(?:(?:temp|temporary|unlogged) )?table (?:if not exists )?(${IDENTIFIER})`
  )
  const created = new Set(
    found
      .map(({ sql }) => createTable.exec(sql)?.[1])
      .filter((name) => name !== undefined)
      .map(tableKey)
  )

  /** @type {{ line: number, operation: string }[]} */
  const operations = []
  for (const { start, sql } of found) {
    const flag = (/** @type {string} */ operation) =>
      operations.push({ line: lineOf(start), operation })
    if (/^drop table\b/.test(sql)) {
      flag("drop table")
      continue
    }
    if (/^create (unique )?index\b/.test(sql)) {
      if (/^create (unique )?index concurrently\b/.test(sql)) continue
      const on = new RegExp(String.raw`\bon (?:only )?(${IDENTIFIER})`).exec(
        sql
      )
      if (on && !created.has(tableKey(on[1]))) {
        flag(`create index without concurrently on ${tableKey(on[1])}`)
      }
      continue
    }
    const alter = new RegExp(
      String.raw`^alter table (?:if exists )?(?:only )?(${IDENTIFIER}) (.*)$`
    ).exec(sql)
    if (!alter) continue
    const table = tableKey(alter[1])
    const isNew = created.has(table)
    for (const action of splitTopLevel(alter[2])) {
      if (/^rename\b/.test(action)) flag(`rename on ${table}`)
      else if (/^drop (?!constraint\b|default\b|not\b)/.test(action))
        flag(`drop column on ${table}`)
      else if (isNew) continue
      else if (/^alter (column )?\S+ (set data )?type\b/.test(action))
        flag(`alter column type on ${table}`)
      else if (/^alter (column )?\S+ set not null\b/.test(action))
        flag(`set not null on ${table}`)
      else if (/^alter (column )?\S+ drop default\b/.test(action))
        flag(`drop default on ${table}`)
      else if (
        /^add (?!constraint\b|primary\b|unique\b|check\b|foreign\b|exclude\b)/.test(
          action
        ) &&
        /\bnot null\b/.test(action) &&
        !/\b(default|generated)\b/.test(action)
      )
        flag(`add not null column without default on ${table}`)
    }
  }
  return operations
}

/**
 * Split `a, b (c, d), e` on the commas outside parentheses.
 * @param {string} sql
 */
function splitTopLevel(sql) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= sql.length; i += 1) {
    const c = sql[i]
    if (c === "(") depth += 1
    else if (c === ")") depth -= 1
    else if (i === sql.length || (c === "," && depth === 0)) {
      parts.push(sql.slice(start, i).trim())
      start = i + 1
    }
  }
  return parts.filter(Boolean)
}
