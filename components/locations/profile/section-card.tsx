import { PenLine } from "lucide-react"

import { cardClassName } from "@/components/ui/card"
import { SettingsGroup } from "@/components/ui/settings-row"
import { cn } from "@/lib/utils"

/** The reference `.changed-mark`: an info-ink word with a pen, never colour alone. */
export function ChangedMark({ label = "Changed" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-caption font-semibold text-info-ink">
      <PenLine className="size-3" strokeWidth={2} aria-hidden />
      {label}
    </span>
  )
}

/** A field label row: the label, then the "Changed" word when it differs from Google. */
export function LabelRow({
  children,
  changed,
  extra,
}: {
  children: React.ReactNode
  changed?: boolean
  /** Trailing content such as a character counter. */
  extra?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {changed ? <ChangedMark /> : null}
      {extra ? <span className="ml-auto">{extra}</span> : null}
    </div>
  )
}

/**
 * One profile section, drawn as a settings group (Notion Mail settings,
 * `SettingsGroup`): a quiet group label, a caption saying what it is for,
 * then the fields. Where its edits go is said once, in the review sheet
 * (components/reviewed-write/combined-review.tsx), not on each section.
 * On a phone the group sits flat on the page, with only the space between
 * groups setting them apart; on a desk the rows sit in the group's quiet
 * bordered card. `id` is the jump target for the section nav, and
 * `${id}-heading` the heading it focuses (SettingsGroup's script-focusable
 * heading); the scroll margin keeps the section clear of the phone's
 * sticky section tabs.
 *
 * `quietOnPhone`: where the phone's sticky tab strip already names the
 * section, the group drops its visible heading row and caption below `desk`
 * so its first field starts straight under the tabs. The heading stays in
 * the outline as screen-reader text, still the section nav's focus target,
 * and the caption still describes the group; a "Changed" mark keeps its row.
 * Opt-in, for the one section that sits first under the tabs (Identity). It
 * is a prop rather than a `first-of-type` rule on purpose: that selector
 * matched any card that was the first `<section>` inside its own wrapper
 * (Lodging in IndustryEditor, the Product catalogue handoff) and hid their
 * headings too.
 *
 * `bare`: no card, for a section made of its own groups (attributes).
 * `info`: an information card on every screen (the sunken surface), for a
 * note rather than fields, such as the Google details NabaPresence can't edit.
 */
export function SectionCard({
  id,
  title,
  description,
  changed,
  children,
  bare = false,
  info = false,
  quietOnPhone = false,
  className,
}: {
  id: string
  title: string
  description?: React.ReactNode
  changed?: boolean
  children: React.ReactNode
  /** No card chrome, for a section made of its own cards (attributes). */
  bare?: boolean
  /** A sunken information card on every screen, not a settings group. */
  info?: boolean
  /** Below `desk`, turn the heading and caption into screen-reader text. */
  quietOnPhone?: boolean
  className?: string
}) {
  // An info card says its piece inside the card; a settings group says what
  // it is for in the caption under its label.
  const lead = info ? null : description
  const caption = lead ? (
    <span className="min-w-0 text-pretty">{lead}</span>
  ) : undefined
  return (
    <SettingsGroup
      id={id}
      headingAs="h3"
      label={title}
      // The word beside the label, outside the heading, so the heading's
      // name stays the section's name.
      actions={changed ? <ChangedMark /> : undefined}
      caption={caption}
      bodyAs="div"
      card={!bare && !info}
      className={cn(
        // The page's column gap spaces the groups; clear of the phone's
        // sticky section tabs, a desk has a rail.
        "mt-0 min-w-0 scroll-mt-18 desk:scroll-mt-4",
        // Below `desk` (a custom variant has no `max-` form, so `desk:` puts
        // it back): the tab strip above already names the group, so its
        // heading row and caption become screen-reader text.
        quietOnPhone &&
          "[&>[data-slot=settings-group-caption]]:sr-only desk:[&>[data-slot=settings-group-caption]]:not-sr-only desk:[&>[data-slot=settings-group-caption]]:mb-1 [&>div:first-child]:min-h-0 desk:[&>div:first-child]:min-h-8 [&>div:first-child>[data-slot=settings-group-label]]:sr-only desk:[&>div:first-child>[data-slot=settings-group-label]]:not-sr-only",
        className
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-4",
          info
            ? cardClassName({ surface: "sunken", pad: true })
            : !bare && "desk:p-(--np-card-pad)"
        )}
      >
        {info && description ? (
          <p className="text-caption text-pretty text-ink-muted">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </SettingsGroup>
  )
}
