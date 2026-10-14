# Implementation registry (coordinator: claude3)

Started 2026-10-14. Each agent works in its own T3 worktree off origin/main (d8759c74), opens PRs against main, never merges. Coordinator reviews, links PRs, resolves merge order and schema-manifest conflicts.

Audit docs PR: #71 (docs/full-stack-audit-2026-10-14).

## Migration number allocation
| Numbers | Owner | WP |
|---|---|---|
| 0132–0133 | claude6 | WP-00 SEC-11 |
| 0134–0138 | claude5 | WP-10 indexes |
| 0139–0140 | claudeAgent | WP-06 legal hold |
| 0141–0142 | claude8 | WP-03 ingest |
| 0143 | claude4 | WP-02 |
| 0144 | claude3 | WP-04 |
| 0145+ | wave 2 | WP-11/12/15 |

## Wave 1
| Task | Account | Branch(es) | Scope | Status | PR(s) | Review |
|---|---|---|---|---|---|---|
| WP00 | claude6 | fix/sec-11-data-api-grants; fix/auth-confirm-interstitial | SEC-11/W6-02 migration + catalogue test; W6-05 | done | #74, #77 | #74 reviewed: revokes no-op w/o roles, bootstrap guard keeps body, also scoped organisation_provision; catalogue test fails without 0132 (agent) |
| WP01-09 | claude1 | fix/approve-binds-draft; perf/review-write-scoped-cache | W1-F1; W1-F2/F3/F4/F8/F10 + contracts | done | #72, #82 | publish w/3 pages: 5 -> 2 follow-up requests; settling 5s->15s->60s, stop 10 min; 4xx no retry (except 408/429); approve 409s on newer unsubmitted draft until resubmit -> follow-up; rebase on use-approval-decision.ts |
| WP08 | claude2 | perf/inbox-interaction (may split) | W5-01, W2-01, W5-02, W2-02, X1-01, W0-05, listings debounce | done | #73, #79, #75 | #75 throttle reviewed (where last_seen_at < now()-1 min; checks still per request); e2e: row click 0 _rsc, 5 reviews 0 extra history; #73/#79 import conflict near useNow; merge #75 after WP-06 session-payload PR |
| WP04-05 | claude3 | fix/request-budgets-ai-credits; fix/error-taxonomy | W3-4/R2B-05 deadline + credits; W3-3 | done | #81, #90 | ctx.deadline (epoch ms, maxDuration-5s); 43 routes newly capped at 60 -> verify vs platform default (WP04b); credit charged with draft insert (product change: undelivered draft no longer costs a credit); 502/500 taxonomy |
| WP02 | claude4 | fix/google-write-sessions (+ -2 stacked) | W4-01 primitive, 13 sites | done | #87, #97 (stacked) | 409 google_write_busy ~10 s; deadline-capped timeouts; refuse send if timeout won't fit (503); lock loss after Google success -> 200; audit correction: postgres.js fails tx on socket close mid-work, not at COMMIT; deadline wiring from #81 pending merge |
| WP03 | claude8 | fix/guarded-review-ingest | W4-03 + W8-04 | done | #78 | reviewed diff; deviation: settle does not refresh content_hash (one extra update per reply); behaviour change: locally failed reply edit stays failed until Google changes; pre-existing sync/publish lock-order deadlock risk -> WP-12 |
| WP10-14 | claude5 | perf/audit-log-and-fk-indexes; perf/bundle-hygiene | W4-04/08; bundles + 7 deps | done | #80, #101 | #80 also fixes db-migrate unable to run concurrently files (touches WP-13 script) and listed 0132/0133 as known gaps -> revert at renumber; #101 JS 5.74->5.38 MB (-6.2%), 25 light routes +0.2-4.7 KB gz (coordinator recommends keep) |
| WP13-07 | claude7 | ci/merge-gate-and-staged-promote; feat/otel-export-and-probe | W7-2/4/5; W7-1/3 code side | done | #76, #85 | hosted CI blocked by Actions BUDGET (billing setting); staged promote w/ probe; zero-test gate; secret-scan required; 5 s lock_timeout + contract marker; OTEL flush proven vs local capture; operator: budget/self-hosted runner, ruleset, OTLP dest, NABA_READINESS_TOKEN |
| WP06 | claudeAgent | fix/legal-hold-and-erasure-integrity; fix/session-payload-trim | R2B-01/02/03; layout session P3 | done | #83, #86 | 0139 hold triggers + RESTRICT FK; erasure preview token; reasons scrubbed; 113/113 integration; held-review location cascade now raises (intended); media race open -> WP15d |

