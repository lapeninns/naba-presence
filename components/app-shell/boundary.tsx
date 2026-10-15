import { CircleAlert, FileQuestion } from "lucide-react"
import Link from "next/link"
import type * as React from "react"

import { Empty } from "@/components/ui/empty"

/**
 * The pieces the error and not-found boundaries share, kept deliberately
 * light: no Base UI and no interactive primitives. Every route segment gets
 * its own boundary chunk, so whatever a boundary imports is copied into each
 * of them; these are plain class strings and markup drawn with the same
 * tokens as the primitives they stand in for. The one primitive used is
 * `Empty` (a plain server-safe component: lucide glyphs and `cn`, both
 * already in the app's shared chunk), so the error state is the same
 * drawing as every other empty, error and system state.
 */

type BoundaryButtonVariant = "primary" | "outline" | "ghost"
type BoundaryButtonSize = "default" | "lg"

// buttonVariants (components/ui/button.tsx) resolved for the variants the
// boundaries use, without the class-merging machinery.
const BUTTON_BASE =
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-(--np-radius-control) border leading-none font-semibold whitespace-nowrap no-underline focus-halo transition-[background-color,border-color,color,box-shadow,transform] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:not-disabled:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

const BUTTON_VARIANT: Record<BoundaryButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-primary-foreground hover:not-disabled:bg-accent-hover",
  outline: "border-line-strong bg-surface text-ink hover:not-disabled:bg-fill",
  ghost:
    "border-transparent bg-transparent text-ink hover:not-disabled:bg-fill",
}

const BUTTON_SIZE: Record<BoundaryButtonSize, string> = {
  default: "h-(--np-control-h) px-3.5 text-ui",
  lg: "h-11 px-5 text-body",
}

/** The button look for a native `<button>` or an `<a>` in a boundary. */
function boundaryButtonClass(
  variant: BoundaryButtonVariant = "primary",
  size: BoundaryButtonSize = "default",
  extra?: string
) {
  return [BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra]
    .filter(Boolean)
    .join(" ")
}

/**
 * PageFrame's widths and gutters (page-frame.tsx) as a plain div carrying
 * the same `data-slot`, for the boundaries that replace a whole page.
 */
function BoundaryFrame({
  width = "default",
  className,
  children,
}: {
  width?: "default" | "wide" | "workspace"
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="page-frame"
      data-width={width}
      className={[
        "@container mx-auto flex w-full flex-col gap-(--np-gap-section) px-5 pt-6 outline-none md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)",
        width === "default" && "max-w-(--np-page-default-width) pb-12",
        width === "wide" && "max-w-(--np-page-max-width) pb-12",
        width === "workspace" && "min-h-0 max-w-none flex-1 pb-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  )
}

/** Inline mono code, wrapping anywhere so a long path never overflows. */
function BoundaryCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-caption [overflow-wrap:anywhere] text-ink">
      {children}
    </code>
  )
}

/**
 * The words of every "this page doesn't exist" screen, in one place so the
 * root 404 (outside the shell) and the dashboard 404 (inside it) cannot drift
 * apart: one title, one sentence, one verb for the way back.
 */
const NOT_FOUND_TITLE = "This page doesn’t exist"
const NOT_FOUND_DESCRIPTION =
  "The page you followed may have been removed, or the link may be wrong. Nothing was changed."

/** The one verb for the way back, naming where it goes ("Back to Clients"). */
function notFoundActionLabel(destination: string) {
  return `Back to ${destination}`
}

/**
 * The shared body of both 404s: a calm, centred outline mark, the title as
 * the page's h1, why, then whatever the caller draws below (the way back and
 * any secondary controls). The caller owns the surroundings (the root 404's
 * card, the dashboard's page frame) and the landmark.
 */
function NotFoundState({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <section
      aria-labelledby="not-found-title"
      data-slot="page-empty-state"
      className={["flex flex-col items-center gap-2 text-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden
        className="mb-1 grid size-11 place-items-center rounded-lg bg-fill text-ink-secondary"
      >
        <FileQuestion className="size-5" strokeWidth={1.5} />
      </span>
      <h1
        id="not-found-title"
        tabIndex={-1}
        className="text-title font-medium text-balance text-ink outline-none"
      >
        {NOT_FOUND_TITLE}
      </h1>
      <p className="max-w-md text-ui text-pretty text-ink-muted">
        {NOT_FOUND_DESCRIPTION}
      </p>
      {children}
    </section>
  )
}

/**
 * A route's error, inside a page that keeps working around it. Calm and
 * honest, drawn by the shared empty state (`Empty variant="error"`): its
 * failure mark, what happened (the title and its sentence, announced as an
 * alert, as the Alert primitive is), one primary Try again, and the way out
 * as a quiet second action. The actions sit outside the alert so it
 * announces only what happened. The light twin of RouteErrorState in
 * query-states.tsx.
 *
 * `secondaryAction` replaces the quiet home link with the caller's own
 * control (a button that must `router.replace` and reset, say); draw it
 * with `boundaryButtonClass("ghost", "default", "pointer-coarse:min-h-11")`
 * so it matches.
 */
function BoundaryErrorState({
  title,
  description,
  onReset,
  homeHref = "/inbox",
  homeLabel = "Go to Inbox",
  secondaryAction,
}: {
  title: string
  description: React.ReactNode
  onReset: () => void
  homeHref?: string
  homeLabel?: string
  /** Replaces the home link (`homeHref`/`homeLabel` are then unused). */
  secondaryAction?: React.ReactNode
}) {
  return (
    <div
      data-slot="boundary-error-state"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-5 pt-10 pb-6 text-center md:pt-20"
    >
      {/* The wrapper owns the spacing; Empty's own padding is for a state
          that stands alone. */}
      <Empty
        variant="error"
        data-slot="alert"
        role="alert"
        className="px-0 py-0 sm:py-0 lg:py-0"
        title={<span data-slot="alert-title">{title}</span>}
        description={<span data-slot="alert-description">{description}</span>}
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => onReset()}
          className={boundaryButtonClass(
            "primary",
            "default",
            "pointer-coarse:min-h-11"
          )}
        >
          Try again
        </button>
        {secondaryAction ?? (
          <Link
            href={homeHref}
            className={boundaryButtonClass(
              "ghost",
              "default",
              "pointer-coarse:min-h-11"
            )}
          >
            {homeLabel}
          </Link>
        )}
      </div>
    </div>
  )
}

/** The destructive Alert's drawing: a danger tint, a title and its words. */
function BoundaryAlert({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-(--np-radius-card) bg-danger-tint px-3.5 py-3 text-left text-ui text-ink"
    >
      <CircleAlert
        className="row-span-2 mt-0.5 size-4 text-danger-ink"
        strokeWidth={1.75}
        aria-hidden
      />
      <div data-slot="alert-title" className="text-body font-semibold text-ink">
        {title}
      </div>
      <div
        data-slot="alert-description"
        className="col-start-2 min-w-0 text-pretty"
      >
        {children}
      </div>
    </div>
  )
}

export {
  BoundaryAlert,
  BoundaryCode,
  BoundaryErrorState,
  BoundaryFrame,
  boundaryButtonClass,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
  notFoundActionLabel,
  NotFoundState,
}
