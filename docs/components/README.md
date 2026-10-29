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
  selected row (`--np-selection-bg`). Pressed chips, navigation count badges
  and the tab underline are ink, not accent.
- One sans for everything, page titles and the customer's words included
  (decision D1). Figures, counts and timestamps are sans `tabular-nums`; IDs
  and codes are `font-mono`. A KPI's value is the `text-figure` role,
  grouped in a `KpiStrip`, not a card per figure.
- Put the dark action bar (`ActionBar`, `bg-charcoal`, `on-charcoal`) on at
  most one region per screen, and only for the action that reaches Google.
  Toasts are charcoal too.
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
- Draw every state with a role, never opacity. Disabled is the
  `drawn-disabled:` variant with `bg-disabled`, `text-disabled-ink` and
  `border-disabled-line` (4.5:1, gated); a pending control keeps its colours.
  Focus is the 2px `focus-halo` on every control, fields included; an
  invalid field keeps its red edge and rings in `shadow-np-focus-danger`.
- Carry a visible reason whenever a control is disabled.
- Loading is the final layout in flat `Skeleton` bars (no shimmer), and an
  empty or error state is a bare 20px glyph, a title and one sentence, with
  no tinted icon square. See `docs/specs/2026-10-29-taste-pilot-direction.md`.
- Name itself for a screen reader: an icon-only control needs an accessible
  name, a toggle needs `aria-labelledby` on its role element, and a table or
  chart needs a caption or a data table.
- Work from 320px up: controls 44px on touch, 36px on a desk, no target
  smaller than 24px, and no hover-only actions.
