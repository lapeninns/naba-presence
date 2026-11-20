import { execFileSync } from "node:child_process"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const args = process.argv.slice(2)
if (args.length > 1 || args[0]?.startsWith("-"))
  throw new Error("Usage: pnpm release:notes [base-ref]")
const base = git("merge-base", args[0] ?? "origin/main", "HEAD")
const head = git("rev-parse", "--short", "HEAD")
const changes = git("log", "--reverse", "--format=%h%x09%s", `${base}..HEAD`)

console.log(`# Release notes: ${base.slice(0, 8)}..${head}\n`)
if (!changes) console.log("No commits in this range.")
for (const line of changes.split("\n").filter(Boolean)) {
  const [sha, ...subject] = line.split("\t")
  console.log(`- ${subject.join(" ")} (${sha})`)
}
