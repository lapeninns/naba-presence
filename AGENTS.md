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
archived milestone plans under `docs/archive/2026-07-frontend-rebuild/` repeat
a rule to never change the `--webpack` flags. That rule was written against an
older Next.js, where Turbopack spawned runaway PostCSS workers in this project;
it no longer holds for dev on 16.2.6 and the dev script has moved. Leave
`build` on webpack: it is the path CI validates through
`scripts/prepare-standalone.mjs`.

## Historical plans

`docs/archive/2026-07-frontend-rebuild/` is a historical record of the 2026-07
frontend rebuild, and its branch, protected-path, workflow, testing, and commit
instructions are not active project rules. Read those documents for background
on how and why a milestone was built; take your actual instructions from this
file, the current project configuration, and the user's task. Attribute commits
only to actual contributors; historical model trailers are not reusable
defaults. See `docs/archive/2026-07-frontend-rebuild/README.md` for the index.

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
