import { GlobeIcon, PenLine, ShieldCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** The reference `.changed-mark`: an info-ink word with a pen, never colour alone. */
export function ChangedMark({ label = "Changed" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] leading-4 font-semibold text-info-ink">
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
 * NabaPresence copy and go straight to Google when published.
 */
export type SaveModel = "here" | "google"

export function SaveModelTag({ model }: { model: SaveModel }) {
  const Icon = model === "here" ? ShieldCheckIcon : GlobeIcon
  return (
    <span
      data-slot="save-model"
      data-model={model}
      className="inline-flex items-center gap-1 rounded-(--np-radius-tag) border border-line bg-surface-alt px-1.5 text-[11.5px] leading-[18px] font-medium text-ink-secondary"
    >
      <Icon className="size-3" strokeWidth={2} aria-hidden />
      {model === "here" ? "Saved here first" : "Goes straight to Google"}
    </span>
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
        "flex min-w-0 scroll-mt-4 flex-col gap-4",
        !bare &&
          "rounded-(--np-radius-card) border border-line bg-surface p-5 max-sm:p-4",
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
