import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { expect, it } from "vitest"

it("keeps the checked-in OpenAPI operations synchronized with the route tree", () => {
  const document = readFileSync(
    new URL("../../docs/openapi.json", import.meta.url),
    "utf8"
  )
  const { openapi, paths } = JSON.parse(document)
  expect(openapi).toBe("3.1.0")
  expect(paths["/api/session"].get.security).toEqual([])
  expect(paths["/api/session/switch"].post.security).toEqual([{ session: [] }])
  expect(paths["/api/clients"].post["x-body-validator"]).toBeTruthy()
  expect(paths["/api/operations/readiness"].get.security).toEqual([
    { cron: [] },
  ])
  expect(paths["/api/reviews/{id}"].get.parameters).toEqual([
    { name: "id", in: "path", required: true, schema: { type: "string" } },
  ])
  expect(
    paths["/api/reviews"].get.responses["200"].content["application/json"]
      .schema.required
  ).toContain("items")
  execFileSync("node", ["scripts/ci/openapi.mjs", "--check"], { stdio: "pipe" })
})
