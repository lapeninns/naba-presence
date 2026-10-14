import * as React from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { cn } from "@/lib/utils"

/**
 * Settings-row building blocks for the profile sections, on the Notion Mail
 * primitives:
 *
 *   SettingsGroupLabel → a sub-group label inside a SettingsGroup section
 *   RowList / ItemRow  → ListRows / ListRow (title, sub-label, trailing actions)
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

/**
 * Rows separated by a hairline, with no card of their own (`ListRows`). It
 * takes `ItemRow`s or plain `<li>`s; the hairlines are the list's, so both
 * kinds are divided the same way.
 */
export function RowList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ListRows
      className={cn(
        "divide-y divide-line-subtle border-y border-line-subtle",
        className
      )}
      {...props}
    />
  )
}

/**
 * One item (`ListRow`, not a hit target: it carries its own controls): a
 * title, an optional sub-label (a code or place ID, in mono, the way IDs
 * read everywhere) and trailing actions. At least 44px tall; the title and
 * ID wrap rather than truncate, so two long IDs never look the same.
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
    <ListRow
      as="li"
      flush
      wrap
      interactive={false}
      emphasis="neutral"
      // RowList draws the hairlines.
      wrapperClassName="after:hidden"
      className={cn("items-center py-2", className)}
      title={<span className="font-normal">{title}</span>}
      subtitle={
        detail ? (
          <span className="font-mono text-caption break-all text-ink-muted">
            {detail}
          </span>
        ) : undefined
      }
      trailing={
        trailing ? (
          <span className="flex flex-wrap items-center justify-end gap-2">
            {trailing}
          </span>
        ) : undefined
      }
    />
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
