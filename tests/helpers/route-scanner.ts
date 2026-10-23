import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * One static reader of app/api route handlers for the contract scans
 * (route-authorization-contract, mfa-step-up-contract, route-entitlements,
 * route-max-duration, role-copy).
 *
 * Every scan reads code, never comments: a commented-out guard or an
 * `auth: "public"` in a comment proves nothing. A handler is the text of its
 * own `route(...)` call, not everything from its export to the next one, so a
 * guard in a neighbouring handler or a module helper the handler never calls
 * cannot stand in for its own. Route config keys are read at the top level of
 * that call's object only. Any other way of exporting an HTTP method (a
 * function, a wrapped or `let` route, a re-export, `export *`, a
 * destructured export), and any declaration the reader lost track of, is
 * reported as unrecognised, so a handler the scans cannot read fails loudly
 * instead of escaping every check.
 */

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

export const HTTP_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export const MUTATING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
])

const METHOD = HTTP_METHODS.join("|")

type Views = {
  /** The source with every comment blanked; strings and regexes intact. */
  code: string
  /** As `code`, with string, template and regex literal contents blanked too. */
  skeleton: string
}

const REGEX_AFTER = new Set([..."(,=:[!&|?{};+-*%<>~^"])
// A keyword, not a property of the same name (`range.in / 2` divides).
const REGEX_AFTER_WORD =
  /(?:^|[^\w$.])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/

/**
 * Blanks comments (and, in the skeleton, literal contents) with spaces,
 * keeping every newline, so offsets in all three texts line up.
 */
function views(source: string): Views {
  const code = source.split("")
  const skeleton = source.split("")
  const blank = (from: number, to: number, both: boolean) => {
    for (let index = from; index < to; index += 1) {
      if (source[index] === "\n") continue
      skeleton[index] = " "
      if (both) code[index] = " "
    }
  }
  // Template literal frames: the brace depth at which `${` reopened code.
  const templates: number[] = []
  let depth = 0
  let last = ""
  let index = 0

  const readString = (quote: string) => {
    const start = index
    index += 1
    while (index < source.length && source[index] !== quote) {
      if (source[index] === "\\") index += 1
      // A quote string cannot span lines: reaching one means a regex or a
      // division was misread, and everything after it would be misread too.
      else if (source[index] === "\n") {
        throw new Error(`unterminated string from offset ${start}`)
      }
      index += 1
    }
    blank(start + 1, index, false)
    index += 1
  }

  /** Template text from `index` (just past a backtick or a closing `}`). */
  const readTemplateText = () => {
    const start = index
    while (index < source.length) {
      const char = source[index]
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === "`") {
        blank(start, index, false)
        index += 1
        return
      }
      if (char === "$" && source[index + 1] === "{") {
        blank(start, index, false)
        index += 2
        templates.push(depth)
        depth += 1
        return
      }
      index += 1
    }
    blank(start, index, false)
  }

  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index)
      const stop = end === -1 ? source.length : end
      blank(index, stop, true)
      index = stop
      continue
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(index, stop, true)
      index = stop
      continue
    }
    if (char === '"' || char === "'") {
      readString(char)
      last = char
      continue
    }
    if (char === "`") {
      index += 1
      readTemplateText()
      last = "`"
      continue
    }
    if (
      char === "/" &&
      (last === "" ||
        REGEX_AFTER.has(last) ||
        REGEX_AFTER_WORD.test(
          source.slice(Math.max(0, index - 13), index).trimEnd()
        ))
    ) {
      const start = index
      index += 1
      let inClass = false
      while (index < source.length && source[index] !== "\n") {
        const current = source[index]
        if (current === "\\") index += 1
        else if (current === "[") inClass = true
        else if (current === "]") inClass = false
        else if (current === "/" && !inClass) break
        index += 1
      }
      blank(start + 1, index, false)
      index += 1
      last = "/"
      continue
    }
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (templates.length && templates.at(-1) === depth) {
        templates.pop()
        index += 1
        readTemplateText()
        last = "`"
        continue
      }
    }
    if (!/\s/.test(char)) {
      last = /[\w$]/.test(char) ? "w" : char
    }
    index += 1
  }
  return { code: code.join(""), skeleton: skeleton.join("") }
}

/** `source` with every comment replaced by spaces (newlines kept). */
export function stripComments(source: string): string {
  return views(source).code
}

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" }

/** Index just past the bracket that closes the one at `open`, in `skeleton`. */
function closeOf(skeleton: string, open: number): number {
  const stack: string[] = []
  for (let index = open; index < skeleton.length; index += 1) {
    const char = skeleton[index]!
    if (OPEN[char]) stack.push(OPEN[char]!)
    else if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== char) {
        throw new Error(`unbalanced ${char} at offset ${index}`)
      }
      if (stack.length === 0) return index + 1
    }
  }
  throw new Error(`no closing bracket for offset ${open}`)
}

