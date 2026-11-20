import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { register } from "node:module"
import { pathToFileURL } from "node:url"

import ts from "typescript"
import { z } from "zod"

const output = new URL("../../docs/openapi.json", import.meta.url)
const app = new URL("../../app/api/", import.meta.url)
const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
])

function parse(url) {
  return ts.createSourceFile(
    url.pathname,
    readFileSync(url, "utf8"),
    ts.ScriptTarget.Latest
  )
}

function exportedHandlers(tree) {
  return tree.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
    .flatMap((node) => [...node.declarationList.declarations])
    .filter(({ name }) => ts.isIdentifier(name) && methods.has(name.text))
}

function wrapperConfig(initializer, tree, label) {
  const config =
    initializer &&
    ts.isCallExpression(initializer) &&
    initializer.expression.getText(tree) === "route" &&
    initializer.arguments[0]
  if (!config || !ts.isObjectLiteralExpression(config))
    throw new Error(`Unmapped handler: ${label}`)
  return new Map(
    config.properties
      .filter(ts.isPropertyAssignment)
      .map((prop) => [prop.name.getText(tree), prop.initializer])
  )
}

function authMode(auth, label) {
  if (!auth) return "session"
  if (
    ts.isStringLiteral(auth) &&
    ["public", "cron", "session"].includes(auth.text)
  )
    return auth.text
  throw new Error(`Unmapped auth: ${label}`)
}

function operation({ name, initializer }, tree, relative, params) {
  const label = `${relative} ${name.text}`
  const config = wrapperConfig(initializer, tree, label)
  const mode = authMode(config.get("auth"), label)
  const validators = Object.fromEntries(
    ["body", "query"].flatMap((key) => {
      const node = config.get(key)
      return node
        ? [[`x-${key}-validator`, ts.isIdentifier(node) ? node.text : "inline"]]
        : []
    })
  )
  const roles = config.get("roles")
  return {
    "x-source": `app/api/${relative}`,
    ...validators,
    ...(roles
      ? { "x-role-check": roles.getText(tree).replace(/\s/g, "") }
      : {}),
    ...(config.has("mfa") ? { "x-mfa-step-up": true } : {}),
    ...(params.length
      ? {
          parameters: params.map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
        }
      : {}),
    security: mode === "public" ? [] : [{ [mode]: [] }],
    responses: {
      default: {
        description:
          "See the linked route and its wire contracts for the response.",
      },
    },
  }
}

function routeEntry(relative) {
  const tree = parse(new URL(relative, app))
  const segments = relative.split("/").slice(0, -1)
  const params = segments
    .filter((part) => part.startsWith("["))
    .map((part) => part.slice(1, -1))
  if (params.some((name) => !/^\w+$/.test(name)))
    throw new Error(`Unmapped dynamic segment: ${relative}`)
  const path =
    "/api/" +
    segments.map((part) => part.replace(/^\[(\w+)\]$/, "{$1}")).join("/")
  const handlers = exportedHandlers(tree)
  if (!handlers.length) throw new Error(`No HTTP handlers: ${relative}`)
  return [
    path,
    Object.fromEntries(
      handlers.map((handler) => [
        handler.name.text.toLowerCase(),
        operation(handler, tree, relative, params),
      ])
    ),
  ]
}

function routeInventory() {
  return Object.fromEntries(
    readdirSync(app, { recursive: true })
      .filter((file) => /(^|\/)route\.ts$/.test(file))
      .sort()
      .map(routeEntry)
  )
}

async function addWireSchemas(paths) {
  register("../ts-extension-resolver.mjs", import.meta.url)
  const session = await import("../../lib/contracts/session.ts")
  const reviews = await import("../../lib/contracts/reviews.ts")
  const response = (schema) => ({
    200: {
      description: "Successful response.",
      content: {
        "application/json": {
          schema: z.toJSONSchema(schema, { target: "draft-2020-12" }),
        },
      },
    },
  })
  paths["/api/session"].get.responses = response(session.sessionResponseSchema)
  const switchSession = paths["/api/session/switch"].post
  if (switchSession["x-body-validator"] !== "sessionSwitchSchema")
    throw new Error(
      "Session switch no longer uses the documented request schema"
    )
  switchSession.requestBody = {
    required: true,
    content: {
      "application/json": {
        schema: z.toJSONSchema(session.sessionSwitchSchema, { io: "input" }),
      },
    },
  }
  switchSession.responses = response(session.sessionResponseSchema)
  paths["/api/reviews"].get.responses = response(reviews.reviewsPageSchema)
}

export async function renderOpenApi() {
  const paths = routeInventory()
  await addWireSchemas(paths)
  const session = parse(new URL("../../lib/server/session.ts", import.meta.url))
  const cookie = session.statements
    .flatMap((node) =>
      ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []
    )
    .find(
      (node) => node.name.getText(session) === "SESSION_COOKIE"
    )?.initializer
  if (!cookie || !ts.isStringLiteral(cookie))
    throw new Error("Unmapped session authentication cookie name")
  return (
    JSON.stringify(
      {
        openapi: "3.1.0",
        info: {
          title: "NabaPresence internal HTTP API",
          version: "1.0.0",
          description:
            "Route and authentication inventory for app/api. Core session and review responses include shared Zod schemas. Other payloads are defined in the linked handlers and lib/contracts. An empty security array means no session or cron authentication in the wrapper; a webhook may verify its provider in the handler.",
        },
        paths,
        components: {
          securitySchemes: {
            session: { type: "apiKey", in: "cookie", name: cookie.text },
            cron: { type: "http", scheme: "bearer" },
          },
        },
      },
      null,
      2
    ) + "\n"
  )
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const schema = await renderOpenApi()
  if (process.argv.includes("--write")) writeFileSync(output, schema)
  else if (readFileSync(output, "utf8") !== schema) {
    console.error("OpenAPI is out of date. Run pnpm docs:openapi.")
    process.exitCode = 1
  }
}
