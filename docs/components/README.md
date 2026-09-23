# UI primitives

The primitives live in `components/ui/`, and the source is the reference.
There is no separate component API to document: each file exports the parts it
names, typed, with the reasoning for anything surprising in a comment above the
code it explains.

There used to be one Markdown file per component here. They described a
`window.NabaPresence.*` prototype runtime that the app has not used since the
August 2026 rebuild, and half of them documented components that were never
built. Keeping them meant maintaining a second, wrong description of every
control.

## Where to look instead

| Question                                                    | Answer                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| What does this look like, in both themes?                   | `/design-system` in a development build — internal evidence, gated by `DESIGN_SYSTEM_EVIDENCE_ENABLED` and not served in production |
| Which colour, size or radius should I use?                  | `app/globals.css`, layer 2 (the `--np-*` roles)                                                                                     |
| Is this pair readable?                                      | `pnpm check:contrast`, and `lib/design/contrast-pairs.ts` for the manifest                                                          |
| Why is it built this way?                                   | `docs/specs/2026-09-23-operators-desk-identity.md` (it supersedes `2026-09-19-warm-paper-identity.md`)                              |
| Which reference, token and utility go together?             | The token map and type roles in that spec                                                                                           |
| Which routes are implemented and verified, at which widths? | `docs/specs/2026-09-23-redesign-route-checklist.md`                                                                                 |
| What are the status words?                                  | `lib/ui/status-tone.ts` for the five tones; the identity spec's "Status words" for what may be said about Google                    |

## The rules a new primitive has to follow

- Read a semantic role through its utility (`bg-surface`, `text-ink-muted`,
  `border-line`), never a ramp step and never a literal colour.
- One green accent: the primary action, focus, the current item and the
  selected row. Pressed chips and the tab underline are ink, not accent.
- Serif (`font-display`, `font-reading`) only for page titles and the
  customer's words. Everything else is the system sans; figures, counts, IDs
  and timestamps are `font-mono tabular-nums`.
- Put the dark action bar (`ActionBar`, `bg-charcoal`, `on-charcoal`) on at
  most one region per screen, and only for the action that reaches Google.
  Toasts are charcoal too. In dark the charcoal role is near-white; never
  assume dark means black.
- There is no caption bar. Do not use the `caption-bar` utility or the
  `--np-caption-bar*` roles; they remain only until nothing references them.
- Show status as a word plus a tone (`StatusPill`, `lib/ui/status-tone.ts`),
  never colour alone. Say "Sent to Google" or "Live on Google" only from real
  operation or verification evidence.
- Move with `--np-ease-out` at 140ms (colour) or 260ms (movement). Never
  `transition: all`, never a spring, never a hidden-by-default reveal; hover
  fills only for fine pointers (`hover-fine:`).
- Take its shape from a radius token: `rounded-sm` tag, `rounded-md` control,
  `rounded-lg` card, `rounded-2xl` modal, `rounded-full` pill.
- Carry a visible reason whenever a control is disabled.
- Name itself for a screen reader: an icon-only control needs an accessible
  name, a toggle needs `aria-labelledby` on its role element, and a table or
  chart needs a caption or a data table.
- Work from 320px up: controls 36px, 44px on coarse pointers, no target
  smaller than 24px, and no hover-only actions.
