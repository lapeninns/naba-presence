import { describe, expect, it } from "vitest"

import { listRepoFiles, readRepoText } from "../helpers/repo-text"

// Local (.nvmrc / nvm), CI (setup-node reads .nvmrc), installs
// (`engines` + engineStrict) and Vercel (which reads `engines.node`) must all
// run the same Node major. A drift in any one of them fails here.
const packageJson = JSON.parse(readRepoText("package.json")) as {
  packageManager?: string
  engines?: { node?: string }
}

const nvmrcMajor = Number(readRepoText(".nvmrc").trim())

function setupNodeBlocks(source: string): string[] {
  // Each `uses: actions/setup-node@...` step with its indented `with:` lines.
  const lines = source.split("\n")
  const blocks: string[] = []
  lines.forEach((line, index) => {
    if (!/uses:\s*actions\/setup-node@/.test(line)) return
    const indent = line.search(/\S/)
    const block = [line]
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === "") continue
      if (next.search(/\S/) <= indent) break
      block.push(next)
    }
    blocks.push(block.join("\n"))
  })
  return blocks
}

describe("toolchain parity", () => {
  it("pins .nvmrc to a bare Node major", () => {
    expect(readRepoText(".nvmrc").trim()).toMatch(/^\d+$/)
    expect(nvmrcMajor).toBe(24)
  })

  it("declares engines.node as exactly the .nvmrc major", () => {
    expect(packageJson.engines?.node).toBe(`>=${nvmrcMajor} <${nvmrcMajor + 1}`)
  })

  it("makes pnpm refuse installs outside engines", () => {
    expect(readRepoText("pnpm-workspace.yaml")).toMatch(
      /^engineStrict:\s*true\s*$/m
    )
  })

  it("pins packageManager to an exact pnpm version", () => {
    expect(packageJson.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
  })

  it("takes Node from .nvmrc in every setup-node step", () => {
    const sources = [
      ".github/actions/setup/action.yml",
      ...listRepoFiles(".github/workflows", [".yml", ".yaml"]),
    ]
    const blocks = sources.flatMap((path) =>
      setupNodeBlocks(readRepoText(path)).map((block) => ({ path, block }))
    )
    const paths = blocks.map(({ path }) => path)
    expect(paths).toContain(".github/actions/setup/action.yml")
    expect(paths).toContain(".github/workflows/ci.yml")
    for (const { path, block } of blocks) {
      expect(block, path).toMatch(/node-version-file:\s*\.nvmrc\s*$/m)
      expect(block, path).not.toMatch(/^\s*node-version:/m)
    }
  })
})
