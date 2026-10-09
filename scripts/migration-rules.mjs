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
 *
 * @param {string} text
 */
export function maskSql(text) {
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
 * @param {string} file
 * @param {string} text
 * @returns {{ transactional: boolean, body: string }}
 */
export function prepareMigration(file, text) {
  if (text.split("\n", 1)[0].trim() === NO_TRANSACTION_MARKER) {
    return { transactional: false, body: text }
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
