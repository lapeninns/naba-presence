# Production dependency disposition

Prepared 2026-10-09 for plan packages PR01/PR02. Baseline commit
`b22cda1bfed8b8ddc0a84222b022c4e832ab5139`. Ledger rows: DEP-01 to DEP-06 in
`docs/release/ledger.md`.

**Every disposition below is proposed — needs security reviewer.** No
exception or acceptance has been granted. An advisory stays open until the
reviewer records a decision with a date, and an accepted item names its owner
role, compensating control and review date. An advisory suppression is not a
repair.

## Snapshot

### After upgrade, 9 October 2026

PR #59 upgraded Next.js, `@next/env` and `eslint-config-next` to 16.3.8 and
moved `shadcn` out of production dependencies. At candidate
`6115040bafaa007b5da008734ce928bee307f095`, the refreshed
`pnpm audit --prod --audit-level high --json` result is **0 critical, 0 high,
0 moderate, 0 low and 0 info**. The frozen install, current-version webpack
build and local validation passed. Receipt:
`/Users/amankumarshrestha/Documents/Codex/2026-10-09/nabapresence-smtp/dependency-audit.json`.

The table below preserves the original pre-upgrade assessment. Its old
findings are not the current dependency audit. Hosted CI and reviewer
acceptance remain separate requirements.

| Field                         | Value                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Command                       | `pnpm audit --prod --json` (read-only)                                             |
| Date                          | 2026-10-09                                                                         |
| Totals                        | 4 critical, 27 high, 31 moderate, 5 low, 0 info                                    |
| Production dependencies       | 472                                                                                |
| Root sources of critical/high | `next@16.2.6` (direct) and `shadcn@^4.16.0` (direct, build-time CSS import only)   |
| Plan receipt                  | `/tmp/naba-presence-readiness-20261009-audit.json` (local, volatile; totals match) |

Move the raw audit output into durable, access-controlled evidence storage
before PR02 closes, and add the after-remediation totals to this file.

Reachability is "verified" when confirmed in source, otherwise "inferred".
Reachability arguments do not replace an upgrade for critical findings on an
endpoint Next.js enables by default.

## Advisories through `next`

Upgrade target: `next` 16.3.8 or later (lowest 16.x release that clears every
Next advisory below; 16.2.11 alone would leave 3 critical and 1 high open).
Move `eslint-config-next` (pinned 16.2.6) and `@next/env` (^16.2.12) with it.
Keep `pnpm build` on webpack. Before changing configuration, read
`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` and the
official 16.3 release notes.

