# NabaPresence infrastructure operations and cutover

The [pilot record](pilot.md) captures the baseline and architecture.
Use the existing local merge and release path until each change below is
authorized and qualified. There is no production deployment job in CI.

## Local commands

| Need | Command |
| --- | --- |
| Install | `nvm use && pnpm install --frozen-lockfile` |
| Fast feedback | `pnpm check` or `pnpm exec vitest run <file>` |
| All quick checks | `lci slot -- pnpm verify` |
| Workflow changes | `pnpm lint:workflows` and the workflow contract tests |
| Build and targeted browser test | `lci slot -- pnpm build`, then `lci slot -- pnpm test:e2e <spec>` |
| Final trusted PR head | `lci run naba-presence --pr <N> --post --comment --wait` |
| Queue or unavailable executor | `lci status` and `lci agent status` |
| Exact release evidence | `lci slot -- pnpm verify:release --full` from clean current main, with the serving base resolved from the receipt ledger |

Use the executable at `~/.local/bin/lci`. Set Node 24 on PATH explicitly in
non-interactive shells. Review the exact head's source, configuration and
lifecycle scripts before putting it on the Mac. The checkout and dependency
install themselves execute candidate-controlled code. Never point `lci` at
external PRs, Dependabot PRs or code you have yet to trust. Run external work
on a clean hosted VM after authorization. Keep qualification and production
credentials separate. One NabaPresence gate at a time is the pilot operating
limit. The process retains the current CPU budget and up to four native
integration shards and six e2e lanes. If other workloads cause saturation,
take a shared slot or queue until headroom returns.

When the runner is unavailable, the required result stays pending or failed.
Inspect the exact head's last run and service state. Resume on the same
verified head only after the executor and dependencies are healthy. Recover
cancelled runs from their own logs and remove only orphan worktrees or
clusters you have confirmed belong to those runs. Use the cleanup commands
in [CI and deployment](../ci.md). Keep disk above the pilot floor of 50 GiB
free before a full suite. Review storage, load and wait time weekly during
the pilot. Report p50 only with a clearly stated sample size and collect at
least 20 eligible runs before comparing tail latency.

## First cutover option · Simplify the installed local profile

The required GitHub context remains `local-ci/release-gate`. Leave the
strict ruleset, PR requirement and Codex review workflow in place.

1. In the maintained local-ci repository, branch from the installed bundle's
   source. Edit `profiles/naba-presence.json` to remove its outer `install`
   and the leading `pnpm exec playwright install chromium`. Its gate should
   invoke the existing `pnpm verify:release` command with the exact
   `--base-ref "$CI_BASE_SHA"` for PRs. Use explicit preflight checks for
   `gitleaks`, `actionlint` and `zizmor`. This maintains continuous
   scanner enforcement on the machine.
2. Convert `secret-scan` to a gate alias depending on `gate`, just like
   `quick-verify`. The gate always scans all history reachable from the
   checked-out candidate, including on the docs-only path. Keep both
   status aliases and the `release-gate` dependency list through the pilot.
   The existing outer scan can include other refs in the shared mirror. If
   that broader coverage is intentional, preserve it as an independently
   scheduled repository-wide sweep before replacing the outer scan.
   Disable the profile watcher unless it can enforce an explicit trusted
   same-repo allowlist and exclude Dependabot.
3. Before enabling reusable proof for this profile, extend the shared
   controller to bind it to candidate SHA, target base, full or docs scope,
   toolchain versions, profile and config, platform and scanner freshness.
   A same-tree record alone omits the base, history scanned, tool patches
   and audit age. A second commit with the same tree can add and remove a
   secret in its history. Until that is addressed, qualify changed SHAs with
   fresh proof when same-tree reuse would apply. Review a dedicated
   status-publishing GitHub App as a separate owner action.
4. Validate the shared change with a branch-local profile and synthetic
   failures. For a pilot candidate, require the same unit, integration,
   browser, migration and security outcomes, one install, one Chromium
   provision and one full-history scan. With the old profile there are two
   invocations of each preparation or scan across the wrapper and gate.
   Keep a record of the previous installed bundle hash.
5. After review and authorization, use the shared repository's
   `rollback/lci-cutover.sh install <commit>` procedure. Verify the version
   readback and test pass, failure, missing tool, stale base and unavailable
   runner against a pilot PR. If evidence regresses, reinstall the known
   working bundle using the same installer and requalify the current head.
   Do not edit the installed files in place.

