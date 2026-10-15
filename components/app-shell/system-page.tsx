"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Pieces the system pages (not found, no access, error) share. Flat and
 * words-first: sections are separated by a hairline, not boxed, so the one
 * message above them stays the loudest thing on the page.
 */

/** A titled section under a hairline (the name is kept for callers). */
function SystemCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex min-w-0 flex-col gap-3 border-t border-line pt-4",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-ui font-medium text-ink">
          {title}
        </h2>
        {description ? (
          <p className="text-caption text-ink-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/** Label/value rows that stack when the card is narrow. */
function DetailList({
  items,
}: {
  items: { term: string; value: React.ReactNode }[]
}) {
  return (
    <div className="@container">
      <dl className="grid grid-cols-[minmax(7.5rem,34%)_1fr] gap-x-4 gap-y-2.5 text-ui @max-[480px]:grid-cols-1 @max-[480px]:gap-y-0.5">
        {items.map((item) => (
          <React.Fragment key={item.term}>
            <dt className="text-ink-muted">{item.term}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] text-ink @max-[480px]:mb-2.5">
              {item.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  )
}

/** Inline mono code, wrapping anywhere so a long path never overflows. */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-caption [overflow-wrap:anywhere] text-ink">
      {children}
    </code>
  )
}

export { Code, DetailList, SystemCard }
