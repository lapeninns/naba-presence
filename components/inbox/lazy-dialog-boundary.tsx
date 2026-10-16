"use client"

import * as React from "react"

import { useToastManager } from "@/components/ui/toast"

/**
 * Whether an error is a code chunk that would not download (an offline phone,
 * a deploy that retired the file), rather than a bug in the component. Only
 * the first is the operator's connection to put right.
 */
function isLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === "ChunkLoadError" ||
    /loading (css )?chunk|dynamically imported module|importing a module script failed/i.test(
      error.message
    )
  )
}

type CatcherProps = {
  onLoadFailure: () => void
  children: React.ReactNode
}

class Catcher extends React.Component<CatcherProps, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown) {
    if (isLoadFailure(error)) this.props.onLoadFailure()
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    // Anything but a download failure is a real fault: the page's own
    // boundary should see it, not a toast about the connection.
    if (!isLoadFailure(error)) throw error
    return null
  }
}

/**
 * Around a dialog (or the body of one) that loads through `next/dynamic`.
 * When its code cannot be fetched the dialog closes (`onFail`) and a toast
 * says so, instead of the error reaching the page-level boundary and taking
 * the whole Inbox with it. `onFail` also swaps in a fresh lazy component:
 * React caches a rejected load, so without that the next open would fail
 * again until a reload.
 *
 * `what` completes "Could not open …": "History", "the template reply".
 */
function LazyDialogBoundary({
  what,
  onFail,
  children,
}: {
  what: string
  onFail: () => void
  children: React.ReactNode
}) {
  const toasts = useToastManager()
  return (
    <Catcher
      onLoadFailure={() => {
        onFail()
        toasts.add({
          title: `Could not open ${what}`,
          description: "Check your connection and try again.",
          type: "error",
        })
      }}
    >
      {children}
    </Catcher>
  )
}

/**
 * The `loading` option for a lazy dialog: `content` while its code is on the
 * way, and the load error rethrown if it fails. next/dynamic's two runtimes
 * differ here: one throws a failed load into the tree, the other hands it to
 * `loading` as `error` and shows whatever that renders. Rethrowing reaches
 * the LazyDialogBoundary either way.
 */
function whileLoading(content: React.ReactNode) {
  return function Loading({ error }: { error?: unknown }) {
    if (error) throw error
    return content
  }
}

export { isLoadFailure, LazyDialogBoundary, whileLoading }
