#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const repo = "lapeninns/naba-presence"
const title = "Nightly health and alerting smoke failed"

if (process.argv.includes("--help")) {
  console.log("nightly-report.mjs <40-character tested Git SHA> [--post]")
} else {
  const [sha, ...options] = process.argv.slice(2)
  if (
    !/^[0-9a-f]{40}$/.test(sha ?? "") ||
    (options.length !== 0 && options.join(" ") !== "--post")
  ) {
    throw new Error("Provide the tested Git SHA and optionally --post")
  }
  const body = `The disposable health and alerting smoke failed on \`${sha}\`.\n\nSee [the smoke runbook](https://github.com/${repo}/blob/${sha}/docs/observability.md#nightly-smoke). Inspect runner logs locally; do not attach raw logs or environment values.`
  if (options.length === 0) {
    console.log(`${title}\nLabels: bug, P2, area:infra\n\n${body}`)
  } else {
    gh("auth", "switch", "--user", "lapeninns")
    const open = JSON.parse(
      gh(
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--label",
        "area:infra",
        "--search",
        `"${title}" in:title`,
        "--json",
        "title,url"
      )
    )
    const existing = open.find((issue) => issue.title === title)
    console.log(
      existing?.url ??
        gh(
          "issue",
          "create",
          "--repo",
          repo,
          "--title",
          title,
          "--label",
          "bug,P2,area:infra",
          "--body",
          body
        )
    )
  }
}

function gh(...args) {
  const result = spawnSync("gh", args, { encoding: "utf8", timeout: 20_000 })
  if (result.status !== 0)
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed`)
  return result.stdout.trim()
}
