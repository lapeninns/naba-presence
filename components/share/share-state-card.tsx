import type * as React from "react"

import { Empty } from "@/components/ui/empty"

/**
 * The one state the public report shows when there is no report to show (a
 * link that does not work, or a failed read): the page's `h1`, one sentence
 * and at most one action. No links into the app.
 *
 * The shared `Empty` state at page placement (the mark, title and sentence
 * at about a third of the screen's height, NM's "All caught up" layout), in
 * its own `<main>`: this page has no app shell, so the state IS the page and
 * its title is the page's one `h1`.
 */
export function ShareStateCard({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col outline-none"
    >
      <Empty
        placement="page"
        titleAs="h1"
        icon={icon}
        title={title}
        description={description}
        action={
          action ? <div className="w-full max-w-xs">{action}</div> : undefined
        }
        className="min-h-svh"
      />
    </main>
  )
}
