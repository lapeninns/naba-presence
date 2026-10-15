"use client"

import Link from "next/link"
import { isValidElement, type ReactElement, type ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { SkeletonList } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { describeActionError } from "@/lib/errors/action-errors"
import { cn } from "@/lib/utils"

/**
 * The one way a query-backed surface renders pending / error / empty / ready.
 * Replaces the hand-rolled retry alerts that used to live in the inbox list,
 * the review detail pane and the locations tab shell (Sprint 4.4).
 *
 * One vocabulary with `Empty` (prim-14): the error state IS an
 * `<Empty variant="error">`, announced, with the retry as its action, and
 * an `empty` state should be an `<Empty>` too. Pending is a sentence plus
 * `SkeletonList` rows at the row height the content will have (or, with no
 * rows, a sentence plus a spinner: never both).
 */

export type QueryStatus = "pending" | "error" | "empty" | "ready"

/** Derive a `QueryStatus` from a TanStack query result plus an emptiness check. */
export function queryStatus(
  query: { isPending: boolean; isError: boolean },
  options: { isEmpty?: boolean } = {}
): QueryStatus {
  if (query.isPending) return "pending"
  if (query.isError) return "error"
  if (options.isEmpty) return "empty"
  return "ready"
}

/**
 * The default pending state: a sentence saying what is being fetched, then the
 * placeholder blocks. Exactly ONE loading indicator is ever drawn: the
 * skeleton rows when there are any (the sentence beside them is the live
 * region), otherwise the spinner (a `skeleton={null}` surface whose content
 * has no row shape to stand in for). A spinner above skeleton rows was two
 * "loading" signals for one wait.
 *
 * The sentence is not decoration. Every `Skeleton` is `aria-hidden`, and
 * `aria-busy` on a plain div announces nothing on insertion, so this component
 * used to be literally empty to a screen reader — and to a sighted user it was
 * two grey rectangles that looked the same at 400ms and at 30s. Callers that
 * pass a `label` get a `role="status"` region, which is announced when it
 * appears and again if the label changes.
 */
export function QueryPending({
  className,
  label,
  skeleton = <SkeletonList rows={3} />,
}: {
  className?: string
  /** What is being fetched, e.g. "Loading this location's hours". */
  label?: string
  /**
   * The placeholder that stands in for the content, at the height it will
   * have. Defaults to three list rows; a falsy value (`null`) draws the spinner instead.
   */
  skeleton?: ReactNode
}) {
  // Any falsy value (`null`, `false`, "") means no rows: it must not count as a
  // skeleton, or nothing at all would be drawn.
  const hasSkeleton = Boolean(skeleton)
  return (
    <div
      className={cn("flex flex-col gap-3", className)}
      aria-busy="true"
      role={label ? "status" : undefined}
    >
      {label ? (
        <p className="flex items-center gap-2 text-ui text-ink-muted">
          {hasSkeleton ? null : <Spinner decorative size="sm" />}
          {label}
        </p>
      ) : hasSkeleton ? null : (
        <Spinner />
      )}
      {hasSkeleton ? skeleton : null}
    </div>
  )
}

export type QueryErrorContent = {
  /** The visible headline, e.g. "We could not load your reviews." */
  title: string
  /** Defaults to `describeActionError(cause)`. */
  description?: ReactNode
  /** The thrown error; only used to derive the default description. */
  cause?: unknown
  /** Wrapper classes (padding around the state). */
  className?: string
  /** Draw the card box around the state (see `Empty`). */
  framed?: boolean
}

export type QueryErrorProps = QueryErrorContent & {
  onRetry?: () => void
  retryLabel?: string
}

/**
 * A failed load is NOT a plain empty state: "nothing here" for a failed
 * fetch would silently mask a real error with no way to retry. This renders
 * `<Empty variant="error">` as an alert (it replaces content because the
 * load just failed) with a 44px "Try again" whenever `onRetry` is given.
 */
export function QueryError({
  title,
  description,
  cause,
  onRetry,
  retryLabel = "Try again",
  className,
  framed,
}: QueryErrorProps) {
  return (
    <Empty
      role="alert"
      variant="error"
      size="sm"
      framed={framed}
      className={className}
      title={title}
      description={description ?? describeActionError(cause)}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null
      }
    />
  )
}

export type QueryStatesProps = {
  status: QueryStatus
  /** Rendered while pending; defaults to `<QueryPending />`. */
  pending?: ReactNode
  /** Names what is loading on the default pending state. Ignored if `pending` is set. */
  pendingLabel?: string
  /**
   * Rendered on error. A string is the alert title; an object configures
   * `QueryError`; a React element is rendered as-is (for surfaces whose error
   * state needs its own chrome around the alert).
   */
  error: string | QueryErrorContent | ReactElement
  /** Wired to the "Try again" button when `error` is a string or object. */
  onRetry?: () => void
  /** Rendered when `status` is "empty"; falls back to `children`. */
  empty?: ReactNode
  /** The ready state. A function keeps expensive trees lazy until ready. */
  children?: ReactNode | (() => ReactNode)
}

export function QueryStates({
  status,
  pending,
  pendingLabel,
  error,
  onRetry,
  empty,
  children,
}: QueryStatesProps) {
  if (status === "pending")
    return <>{pending ?? <QueryPending label={pendingLabel} />}</>
  if (status === "error") {
    if (isValidElement(error)) return error
    const content: QueryErrorContent =
      typeof error === "string" ? { title: error } : error
    return <QueryError {...content} onRetry={onRetry} />
  }
  if (status === "empty" && empty !== undefined) return <>{empty}</>
  return <>{typeof children === "function" ? children() : children}</>
}

/**
 * Body of a Next.js route `error.tsx`: what happened, that the rest of the app
 * still works, a `reset` button and a way home. The route file decides the
 * landmark: segments whose layout already owns `<main>` render this bare.
 */
export function RouteErrorState({
  title,
  description,
  onReset,
  homeHref = "/inbox",
  homeLabel = "Go to Inbox",
  className,
}: {
  title: string
  description: ReactNode
  onReset: () => void
  homeHref?: string
  /** Names where `homeHref` goes, e.g. "All clients". */
  homeLabel?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-[60svh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6 text-center",
        className
      )}
    >
      <Alert variant="destructive" live className="text-left">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onReset}>Try again</Button>
        {/* A real <a> styled as a button, not Button+render — see the note in
            app/not-found.tsx for why. buttonVariants() merges its own
            classes, so no cn() is needed around it. */}
        <Link
          href={homeHref}
          className={buttonVariants({ variant: "outline" })}
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  )
}