## Wave 2 (assign as accounts free up)
- WP-11 freshness-aware editors (W3-2, W0-04) — after WP-02/WP-03.
- WP-12 job scheduling (W8-01/02/03/05/08/09).
- WP-15 clean-up: idempotency polish (W1-F6/F7, R2-W1b), dirty-guard hook (W2-07), keys (W2-05), W2-04, counts/search (W4-06/07), batched metric upserts (W4-09), W0-02 scheduler parity, W0-06 shared guards, W0-10 docs drift, W3-1 discovery routes, W3-07 abuse limits, R2B-04 member limit, R2B-06 billing alerting, W6-03 publish re-arm CAS, W8-08/09.

| WP15a | claude6 | fix/publish-rearm-cas; fix/abuse-limits-and-fairness; fix/billing-limits-and-alerts | W6-03; W3-07 + W8-08; R2B-04/06 | PARTIAL (claude6 hit API rate limit) | #88, #92 | billing PR unfinished: uncommitted work in ~/.t3/worktrees/naba-presence/t3-8b541c13 (branch fix/billing-limits-and-alerts) -> reassign to next free account |

| WP12 | claude8 | perf/job-runner-scheduling | W8-01/02/03/05/09 + lock order note | done | #104 | posts first (15 s), bulk reserve, priority claim (0147), start gating + release_unstarted_job, fleet_lease rows (0148), bulk capped; 1,000-job test; one flaky profile-editor component test seen once; conflicts with #81 imports |

| WP15b | claude2 | refactor/unsaved-changes-hook; fix/query-key-roots; fix/post-and-bulk-idempotency | W2-07/W2-04; W2-05/F11/F12; W1-F6/F7 | done | #84, #91, #94 | retry-after-success 200; bulk dedupe via mutation_operation ledger; useUnsavedChanges across 5 editors; residual: concurrent same-post approve -> 2 decision rows (1 Google write) |

