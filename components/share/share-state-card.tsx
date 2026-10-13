import type * as React from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * The one card the public report shows when there is no report to show (a
 * link that does not work, or a failed read): the page's `h1`, one sentence
 * and at most one action, centred on the screen. No links into the app.
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
      className="flex min-h-svh flex-col items-center justify-center px-4 py-10 outline-none"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="gap-1.5">
          <span
            aria-hidden
            className="mb-2.5 grid size-11 place-items-center rounded-(--np-radius-card) bg-fill text-ink-secondary [&_svg]:size-5 [&_svg]:[stroke-width:1.75]"
          >
            {icon}
          </span>
          <CardTitle
            as="h1"
            className="font-display text-page-title text-balance"
          >
            {title}
          </CardTitle>
          <CardDescription className="text-body">{description}</CardDescription>
        </CardHeader>
        {action ? <CardContent>{action}</CardContent> : null}
      </Card>
    </main>
  )
}