export type RouteHandler = {
  method: HttpMethod
  /** Repository-relative path, forward slashes. */
  file: string
  /** `${method} ${file}` */
  key: string
  /** The code (comments blanked) of this handler's own `route(...)` call. */
  config: string
}

export type ScannedRoute = {
  file: string
  /** The whole module, comments blanked. */
  code: string
  handlers: RouteHandler[]
  /**
   * HTTP methods this module exports in a form other than
   * `export const METHOD = route(...)`, which none of the scans could read.
   */
  unrecognised: string[]
}

/** `export` as a keyword anywhere, not only at the start of a line. */
const EXPORT = "(?<![\\w$.])export"

const RECOGNISED = new RegExp(
  `${EXPORT}\\s+const\\s+(${METHOD})\\s*(?::[^=\\n]+)?=\\s*route\\s*(?:<[^>]*>)?\\s*\\(`,
  "g"
)

/** Declares an HTTP method by name: const, let, var or function. */
const DECLARED = new RegExp(
  `${EXPORT}\\s+(?:const|let|var|(?:async\\s+)?function\\s*\\*?)\\s+(${METHOD})\\b`,
  "g"
)
const RE_EXPORT = new RegExp(`${EXPORT}\\s+(?:type\\s+)?\\{([^}]*)\\}`, "g")
const EXPORT_ALL = new RegExp(`${EXPORT}\\s*\\*`, "g")
const DESTRUCTURED = new RegExp(
  `${EXPORT}\\s+(?:const|let|var)\\s*[{[]([^=]*)=`,
  "g"
)

const methodNamed = (name: string | undefined) =>
  name !== undefined && (HTTP_METHODS as readonly string[]).includes(name)

/** Reads one route module (`file` relative to the repository root). */
export function scanRouteSource(file: string, source: string): ScannedRoute {
  const { code, skeleton } = views(source)
  const handlers: RouteHandler[] = []
  const recognisedAt = new Set<number>()
  for (const match of skeleton.matchAll(RECOGNISED)) {
    const method = match[1] as HttpMethod
    const open = match.index + match[0].length - 1
    const end = closeOf(skeleton, open)
    recognisedAt.add(match.index)
    handlers.push({
      method,
      file,
      key: `${method} ${file}`,
      config: code.slice(match.index + match[0].search(/route\s*(<|\()/), end),
    })
  }
  const unrecognised: string[] = []
  const declared: string[] = []
  for (const match of skeleton.matchAll(DECLARED)) {
    declared.push(match[1]!)
    if (!recognisedAt.has(match.index)) unrecognised.push(match[1]!)
  }
  for (const match of skeleton.matchAll(RE_EXPORT)) {
    // Re-exports: `export { handler as POST }` or `export { GET } from`.
    const names = code
      .slice(match.index, match.index + match[0].length)
      .replace(/^[^{]*\{/, "")
      .replace(/\}$/, "")
      .split(",")
      .map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim()
      )
    for (const name of names) {
      if (methodNamed(name)) unrecognised.push(`${name} (re-export)`)
    }
  }
  for (let count = [...skeleton.matchAll(EXPORT_ALL)].length; count; count--) {
    unrecognised.push("* (export all)")
  }
  for (const match of skeleton.matchAll(DESTRUCTURED)) {
    for (const name of match[1]!.match(/[A-Z]+/g) ?? []) {
      if (methodNamed(name)) unrecognised.push(`${name} (destructured)`)
    }
  }
  // Cross-check against the code with only comments removed: a method
  // declared there that the literal-aware reading did not see means the
  // reader lost its place, so it is reported rather than silently skipped.
  const seen = [...declared]
  for (const match of code.matchAll(DECLARED)) {
    const at = seen.indexOf(match[1]!)
    if (at === -1) unrecognised.push(`${match[1]} (unread)`)
    else seen.splice(at, 1)
  }
  return { file, code, handlers, unrecognised }
}

/** Every `route.ts` under app/api, repository-relative and sorted. */
export function routeFiles(dir = "app/api"): string[] {
  const walk = (absolute: string): string[] =>
    readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) return walk(path)
      return entry.name === "route.ts" ? [path] : []
    })
  return walk(join(repoRoot, dir))
    .map((path) => relative(repoRoot, path).split("\\").join("/"))
    .sort()
}

const scanned = new Map<string, ScannedRoute>()

/** Reads one route module from the repository. */
export function scanRouteFile(file: string): ScannedRoute {
  const cached = scanned.get(file)
  if (cached) return cached
  const result = scanRouteSource(
    file,
    readFileSync(join(repoRoot, file), "utf8")
  )
  scanned.set(file, result)
  return result
}

