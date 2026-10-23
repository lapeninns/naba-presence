import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// The schema half of this file (tables, intent payload, status vocabulary,
// publish lease index, deprecated schedule columns) is read from the
// migrated catalogue in tests/integration/schema-contract.test.ts.
describe("Local Posts scheduling contract", () => {
  // The column is still in the schema, but the request/response contract no
  // longer carries it: nothing ever published a post when its time arrived,
  // so echoing a scheduled time back promised a behaviour the system does not
  // have. Asserting the column existed read as coverage for that behaviour.
  it("leaves scheduling to a due-posts claim that does not exist yet", () => {
    const contract = readFileSync(
      join(process.cwd(), "lib/contracts/location-posts.ts"),
      "utf8"
    )
    expect(contract).not.toContain("scheduledTime:")
    const server = readFileSync(
      join(process.cwd(), "lib/server/posts.ts"),
      "utf8"
    )
    expect(server).not.toContain("scheduled_publish_time")
  })
})