| Advisory                                                               | Severity | Package and installed version | Path                                           | Runtime reachability                                                                                                                         | Fixed in  | Proposed disposition                                                                                              | Status                             |
| ---------------------------------------------------------------------- | -------- | ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| GHSA-2xp9-vwfh-vxw4 Image Optimization AVIF RCE                        | critical | next 16.2.6                   | `.>next`                                       | Inferred possible: `/_next/image` is enabled by default (no `images.unoptimized`); on Vercel optimisation may run on platform infrastructure | >=16.3.3  | Upgrade                                                                                                           | proposed — needs security reviewer |
| GHSA-p293-qw3h-jr36 (CVE-2026-75604) Windows-hosted RCE                | critical | next 16.2.6                   | `.>next`                                       | Not applicable: hosting is Vercel/Linux, standalone server on Linux                                                                          | >=16.3.3  | Upgrade (same change)                                                                                             | proposed — needs security reviewer |
| GHSA-vcvr-r3jv-pc5j `next/og` ImageResponse RCE                        | critical | next 16.2.6                   | `.>next`                                       | Verified unreachable: no `next/og` import and no opengraph-image or icon routes                                                              | >=16.3.6  | Upgrade (same change)                                                                                             | proposed — needs security reviewer |
| GHSA-6gpp-xcg3-4w24 middleware/proxy bypass (Turbopack, single locale) | high     | next 16.2.6                   | `.>next`                                       | Verified low: production builds with webpack; `proxy.ts` performs no auth                                                                    | >=16.2.11 | Upgrade                                                                                                           | proposed — needs security reviewer |
| GHSA-89xv-2m56-2m9x SSRF in Server Actions on custom servers           | high     | next 16.2.6                   | `.>next`                                       | Inferred unreachable: no `'use server'` directives, no custom server                                                                         | >=16.2.11 | Upgrade                                                                                                           | proposed — needs security reviewer |
| GHSA-m99w-x7hq-7vfj App Router Server Actions DoS                      | high     | next 16.2.6                   | `.>next`                                       | Inferred unreachable: no Server Actions found (Next may still register action handling)                                                      | >=16.2.11 | Upgrade                                                                                                           | proposed — needs security reviewer |
| GHSA-p9j2-gv94-2wf4 SSRF in rewrites                                   | high     | next 16.2.6                   | `.>next`                                       | Verified unreachable: `next.config.ts` has no rewrites                                                                                       | >=16.2.11 | Upgrade                                                                                                           | proposed — needs security reviewer |
| GHSA-cjq9-62q9-8jv4 SSRF in Image Optimization                         | high     | next 16.2.6                   | `.>next`                                       | Inferred low: default image endpoint, no `remotePatterns`                                                                                    | >=16.3.8  | Upgrade; consider `images.unoptimized` (D-45)                                                                     | proposed — needs security reviewer |
| GHSA-f88m-g3jw-g9cj libvips CVEs                                       | high     | sharp 0.34.5                  | `.>next>sharp`                                 | Inferred: used only by `/_next/image`; the app renders Google thumbnails with plain `<img>`                                                  | >=0.35.0  | Upgrade via `next`; if still <0.35.5 after upgrade, decide override (with build evidence) or `images.unoptimized` | proposed — needs security reviewer |
| GHSA-rgj7-g3m4-5g8c libheif                                            | high     | sharp 0.34.5                  | `.>next>sharp`                                 | As above                                                                                                                                     | >=0.35.4  | As above                                                                                                          | proposed — needs security reviewer |
| GHSA-wq5f-xc86-pv6w librsvg (CVE-2026-96889)                           | high     | sharp 0.34.5                  | `.>next>sharp`                                 | As above                                                                                                                                     | >=0.35.5  | As above                                                                                                          | proposed — needs security reviewer |
| GHSA-6g55-p6wh-862q sourceMappingURL file read                         | high     | postcss 8.4.31                | `.>next>postcss` (also `.>geist>next>postcss`) | Inferred unreachable: build-time processing of first-party CSS only                                                                          | >=8.5.12  | Re-check after `next` upgrade; no forced override without build evidence                                          | proposed — needs security reviewer |
| GHSA-r28c-9q8g-f849 source-map path traversal                          | high     | postcss 8.4.31                | `.>next>postcss`                               | As above                                                                                                                                     | >=8.5.18  | As above                                                                                                          | proposed — needs security reviewer |
| GHSA-2v37-7h3g-55p8                                                    | high     | nanoid 3.3.16                 | `.>next>postcss>nanoid`                        | Inferred unreachable: requires a custom generator with size 0, which postcss does not use                                                    | >=3.3.18  | As above                                                                                                          | proposed — needs security reviewer |
| GHSA-68fv-2mgg-jv7q                                                    | high     | source-map-js 1.2.1           | `.>next>postcss>source-map-js`                 | Inferred unreachable: build-time only                                                                                                        | >=1.2.2   | As above                                                                                                          | proposed — needs security reviewer |

## Advisories through `shadcn`

`shadcn` is listed under `dependencies` but is used only as a build-time CSS
import (`app/globals.css:3`, `@import "shadcn/tailwind.css"`). No runtime code
imports it or its transitive packages (verified by search of `app/`,
`components/`, `lib/`, `scripts/`). Proposed fix for the whole group: move
`shadcn` to `devDependencies` (or vendor the stylesheet; D-46), then confirm
the webpack build, `scripts/prepare-standalone.mjs` output and a clean
production audit.

