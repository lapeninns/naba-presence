## What and why

<!-- One or two sentences: the change and the reason for it. -->

## Evidence

GitHub Actions is disabled; the merge check is `local-ci/release-gate`
(docs/ci.md §5). Do not run `pnpm verify:release` before merge: local-ci's
`gate` job is that command. No human review is needed; `lci merge` enforces
the Codex review.

- [ ] `pnpm verify` passed on the final head (paste the summary or say which
      steps you ran instead, and why)
- [ ] Rebased on `origin/main`, then one
      `lci run naba-presence --pr <N> --post --comment --wait` on the final head
- [ ] Merge through `lci merge naba-presence --pr <N>` only

## Migrations

<!-- Delete this section when the PR adds nothing under supabase/migrations. -->

- [ ] Every new migration is expand-only (no `-- migrate:contract`, nothing
      dropped, renamed or rewritten); otherwise the owner applies it
- [ ] Plan: the `pnpm db:status` output against production (pending versions
      equal this PR's files) and what each file adds
- [ ] Applied to production after `local-ci/release-gate` passed on this
      head and before merge; `pnpm db:status --expect-current`
      result pasted below, then the `migrations-applied` label added
      (credentials from the keychain, never pasted)

## Risk

<!-- Production behaviour, new environment variables, rollback. Staging is
needed first only for database, payments, sign-in/auth and email/SMS
changes. -->
