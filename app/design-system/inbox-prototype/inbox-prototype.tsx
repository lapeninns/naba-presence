"use client"

import {
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  Inbox,
  RefreshCw,
  Reply,
  Search,
  Star,
  SunMoon,
  UserRound,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { ToggleChip } from "@/components/ui/chip"
import { Checkbox } from "@/components/ui/checkbox"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { Textarea } from "@/components/ui/textarea"
import { Timeline } from "@/components/ui/timeline"
import { Toaster, toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

import { installReferenceReveals, playEntrance } from "./reveals"
import {
  ACTIVITY_ENTRIES,
  QUEUES,
  SAMPLE_REVIEWS,
  SHORTCUTS,
  TONE_CHIPS,
  type QueueId,
  type SampleReview,
} from "./sample-data"

const MATERIAL_FALLBACK =
  "supports-[not(backdrop-filter:blur(0px))]:backdrop-blur-none [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none"

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="sr-only">{rating} out of 5</span>
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden
          strokeWidth={1.5}
          className={cn(
            "size-3.5",
            step <= rating
              ? "fill-[var(--np-rating)] text-[var(--np-rating)]"
              : "text-ink-quaternary"
          )}
        />
      ))}
    </span>
  )
}

function Avatar({
  initials,
  className,
}: {
  initials: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-secondary text-caption font-medium text-ink-muted",
        className
      )}
    >
      {initials}
    </span>
  )
}

/** The applied-filter chips: dismissible, with a Clear all. */
function FilterRow({
  filters,
  onRemove,
  onClear,
  onOpenMore,
}: {
  filters: string[]
  onRemove: (value: string) => void
  onClear: () => void
  onOpenMore: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" className="h-11" onClick={onOpenMore}>
        More filters
        <ChevronDown aria-hidden className="size-3.5" />
      </Button>
      {filters.map((filter) => (
        <span
          key={filter}
          className="inline-flex h-11 items-center gap-1 rounded-(--np-radius-pill) bg-fill pr-1 pl-3 text-ui text-ink"
        >
          {filter}
          <button
            type="button"
            onClick={() => onRemove(filter)}
            aria-label={`Remove filter ${filter}`}
            className="grid size-11 place-items-center rounded-full text-ink-muted focus-halo hover:bg-fill-secondary hover:text-ink"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      ))}
      {filters.length > 0 ? (
        <Button variant="ghost" size="sm" className="h-11" onClick={onClear}>
          Clear all
        </Button>
      ) : null}
    </div>
  )
}

