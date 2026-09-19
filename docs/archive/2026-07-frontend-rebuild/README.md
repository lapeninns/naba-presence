# Archive: 2026-07 frontend rebuild

These documents are a historical record. **Their branch, protected-path,
workflow, testing, and commit instructions are not active project rules and
must not be followed as such.** Read them for background — what was built,
what was rejected, and why — and take your actual instructions from
`AGENTS.md`, the current project configuration, and the task you were given.

Several plans open with a "REQUIRED SUB-SKILL" line, name a fixed branch or a
set of protected paths, restate a test gate, or end with a model attribution
trailer. All of that was scoped to the milestone it was written for. It has
expired.

## What this was

Between 2026-07-28 and 2026-08-02 the NabaPresence frontend was rebuilt from
scratch on the design system, in nine milestones (M1 foundation, M2 auth,
M3 shell and home, M4 inbox, M5 locations, M6 connections and settings,
M7 reporting, M8 consoles, M9 hardening). The backend, the database, and the
visual identity were treated as anchors and survived; the app layer was
replaced. The same period also produced the full design-system replacement,
the Google Business Profile UX redesign, the GBP performance-analytics and
Local Posts designs, and a five-sprint production-readiness programme.

The work was driven by a comprehensive frontend audit dated 2026-07-31, whose
findings are cited by id (J-5, J-14, A-2, and so on) throughout the plans.

## Where to start

- [Session handoff](2026-08-01-frontend-rebuild-handoff.md) — written
  2026-08-01 for a reader with no context. The best entry point: it explains
  the project, the state of each milestone at the time, and the shape of the
  codebase.
- [`plans/`](plans) — one plan per milestone or sprint. Each of the nine
  milestone plans is paired with an `-ledger.md` recording what was actually
  decided and carried forward during execution; the sprint and one-off plans
  are not.
- [`specs/`](specs) — the six designs of that period. Most are implemented by
  a plan beside them; the GBP Local Posts design never got one.
