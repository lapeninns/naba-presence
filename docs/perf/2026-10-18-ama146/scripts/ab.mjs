// AMA-146 matched A/B driver. Run with cwd = the worktree, env from withenv.py.
//   node ab.mjs <outDir> <runs> <label=buildDir>[,<label=buildDir>...] blockOrder
// e.g. node ab.mjs out 5 A=/x/build-A,B=/x/build-B A,B,B,A
// One fixture server (seed, Google stub, session refresh) is held for every
// block; only the app process is replaced between blocks, on the same port.
import { spawn, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"

const [outArg, runsArg, buildsArg, orderArg, probeScript] = process.argv.slice(2)
const out = resolve(outArg)
mkdirSync(out, { recursive: true })
const builds = Object.fromEntries(buildsArg.split(",").map((p) => p.split("=")))
const order = orderArg.split(",")
const routes = process.env.AB_ROUTES ?? "/inbox,/listings,/listings/{loc}/profile"
const budgets = process.env.AB_BUDGETS ?? "tests/perf/budgets-baseline.json"
const log = (m) => console.error(`[ab] ${new Date().toISOString()} ${m}`)

const freePort = () =>
  new Promise((done) => {
    const s = createServer()
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => done(port))
    })
  })
const appPort = await freePort()
const stubPort = await freePort()
const base = `http://127.0.0.1:${appPort}`
const hostmon = spawn(
  "sh",
  [join(import.meta.dirname, "hostmon.sh"), join(out, "host.log")],
  { stdio: "ignore" }
)

const fixtureLog = openSync(join(out, "fixture-server.log"), "a")
const fixture = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    "--import",
    "./tests/visual/ts-resolve-hook.mjs",
    "tests/visual/fixture-server.ts",
  ],
  {
    stdio: ["ignore", "pipe", fixtureLog],
    env: {
      ...process.env,
      VISUAL_APP_PORT: String(appPort),
      PLAYWRIGHT_GOOGLE_STUB_PORT: String(stubPort),
    },
  }
)
await new Promise((done, fail) => {
  fixture.stdout.on("data", (d) => {
    writeFileSync(join(out, "fixture-server.stdout"), d, { flag: "a" })
    if (String(d).includes("seeded")) done()
  })
  fixture.once("exit", (c) => fail(new Error(`fixture server exited ${c}`)))
})
log(`fixture held pid=${fixture.pid} app=${appPort} stub=${stubPort}`)
const stateFile = "test-results/e2e-journey-state.json"
const stateHash = () =>
  createHash("sha256").update(readFileSync(stateFile)).digest("hex")
const state = JSON.parse(readFileSync(stateFile, "utf8"))
const cookie = state.cookie
const meta = { appPort, stubPort, fixturePid: fixture.pid, stateSha256: stateHash(), blocks: [] }

const appEnv = {
  ...process.env,
  DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL,
  LOCAL_BOOTSTRAP_ENABLED: "false",
  PORT: String(appPort),
  HOSTNAME: "127.0.0.1",
  GOOGLE_API_PROXY_BASE: `http://127.0.0.1:${stubPort}`,
  NEXTAUTH_URL: base,
  OPENAI_API_KEY: "",
  WEBHOOKS_ENABLED: "false",
  PASSWORD_AUTH_ENABLED: "false",
  GBP_PROFILE_WRITES_ENABLED: "true",
  GBP_MEDIA_ENABLED: "true",
  GBP_POSTS_ENABLED: "true",
  GBP_FOOD_MENUS_ENABLED: "true",
  GBP_PLACE_ACTIONS_ENABLED: "true",
  GBP_PERFORMANCE_ENABLED: "true",
  GBP_KEYWORDS_ENABLED: "true",
  ABUSE_LIMITS_ENABLED: "false",
  DESIGN_SYSTEM_EVIDENCE_ENABLED: "true",
  REGISTRATION_WORKSPACE_CHOICE_ENABLED: "true",
  BILLING_ENABLED: "true",
}
const fill = (r) =>
  r.replaceAll("{loc}", state.primaryLocationId).replaceAll("{review}", state.directReview.id)

let exitCode = 0
try {
  for (const [index, label] of order.entries()) {
    const dir = builds[label]
    const buildId = readFileSync(join(dir, ".next/BUILD_ID"), "utf8").trim()
    const appLog = openSync(join(out, `app-${index + 1}-${label}.log`), "a")
    const app = spawn(process.execPath, [join(dir, "server.js")], {
      cwd: dir,
      stdio: ["ignore", appLog, appLog],
      env: appEnv,
    })
    const deadline = Date.now() + 90_000
    for (;;) {
      try {
        const r = await fetch(base, { redirect: "manual" })
        if (r.status < 500) break
      } catch {}
      if (Date.now() > deadline) throw new Error("app not ready")
      await new Promise((d) => setTimeout(d, 300))
    }
    // Equal warm-up: two server renders of every timed route.
    for (let i = 0; i < 2; i++)
      for (const r of routes.split(","))
        await (await fetch(base + fill(r), { headers: { cookie } })).text()
    const blockOut = join(out, `block-${index + 1}-${label}`)
    const block = { index: index + 1, label, buildId, appPid: app.pid, start: new Date().toISOString(), stateSha256Before: stateHash() }
    log(`block ${index + 1} ${label} build=${buildId} app pid=${app.pid}`)
    const code = await new Promise((done) => {
      const lab = probeScript ? spawn(process.execPath, [probeScript], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, APP_URL: base, OUT: blockOut, RUNS: runsArg } }) : spawn(
        process.execPath,
        ["tests/perf/perf-lab.mjs", "--base", base, "--profile", "mobile", "--role", "owner", "--runs", runsArg, "--quiet", "5000", "--routes", routes, "--budgets", budgets, "--out", blockOut],
        { stdio: ["ignore", "inherit", "inherit"] }
      )
      lab.once("exit", (c) => done(c ?? 1))
    })
    block.end = new Date().toISOString()
    block.perfLabExit = code
    block.stateSha256After = stateHash()
    meta.blocks.push(block)
    app.kill("SIGTERM")
    await new Promise((d) => app.once("exit", d))
  }
} catch (error) {
  log(String(error))
  exitCode = 2
} finally {
  writeFileSync(join(out, "ab-meta.json"), JSON.stringify(meta, null, 2))
  fixture.kill("SIGTERM")
  await new Promise((d) => fixture.once("exit", d))
  hostmon.kill("SIGTERM")
  try { execFileSync("pkill", ["-f", `hostmon.sh ${join(out, "host.log")}`]) } catch {}
  log("fixture stopped")
}
process.exit(exitCode)
