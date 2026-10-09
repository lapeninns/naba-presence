import { LinkIcon } from "lucide-react"

/**
 * The one answer for every report link that does not work: mistyped, made
 * up, expired or revoked. Deliberately identical for all of them -- which one
 * it was is not the reader's to learn, and telling them apart would let
 * anyone probing tokens learn which ones once existed. No links into the app.
 */
export default function ShareReportNotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col items-center justify-center px-4 py-10 outline-none"
    >
      <section
        aria-labelledby="share-not-found-title"
        className="flex w-full max-w-[460px] flex-col gap-4 rounded-2xl border border-line bg-surface p-[clamp(20px,5vw,32px)]"
      >
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-lg bg-fill text-ink-secondary"
        >
          <LinkIcon className="size-5" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1
            id="share-not-found-title"
            className="font-display text-page-title font-semibold text-balance"
          >
            This report link isn’t available
          </h1>
          <p className="text-body text-ink-muted">
            The link may be mistyped, or it may have expired or been switched
            off. Ask whoever sent it to you for a new one.
          </p>
        </div>
      </section>
    </main>
  )
}