function ReviewRow({
  review,
  selected,
  checked,
  onSelect,
  onToggleCheck,
  registerRef,
}: {
  review: SampleReview
  selected: boolean
  checked: boolean
  onSelect: () => void
  onToggleCheck: (next: boolean) => void
  registerRef: (node: HTMLLIElement | null) => void
}) {
  return (
    <li ref={registerRef} role="option" aria-selected={selected}>
      <div
        className={cn(
          "flex gap-3 rounded-(--np-radius-card) p-5 transition-[background-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
          selected
            ? "bg-(--np-selection-bg) shadow-np-hairline"
            : "bg-surface hover:bg-(--np-hover-bg)"
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(next) => onToggleCheck(Boolean(next))}
          aria-label={`Select the review from ${review.reviewer}`}
          className="size-11 shrink-0 rounded-(--np-radius-control) border-0 bg-transparent before:absolute before:inset-0 before:m-auto before:size-4 before:rounded-(--np-radius-tag) before:border before:border-line-strong before:bg-(--np-field-bg) before:content-[''] data-checked:bg-transparent data-checked:before:border-primary data-checked:before:bg-primary relative"
        />
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-2 rounded-(--np-radius-control) text-left focus-halo"
        >
          <span className="flex items-start gap-3">
            <Avatar initials={review.initials} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-title font-semibold text-ink">
                {review.reviewer}
              </span>
              <span className="truncate text-caption text-ink-muted">
                {review.venue} · {review.relative}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1.5">
              <Stars rating={review.rating} />
              <StatusPill tone={review.status.tone}>
                {review.status.label}
              </StatusPill>
            </span>
          </span>
          <span className="line-clamp-2 text-ui text-ink-muted">
            {review.body}
          </span>
        </button>
      </div>
    </li>
  )
}

function BulkActionBar({
  count,
  onClear,
}: {
  count: number
  onClear: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const node = ref.current
    if (!node?.animate) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const animation = node.animate(
      [
        { opacity: 0, transform: "translateY(16px)" },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      }
    )
    return () => animation.cancel()
  }, [])

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Bulk actions"
      className={cn(
        "sticky bottom-4 z-10 mx-1 flex flex-wrap items-center gap-2 rounded-(--np-radius-card) bg-material-popover p-2 shadow-np-pop backdrop-blur-xl",
        MATERIAL_FALLBACK,
        "[@media(prefers-reduced-transparency:reduce)]:bg-surface-overlay"
      )}
    >
      <span className="px-2 text-ui font-medium text-ink">
        {count} selected
      </span>
      <Button variant="ghost" size="sm" className="h-11">
        Assign
      </Button>
      <Button variant="ghost" size="sm" className="h-11">
        Mark handled
      </Button>
      <Button variant="ghost" size="sm" className="h-11">
        Generate drafts
      </Button>
      <Button variant="ghost" size="sm" className="h-11" onClick={onClear}>
        Dismiss
      </Button>
    </div>
  )
}

/** The verification and activity panel, used in the inspector and again below. */
function VerificationActivityPanel({
  defaultOpen = true,
  id,
}: {
  defaultOpen?: boolean
  id?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section
      id={id}
      aria-label="Verification and activity"
      className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-6"
    >
      <div className="flex items-center gap-3">
        <Avatar initials="HY" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-title font-semibold text-ink">
            Harbour Yard
          </p>
          <p className="truncate text-caption text-ink-muted">
            Connected location
          </p>
        </div>
        <StatusPill tone="healthy">Verified</StatusPill>
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex h-11 items-center justify-between rounded-(--np-radius-control) px-2 text-ui font-medium text-ink focus-halo hover:bg-fill-tertiary"
      >
        Activity
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 text-ink-muted transition-transform duration-(--np-duration-standard) ease-spring-snappy",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <Timeline
          entries={ACTIVITY_ENTRIES.map((entry, index) => ({
            id: `${entry.time}-${index}`,
            title: entry.action,
            meta: (
              <span className="flex items-center gap-2">
                <span className="font-mono tabular-nums">{entry.time}</span>
                <span>{entry.actor}</span>
              </span>
            ),
            tone: index === ACTIVITY_ENTRIES.length - 1 ? "success" : "neutral",
          }))}
        />
      ) : (
        <p className="px-2 text-ui text-ink-muted">
          Five entries, from received to published.
        </p>
      )}
    </section>
  )
}

