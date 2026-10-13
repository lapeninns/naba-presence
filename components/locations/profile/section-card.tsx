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

export function SaveModelTag({ model }: { model: SaveModel }) {
  const Icon = model === "here" ? ShieldCheckIcon : GlobeIcon
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

/**
 * One profile section (reference `.card.section-card`): a white card with a
 * hairline, the heading and a muted line saying what the section is for,
 * then the fields. `id` is the jump target for the section index; the scroll
 * margin keeps the heading clear of the sticky toolbar.
 */
export function SectionCard({
  id,
  title,
  description,
  changed,
  model,
  children,
  bare = false,
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
  className?: string
}) {
  const headingId = `${id}-heading`
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        // Clear of the phone's sticky section chips; a desk has a rail.
        "flex min-w-0 scroll-mt-18 flex-col gap-4 desk:scroll-mt-4",
        !bare && cardClassName({ pad: true }),
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            id={headingId}
            tabIndex={-1}
            className="text-section font-semibold text-ink outline-none"
          >
            {title}
          </h3>
          {model ? <SaveModelTag model={model} /> : null}
          {changed ? <ChangedMark /> : null}
        </div>
        {description ? (
          <p className="text-ui text-ink-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}
