import type * as React from "react"

/**
 * The one state the public report shows when there is no report to show (a
 * link that does not work, or a failed read): the page's `h1`, one sentence
 * and at most one action, centred on the screen. No links into the app.
 *
 * Drawn as the shared empty-state look (the `Empty` primitive's mark, title
 * and sentence, centred on a quiet card), written out here because this
 * title is the page's `h1`, which `Empty` does not offer.
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
      className="flex min-h-svh flex-col items-center justify-center px-5 py-10 outline-none"
    >
      <div
        data-slot="share-state"
        className="flex w-full max-w-md flex-col items-center gap-2.5 rounded-(--np-radius-card) border border-line-subtle bg-surface px-5 py-10 text-center sm:px-8"
      >
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-(--np-radius-card) bg-fill text-ink-secondary [&_svg]:size-5 [&_svg]:[stroke-width:1.75]"
        >
          {icon}
        </span>
        <h1 className="text-page-title font-semibold text-balance text-ink">
          {title}
        </h1>
        <p className="max-w-sm text-body text-pretty text-ink-secondary">
          {description}
        </p>
        {action ? <div className="mt-2 w-full">{action}</div> : null}
      </div>
    </main>
  )
}
