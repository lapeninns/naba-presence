# Skills and AGENTS.md audit — 5 September 2026

Scope: NabaPresence, as confirmed in the conversation after `~/Projects` was found not to exist. This is an instruction-quality audit against Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862), read in full through the browser. The review also checked [OpenAI's model guidance](https://developers.openai.com/api/docs/guides/latest-model).

The article recommends concise, task-specific skill triggers, loading supporting guidance only when needed, avoiding rigid recipes, contextual documentation requirements, proportionate verification, and clear completion and approval boundaries.

## Coverage and limits

- Searched hidden and ignored files, followed dependency symlinks, and deduplicated identical content. Excluded `.git` and `.next` internals.
- Found **14 distinct SKILL.md texts**: one staged Storybook guide, three Playwright skills, eight Redux Toolkit skills, and two dotenv skills. Repeated installed copies and symlink aliases have identical content and are not counted as separate findings.
- Reviewed the root `AGENTS.md` and the dependency-owned Recharts `AGENTS.md`.
- No project `.agents/skills`, `.codex/skills`, or `.claude/skills` directory was found. The Storybook guide is staged under `.ds-sync`; the other skills are dependency assets. Disk presence does not establish automatic skill registration or context loading.
- Global skills and plugin caches outside this project are outside the confirmed scope.
- Assessed instruction prose, triggers, routing, workflow boundaries, size, and local references. This was not an exhaustive API-correctness review of every code example or an execution test of the bundled scripts.
- Existing modifications to `AGENTS.md`, `README.md`, `package.json`, and the dashboard layout predated this audit. They were preserved. This report is the only project file added by the audit.

## Findings

### 1. Narrow the unconditional Next.js documentation prerequisite

**Priority: medium; active project guidance.** `AGENTS.md:4` requires reading the relevant bundled Next.js guide before writing any code. This applies unnecessarily to pure domain logic, independent scripts, tests, and small edits that do not involve framework behavior. It can also create an avoidable prerequisite on fresh checkouts without dependencies.

The local documentation directory exists here, so there is no current missing-directory blocker. Preserve the useful version-specific pointer, but scope it to framework-sensitive changes:

> Before changing Next.js APIs, routing, rendering, caching, or configuration, consult the relevant guide in `node_modules/next/dist/docs/`. Read only the sections needed for the change and heed deprecation notices. If the bundled guide is unavailable, use official documentation for the installed Next.js version.

This is a proposed replacement, not an applied edit.

### 2. The staged Storybook guide is incomplete as a standalone skill

**Priority: medium when this sync workflow is used.** `.ds-sync/storybook/SKILL.md` contains 340 lines and about 69 KB of text. It combines initial sync, re-sync, visual grading, troubleshooting, subagent coordination, upload orchestration, and handoff rules. Long paragraphs make its line count understate its context cost.

It refers repeatedly to a base `SKILL.md` and `../non-storybook/SKILL.md`, including at lines 8, 24, 62, 128, 269, and 273. Neither `.ds-sync/SKILL.md` nor `.ds-sync/non-storybook/SKILL.md` exists. The build, validate, compare, and re-sync scripts do exist. Thus the staged guide omits parts of the workflow it requires.

It also has no name/description frontmatter. That is understandable for a staged supporting document, but it should not be registered as a standalone skill in its present form.

Recommended action: recover the complete source package if design sync is needed. Keep the entry skill short and route to separate initial-sync, re-sync, grading, troubleshooting, and upload references. Modify the maintained source rather than only this staged copy: line 313 instructs future runs to refresh the staged scripts and documents.

Preserve the useful integrity rules around verified artifacts and writing the upload anchor last. Those encode concrete failure modes. The issue is packaging and unconditional workflow detail, not the mere existence of rigorous verification.

### 3. dotenv has a keyword trigger and pushes unrelated migrations

**Priority: medium if registered or explicitly loaded.** `node_modules/.pnpm/node_modules/dotenv/skills/dotenv/SKILL.md:3` says to always activate when the user mentions `.env`, including simple tasks. This can capture requests that concern Next.js environment loading without needing dotenv guidance.

Lines 57–59 recommend installing a hook and migrating to dotenvx; lines 149–172 repeatedly steer production, CI, and AI-agent workflows toward dotenvx. That can expand an environment-variable fix into a tooling migration the task did not require.

Recommended trigger for a maintained skill or wrapper:

> Use when configuring or debugging dotenv loading or parsing in a Node.js application.

Keep dotenvx migration guidance conditional on a request or a demonstrated need for its features. Preserve secret redaction and untrusted-input rules. Do not patch installed package files as a durable fix.

The companion dotenvx skill has a shorter, clearer description, but its body still makes broad product recommendations; apply it to explicit dotenvx or encrypted-environment work.

### 4. Playwright CLI mixes a broad trigger with an oversized command reference

**Priority: low to medium if registered or loaded.** `playwright-cli/SKILL.md:3` covers browser interaction and work with Playwright tests generally. Its 420-line body embeds extensive command examples before linking specialized references at line 410.

Line 403 directs interactive annotation whenever the user asks for UI review or design feedback. That can turn a request for the agent to review a UI into a request for the user to perform the review. Lines 345–354 also prescribe a global latest-version install when a local CLI is unavailable.

Recommended action: make the entry a compact router; move the command catalog into a reference; scope activation to the Playwright CLI; use interactive annotation when the task calls for collecting user feedback. Resolve tooling from the current environment before prescribing global installation. Preserve clear browser observation and locator guidance.

The trace skill is narrower and comparatively proportionate. The component-testing skill has useful framework-specific references and a clear trigger, but its opening promises no additional packages while its Next.js/non-Vite setup explicitly requires Vite and a framework plugin. Qualify that promise. Its blanket test-isolation statement should also be qualified because the provided configuration reuses browser context.

### 5. Historical plan instructions need an explicit scope boundary

**Priority: low; contextual documents, not automatically active root rules.** The root bundler section correctly supersedes old webpack-only development guidance. However, plans such as `docs/archive/2026-07-frontend-rebuild/plans/2026-07-31-frontend-rebuild-m1-foundation.md` still contain milestone-specific mandatory subskills (line 3), a fixed branch and protected paths (line 14), repeated test gates (line 19), and a fixed model attribution trailer (line 20).

These can misdirect an agent if a historical plan is treated as general current policy. Keep the history, and add a short scope clarification if this has caused confusion:

> Documents under `docs/superpowers/` describe their named milestones. Apply their branch, workflow, testing, and commit instructions only when implementing that milestone; reconcile stale guidance with current project configuration and the user's task.

[Editorial note, 2026-09-19: `docs/superpowers/` moved to `docs/archive/2026-07-frontend-rebuild/` on that date. The quotation above is reproduced verbatim as written on 2026-09-05; the plan path cited earlier in this section was updated to its current location so the link still resolves.]

Do not import old milestone restrictions or mandatory attribution into the general project instructions.

## What should remain

`AGENTS.md:9–14` correctly records development on Turbopack and production builds on webpack. `package.json:8–10` confirms both commands and the standalone postbuild hook; `.github/workflows/ci.yml:57–60` builds and runs integration and browser tests. The current README also records the same bundler decision. Preserve this section. The historical worker-performance claim was checked for documentation consistency, not benchmarked again.

The root file is only 14 lines. It does not currently impose arbitrary approval checkpoints, mandatory delegation, full-repository reading, or universal test loops. There is no need to add a large general-purpose prompt, repeat session-level permission rules, or add a repository map.

## Skill inventory

Locations below are relative to the project. Dependency aliases were grouped by identical content.

| Skill or guide | Assessment |
| --- | --- |
| `.ds-sync/storybook/SKILL.md` | Incomplete staged workflow; excessive entry-document size; restore source package and split routes if used. |
| `playwright-trace` | Narrow task trigger; coherent investigation flow; no material approval or persistence problem found. |
| `playwright-cli` | Broad browser trigger; 420-line catalog; unconditional annotation and install branches deserve narrowing. |
| `playwright-component-testing` | Clear specialist scope and useful references; qualify dependency and isolation promises. |
| `model-redux-state/design-state-ownership` | Useful Redux guidance; trigger should establish a Redux context before capturing general state-ownership questions. |
| `model-redux-state/build-slices-and-selectors` | Specific RTK API trigger; examples could move to references; no material workflow stop found. |
| `manage-server-data/adopt-rtk-query` | Explicit adoption scope; do not apply as a general cache-policy instruction for this app. |
| `build-modern-redux-apps/redux-dataflow` | Specific Redux scope; lengthy instructional examples, but no material permission or persistence problem found. |
| `build-modern-redux-apps/modern-redux` | Clear new/modernized Redux scope; retain only for Redux work. |
| `evolve-and-diagnose-redux-apps/migrate-to-modern-redux` | Clear migration scope; do not let opportunistic reducer/server-cache migration escape that scope. |
| `evolve-and-diagnose-redux-apps/debug-redux-toolkit-apps` | Appropriate Redux debugging guidance; put Redux context first in the trigger to avoid capturing unrelated cache bugs. |
| `orchestrate-side-effects/handle-side-effects` | Appropriate within Redux; its RTK Query default should not supersede this app's TanStack Query architecture. |
| `dotenv` | Overbroad keyword trigger and repeated migration/product steering. |
| `dotenvx` | More concise trigger; keep encryption and migration instructions conditional on task intent. |

Playwright skills are under `.ds-sync/node_modules/playwright-core/lib/tools/skills/` and the root pnpm dependency tree. Redux skills are reachable under `node_modules/.pnpm/node_modules/@reduxjs/toolkit/skills/`; dotenv skills under `node_modules/.pnpm/node_modules/dotenv/skills/`.

The eight Redux skills contain roughly 226–385 lines each and identify library version 2.11.2 while the installed package is 2.12.0. This is metadata drift, not proof of broken examples. NabaPresence directly uses TanStack Query, so their installed presence should not be interpreted as a request to adopt Redux or RTK Query.

The dependency-owned `node_modules/recharts/AGENTS.md` describes developing Recharts itself. Its npm commands and contribution-document prerequisites are not NabaPresence policy. Keep that boundary if inspecting chart-library internals.

## Validation

Verified the filesystem inventory, identical-copy grouping, referenced Storybook files, the Next.js documentation directory, current package scripts, CI build path, and current uncommitted changes. No application code or installed skill files were changed. No application tests were run for this read-only instruction review.
