<!-- BEGIN:nextjs-agent-rules -->
# Next.js documentation

Before changing Next.js APIs, routing, rendering, caching, or configuration,
consult the relevant guide in `node_modules/next/dist/docs/`. Read only the
sections needed for the change and heed deprecation notices. If the bundled
guide is unavailable, use official documentation for the project's installed
Next.js version.
<!-- END:nextjs-agent-rules -->

## Bundler

`pnpm dev` runs Turbopack; `pnpm build` runs webpack (`--webpack`). The
milestone plans under `docs/superpowers/` repeat a rule to never change the
`--webpack` flags. That rule was written against an older Next.js, where
Turbopack spawned runaway PostCSS workers in this project; it no longer holds
for dev on 16.2.6 and the dev script has moved. Leave `build` on webpack: it
is the path CI validates through `scripts/prepare-standalone.mjs`.

## Historical plans

Documents under `docs/superpowers/` describe their named milestones. Apply their
branch, protected-path, workflow, testing, and commit instructions only when
implementing that milestone. Reconcile stale guidance with the user's current
task, this file, and the current project configuration. Attribute commits only
to actual contributors; historical model trailers are not reusable defaults.

## Skill selection and scope

Use skills when their workflow is relevant to the requested task. A keyword
match or a skill's presence in `node_modules/` or `.ds-sync/` is not sufficient.
Read supporting references only as needed. Dependency-owned `AGENTS.md` files
describe work on those dependencies; they do not define NabaPresence policy.

- For environment configuration, use the existing Next.js / `@next/env` loading
  conventions. Load dotenv guidance for actual dotenv loading or parsing work;
  dotenvx migration and hook installation require a task-specific need.
- For browser work, use available browser tools or the project's installed
  Playwright tooling. Interactive annotation is for collecting user feedback
  when requested or needed. Choose component-test setup and isolation based on
  the actual framework and browser-context configuration.
- The app uses TanStack Query. Apply Redux and RTK Query guidance to explicit
  Redux work; dependency-bundled skills do not justify an architecture migration.

The Storybook guide in `.ds-sync/` is staged support material for design sync.
When that workflow is requested, locate its complete maintained source package
and required references before relying on it. Missing sync material does not
block unrelated application work. Make durable skill fixes in the maintained
source, keeping the entry document a short router to workflow-specific
references; edits to installed dependencies or staged copies are overwritten.