## Second cutover option · Hosted recovery

| Context | State | Use |
| --- | --- | --- |
| `local-ci/release-gate` | Required, strict, live | Trusted same-repository local qualification |
| `local-ci/summary` | Checked by the merge CLI | Local aggregate |
| `CI result` | Historical Actions context | Recovery from Git history only |
| `Candidate verification` | Proposed GitHub Actions job, integration 15368 | One PR test-merge qualification on Ubuntu |
| `Analyze (javascript-typescript)`, `Analyze (actions)` | Separate CodeQL jobs | Advisory findings and scheduled refresh |

1. An owner authorizes and enables Actions for a bounded rehearsal.
   Read back allowed Actions, fork approval, repository permissions,
   repository and team integrations, and protection for engineering files.
   Keep read-only default tokens, approvals for outside contributors, no
   write token for fork runs and no persistent self-hosted runners for
   this public repo. Review changes to workflows and gate scripts before
   trusting a candidate result. Pin the required status to the GitHub
   Actions integration if adopting this lane.
2. Record, with the old gate still enforced, one same-repo and one approved
   untrusted PR, an ordinary app candidate, an inert-docs candidate,
   a deliberately failing check, and two rapid updates. Compare GitHub's
   status SHA to both parents of the current PR test merge. Exercise stale
   base, cancellation, failure, missing receipt and checkout errors.
   Retargeted PRs need an update or reopen to trigger a run. The local wrapper
   currently looks for hosted checks on the head. Prove a supported merge
   path that reads the current test-merge SHA and keeps the Codex review
   requirement before mapping the gate. A dry run on a single host cannot
   establish GitHub's status-selection semantics.
3. If adopting hosted recovery as primary, have the owner add
   `Candidate verification` beside the live local context with strict
   up-to-date still on. Verify both gates block on failure. Switch to the
   tested merge path before retiring the local requirement. Stop ordinary
   local full runs when the hosted check is authoritative. Keep manual
   promotion and rollback disconnected from the workflow.
4. To revert, first restore the prior required local context, prove a pass
   on the current trusted head under the previous profile, and then remove
   the hosted context. Disable Actions again only with authorization.
   Reverting the repository revision restores the old workflow and tests.
   Keep GitHub rule and Actions-setting snapshots with the change record.

## Delivery and rollback

The existing production workflow stays in [CI and deployment](../ci.md#7-deploys-vercel).
A valid release uses an exact full receipt and verifies migrations from the
serving release. The operator serializes release operations and checks for a
valid previous deployment ID and compatible schema before staging. Vercel
builds with production environment configuration but keeps domains on the old
deployment. The readiness probe verifies the staged candidate and revision.
After promotion, verify the production revision and record the provider ID,
revision, migration hashes and health result. If post-promotion health fails,
verify the currently served revision, run the rollback dry run, and restore
the known-good deployment through the existing rollback command after
approval. Forward-only DB changes require compatibility with the rollback
target. A GitHub verification receipt or local build is never promoted as a
provider deployment artifact.

A provider rehearsal needs an explicitly authorized test project and test
database, a prior working target, and the staged, promoted and rolled-back
health receipts from that isolated environment. The pilot exercises promotion
and rollback test doubles. No provider rehearsal or production mutation forms
part of the draft.

## Cache policy and maintenance

- Local frozen installs may use the shared native pnpm store. Keep its Node
  major, pnpm version, platform and build-side-effects settings compatible.
  Changing the lockfile still runs a frozen install. A suspect store gets an
  isolated empty store for reproduction. Never prune a shared store during
  an active install.
- Chromium's cache belongs to the installing user and browser revision.
  A version mismatch installs the browser from the locked Playwright version.
  In hosted recovery, Chromium and Linux libraries are installed with the
  gate. Local test output belongs to each worktree. Never import a build or
  browser cache from an untrusted runner to a privileged release machine.
- Retain hosted JSON receipts for seven days. Keep local logs and receipts
  per the local-ci housekeeping policy. Preserve failed-run evidence while
  diagnosing. Remove only disposable run directories after their processes
  and clusters have stopped. Committed promotion receipts are release records.
- Review Dependabot changes in small groups. Check the pinned item's official
  release notes, failure modes and build impact. Test the new toolchain
  against the same application revision and record actual binary versions.
  Bump shared recipes only through reviewed, versioned changes. Start with
  this pilot, then qualify each repo against its own gate, runtime and
  deployment integration before wider rollout.
