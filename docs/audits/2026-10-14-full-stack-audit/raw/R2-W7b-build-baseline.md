# R2-W7b — Frontend build / bundle baseline (measured)

- **Commit:** `d8759c74` (main, "Merge pull request #70 … release-receipt-2b26bcf2")
- **Where:** isolated worktree `~/.t3/worktrees/naba-presence/t3-ddb741dc` (the main checkout was not rebuilt)
- **When:** 2026-10-14, build started 12:41:44Z and finished 12:42:38Z
- **Toolchain:** Node v24.16.0 (nvm; the default PATH node is v22.23.1, so Node 24 was put first to satisfy `engines >=24 <25`), pnpm 10.34.5, Next.js 16.3.8 (webpack)
- **Env:** **No env vars were set.** No `.env*` was read or copied, and the build compiled with nothing set because `lib/server/env.ts` parses lazily. There were no DB or service connections.
- All numbers below are **measured** unless marked otherwise. "gz" = gzip -9 computed locally over the emitted file. It is not a CDN transfer size.

## Commands

```bash
pnpm install --frozen-lockfile                       # 4.4s, no lockfile change
PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH /usr/bin/time -p pnpm build   # next build --webpack + postbuild
# second, attribution-only build (temporary worktree-only config edit, reverted with git checkout):
#   next.config.ts += distDir: ".next-sm", productionBrowserSourceMaps: true
PATH=…v24… /usr/bin/time -p pnpm exec next build --webpack
git checkout next.config.ts tsconfig.json             # next rewrote tsconfig include for .next-sm; reverted
# analysis scripts (no deps added): /tmp/w7b-scripts/routes2.mjs (manifests → per-route JS), attr.mjs (source-map VLQ → bytes per package/file)
```

## Build timing (measured)

| Build | real | user | sys | Phase notes (from Next output) |
|---|---|---|---|---|
| `pnpm build` (baseline) | **54.30 s** | 84.28 s | 11.68 s | Compiled in 23.3 s; TypeScript 16.7 s; 107 static-gen units in 244 ms; postbuild prepare-standalone ran OK |
| source-map build (attribution only) | 50.31 s | 82.67 s | 11.10 s | — |

Output: `.next/static` = 6,872 KB on disk; `.next/standalone` = 93,500 KB on disk (du -sk).

## Route table

Next 16.3.8 **no longer prints Size / First Load JS** in the route table. It prints only the route and the ○/ƒ marker. The table has 210 lines covering pages and API routes, mostly ƒ (dynamic). Static (○) routes: `/forgot-password`, `/privacy`, `/terms`. Full log: `/tmp/w7b-build.log`, which may be lost because /tmp is ephemeral.

I computed First Load JS myself in two ways:

### A. Exact, from prerendered HTML (only possible for static pages; polyfills excluded because they are `nomodule`)

| Route | JS chunks | raw bytes | gz bytes |
|---|---|---|---|
| `/privacy` (static) | 14 | 587,591 | **184,066 (179.8 KB)** |
| `/forgot-password` (static) | 20 | 721,814 | **225,964 (220.7 KB)** |

### B. Upper bound for every route: union of `rootMainFiles` and every chunk referenced by the route's `page_client-reference-manifest.js`

Caveat: this method **overcounts**. In webpack mode each manifest also lists client modules from sibling boundaries, such as the `(dashboard)` layout, error and not-found boundaries, and `(auth)/error`. Calibration: `/` and `/privacy` show 356.3 KB gz by method B against 179.8 KB gz exact by method A, roughly +175 KB gz. **Use B to rank routes, not as an absolute size.**

Shared by all routes (`rootMainFiles`): 448,411 B raw / **132,484 B gz**
- `a3c2aa7f-….js` 201,059 / 63,161 (react-dom client, Next-compiled copy)
- `860-….js` 241,652 / 66,395 (Next app-router runtime, RSC client, segment-cache)
- `webpack-….js` 5,217 / 2,701
- `main-app-….js` 483 / 227

Polyfills (`polyfills-….js`, nomodule, legacy browsers only): 112,594 / 39,520.

