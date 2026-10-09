import { readdirSync, readFileSync } from "node:fs"

// Contract tests read repository files (workflows, configs, scripts) as plain
// text rather than parsing them, so they need no YAML dependency.
const repoRoot = new URL("../../", import.meta.url)

export function readRepoText(path: string): string {
  return readFileSync(new URL(path, repoRoot), "utf8")
}

export function listRepoFiles(dir: string, suffixes: string[]): string[] {
  const base = dir.endsWith("/") ? dir : `${dir}/`
  return readdirSync(new URL(base, repoRoot))
    .filter((name) => suffixes.some((suffix) => name.endsWith(suffix)))
    .sort()
    .map((name) => `${base}${name}`)
}
