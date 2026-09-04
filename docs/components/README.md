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

| Question | Answer |
|---|---|
| What does this look like, in both themes? | `/design-system` in the running app |
| Which colour, size or radius should I use? | `app/globals.css`, layer 2 (the `--np-*` roles) |
| Is this pair readable? | `pnpm check:contrast`, and `lib/design/contrast-pairs.ts` for the manifest |
| Why is it built this way? | `docs/specs/2026-09-03-visual-identity.md` |
| What are the status words? | `lib/ui/status-tone.ts` — five tones, used everywhere |

## The rules a new primitive has to follow

- Read a semantic role, never a ramp step and never a literal colour.
- Take its shape from a radius token, not a Tailwind `rounded-*` size.
- Carry a visible reason whenever a control is disabled.
- Name itself for a screen reader: an icon-only control needs an accessible
  name, and a table needs a caption.
- Work at both densities (`data-density`), with a target no smaller than 24px.