| Route (app dir) | upper-bound KB raw | upper-bound KB gz | chunks |
|---|---|---|---|
| `/(dashboard)/listings/[id]/profile` | 1712.1 | 550.8 | 54 |
| `/(dashboard)/inbox` | 1613.3 | 522.6 | 52 |
| `/(dashboard)/setup` | 1630.5 | 518.1 | 50 |
| `/(dashboard)/listings/[id]/verification` | 1607.9 | 512.4 | 52 |
| `/(dashboard)/listings/[id]/people` | 1607.9 | 512.4 | 52 |
| `/(dashboard)/listings/[id]/posts` | 1563.4 | 504.8 | 52 |
| `/(dashboard)/listings/[id]/hours` | 1548.6 | 503.1 | 53 |
| `/(dashboard)/listings/[id]/menu` | 1544.6 | 501.0 | 52 |
| `/(dashboard)/settings/billing/confirming` | 1524.6 | 496.6 | 56 |
| `/(dashboard)/settings/connections` | 1521.6 | 493.9 | 54 |
| `/(dashboard)/settings/privacy` | 1521.7 | 492.6 | 53 |
| `/(dashboard)/listings/[id]/booking` | 1503.2 | 485.9 | 51 |
| `/(dashboard)/listings/[id]/photos` | 1497.4 | 484.9 | 51 |
| `/(dashboard)/clients/[clientId]/settings` | 1494.5 | 481.1 | 55 |
| `/(dashboard)/settings/billing` | 1474.5 | 480.2 | 53 |
| `/(dashboard)/settings/operations` | 1473.2 | 480.1 | 53 |
| `/(dashboard)/settings/security` | 1462.6 | 479.1 | 55 |
| `/(dashboard)/listings/[id]/changes` | 1475.4 | 478.9 | 50 |
| `/(dashboard)/settings/notifications` | 1465.0 | 477.4 | 53 |
| `/(dashboard)/listings/bulk/[operationId]` | 1531.0 | 474.6 | 51 |
| `/(dashboard)/settings/usage` | 1449.6 | 472.8 | 53 |
| `/(dashboard)/listings/[id]/suggestions` | 1446.4 | 467.5 | 49 |
| `/(dashboard)/settings/policy` | 1415.9 | 462.7 | 52 |
| `/(dashboard)/settings` | 1400.0 | 456.4 | 50 |
| `/settings/listing` | 1400.0 | 456.4 | 50 |
| `/(dashboard)/listings/[id]` | 1406.2 | 455.2 | 48 |
| `/(dashboard)/reports` | 1408.6 | 454.0 | 48 |
| `/design-system` | 1392.6 | 449.2 | 45 |
| `/(dashboard)/clients/[clientId]` | 1369.4 | 441.7 | 51 |
| `/(dashboard)/listings/bulk` | 1430.5 | 441.2 | 48 |
| `/(dashboard)/calendar` | 1335.0 | 431.6 | 48 |
| `/(dashboard)/team` | 1318.0 | 421.3 | 44 |
| `/share/report/[token]` | 1292.0 | 417.7 | 47 |
| `/(dashboard)/clients/new` | 1250.5 | 407.3 | 49 |
| `/(auth)/sign-in/verify` | 1246.5 | 406.4 | 46 |
| `/(dashboard)/clients` | 1211.5 | 393.9 | 46 |
| `/(dashboard)/notifications` | 1178.8 | 385.6 | 43 |
| `/(auth)/invite/[token]` | 1169.3 | 383.1 | 44 |
| `/(auth)/reset-password` | 1183.1 | 382.9 | 40 |
| `/(auth)/forgot-password` | 1180.3 | 381.4 | 39 |
| `/(auth)/sign-in` | 1136.9 | 373.0 | 43 |
| `/(dashboard)/listings` | 1102.6 | 360.3 | 39 |
| `/(legal)/privacy` | 1092.0 | 356.3 | 38 |
| `/(legal)/terms` | 1092.0 | 356.3 | 38 |
| `/_global-error` | 1092.0 | 356.3 | 38 |
| `/_not-found` | 1092.0 | 356.3 | 38 |
| `/` | 1092.0 | 356.3 | 38 |
| `/photos` | 1092.0 | 356.3 | 38 |
| `/posts` | 1092.0 | 356.3 | 38 |
| `/profile/[...section]` | 1092.0 | 356.3 | 38 |
| `/profile` | 1092.0 | 356.3 | 38 |

#### Heaviest routes → page files
| Route | Page file | Route-only chunk (raw / gz) | Dominant modules |
|---|---|---|---|
| `/listings/[id]/profile` | `app/(dashboard)/listings/[id]/profile/page.tsx` | page chunk 165,771 / 48,610 | `components/locations/profile/profile-editor.tsx` 18.0K, `components/ui/overlay.tsx` 8.7K, `sections/contact-section.tsx` 8.0K; `components/locations` 98.7K total |
| `/inbox` | `app/(dashboard)/inbox/page.tsx` (+ `loading.tsx` 18.7K, `error.tsx`) | page chunk 188,656 / 58,757 | `components/inbox/review-detail.tsx` 17.1K, `inbox-view.tsx` 11.1K, `reply-composer.tsx` 10.8K, `components/ui/toast.tsx` 9.5K |
| `/setup` | `app/(dashboard)/setup/page.tsx` | page chunk 199,113 / 53,913 (largest page chunk) | `components/setup/onboarding-drafts.tsx` 26.7K, `setup-wizard.tsx` 10.0K, `onboarding-review.tsx` 8.1K; `components/setup` 110K total |
| `/listings/[id]/people`, `/verification` | `app/(dashboard)/listings/[id]/{people,verification}/page.tsx` | shared split chunk `9465` 168,069 / 45,521 | `components/locations/administration/*` (93.3K), `components/ui/settings-row.tsx` 8.3K, `lib/locations/google-values.ts` 7.2K |
| `/listings/[id]/posts` | `app/(dashboard)/listings/[id]/posts/page.tsx` | 104,697 / 31,706 | `post-composer-sheet.tsx` 17.3K, `schedule-post-sheet.tsx` 11.3K |