| WP15c | claude1 | fix/approval-pending-draft-and-versions (stacked on #82); perf/shell-polls-and-google-refetch | pending-draft approve + version guard; X1 poll consolidation, W5-07, W3-1 | done | #89 (stacked on #82, merges #72), #93 | idle tab 40 -> 8 req/10 min; /api/shell-status 90 s; Google tabs no focus refetch; INCIDENT: claude1 stopped shared default local cluster naba-pg-local (throwaway); verify/agent named clusters unaffected |

| INT1 | claude7 | integration/audit-fixes-r1 | merge all open PRs, resolve conflicts, full local gate (CI blocked) | done | integration/audit-fixes-r1 | 15 PRs; integration 1302/1302 (37 min); e2e 573 pass / 3 fail (2 = #82 PIN-drift race, 1 flake); fixups: #78 TS2790 (coordinator pushed 82c0d325), KNOWN_VERSION_GAPS 0132, preview route maxDuration |

| WP15d | claudeAgent | perf/counts-search-metrics; fix/retention-media-hold-race | W4-06/07/09; media hold race | done | #96, #100 (stacked on #83) | counts 1 query; search: audit fix wrong under RLS -> bounded SD lookup (tenant guard checked by coordinator), common terms ~500 ms -> 2-275 ms on 300k fixture; metrics 6,028 -> 7 statements |

| WP04b | claude3 | onto #81/#90 + fix/sweep-deadline + fix/scheduler-parity | maxDuration default check; W3-4c; WP-05 remainder; W0-02 | done | #81 (updated), #102 (stacked on #81), #90 (updated), #95 | CONFIRMED risk: Fluid 300 s default; 15 Google-chaining routes restored to 300, 28 keep 60; 47 stored/server parse sites -> 500; scheduler GETs vercel.json paths; cron POST inline path retained for tests (retire later) |

| WP15e | claude1 | fix/bulk-approve-parked-draft (stacked on #89); refactor/reviewed-write-shared-guards | bulk approve parked draft; W0-06 narrow | done | #98 (stacked on #89), #106 | pendingDraftId on rows; helper gained optional message (audit missed per-copy wording); conflict-free with #87/#97 |

| WP15f | claude2 | fix/composer-discard-version (stacked on #79); docs/audit-drift-fixes | composer discard; W0-10 docs drift | done | #99 (stacked on #79), #103 | discard re-arms guard on next edit (not a version bump, avoids double prompt); docs facts corrected, ledger statuses untouched |

| WP11 | claude4 | perf/fresh-editors-* (stacked on #97) | W3-2, W0-04 | done (hours, profile) | #108 (on #97), #111 (on #108) | 5-min freshness, 0 Google calls within window; migration 0155 stored payload, 30-day retention; save-and-publish <=2 Google reads (from >=4); behaviour change: Google-side edits may take <=5 min unless 'Check Google now'; conflict with #93 hooks |
| WP11b | claude4 | perf/fresh-editors-posts-place-actions (on #111) | posts, place actions, business info | done | #112 (on #111) | posts list no longer up to 100 Google pages on open; migration 0156; 88/88 changed integration files |

| WP15a-billing | claudeAgent | fix/billing-limits-and-alerts (claude6's worktree t3-8b541c13) | R2B-04, R2B-06 | done | #109 | member limit 402 (invites count as seats; race-safe accept; downgrade below members 409; only with enforcement on, never pilots); single incidents per condition; FULL integration 1264/1264 |

| WP10b | claude5 | perf/publish-fk-indexes (stacked on #80) | remaining FK indexes | done | #105 (stacked on #80) | 0157-0159 all justified by retention purge cascades; 0 seq scans vs 2 each without; lists 0139-0156 as known gaps -> revert at renumber |

| LOCKORDER | claude8 -> claude5 | fix/review-lock-order (stacked on #78), worktree t3-c58dbb36 | sync vs publish deadlock | verified by claude2; bulk-order follow-up running | #107 (stacked on #78) | defect fixed bc7a1ffd (disconnect route old order -> new deadlock); full integration 1272/1272; both lock tests fail w/o fix; bulk approvals id-sorted via lockReviews (b3496841; also sync pages, sweep tombstone, privacy, relink); 40P01 without sort, pass with; full integration 1274/1274 -> READY for r3 |

| FIX82 | claude1 | perf/review-write-scoped-cache | verification-pin-drift e2e race | done | #82 (fa272035), #89/#98 rebased | test-only race (409 google_target_changed refetch; UI blocking is correct); spec 21/21 x3 clusters; retry policy unchanged |
| DEPS | claude3 | chore/dependency-security-updates | 46 Dependabot alerts (1 crit, 19 high) triage + safe fixes | done | #110 | all 46 dev-only (shadcn CLI, eslint, jsdom/vitest); lockfile-only, 45 fixed; coordinator checked diff: only vulnerable dev pkgs + postcss 8.5.29->8.5.30 patch; braces (no patch) remains |
| TRAIN1 | claude7 | integration/audit-fixes-r2 -> main | renumber migrations gapless, full gate, admin-merge PR by PR (CI budget-blocked; 'CI result' required) | claude7 rate-limited mid-gate; r2 assembled (34 PR heads, migrations 0132-0146 gapless) and pushed by coordinator at 969655f0; nothing merged | | |
| TRAIN2 | claudeAgent | integration/audit-fixes-r2 -> main, then r3 | gate r2, land via single admin-merged integration PR (constituent PRs auto-marked merged), then round 2 as r3 | running | | |

Round 2 train: #72?, #82, #89, #98, #107, #108, #111, #112, #110.

## Not in scope for agents (operator)
- Run CODEBASE_AUDIT.md §3.4 SQL on staging/prod; Supabase Data API toggle.
- Production migrations/promotion (pnpm release:promote).
- OTLP destination + readiness token secret; GitHub settings (branch protection / Actions).

## Known conflict hot-spots
- MIGRATION NUMBERING MUST BE GAPLESS (tests/migration-contract.test.ts:65, KNOWN_VERSION_GAPS). Reserved ranges leave gaps (0133, 0140-0144 unused so far). Coordinator renumbers migrations in merge order before each merge and updates schema-manifest.
- lib/server/schema-manifest.ts: every migration PR appends — coordinator rebases in merge order.
- components/inbox/* and lib/queries/*: claude2 (render/URL) vs claude1 (invalidation/contract) vs user's uncommitted layout edits.
- deadline primitive: claude3 (route ctx.deadline) vs claude4 (write session deadline param) — plain epoch-ms param contract.
