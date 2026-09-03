/**
 * Lets plain `node` load the repo's TypeScript modules by their
 * extensionless specifiers (`./contrast`), which is what tsconfig's
 * "bundler" resolution allows and what Next and vitest already accept.
 * Node's own ESM resolver requires the extension, so this hook adds it.
 *
 * Node strips the types itself; this only answers "which file".
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const extension of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(specifier + extension, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context)
      }
    }
  }
  return nextResolve(specifier, context)
}