## `.next/static/chunks` totals (measured)

- **366 JS files, 5,739,211 B raw / 1,843,879 B gz** (du: 6,576 KB)
- 205 of these files (818,776 B raw) are referenced by no app-route manifest. They are async/lazy chunks and pages-router leftovers (`framework`, `main`, `polyfills`, builtin error pages).
- CSS: `b431e6b3872e28e1.css` 235,152 raw / **37,350 gz** (root layout, every route); `8f10ceb9547828c0.css` 655 / 292.

## 15 largest client chunks, with dominant modules (source-map attribution, bytes of minified output)

| # | chunk | raw B | gz B | #routes referencing | dominant packages / dirs |
|---|---|---|---|---|---|
| 1 | `860-4b0af8739ff5b3a5.js` | 241652 | 66395 | 51 | npm:next/react(chained-map) 183.9K; npm:next 50.0K; npm:@swc/helpers 0.8K |
| 2 | `framework-74790a9222127649.js` | 218930 | 68371 | 0 | npm:react-dom 202.4K; npm:react 7.9K; npm:scheduler 3.4K |
| 3 | `a3c2aa7f-a0e3c337bc8b2f24.js` | 201059 | 63161 | 51 | npm:next 196.3K |
| 4 | `app/(dashboard)/setup/page-890b728fef353d99.js` | 199113 | 53913 | 1 | app:components/setup 110.0K; app:components/ui 20.9K; app:lib/domain 14.8K |
| 5 | `app/(dashboard)/inbox/page-a22ee9c79c732110.js` | 188656 | 58757 | 1 | app:components/inbox 99.1K; app:components/ui 31.7K; app:lib/contracts 10.8K |
| 6 | `9465-73d6453d6b4c29b9.js` | 168069 | 45521 | 2 | app:components/locations 93.3K; app:components/ui 32.9K; app:lib/contracts 11.4K |
| 7 | `app/(dashboard)/listings/[id]/profile/page-2f16097bff1b0863.js` | 165771 | 48610 | 1 | app:components/locations 98.7K; app:components/ui 24.6K; app:lib/locations 18.7K |
| 8 | `main-af011b84296a9be5.js` | 139773 | 40495 | 0 | npm:next/react(chained-map) 117.1K; npm:next 18.4K; npm:@swc/helpers 0.8K |
| 9 | `polyfills-42372ed130431b0a.js` | 112594 | 39520 | 0 | core-js/Next polyfills (no source map; nomodule) |
| 10 | `app/design-system/page-0925193eba839384.js` | 108260 | 28854 | 1 | app:components/ui 65.5K; app:app/design-system 33.9K; npm:lucide-react(chained-map) 4.1K |
| 11 | `app/(dashboard)/listings/[id]/posts/page-b3875d782c663b06.js` | 104697 | 31706 | 1 | app:components/locations 55.5K; app:components/ui 22.9K; app:lib/locations 6.2K |
| 12 | `2933-27499cfae04f5537.js` | 104100 | 36506 | 51 | npm:@base-ui/react 80.6K; npm:@floating-ui/dom 7.4K; npm:@floating-ui/core 6.5K |
| 13 | `app/(dashboard)/settings/privacy/page-ebcdeba7151d9786.js` | 89054 | 25138 | 1 | app:components/ui 30.4K; app:components/settings 25.9K; app:lib/settings 11.9K |
| 14 | `9572-d11eb36e310cd496.js` | 83203 | 25873 | 11 | app:components/listings 12.6K; app:lib/listings 11.6K; app:lib/domain 11.5K |
| 15 | `app/(dashboard)/layout-5e756df7fff2ca9f.js` | 76362 | 23625 | 51 | app:components/app-shell 36.7K; app:lib/queries 9.2K; app:lib/clients 7.4K |