/** Every route module under app/api. */
export function scanRoutes(dir = "app/api"): ScannedRoute[] {
  return routeFiles(dir).map(scanRouteFile)
}

/** Every handler under app/api. */
export function routeHandlers(dir = "app/api"): RouteHandler[] {
  return scanRoutes(dir).flatMap((route) => route.handlers)
}

/**
 * The value text of a key at the top level of a `route({...})` config, or
 * undefined when the config does not set it. A shorthand key (`maxDuration,`)
 * returns its own name. Keys inside the handler or any nested object do not
 * count.
 */
export function routeConfigValue(
  config: string,
  key: string
): string | undefined {
  const { skeleton } = views(config)
  const open = skeleton.indexOf("{", skeleton.indexOf("("))
  if (open === -1) return undefined
  const close = closeOf(skeleton, open) - 1
  let start = open + 1
  let index = start
  const entries: [number, number][] = []
  while (index < close) {
    const char = skeleton[index]!
    if (OPEN[char]) {
      index = closeOf(skeleton, index)
      continue
    }
    if (char === ",") {
      entries.push([start, index])
      start = index + 1
    }
    index += 1
  }
  entries.push([start, close])
  for (const [from, to] of entries) {
    const entry = skeleton.slice(from, to)
    const named = new RegExp(`^\\s*${key}\\s*(:|$)`).exec(entry)
    if (!named) continue
    if (named[1] === "") return key
    return config.slice(from + named[0].length, to).trim()
  }
  return undefined
}

/** A route config key that holds a string literal, e.g. `auth: "cron"`. */
export function routeConfigString(
  config: string,
  key: string
): string | undefined {
  const value = routeConfigValue(config, key)
  return value === undefined ? undefined : /^"([^"]*)"$/.exec(value)?.[1]
}

/**
 * The string literals of a route config array key, e.g. `roles: [...]`, or
 * undefined when the key is absent or not a plain list of literals.
 */
export function routeConfigStrings(
  config: string,
  key: string
): string[] | undefined {
  const value = routeConfigValue(config, key)
  // Only a list of string literals: a spread or a constant is not readable.
  if (
    value === undefined ||
    !/^\[\s*(?:(["'])[^"']*\1\s*(?:,\s*)?)*\]$/.test(value)
  ) {
    return undefined
  }
  return [...value.matchAll(/["']([^"']*)["']/g)].map((match) => match[1]!)
}

/** A module's code with comments blanked. */
export function readCode(file: string): string {
  return stripComments(readFileSync(join(repoRoot, file), "utf8"))
}

/**
 * The code of one top-level function declaration in a module: from its last
 * `function name` (the implementation, after any overload signatures) to the
 * brace that closes its body.
 */
export function functionBody(file: string, name: string): string {
  return functionBodyIn(readFileSync(join(repoRoot, file), "utf8"), name, file)
}

export function functionBodyIn(
  source: string,
  name: string,
  label = "source"
): string {
  const { code, skeleton } = views(source)
  const starts = [
    ...skeleton.matchAll(
      new RegExp(`^(?:export )?(?:async )?function\\s*\\*?\\s*${name}\\b`, "gm")
    ),
  ]
  const start = starts.at(-1)?.index
  if (start === undefined) throw new Error(`${label} has no function ${name}`)
  const params = skeleton.indexOf("(", start)
  let index = closeOf(skeleton, params)
  // Skip a return type annotation: a `{` straight after `:`, `|`, `&`, `<`
  // or `,` opens a type literal; the first other `{` opens the body.
  let previous = ""
  let angle = 0
  while (index < skeleton.length) {
    const char = skeleton[index]!
    if (char === "=" && skeleton[index + 1] === ">") {
      index += 2
      previous = ">"
      continue
    }
    if (char === "<") angle += 1
    if (char === ">") angle -= 1
    if (char === "(" || char === "[") {
      index = closeOf(skeleton, index)
      previous = ")"
      continue
    }
    if (char === "{") {
      if (angle > 0 || [":", "|", "&", "<", ","].includes(previous)) {
        index = closeOf(skeleton, index)
        previous = "}"
        continue
      }
      return code.slice(start, closeOf(skeleton, index))
    }
    if (!/\s/.test(char)) previous = char
    index += 1
  }
  throw new Error(`${label}: no body for function ${name}`)
}

/** `source` with comments and string, template and regex contents blanked. */
export function withoutLiterals(source: string): string {
  return views(source).skeleton
}

/** Calls `name(` in `code`, outside comments and string literals. */
export function calls(code: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(withoutLiterals(code))
}
