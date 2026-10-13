import * as React from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

/**
 * Settings-row building blocks for the profile sections (Notion Mail
 * settings look, interim until Foundation Drop 1). Each maps one-to-one onto
 * a Drop 1 primitive, so the later swap is mechanical:
 *
 *   SettingsGroupLabel → SettingsGroup's label
 *   RowList / ItemRow  → ListRow (title, sub-label, trailing actions)
 *   HandoffNote        → the settings info card ("Manage it in Google")
 */

/** A quiet group label inside a section: sentence case, `ink-muted`. */
export function SettingsGroupLabel({
  as: Tag = "p",
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: "p" | "h4" | "h5" }) {
  return (
    <Tag
      className={cn("text-caption font-medium text-ink-muted", className)}
      {...props}
    />
  )
}

/** Rows separated by a hairline, with no card of their own. */
export function RowList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "flex min-w-0 flex-col divide-y divide-line-subtle border-y border-line-subtle",
        className
      )}
      {...props}
    />
  )
}

/**
 * One item: a title, an optional sub-label (a code or place ID, in mono, the
 * way IDs read everywhere) and trailing actions. At least `--np-row-h` tall,
 * and the trailing actions wrap under the title on a narrow phone rather
 * than squeezing it.
 */
export function ItemRow({
  title,
  detail,
  trailing,
  className,
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <li
      className={cn(
        "flex min-h-(--np-row-h) min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2",
        className
      )}
    >
      <div className="min-w-0 grow basis-40">
        <p className="text-body break-words text-ink">{title}</p>
        {detail ? (
          <p className="font-mono text-caption break-all text-ink-muted">
            {detail}
          </p>
        ) : null}
      </div>
      {trailing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {trailing}
        </div>
      ) : null}
    </li>
  )
}

/**
 * The "can't be edited safely here" handoff: a neutral info card announced
 * politely, as the plain status line it replaces was.
 */
export function HandoffNote({ children }: { children: React.ReactNode }) {
  return (
    <Alert live="polite">
      <AlertDescription className="text-ink-secondary">
        {children}
      </AlertDescription>
    </Alert>
  )
}

/** A failure under a control: an inline destructive Alert (`role="alert"`). */
export function InlineError({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
