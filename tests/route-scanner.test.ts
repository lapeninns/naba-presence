import { describe, expect, it } from "vitest"

import {
  calls,
  functionBodyIn,
  routeConfigString,
  routeConfigStrings,
  routeConfigValue,
  routeHandlers,
  scanRouteSource,
  stripComments,
} from "./helpers/route-scanner"

/**
 * The shared reader behind the route contract scans. Each case is a way a
 * scan used to be fooled (NP2-010): comments read as code, a guard anywhere
 * in the module standing in for the handler's own, and only
 * `export const POST =` being recognised.
 */

describe("stripComments", () => {
  it("blanks line and block comments and keeps offsets and newlines", () => {
    const source = "a() // b()\n/* c()\n d() */ e()\n"
    const code = stripComments(source)
    expect(code).toHaveLength(source.length)
    expect(code.split("\n")).toHaveLength(source.split("\n").length)
    expect(code).toMatch(/a\(\)/)
    expect(code).toMatch(/e\(\)/)
    expect(code).not.toMatch(/b\(|c\(|d\(/)
  })

  it("leaves comment markers inside strings, templates and regexes alone", () => {
    const source = [
      'const url = "https://example.test/a" // gone()',
      "const quoted = 'it\\'s // here'",
      "const template = `${base}//${path /* gone() */}`",
      "const pattern = /^https?:\\/\\//",
      "const ratio = width / height // gone()",
    ].join("\n")
    const code = stripComments(source)
    expect(code).toContain('"https://example.test/a"')
    expect(code).toContain("'it\\'s // here'")
    expect(code).toContain("`${base}//${path")
    expect(code).toContain("/^https?:\\/\\//")
    expect(code).toContain("width / height")
    expect(code).not.toContain("gone()")
  })
})

describe("calls", () => {
  it("counts a call in code, not in a comment or a string", () => {
    expect(calls("await guard(sql)", "guard")).toBe(true)
    expect(calls("await guard (sql)", "guard")).toBe(true)
    expect(calls(stripComments("// guard(sql)"), "guard")).toBe(false)
    expect(calls('log("guard(sql)")', "guard")).toBe(false)
    expect(calls("unguard(sql)", "guard")).toBe(false)
  })
})

describe("scanRouteSource", () => {
  const source = [
    'import { route } from "@/lib/server/route"',
    "",
    "export const maxDuration = 60",
    "",
    "export const GET = route({",
    "  maxDuration,",
    '  auth: "public",',
    "  handler: async () => ({ ok: true }),",
    "})",
    "",
    "export const POST: RouteHandler = route<typeof body>({",
    "  maxDuration,",
    '  roles: ["owner", "admin"], // not "viewer"',
    "  handler: async ({ session }) => {",
    '    const options = { auth: "cron", mfa: "step_up" }',
    "    return save(session, options)",
    "  },",
    "})",
    "",
    "function save(session, options) {",
    "  return requireLocationAction(session, options)",
    "}",
  ].join("\n")
  const scanned = scanRouteSource("app/api/fixture/route.ts", source)

  it("finds each handler as its own route() call, typed or not", () => {
    expect(scanned.handlers.map((handler) => handler.key)).toEqual([
      "GET app/api/fixture/route.ts",
      "POST app/api/fixture/route.ts",
    ])
    expect(scanned.unrecognised).toEqual([])
    const [get, post] = scanned.handlers
    expect(get!.config).toMatch(/^route\(\{/)
    expect(get!.config).toMatch(/\}\)$/)
    expect(post!.config).toMatch(/^route<typeof body>\(\{/)
    // A helper after the last handler is not part of it.
    expect(post!.config).not.toContain("requireLocationAction")
  })

  it("reads config keys at the top level of the route() object only", () => {
    const [get, post] = scanned.handlers
    expect(routeConfigString(get!.config, "auth")).toBe("public")
    expect(routeConfigString(post!.config, "auth")).toBeUndefined()
    expect(routeConfigString(post!.config, "mfa")).toBeUndefined()
    expect(routeConfigStrings(post!.config, "roles")).toEqual([
      "owner",
      "admin",
    ])
    expect(routeConfigValue(post!.config, "maxDuration")).toBe("maxDuration")
  })

  it("reports every other way of exporting an HTTP method", () => {
    const other = scanRouteSource(
      "app/api/other/route.ts",
      [
        "export async function GET() {}",
        "export function HEAD() {}",
        "export const POST = wrapped(route({ handler }))",
        "export let PUT = route({ handler })",
        "export { handler as PATCH, helper }",
        'export { DELETE } from "./shared"',
        "// export async function OPTIONS() {}",
      ].join("\n")
    )
    expect(other.handlers).toEqual([])
    expect(other.unrecognised.sort()).toEqual([
      "DELETE (re-export)",
      "GET",
      "HEAD",
      "PATCH (re-export)",
      "POST",
      "PUT",
    ])
  })
})

describe("functionBodyIn", () => {
  it("takes the implementation after overloads, past a type-literal return type", () => {
    const source = [
      "export function pick(a: string): string",
      "export function pick(a: number): number",
      "export async function pick(",
      "  a: { readonly value: string },",
      "): Promise<{ ok: boolean }> {",
      "  if (a) { inner() }",
      "  return guard(a)",
      "}",
      "function other() { guard() }",
    ].join("\n")
    const body = functionBodyIn(source, "pick")
    expect(body).toMatch(/^export async function pick\(/)
    expect(body).toMatch(/return guard\(a\)\n\}$/)
    expect(body).not.toContain("other")
  })

  it("names a missing function", () => {
    expect(() => functionBodyIn("const a = 1", "absent", "lib/x.ts")).toThrow(
      "lib/x.ts has no function absent"
    )
  })
})

describe("the repository's routes", () => {
  it("are every one of them readable by the scans", () => {
    const handlers = routeHandlers()
    expect(handlers.length).toBeGreaterThan(200)
    for (const handler of handlers) {
      expect(handler.config, handler.key).toMatch(/^route(<[^>]*>)?\(\{/)
      expect(handler.config.trimEnd(), handler.key).toMatch(/\}\)$/)
    }
  })
})
