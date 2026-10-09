// Lets `node --experimental-strip-types` load the repo's extensionless
// TypeScript imports (the integration helpers are written for Vitest and
// Playwright, which resolve `./foo` to `./foo.ts`).
import { register } from "node:module"

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs"
      import { fileURLToPath } from "node:url"
      export async function resolve(specifier, context, next) {
        if ((specifier.startsWith(".") || specifier.startsWith("/")) && !/\\.[cm]?[jt]s$/.test(specifier)) {
          for (const ext of [".ts", "/index.ts"]) {
            const url = new URL(specifier + ext, context.parentURL)
            if (existsSync(fileURLToPath(url))) return next(url.href, context)
          }
        }
        return next(specifier, context)
      }
    `),
  import.meta.url
)