| Advisory                                                                                                                     | Severity | Package and installed version    | Path                                                           | Runtime reachability                                                                  | Fixed in      | Proposed disposition                                                                         | Status                             |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| GHSA-jqcg-44mw-7w3h (CVE-2026-90711) IPv4-mapped IPv6 trust bypass                                                           | critical | proxy-addr 2.0.7                 | `.>shadcn>@modelcontextprotocol/sdk>express>proxy-addr`        | Verified unreachable: the shadcn MCP server CLI is never started by the app           | >=2.0.8       | Move `shadcn` to devDependencies                                                             | proposed — needs security reviewer |
| GHSA-6qxp-vccf-f47h                                                                                                          | high     | @modelcontextprotocol/sdk 1.30.0 | `.>shadcn>@modelcontextprotocol/sdk`                           | Verified unreachable (developer CLI)                                                  | >=1.31.0      | Move `shadcn` to devDependencies                                                             | proposed — needs security reviewer |
| GHSA-7p8r-x3mc-p8w7, GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp, GHSA-qw65-cvwx-89v3 | high (6) | fast-uri 3.1.4                   | `.>shadcn>@dotenvx/dotenvx>conf>ajv>fast-uri`                  | Verified unreachable (developer CLI)                                                  | >=3.1.7       | Move `shadcn` to devDependencies                                                             | proposed — needs security reviewer |
| GHSA-2883-xcg3-v3hh, GHSA-5p4m-2wfm-xmqj                                                                                     | high (2) | js-yaml 4.3.0                    | `.>shadcn>cosmiconfig>js-yaml`                                 | Verified unreachable (developer CLI)                                                  | >=4.3.2       | Move `shadcn` to devDependencies                                                             | proposed — needs security reviewer |
| GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7, GHSA-rgw5-rvv9-x895                                                                | high (3) | brace-expansion 5.0.8            | `.>shadcn>ts-morph>@ts-morph/common>minimatch>brace-expansion` | Verified unreachable (developer CLI)                                                  | >=5.0.11      | Move `shadcn` to devDependencies                                                             | proposed — needs security reviewer |
| GHSA-vfj7-8cjw-p6xm                                                                                                          | high     | braces 3.0.3                     | `.>shadcn>fast-glob>micromatch>braces`                         | Verified unreachable in production; affects developer machines running the shadcn CLI | none released | Move `shadcn` to devDependencies; dated dev-only exception record until upstream ships a fix | proposed — needs security reviewer |
| GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3                                                                                     | high (2) | undici 7.29.0                    | `.>shadcn>undici`                                              | Verified unreachable (developer CLI)                                                  | >=7.29.1      | Move `shadcn` to devDependencies                                                             | proposed — needs security reviewer |

## Hygiene and gate

| Item                                     | Finding                                                                                                                                   | Proposed disposition                                                    | Status                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `@shadcn/react` ^0.2.1 in `dependencies` | No advisory; no import found in `app/`, `components/`, `lib/`, `scripts/`                                                                 | Remove after `pnpm why` and a build confirm nothing needs it            | proposed — needs security reviewer |
| Production audit gate                    | `pnpm audit --prod --audit-level high` runs only in `nightly.yml` on `main`, outside `CI result`; nightly is not running (Actions budget) | Decide placement (D-39); prove it passes after remediation              | proposed — needs security reviewer |
| Moderate and low findings (31 and 5)     | Not triaged in Phase A                                                                                                                    | Triage in PR02 after the upgrades, since most share the two roots above | pending                            |

## Verification required after remediation

1. `pnpm install --frozen-lockfile` with the updated lockfile.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` (webpack) and
   `scripts/prepare-standalone.mjs`.
3. Integration and browser suites on an ephemeral database.
4. `pnpm audit --prod --audit-level high` with zero critical/high findings, or
   only findings with an accepted, dated exception.
5. Record before/after totals here and update ledger rows DEP-01 to DEP-06.
