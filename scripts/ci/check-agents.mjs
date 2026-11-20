import { existsSync, readFileSync } from "node:fs"
import { resolve, sep } from "node:path"

const repo = process.cwd()
const guide = readFileSync("AGENTS.md", "utf8")
const { scripts } = JSON.parse(readFileSync("package.json", "utf8"))
const errors = []

function checkPath(reference) {
  const path = resolve(repo, reference)
  if (!path.startsWith(`${repo}${sep}`) || !existsSync(path))
    errors.push(`Unresolved local reference: ${reference}`)
}

function checkCommand(command) {
  const [tool, first, argument, ...rest] = command.split(/\s+/)
  if (tool === "pnpm") {
    if (first === "install" && argument === "--frozen-lockfile" && !rest.length)
      return
    if (first === "exec") {
      checkPath(`node_modules/.bin/${argument}`)
      rest.filter(isLocalFile).forEach(checkPath)
    } else if (!Object.hasOwn(scripts, first)) {
      errors.push(`Unknown package command: ${first}`)
    }
  } else if (
    !/^gh auth switch --user lapeninns$/.test(command) &&
    !/^lci (?:merge|run naba-presence --pr <N> --post --comment --wait)$/.test(
      command
    )
  ) {
    errors.push(`Undocumented command form: ${command}`)
  }
}

const isLocalFile = (value) =>
  /^(?:\.\/)?[\w.-]+\/[\w./-]+\.(md|[cm]?[jt]sx?)$/.test(value)
for (const [, literal] of guide.matchAll(/`([^`\n]+)`/g)) {
  if (/^(pnpm|lci|gh)\s/.test(literal)) checkCommand(literal)
  else if (isLocalFile(literal) || /^\.?\/?[\w-]+\.md$/.test(literal))
    checkPath(literal)
}
for (const [, target] of guide.matchAll(/\]\(([^)\s]+)\)/g)) {
  const path = target.split("#")[0]
  if (!path) continue
  if (URL.canParse(path)) {
    // Network links are intentionally not part of this offline release gate.
    errors.push("Use a local guide for links validated by this gate.")
  } else {
    checkPath(decodeURIComponent(path))
  }
}
if (errors.length) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else {
  console.log("AGENTS.md package commands and local references resolve.")
}
