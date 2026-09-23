import { PenLine } from "lucide-react"

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
  children,
  bare = false,
  className,
}: {
  id: string
  title: string
  description?: React.ReactNode
  changed?: boolean
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
