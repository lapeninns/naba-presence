import { GlobeIcon, PenLine, ShieldCheckIcon } from "lucide-react"

import { StatusPill } from "@/components/ui/status-pill"
import { cardClassName } from "@/components/ui/card"
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
 * Where a section's edits go, said on the section itself, because the
 * profile mixes two models: the name, description, phone and website are
 * saved in NabaPresence first ("Save here" keeps them without touching
 * Google), while categories, address, opening state and attributes have no
 * NabaPresence draft: each change is reviewed and approved as an exact
 * request, then sent to Google directly. Nothing reaches Google unreviewed,
 * so the tag must not say "straight to Google".
 */
export type SaveModel = "here" | "google"

export const SAVE_MODEL_LABEL: Record<SaveModel, string> = {
  here: "Saved here first",
  google: "No draft · reviewed, then sent to Google",
}

export const SAVE_MODEL_DETAIL: Record<SaveModel, string> = {
  here: "Saved in NabaPresence first; nothing reaches Google until you review and publish.",
  google:
    "No NabaPresence draft: each change is reviewed and approved, then sent to Google directly.",
}

export function SaveModelTag({
  model,
  variant = "pill",
}: {
  model: SaveModel
  /**
   * `pill`: the outlined tag beside a heading (hours, typed attributes).
   * `caption`: a quiet line under a settings-group label (profile sections),
   * the same words and glyph without the pill.
   */
  variant?: "pill" | "caption"
}) {
  const Icon = model === "here" ? ShieldCheckIcon : GlobeIcon
  if (variant === "caption")
    return (
      <span
        data-slot="save-model"
        data-model={model}
        title={SAVE_MODEL_DETAIL[model]}
        className="inline-flex items-center gap-1 text-caption font-medium text-ink-secondary"
      >
        <Icon className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        {SAVE_MODEL_LABEL[model]}
        <span className="sr-only">. {SAVE_MODEL_DETAIL[model]}</span>
      </span>
    )
  return (
    <StatusPill
      tone="outline"
      plain
      data-slot="save-model"
      data-model={model}
      title={SAVE_MODEL_DETAIL[model]}
      // The long label wraps on a 320px card instead of overflowing it.
      className="h-auto min-h-5.5 gap-1 py-0.5 font-medium whitespace-normal"
    >
      <Icon className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      {SAVE_MODEL_LABEL[model]}
      <span className="sr-only">. {SAVE_MODEL_DETAIL[model]}</span>
    </StatusPill>
  )
}

/** A quiet bordered card, drawn on a desk only (`desk:` variants of `cardClassName`). */
const DESK_CARD =
  "desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:p-(--np-card-pad)"

/**
 * One profile section, drawn as a settings group (Notion Mail settings): a
 * quiet group label, a caption saying where its edits go (SaveModelTag) and
 * what it is for, then the fields. On a phone the group sits flat on the
 * page, with only the space between groups setting them apart; on a desk it
 * keeps a quiet bordered card. `id` is the jump target for the section nav,
 * and `${id}-heading` the heading it focuses; the scroll margin keeps the
 * heading clear of the phone's sticky section tabs.
 *
 * `bare`: no chrome, for a section made of its own groups (attributes).
 * `info`: an information card on every screen (the sunken surface), for a
 * note rather than fields, such as the Google details NabaPresence can't edit.
 */
export function SectionCard({
  id,
  title,
  description,
  changed,
  model,
  children,
  bare = false,
  info = false,
  className,
}: {
  id: string
  title: string
  description?: React.ReactNode
  changed?: boolean
  /** Where this section's edits go; omit when the fields inside differ. */
  model?: SaveModel
  children: React.ReactNode
  /** No card chrome, for a section made of its own cards (attributes). */
  bare?: boolean
  /** A sunken information card on every screen, not a settings group. */
  info?: boolean
  className?: string
}) {
  const headingId = `${id}-heading`
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-slot="section-card"
      className={cn(
        // Clear of the phone's sticky section tabs; a desk has a rail.
        "flex min-w-0 scroll-mt-18 flex-col gap-4 desk:scroll-mt-4",
        info
          ? cardClassName({ surface: "sunken", pad: true })
          : !bare && DESK_CARD,
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3
            id={headingId}
            tabIndex={-1}
            className="text-caption font-medium text-ink-muted outline-none"
          >
            {title}
          </h3>
          {changed ? <ChangedMark /> : null}
        </div>
        {model ? <SaveModelTag model={model} variant="caption" /> : null}
        {description ? (
          <p className="text-caption text-pretty text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}