Notes:
- "next/react(chained-map)" covers Next/React internals whose own source maps chain to `../../src/...` paths. The `860` and `main` chunks are entirely Next runtime.
- `framework` (react-dom 202K) and `main` are **not referenced by any app route** (0 routes). They serve the pages-router fallback. App routes use `a3c2aa7f`, which is a second, Next-compiled react-dom of 196K. Both copies are emitted, but a given page loads only one.
- `1914-….js` has **no source map**. It is 56,086 B raw: `lib/domain/google-lodging-schema.json`, the Google My Business Lodging discovery document, inlined as JSON. Manifest references: `/listings/bulk` and `/listings/bulk/[operationId]`. Importers: `components/locations/profile/sections/{lodging-workspace,industry-editor,industry-sections}.tsx` and `lib/contracts/lodging-preview.ts`. It probably also loads lazily from the profile editor; I didn't confirm that. **Candidate**: keep this out of the client, or load it only when the lodging section opens.

## Library check: which large libraries reach client chunks (source-map `sources`, strict package match)

| Library | In client chunks? | Measured bytes (sum over chunks) | Where |
|---|---|---|---|
| **@opentelemetry/*** | **NO — clean** | 0 | Zero `sources` entries. The string "opentelemetry" appears only inside the pnpm directory name of `next@16.3.8_…_@opentelemetry+api…`, not as code. `grep -rl opentelemetry .next/static` → 0 files. |
| date-fns | **No** | 0 | Not bundled client-side. `@base-ui/react` peer-links `@date-fns/tz`, but no date-fns module is emitted. |
| embla-carousel(-react) | **No** | 0 | Dependency declared but not imported by any client code that ships. |
| recharts, stripe | **No** | 0 | — |
| cmdk | Yes, `/design-system` only | 11.4K (+ Radix/react-remove-scroll ~16K, same chunk `2137`) | chunk `2137`, 1 route (`app/design-system/command-demo.tsx`) |
| zod | **Yes, widely** | 73.9K total; 73.0K in chunk `772` | `772` is referenced by **35 routes**, including `/sign-in/verify`, `/forgot-password`, `/reset-password`, `/inbox` and most dashboard pages. Zod v4 classic full build, about 19.9 KB gz in the client. |
| @base-ui/react (+utils) | Yes, heavily | 399.5K + 19.5K across 63 / 17 chunks | Biggest single piece is chunk `2933`: 104,100 / 36,506, on all 51 routes (drawer, floating-ui, focus manager) |
| @tanstack/query-core | Yes | 137.0K across 24 chunks | Mutation and MutationObserver modules are duplicated: `mutation.js` in 18 chunks, `mutationObserver.js` in 17 |
| lucide-react | Yes | 176.7K across 82 chunks | Icon base (`createLucideIcon`, `Icon.ts`, `mergeClasses`) appears in several chunks |
| tailwind-merge | Yes | 27.2K | chunk `7147`, all routes |

## Module duplication across chunks (measured, indicative)

The same source file is emitted in more than one chunk. Summing every copy beyond the largest gives **2,014,817 B of duplicated minified bytes**, about 35% of the 5.74 MB chunk total. By owner:

| Owner | duplicated bytes | files |
|---|---|---|
| `components/ui` | 1,021.3K | 56 |
| lucide-react | 130.2K | 87 |
| @tanstack/query-core | 98.1K | 7 |
| `components/app-shell` | 82.5K | 10 |
| @base-ui/react | 81.4K | 43 |
| `lib/queries` | 76.3K | 19 |
| `lib/contracts` | 58.6K | 22 |

Most of this is cross-route duplication, which costs disk and cache rather than per-page download. However, some source files appear in more than one chunk loaded by the same route: 111 for `/inbox`, 112 for `/listings/[id]/profile` and 40 for `/privacy`. Examples are @base-ui internals (`useOpenChangeComplete`, `TransitionStatusDataAttributes`) and lucide base helpers. Caveat: chained library maps can share relative names such as `../../src/context.ts`, so the lucide-style counts may include some false matches. The @base-ui and @tanstack paths are unambiguous. Per-route duplicated bytes were **not** quantified.

## Limitations

- Next 16 no longer prints per-route sizes. Method B is an upper bound; method A is exact but covers static pages only. Dynamic dashboard routes can't be prerendered without auth and a DB, and per the brief I didn't run the server against any DB.
- Attribution comes from a second build with `productionBrowserSourceMaps`. Module IDs and chunk names match the baseline. Content hashes differ only for chunks that changed because of the sourceMappingURL comment, and all sizes in the tables come from the baseline build.
- No dependencies were added and no bundle analyzer was used. Artifacts are left in the worktree (`.next/`, `.next-sm/`, untracked). Nothing was committed, pushed or deployed.