function Inspector({
  review,
  composerRef,
  onPublish,
}: {
  review: SampleReview
  composerRef: React.RefObject<HTMLTextAreaElement | null>
  onPublish: () => void
}) {
  const [draft, setDraft] = React.useState("")
  const dirty = draft.trim().length > 0

  return (
    <section
      aria-label="Review detail"
      className="flex min-w-0 flex-col gap-6 rounded-(--np-radius-card) bg-surface p-6 md:p-8"
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-muted">
          {review.source} · {review.posted}
          {review.translatedFrom
            ? ` · Translated from ${review.translatedFrom}`
            : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar initials={review.initials} className="size-10" />
          <div className="min-w-0">
            <h3 className="text-section font-semibold text-ink">
              {review.reviewer}
            </h3>
            <p className="text-caption text-ink-muted">{review.venue}</p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <Stars rating={review.rating} />
            <StatusPill tone={review.status.tone}>
              {review.status.label}
            </StatusPill>
          </div>
        </div>
      </div>

      <p className="max-w-[68ch] text-body leading-[1.65] text-ink">
        {review.body}
      </p>

      {review.ownerReply ? (
        <div className="rounded-(--np-radius-card) bg-fill-tertiary p-4">
          <p className="text-caption font-medium text-ink-muted">
            Published reply
          </p>
          <p className="mt-1 max-w-[68ch] text-ui leading-[1.6] text-ink">
            {review.ownerReply}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <label
          htmlFor="prototype-composer"
          className="text-ui font-medium text-ink"
        >
          Your reply
        </label>
        <Textarea
          id="prototype-composer"
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Answer the point they actually made."
          className="min-h-30"
        />
        <div className="flex flex-wrap items-center gap-2">
          {TONE_CHIPS.map((chip) => (
            <ToggleChip
              key={chip}
              className="h-11"
              onClick={() => setDraft((value) => (value ? value : `${chip}: `))}
            >
              {chip}
            </ToggleChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className={cn(
              "text-caption transition-colors duration-(--np-duration-standard) ease-standard",
              dirty ? "text-ink" : "text-ink-muted"
            )}
          >
            {draft.length} characters
            {dirty ? " · Unsaved changes" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-11" id="composer-save">
              Save draft
            </Button>
            <Button id="composer-publish" className="h-11" onClick={onPublish}>
              Publish reply
              <Kbd variant="plain" className="text-ink-inverse">
                ⌘↵
              </Kbd>
            </Button>
          </div>
        </div>
      </div>

      <VerificationActivityPanel defaultOpen={false} />
    </section>
  )
}

function StateCards() {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      <article data-reveal="rise" className="flex flex-col gap-3">
        <div className="aspect-4/3 overflow-hidden rounded-(--np-radius-card) bg-surface p-5">
          <div className="flex h-full flex-col gap-3">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-caption text-ink-muted">Loading</p>
        <h3 className="text-title font-semibold text-ink">
          The skeleton keeps the row height
        </h3>
      </article>

      <article
        data-reveal="rise"
        data-reveal-delay="80"
        className="flex flex-col gap-3"
      >
        <div className="relative isolate grid aspect-4/3 place-items-center overflow-hidden rounded-(--np-radius-card) bg-surface p-8 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-5 -z-10 flex flex-col gap-3 opacity-35"
          >
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="size-8 shrink-0 rounded-full bg-fill-secondary" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-3 w-2/3 rounded-(--np-radius-tag) bg-fill-secondary" />
                  <div className="h-3 w-1/3 rounded-(--np-radius-tag) bg-fill-tertiary" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center gap-3 rounded-(--np-radius-card) bg-surface/90 px-4 py-3">
            <Inbox
              aria-hidden
              strokeWidth={1.5}
              className="size-6 text-ink-quaternary"
            />
            <p className="max-w-[28ch] text-ui text-ink-muted">
              Nothing waiting. New reviews land here within the hour.
            </p>
          </div>
        </div>
        <p className="text-caption text-ink-muted">Empty</p>
        <h3 className="text-title font-semibold text-ink">
          Every queue names its next step
        </h3>
      </article>

      <article
        data-reveal="rise"
        data-reveal-delay="160"
        className="flex flex-col gap-3"
      >
        <div className="relative isolate grid aspect-4/3 place-items-center overflow-hidden rounded-(--np-radius-card) bg-surface p-8 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-5 -z-10 flex flex-col gap-3 opacity-35"
          >
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="size-8 shrink-0 rounded-full bg-fill-secondary" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-3 w-2/3 rounded-(--np-radius-tag) bg-fill-secondary" />
                  <div className="h-3 w-1/3 rounded-(--np-radius-tag) bg-fill-tertiary" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center gap-3 rounded-(--np-radius-card) bg-surface/90 px-4 py-3">
            <p className="text-ui text-ink">Reviews did not load.</p>
            <Button id="state-error-retry" variant="secondary" className="h-11">
              <RefreshCw aria-hidden className="size-4" />
              Retry loading reviews
            </Button>
          </div>
        </div>
        <p className="text-caption text-ink-muted">Failed</p>
        <h3 className="text-title font-semibold text-ink">
          The error says what failed
        </h3>
      </article>
    </div>
  )
}

export function InboxPrototype() {
  const [queue, setQueue] = React.useState<QueueId>("needs_reply")
  const [selectedId, setSelectedId] = React.useState(SAMPLE_REVIEWS[0].id)
  const [checked, setChecked] = React.useState<string[]>([])
  const [filters, setFilters] = React.useState<string[]>([
    "Rating 1–3",
    "Harbour Yard",
  ])
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [pressedKey, setPressedKey] = React.useState<string | null>(null)
  // Light-first: the prototype shows the accepted light theme by default, and
  // the toolbar toggle reaches the dark block from here.
  const { resolvedTheme, setTheme } = useTheme()
  React.useEffect(() => {
    setTheme("light")
  }, [setTheme])

  const toolbarRef = React.useRef<HTMLElement>(null)
  const queueRef = React.useRef<HTMLDivElement>(null)
  const inspectorRef = React.useRef<HTMLDivElement>(null)
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const searchRef = React.useRef<HTMLButtonElement>(null)
  const rowRefs = React.useRef(new Map<string, HTMLLIElement>())

  const selected =
    SAMPLE_REVIEWS.find((review) => review.id === selectedId) ??
    SAMPLE_REVIEWS[0]

  const publish = React.useCallback(() => {
    toast.add({
      title: "Reply published",
      description: "Prototype only. Nothing was sent to a live account.",
      type: "success",
    })
  }, [])

  React.useEffect(() => {
    const cancel = playEntrance([
      toolbarRef.current,
      queueRef.current,
      inspectorRef.current,
    ])
    return cancel
  }, [])

  React.useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const rows = [...rowRefs.current.values()].slice(0, 8)
    const animations = rows.map((row, index) =>
      row.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 460,
          delay: 240 + Math.min(index * 70, 240),
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "backwards",
        }
      )
    )
    return () => animations.forEach((animation) => animation.cancel())
  }, [])

  React.useEffect(() => installReferenceReveals(document), [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen(true)
        setPressedKey("04")
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        publish()
        setPressedKey("05")
        return
      }
      if (typing) return

      if (event.key === "j" || event.key === "k") {
        event.preventDefault()
        const index = SAMPLE_REVIEWS.findIndex((item) => item.id === selectedId)
        const next =
          event.key === "j"
            ? Math.min(index + 1, SAMPLE_REVIEWS.length - 1)
            : Math.max(index - 1, 0)
        setSelectedId(SAMPLE_REVIEWS[next].id)
        setPressedKey("01")
      } else if (event.key === "r") {
        event.preventDefault()
        composerRef.current?.focus()
        setPressedKey("02")
      } else if (event.key === "e") {
        setPressedKey("03")
      } else if (event.key === "Escape") {
        setPressedKey("06")
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [publish, selectedId])

  React.useEffect(() => {
    if (!pressedKey) return
    const timer = window.setTimeout(() => setPressedKey(null), 400)
    return () => window.clearTimeout(timer)
  }, [pressedKey])

  return (
    <Toaster>
      <div className="min-h-dvh bg-canvas">
        <header
          ref={toolbarRef}
          className={cn(
            "sticky top-0 z-30 border-b border-line-subtle bg-material-toolbar backdrop-blur-xl",
            MATERIAL_FALLBACK,
            "supports-[not(backdrop-filter:blur(0px))]:bg-[var(--np-material-toolbar-opaque)]",
            "[@media(prefers-reduced-transparency:reduce)]:bg-[var(--np-material-toolbar-opaque)]"
          )}
        >
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-5 py-2 md:px-8">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-title font-semibold tracking-tight text-ink">
                NabaPresence
              </span>
              <span className="hidden h-4 w-px bg-line md:block" aria-hidden />
              <h1 className="text-title font-semibold text-ink">Reviews</h1>
              <p className="basis-full text-caption text-ink-muted md:basis-auto">
                Read reviews. Reply with care.
              </p>
              <div className="ms-auto flex items-center gap-2">
                <button
                  ref={searchRef}
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  className="flex h-11 min-w-44 items-center gap-2 rounded-(--np-radius-control) bg-fill-secondary px-3 text-ui text-ink-muted focus-halo hover:bg-fill"
                >
                  <Search aria-hidden className="size-4" />
                  <span className="flex-1 text-left">Search reviews</span>
                  <Kbd>⌘K</Kbd>
                </button>
                <button
                  type="button"
                  className="hidden h-11 items-center gap-2 rounded-(--np-radius-control) bg-fill-secondary px-3 text-ui text-ink focus-halo hover:bg-fill sm:flex"
                >
                  <Avatar initials="HY" className="size-5 text-[0.625rem]" />
                  Harbour Yard
                  <ChevronDown
                    aria-hidden
                    className="size-3.5 text-ink-muted"
                  />
                </button>
                <button
                  type="button"
                  aria-label="Switch theme"
                  onClick={() =>
                    setTheme(resolvedTheme === "dark" ? "light" : "dark")
                  }
                  className="grid size-11 place-items-center rounded-(--np-radius-control) bg-fill-secondary text-ink focus-halo hover:bg-fill"
                >
                  <SunMoon aria-hidden className="size-4" />
                </button>
              </div>
            </div>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <SegmentedControl
                value={queue}
                onValueChange={(value) => setQueue(value as QueueId)}
                aria-label="Review queues"
              >
                {QUEUES.map((item) => (
                  <SegmentedControlItem
                    key={item.id}
                    value={item.id}
                    className="min-h-11"
                  >
                    {item.label}
                    <span className="ms-1.5 text-ink-muted tabular-nums">
                      {item.count}
                    </span>
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1440px] px-5 py-6 md:px-8">
          {/* review_workspace */}
          <section
            aria-label="Review workspace"
            className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[384px_minmax(0,1fr)]"
          >
            <div ref={queueRef} className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-section font-semibold text-ink">
                  {QUEUES.find((item) => item.id === queue)?.label}
                </h2>
                <p className="text-ui text-ink-muted">
                  Eight sample reviews across the rating range. Select one to
                  read it in full and write a reply.
                </p>
              </div>
              <FilterRow
                filters={filters}
                onRemove={(value) =>
                  setFilters((current) =>
                    current.filter((item) => item !== value)
                  )
                }
                onClear={() => setFilters([])}
                onOpenMore={() => setPaletteOpen(true)}
              />
              <ul
                role="listbox"
                aria-label="Reviews"
                className="flex flex-col gap-3"
              >
                {SAMPLE_REVIEWS.map((review) => (
                  <ReviewRow
                    key={review.id}
                    review={review}
                    selected={review.id === selectedId}
                    checked={checked.includes(review.id)}
                    onSelect={() => setSelectedId(review.id)}
                    onToggleCheck={(next) =>
                      setChecked((current) =>
                        next
                          ? [...current, review.id]
                          : current.filter((id) => id !== review.id)
                      )
                    }
                    registerRef={(node) => {
                      if (node) rowRefs.current.set(review.id, node)
                      else rowRefs.current.delete(review.id)
                    }}
                  />
                ))}
              </ul>
              {checked.length > 0 ? (
                <BulkActionBar
                  count={checked.length}
                  onClear={() => setChecked([])}
                />
              ) : null}
            </div>

            <div ref={inspectorRef} className="min-w-0">
              <Inspector
                review={selected}
                composerRef={composerRef}
                onPublish={publish}
              />
            </div>
          </section>

          {/* workspace_states */}
          <section
            aria-labelledby="states-heading"
            className="mt-16 flex flex-col gap-8 md:mt-24"
          >
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
              <span className="inline-flex items-center gap-2 rounded-(--np-radius-pill) bg-fill px-3 py-1 text-caption font-medium text-ink-muted">
                States
              </span>
              <h2
                id="states-heading"
                className="text-page-title font-bold text-balance text-ink"
              >
                Loading, empty and failed, side by side
              </h2>
              <p className="text-ui text-ink-muted">
                Each state uses the same card geometry as the queue, so nothing
                shifts when the data arrives.
              </p>
            </div>
            <StateCards />
          </section>

          {/* activity_and_verification */}
          <section
            aria-labelledby="activity-heading"
            className="mt-16 grid gap-8 md:mt-24 lg:grid-cols-[48fr_52fr] lg:items-stretch"
          >
            <div data-reveal="rise">
              <VerificationActivityPanel id="inspector-activity" />
            </div>
            <div
              data-reveal="rise"
              data-reveal-delay="90"
              className="flex flex-col lg:py-4"
            >
              <p className="flex items-center gap-2 text-caption font-medium text-ink-muted">
                <span
                  aria-hidden
                  className="size-2 rounded-xs bg-accent-solid"
                />
                In the inspector
              </p>
              <h2
                id="activity-heading"
                className="mt-4 max-w-[16ch] text-page-title font-bold text-balance text-ink md:text-display"
              >
                Every reply carries its own history
              </h2>
              <p className="mt-auto max-w-[56ch] pt-8 text-body leading-[1.6] text-ink-muted">
                The panel sits under the composer and stays collapsed until it
                is opened. It names the connected location and its verification
                state, then lists what happened to this review in order:
                received, drafted, edited, approved, published, each with the
                person who did it and the time it happened.
              </p>
              <div className="pt-6">
                <a
                  href="#inspector-activity"
                  className="inline-flex h-11 items-center gap-2 rounded-(--np-radius-control) bg-fill px-4 text-body font-medium text-ink focus-halo hover:bg-fill-secondary"
                >
                  Open the activity panel
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
              </div>
            </div>
          </section>

          {/* keyboard_reference */}
          <section
            aria-labelledby="shortcuts-heading"
            className="mt-16 grid gap-10 md:mt-24 lg:grid-cols-[38fr_58fr]"
          >
            <div data-reveal="rise" className="flex flex-col gap-4">
              <p className="text-caption font-medium tracking-wide text-ink-muted">
                SHORTCUTS
              </p>
              <h2
                id="shortcuts-heading"
                className="max-w-[12ch] text-page-title font-bold text-ink md:text-display"
              >
                Keys that move the queue
              </h2>
              <p className="max-w-[46ch] text-ui text-ink-muted">
                Every shortcut here has a visible control somewhere on the
                screen. Nothing is keyboard-only.
              </p>
              <div className="rounded-(--np-radius-card) bg-surface p-4">
                <div className="flex items-center gap-2 rounded-(--np-radius-control) bg-fill-tertiary px-3 py-2 text-ui text-ink-muted">
                  <Search aria-hidden className="size-4" />
                  Search actions and reviews
                </div>
                <ul className="mt-2 flex flex-col">
                  {[
                    { icon: Inbox, label: "Go to Needs reply", hint: "G I" },
                    { icon: Reply, label: "Reply to selection", hint: "R" },
                    { icon: Building2, label: "Switch location", hint: "G L" },
                  ].map((item) => (
                    <li
                      key={item.label}
                      className="flex h-11 items-center gap-2 px-2 text-ui text-ink"
                    >
                      <item.icon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-4 text-ink-muted"
                      />
                      <span className="flex-1">{item.label}</span>
                      <Kbd variant="plain">{item.hint}</Kbd>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                id="command-palette"
                variant="secondary"
                size="lg"
                className="h-11 self-start"
                onClick={() => setPaletteOpen(true)}
              >
                Open the command palette
                <Kbd variant="plain">⌘K</Kbd>
              </Button>
            </div>

            <ul className="flex flex-col">
              {SHORTCUTS.map((shortcut, index) => (
                <li
                  key={shortcut.index}
                  data-reveal="rise"
                  data-reveal-delay={index * 60}
                  className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle py-4"
                >
                  <span className="w-8 text-caption font-medium text-accent-ink tabular-nums">
                    {shortcut.index}
                  </span>
                  <span className="flex-1 text-body text-ink">
                    {shortcut.label}
                  </span>
                  <span className="flex items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <Kbd
                        key={key}
                        className={cn(
                          "h-8 min-w-8 font-mono transition-colors duration-(--np-duration-fast) ease-spring-snappy",
                          pressedKey === shortcut.index &&
                            "bg-accent-tint text-accent-ink"
                        )}
                      >
                        {key}
                      </Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* prototype_note */}
          <footer className="mt-16 flex flex-col gap-8 md:mt-24">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="max-w-[48%] min-w-[18rem] text-section font-semibold text-balance text-ink">
                Design prototype. Sample reviews, not live Business Profile
                data.
              </p>
              <a
                href="/design-system"
                className="inline-flex h-11 items-center text-body text-ink underline underline-offset-4 focus-halo hover:text-accent-ink"
              >
                Back to the design system index
              </a>
            </div>
            <div className="border-t border-line-subtle pt-8">
              <div className="grid max-w-lg grid-cols-2 gap-8">
                <div className="flex flex-col gap-2">
                  <p className="text-ui font-semibold text-ink">Prototype</p>
                  <a
                    href="/design-system/inbox-prototype"
                    className="inline-flex h-11 items-center text-ui text-ink-muted focus-halo hover:text-ink"
                  >
                    This route
                  </a>
                  <a
                    href="/design-system"
                    className="inline-flex h-11 items-center text-ui text-ink-muted focus-halo hover:text-ink"
                  >
                    Design system
                  </a>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-ui font-semibold text-ink">Production</p>
                  <a
                    href="/inbox"
                    className="inline-flex h-11 items-center text-ui text-ink-muted focus-halo hover:text-ink"
                  >
                    Open the live Reviews route
                  </a>
                </div>
              </div>
            </div>
            <p className="max-w-[70ch] text-ui text-ink-muted">
              Reviewer names, venues, ratings, timestamps and activity entries
              on this page are written for the prototype. Nothing here is
              connected to a live account. The production Reviews route is
              unchanged.
            </p>
            <div className="flex items-end justify-between gap-4">
              <p
                aria-hidden
                className="text-[clamp(3.5rem,16vw,13rem)] leading-[0.82] font-bold tracking-[-0.04em] text-ink"
              >
                Reviews
              </p>
              <a
                href="#main"
                className="inline-flex h-11 items-center text-ui text-ink-muted focus-halo hover:text-ink"
              >
                Back to top ↑
              </a>
            </div>
          </footer>
        </div>

        <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <CommandInput placeholder="Search actions and reviews" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Queues">
              {QUEUES.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => {
                    setQueue(item.id)
                    setPaletteOpen(false)
                    searchRef.current?.focus()
                  }}
                >
                  <Inbox aria-hidden strokeWidth={1.75} className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <CommandShortcut>{item.count}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => {
                  setPaletteOpen(false)
                  composerRef.current?.focus()
                }}
              >
                <Reply aria-hidden strokeWidth={1.75} className="size-4" />
                <span className="flex-1">Reply to the selected review</span>
                <CommandShortcut>R</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setPaletteOpen(false)
                  publish()
                }}
              >
                <Check aria-hidden strokeWidth={1.75} className="size-4" />
                <span className="flex-1">Publish the reply</span>
                <CommandShortcut>⌘↵</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setPaletteOpen(false)}>
                <UserRound aria-hidden strokeWidth={1.75} className="size-4" />
                <span className="flex-1">Assign to a teammate</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>
    </Toaster>
  )
}
