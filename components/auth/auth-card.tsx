import { BrandMark } from "@/components/app-shell/brand-mark"

/**
 * The one shape every pre-auth screen takes: a single white card, centred on
 * the grey canvas, with the brand mark above a bold title. It is also the
 * page's `<main>` and carries the page's only `h1`; the `(auth)` layout
 * renders no landmark of its own.
 *
 * The card draws no border and no shadow — on the grouped background a
 * white surface is a card by contrast alone — and the footer sits under it
 * on the canvas, where the platform puts a screen's secondary route out.
 */
function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow?: React.ReactNode
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex w-full max-w-md flex-col gap-4 outline-none"
    >
      <div className="flex flex-col gap-6 rounded-(--np-radius-panel) bg-surface p-6 sm:p-8">
        <BrandMark />

        <div className="flex flex-col gap-1.5">
          {eyebrow ? (
            <p className="text-caption font-medium text-ink-muted">{eyebrow}</p>
          ) : null}
          <h1 className="text-page-title font-bold text-balance text-ink">
            {title}
          </h1>
          {description ? (
            <p className="text-body text-ink-muted">{description}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">{children}</div>
      </div>

      {footer ? (
        <div className="text-center text-ui text-ink-muted">{footer}</div>
      ) : null}
    </main>
  )
}

export { AuthCard }
