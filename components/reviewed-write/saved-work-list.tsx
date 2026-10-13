"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { SectionHeader } from "@/components/ui/section-header"
import { Instant } from "./instant"

export type SavedWorkItem = {
  readonly id: string
  /** What the work does ("Remove administrator"). */
  readonly operation: ReactNode
  /** Where it is ("Saved review", "Recorded outcome", "Waiting for approval"). */
  readonly stage: ReactNode
  readonly createdAt: string
  readonly actionLabel: string
  readonly onOpen: () => void
  readonly disabled?: boolean
}

/**
 * Saved reviews and recorded outcomes for one kind of Google write, so work
 * survives a reload, an expiry or a second approver. One list, one row
 * shape (operation, when, stage, open), one place: after the thing it
 * belongs to.
 *
 * Rows read like mail rows: the operation as the title, then a muted
 * sub-line "when · stage" (the stage is often a phrase, "Approval expires ·
 * Approved request", so it stays words in the sub-line rather than a pill),
 * then the action that reopens it. Hairlines between rows, no card: the
 * shared `ListRow`, flush with the section heading.
 */
export function SavedWorkList({
  id,
  title,
  description,
  items,
  pending,
  failed,
  loadingText,
  errorText,
  staleText,
  emptyText,
  reloadLabel,
  reloading,
  onReload,
  loadMoreLabel,
  hasMore,
  loadingMore,
  onLoadMore,
  headingLevel = "h2",
}: {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly items: readonly SavedWorkItem[]
  readonly pending: boolean
  readonly failed: boolean
  readonly loadingText: string
  readonly errorText: string
  /**
   * Shown under the earlier list when a reload fails after a good read (the
   * list stays, marked as possibly out of date). Defaults to `errorText`.
   */
  readonly staleText?: string
  readonly emptyText: string
  readonly reloadLabel: string
  readonly reloading: boolean
  readonly onReload: () => void
  readonly loadMoreLabel?: string
  readonly hasMore?: boolean
  readonly loadingMore?: boolean
  readonly onLoadMore?: () => void
  readonly headingLevel?: "h2" | "h3"
}) {
  return (
    <section aria-labelledby={id} data-slot="saved-work" className="flex min-w-0 flex-col gap-3">
      <SectionHeader id={id} as={headingLevel} title={title} description={description} />
      {pending ? (
        <p role="status" className="text-ui text-ink-muted">{loadingText}</p>
      ) : failed && items.length === 0 ? (
        <p role="alert" className="text-ui text-danger-ink">{errorText}</p>
      ) : items.length === 0 ? (
        <p className="text-ui text-ink-muted">{emptyText}</p>
      ) : (
        // The shared list row (Drop 1), drawn as a plain box: the row holds
        // its own button, so it is not one hit target. The section already
        // sits in the page's padding, so the row's padding and divider run
        // flush with the heading above them.
        <ListRows>
          {items.map((item) => (
            <ListRow
              key={item.id}
              interactive={false}
              emphasis="neutral"
              className="px-0"
              wrapperClassName="after:start-0 after:end-0"
              title={<span className="whitespace-normal">{item.operation}</span>}
              subtitle={
                // One text run, "when · stage", that wraps rather than
                // truncates: the stage is often a phrase worth reading whole.
                <span className="text-caption whitespace-normal text-ink-muted tabular-nums">
                  <Instant value={item.createdAt} /> · {item.stage}
                </span>
              }
              trailing={
                <Button variant="secondary" size="sm" disabled={item.disabled} onClick={item.onOpen}>
                  {item.actionLabel}
                </Button>
              }
            />
          ))}
        </ListRows>
      )}
      {failed && items.length > 0 ? (
        <p role="alert" className="text-ui text-danger-ink">{staleText ?? errorText}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={reloading} onClick={onReload}>{reloadLabel}</Button>
        {hasMore && onLoadMore && loadMoreLabel ? (
          <Button variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>{loadMoreLabel}</Button>
        ) : null}
      </div>
    </section>
  )
}
