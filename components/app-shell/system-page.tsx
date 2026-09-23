"use client"

import { Copy } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Pieces the system pages (not found, no access, error) share, drawn with
 * the reference's card, definition list and sunken-panel recipes.
 */

/** A white card with a section title. */
function SystemCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface p-4 sm:p-5",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-title font-semibold text-ink">
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
    <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-[12px] [overflow-wrap:anywhere] text-ink">
      {children}
    </code>
  )
}

/**
 * Copies text to the clipboard and says so. Nothing is sent anywhere: when
 * the clipboard is unavailable the text is shown so it can be copied by
 * hand.
 */
function CopyTextButton({
  text,
  label,
  copiedMessage,
}: {
  text: string
  label: string
  copiedMessage: string
}) {
  const [result, setResult] = React.useState<"copied" | "manual" | null>(null)
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:min-h-11"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setResult("copied")
          } catch {
            setResult("manual")
          }
        }}
      >
        <Copy strokeWidth={1.75} aria-hidden />
        {label}
      </Button>
      <p role="status" className="text-caption text-ink-muted">
        {result === "copied"
          ? copiedMessage
          : result === "manual"
            ? `Copy this: “${text}”`
            : ""}
      </p>
    </div>
  )
}

export { Code, CopyTextButton, DetailList, SystemCard }
