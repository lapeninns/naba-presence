# SDD ledger — plan: docs/superpowers/plans/2026-07-31-frontend-rebuild-m1-foundation.md

Worktree: /Users/amankumarshrestha/LapenInns Project/NabaPresence/.worktrees/frontend-rebuild (branch frontend-rebuild)
Baseline at 33e06a1: typecheck green, unit suite 243 passed / 159 skipped.
Pre-flight plan scan: clean (Task 9's route edit is the constraint-sanctioned exception).
Task 1: minor (deferred): data-theme-probe attr added net-new on design-system page (inert; align if a later selector convention lands)
Task 1: minor (deferred): design-system page text sizes moved to Tailwind scale (px parity delta, rule-compliant)
Task 1: tracking: /sign-in redirect targets a route M2 recreates — must exist before branch swap (spec swap criteria already gate this)
Task 1: complete (commits 33e06a1..77dcfee, review clean)
Task 2: fix round 1/5 (3 addressed, 0 open; commits 84a7db4..0003571)
Task 2: complete (commits 77dcfee..0003571, review clean after 1 fix round)
Task 3: complete (commits 0003571..0313c88, review clean)
Task 4: minor (deferred): formatDuration silently renders negative inputs (e.g. "-1m"); assumption non-negative — guard when a caller can produce negatives
Task 4: note: TDD failing-run not evidenced in report (deliverable verified correct; process note only)
Task 4: complete (commits 0313c88..405fcd9, review clean)
Task 5: minor (deferred): draft-stash empty-string skip branch untested (a regression to null-only would pass)
Task 5: minor (deferred): a throwing snapshot() aborts stashAllDrafts loop and can swallow the 401 redirect — consider per-source try/catch
Task 5: fix round 1/5 dispatched (2 Important: test module-state leak + unstubbed globals; request-construction path untested)
Task 5: fix round 1/5 (2 addressed, 0 open; commits 90d47fc..6be8e93)
Task 5: complete (commits 405fcd9..6be8e93, review clean after 1 fix round)
Task 6: complete (commits 6be8e93..05330a5, review clean)
Task 7: minor (deferred): Button stamps type="button" unconditionally even via render-prop non-button elements — guard before a render-as-link consumer appears
Task 7: note: Badge info variant deviates from brief (text-foreground fallback) — verified sound by implementer AND reviewer independently (brief's literal code failed AA at 3.79:1)
Task 7: fix round 1/5 dispatched (1 Important: icon-lg missing from IconSize aria-label gate)
Task 7: fix round 1/5 (1 addressed, 0 open; commits 95226b4..84f0472)
Task 7: complete (commits 05330a5..84f0472, review clean after 1 fix round)
Task 8: note: setup.ts RTL cleanup fix (out-of-list, reviewer-verified canonical) benefits all component tests
Task 8: minor (deferred): toast raw 500ms/150ms swipe transitions untokenized (reduced-motion rule covers them; token question deferred per brief scope)
Task 8: note: sheet shadow token applied beyond literal brief wording (Dialog+Sheet) — reviewer judged sound; brief author (controller) confirms intent was both modal surfaces
Task 8: fix round 1/5 dispatched (1 Important: toast close aria-label regression "Close toast"->"Close")
Task 8: fix round 1/5 (1 addressed, 0 open; commits 3e96fab..0751046)
Task 8: complete (commits 84f0472..0751046, review clean after 1 fix round)
Task 9: plan-conflict ruling (user): reviewer's fix governs over plan's literal ::text instruction — raw timestamptz + TS toISOString, integration assertion pins ISO format
Task 9: minor (deferred): app-shell RTL skip-link test asserts href/id but not actual tab order (live-verified separately)
Task 9: minor (deferred): error/not-found pages have no landmark regions (matches brief's literal shape)
Task 9: fix round 1/5 dispatched (1 Important: timestamp wire-format drift from ::text casts)
Task 9: fix round 1/5 (1 addressed, 0 open; commits c14e139..b040924)
Task 9: complete (commits 0751046..b040924, review clean after 1 fix round)
Task 10: rulings: session-bootstrap fix CORRECT (triple-gated, no prod auto-provision); announcer skip-while-loading CORRECT per T9 intent; swatch removal CORRECT (evidence table stays truthful)
Task 10: minor (deferred): app-shell comment overstates apiFetch 401 scope (only authentication_required code redirects) — cosmetic wording
Task 10: tracking: Nav prefetch={false} is temporary — re-enable per route as each milestone ships its page
Task 10: fix round 1/5 dispatched (1 Important: report lacks verbatim gate transcripts — amendment only, no code change)
Task 10: fix round 1/5 (1 addressed — report amendment only, no commit; counts re-verified)
Task 10: complete (commits b040924..ce1498d, review clean after 1 fix round)
All 10 tasks complete. Final whole-branch review next.
Final review: CHANGES REQUIRED — I-1 quarantine sign-in integration tests (re-enable M2/M4), I-2 Field dangling describedby; minors M-1..M-6 folded into wave; ledger triage rulings recorded by reviewer
Final review process note: legacy redirect routes (/reviews,/overview,/analytics,/connections) deleted in T1 are assigned to no milestone — MUST be added to M3/M4/M6/M7 plans or the M9 checklist
Final fix wave: found in-progress at session start (all 8 findings' code already present save M-4's leftover comment block, plus 4 orphaned harness-tenant DB rows and an untracked .playwright-mcp/ dir from an evidently interrupted prior attempt) — completed M-4, cleaned the stale DB fixtures via destroyTenants' own logic, re-verified every finding against shipped code, ran the full gate for real. typecheck/lint/build green, pnpm test 288 passed/159 skipped, e2e foundation.spec.ts 5/5, test:integration 156 passed/3 skipped/159 total exit 0. commit 1570245. See final-fix-wave-report.md.
Final fix wave: complete. Milestone 1 foundation gate is green — ready for branch-swap review per spec criteria.
Final fix wave: complete (ce1498d..1570245); scoped re-review PASS — all 8 findings ADDRESSED, no new breakage, integration exit 0
Milestone 1 COMPLETE at 1570245. Carry-forwards for M2+ plans: sign-in/inbox test re-enables (M2/M4), Nav prefetch re-enable per route, legacy redirects need milestone owners (M3/M4/M6/M7 or M9), formatDuration negative guard (M7), toast swipe tokens + error-page landmarks (M9), apiFetch 204 handling with first consumer, ShellSession extend-with-capabilities note.
