import { cp, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const standalone = join(root, ".next", "standalone")

await mkdir(join(standalone, ".next"), { recursive: true })
await cp(join(root, ".next", "static"), join(standalone, ".next", "static"), {
  recursive: true,
  force: true,
})
await cp(join(root, "public"), join(standalone, "public"), {
  recursive: true,
  force: true,
})
