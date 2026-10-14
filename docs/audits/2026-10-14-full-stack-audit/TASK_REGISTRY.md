# Audit task registry (coordinator: claude3)

Started 2026-10-14. All round-1 tasks: read-only, shared checkout, one raw file per agent.

| ID | Account | Workstream | Raw file | Depends on | Status | Verification |
|---|---|---|---|---|---|---|
| W0 | claudeAgent (0) | Architecture, repo map, dependencies, flow traces | raw/W0-architecture.md | none | done | W0-01 ordering confirmed by coordinator (jobs.ts:1111-1139 schedules run last on leftover budget); 7 unused deps confirmed (0 imports in app/components/lib/tests/scripts) |
| W1 | claude1 | Mutations, queries, invalidation, idempotency | raw/W1-mutations-queries.md | none | done | F1 confirmed by coordinator (lib/queries/use-approval-decision.ts:14 omits draftId/expectedReviewUpdateTime; guards optional at lib/server/review-approval.ts:121,149) |
| W2 | claude2 | Custom hooks, state, lifecycle | raw/W2-hooks-state.md | none | done | W2-01 root line confirmed by coordinator in HEAD and working tree (inbox-view.tsx:195); consequences cross-verified by R2-V5 |
| W3 | claude3 | API routes, services, outbound Google/AI | raw/W3-backend-api.md | none | done | webhook_route lead checked by coordinator: forced RLS update policy (0005:113-121) makes cross-org ON CONFLICT update error, not hijack; downgraded to functional setup failure. Contradiction with W0-03 (tx across Google) sent to R2-V1/R2-V2 |
| W4 | claude4 | DB schema, indexes, transactions, pooling | raw/W4-database.md | none | done | W4-01 confirmed by coordinator: hours.ts:738-756 xact advisory lock held across Google read/write; db.ts:41-42 statement 30s / idle-in-tx 60s (refutes W0's 'no timeouts' detail). Cross-verified by R2-V4 |
| W5 | claude5 | Frontend perf, bundles, rendering | raw/W5-frontend-perf.md | none | done | W5-01 mechanism checked: inbox-view.tsx:212-213,314,404 and listings-board.tsx:482 use router.replace/push (runtime _rsc not observed); session lead confirmed: (dashboard)/layout.tsx:149 passes raw session (P3) |
| W6 | claude6 | Security, authz, concurrency, reliability | raw/W6-security-reliability.md | none | done | W6-01 preconditions confirmed by coordinator: no revoke from anon/authenticated in any migration; provision_local_bootstrap SECURITY DEFINER, revoked from PUBLIC only (0005:76-102); organisation_job_route policy using(true) w/o TO (0005:136). Exploitability depends on prod Data API + default privileges: UNVERIFIED (needs operator read-only SQL; local Docker down) |
| W7 | claude7 | Tests, CI, release, observability (only agent running checks) | raw/W7-testing-ci-ops.md | none | done | typecheck/lint/unit observed passing per agent; LOCAL_BOOTSTRAP lead checked by coordinator: startup.ts:88 + session.ts:282 hostname guards, so config hygiene only |
| W8 | claude8 | Jobs, caching, scalability, cross-layer | raw/W8-jobs-caching-scale.md | none | done | cross-verified by R2-V3 (pending) |

Round 2 (verification + cross-layer follow-ups): to be assigned as round-1 tasks complete.
| R2-W1b | claude1 | Trace W1 F6/F7: does bulk template batch double-publish; post approve/delete retries; intent-key forwarding table | raw/R2-W1b-idempotency-trace.md | W1 | done | coordinator confirmed unique (organisation_id, idempotency_key) on publish_attempt (0001:283) + content-derived key (intent.ts:214): no double Google write; local harm only (P2) |
| R2-W7b | claude7 (worktree) | Isolated pnpm build at d8759c74: route table, chunk sizes, client-bundle libs | raw/R2-W7b-build-baseline.md | W5 | done | measured build at d8759c74 (54.3 s, no env); manifest route totals are rank-only (~175 KB gz overcount); worktree left with untracked .next/.next-sm |
| R2-W0b | claudeAgent | Gap: billing state machine/webhooks, AI credit lifecycle, retention/erasure/legal-hold integrity | raw/R2-W0b-billing-credits-retention.md | none | done | 0 P0/P1, 6 P2, 8 P3; coordinator confirmed legal_hold.review_id ON DELETE CASCADE (0001:303) behind R2B-01; corrects W7: subscription changes covered in tests/integration/routes/billing-checkout.test.ts |
| R2-V1 | claude5 | Adversarial verification of W0-01/03/04/05 and W1 F2/F3/F8/F10/retry | raw/R2-V1-verify-W0-W1.md | W0,W1 | done | 0 refuted; corrections: F2 1-3 rounds; F3->P2; F8->P3 (5 sites); F10 polling->P3; W0-03 advisory lock w/ 60s idle-tx (P2, COMMIT-after-Google-accepted risk); W0-01 needs ~5 starved ticks |
| R2-W6b | claude6 | SEC-11/W6-01 blast radius, operator SQL checklist, remediation draft, interim mitigation | raw/R2-W6b-data-api-exposure.md | W6 | partial | sections 1-2 complete (hosting/ownership; 50 SECURITY DEFINER fns ranked; tiers A/B); agent response stopped by a safety classifier mid-section 3; sections 3-5 (verification SQL, remediation draft, interim mitigation) written by coordinator in CODEBASE_AUDIT.md |
| R2-V2 | claude3 | Adversarial verification of W3-1..4, W5-01/02, W6-05; resolve W0-03 vs W3 contradiction | raw/R2-V2-verify-W3-W5-W6.md | W3,W5,W6 | done | 0 refuted; W3-1->P2, W5-02->P2; W5-01 worse (inbox prefetch reruns); W0-03 vs W3 resolved for W0 (lock-only tx); coordinator settled timeout dispute: role-level only (db-create-runtime-role.mjs:37-40), none in withSessionConnection (db.ts:65-69) |
| R2-X1 | claude1 | Cross-layer per-interaction request/query cost model (inbox load, selection, publish, idle tab, hours editor) | raw/R2-X1-interaction-cost-model.md | W0,W1,W3,W5 | done | layouts reused on search-param nav (corrects CODEBASE_AUDIT draft); new PLAUSIBLE list-collapse-on-select; folded into CODEBASE_AUDIT §5 and PERFORMANCE §4.7 by coordinator |
| R2-V3 | claude4 | Adversarial verification of W8-01..05 (sync-overwrites-reply integrity, missed posts, claim priority, stale session locks) | raw/R2-V3-verify-W8.md | W8 | done | 0 refuted; W8-04 CONFIRMED->P2 (self-heals <=15 min; new case: edited reply reverted); W8-02 latent P1/P2 now (~450+ locations); W8-03->P2; W8-05 PARTIAL->P2; W8-01 upper bound P1 |
| R2-V4 | claude8 | Adversarial verification of W4-01..04 + P2s (locks across Google, unconditional sync rewrites, audit-log index, pooler) | raw/R2-V4-verify-W4.md | W4 | done | 0 refuted; W4-01 13 sites, P1 (worst case 85-120 s vs 60 s idle-tx; Google applied + receipt succeeded + user 5xx); W4-01 fix (a) UNSAFE -> prefer SET LOCAL timeouts or table lease; W4-02->P2; W4-03/04 P1 confirmed (index: org,subject_type,subject_id,created_at desc INCLUDE action) |

Note: user is actively editing app/(dashboard)/inbox/page.tsx and tests/components/inbox-*.test.tsx, review-*.test.tsx during the audit (not agent writes).
| R2-V5 | claude5 | Adversarial verification of W2-01/02/04/05/07 + lint probe (HEAD vs user's working tree) | raw/R2-V5-verify-W2.md | W2 | done | W2-01 P1 worse (scroll-snap to selected row every rerender; auto-select overstated); W2-02 P1 confirmed by trace; W2-03 lint cause REFUTED; W2-04/05 -> P3; user's inbox edits layout-only |

## Round 3: deliverable drafting (each agent owns exactly one file)

| ID | Account | Deliverable | Inputs | Status |
|---|---|---|---|---|
| D-backend | claude4 | BACKEND_DATABASE_AUDIT.md | W3,W4,W8,R2-W0b,R2-V2/V3/V4,R2-W1b | done (745 lines; coordinator reviewed summary table vs ledger, checked `-- migrate:no-transaction` exists at scripts/migration-rules.mjs:4) |
| D-arch | claude8 | ARCHITECTURE_IMPROVEMENTS.md | all raw | done (914 lines; coordinator checked W4-01 fix (a) marked rejected, AR-1 returns settled result on lost lock, no new infra proposed) |
| D-perf | claude7 | PERFORMANCE_OPTIMISATION.md | W5,R2-W7b,W7,R2-V2,W8,W4,W1,R2-X1 (if ready) | done (432 lines; coordinator spot-checked numbers trace to R2-W7b/W7; §4.7 placeholder awaits R2-X1) |
| D-hooks | claude2 | MUTATIONS_AND_HOOKS_AUDIT.md | W1,W2,R2-W1b,R2-V1,R2-V5 | done (861 lines; coordinator reviewed structure and contract-change framing) |
| coordinator | claude3 | CODEBASE_AUDIT.md (done), IMPLEMENTATION_ROADMAP.md (done), VERIFIED_FINDINGS.md (done), AGENT_EXECUTION_REPORT.md (done), README.md (done) | all | done |

Coordinator self-correction: my first CODEBASE_AUDIT §5 draft claimed review write endpoints return the updated review; checked lib/contracts/reviews.ts:657-723 — they return status/ids only. Corrected before publication.

Cleanup: build worktree /Users/amankumarshrestha/.t3/worktrees/naba-presence/t3-ddb741dc (branch t3/build-bundle-baseline at d8759c74, only untracked .next-sm/) removed by coordinator.
AGENT_EXECUTION_REPORT.md written by coordinator.

Audit complete. All 23 delegated tasks terminal.
