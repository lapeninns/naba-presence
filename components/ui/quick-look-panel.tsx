"use client"

import * as React from "react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { mediaQuery } from "@/lib/ui/breakpoints"
import { cn } from "@/lib/utils"

/**
 * A desk quick look (DSK-23): the triage question "what is waiting here?"
 * answered beside a list instead of a full page change and a Back. From
 * `lg`, a plain click on a Clients or Listings row opens the overlay's right
 * `panel` with the row's work and one "Open …" link to the full page.
 *
 * The row's name is its link and always opens the page: a click on the
 * name, Enter on it (so keyboard users keep exactly the link they had) and a
 * modifier or middle click (new tab or window). Only the rest of the row
 * opens the quick look, and only from `lg`; a phone or tablet has no room
 * beside the list, so there the whole row still opens the page. Every fact
 * in the panel is also on the page it links to.
 *
 *   const quick = useQuickLook<Client>()
 *   <a href={…} onClick={(event) => quick.intercept(event, row)}>…</a>
 *   <DataTable onRowClick={(client) => quick.show(client, nameLink) || router.push(…)} />
 *   <QuickLookPanel {...quick.panelProps} title={…} openHref={…} openLabel="Open client">
 *     <QuickLookSection title="Work">…</QuickLookSection>
 *   </QuickLookPanel>
 */

type QuickLookClick = Pick<
  MouseEvent,
  "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "detail"
>

/**
 * A plain primary click from a pointer. Modifier clicks keep the browser's
 * new-tab and new-window behaviour, and a keyboard activation (Enter on a
 * link fires a click whose `detail` is 0) keeps the full page.
 */
function isQuickLookClick(event: QuickLookClick): boolean {
  return (
    event.button === 0 &&
    event.detail > 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/**
 * Whether the window is at least `lg` now. Asked at the click, not held as
 * state, so a resize never re-renders the whole list (see
 * lib/hooks/use-media-query.ts). jsdom and the server read false.
 */
function atDesk(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    Boolean(window.matchMedia(mediaQuery("lg"))?.matches)
  )
}

/**
 * The quick look's state for one list. `item` stays set while the panel
 * animates out, so its content does not empty under the closing panel.
 */
function useQuickLook<T>() {
  const [state, setState] = React.useState<{ item: T | null; open: boolean }>({
    item: null,
    open: false,
  })
  // Where focus goes back to on close: the row's name link.
  const returnFocus = React.useRef<HTMLElement | null>(null)

  const onOpenChange = (open: boolean) =>
    setState((current) => ({ ...current, open }))

  /**
   * From `lg`, open the quick look on `item`; below it, do nothing. For a
   * row whose click handler gets no event (DataTable's `onRowClick`).
   * Answers whether it opened.
   */
  const show = (item: T, from?: HTMLElement | null): boolean => {
    if (!atDesk()) return false
    returnFocus.current = from ?? null
    setState({ item, open: true })
    return true
  }

  /**
   * For a row's click: from `lg`, a plain pointer click opens the quick look
   * (and the click's default is prevented). Answers whether it did, so a
   * caller can fall back to its own navigation. `from` is the row's name
   * link, where focus returns on close.
   */
  const intercept = (
    event: React.MouseEvent<HTMLElement>,
    item: T,
    from?: HTMLElement | null
  ): boolean => {
    if (!isQuickLookClick(event) || !show(item, from ?? event.currentTarget))
      return false
    event.preventDefault()
    return true
  }

  return {
    item: state.item,
    open: state.open,
    show,
    intercept,
    panelProps: { open: state.open, onOpenChange, returnFocus },
  }
}

function QuickLookPanel({
  open,
  onOpenChange,
  returnFocus,
  title,
  description,
  status,
  openHref,
  openLabel,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus?: React.RefObject<HTMLElement | null>
  title: React.ReactNode
  /** One line under the title: the address, the listings linked. */
  description?: React.ReactNode
  /** The row's status pill (and its note), under the title. */
  status?: React.ReactNode
  /** The full page this row opens to. */
  openHref: string
  /** "Open client", "Open listing". */
  openLabel: string
  children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-slot="quick-look"
        className="flex flex-col gap-0"
        // Back to the row's link, if it is still on the page (a filter may
        // have hidden the row meanwhile); otherwise Base UI's default.
        finalFocus={() => {
          const target = returnFocus?.current
          if (target && target.isConnected && target.getClientRects().length)
            return target
          return true
        }}
      >
        <SheetHeader>
          <SheetTitle className="break-words">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="break-words">
              {description}
            </SheetDescription>
          ) : null}
          {status ? (
            <div className="flex flex-col items-start gap-1 pt-1">{status}</div>
          ) : null}
        </SheetHeader>
        <SheetBody className="gap-5">{children}</SheetBody>
        <SheetFooter>
          <ShellLink
            href={openHref}
            intentPrefetch={true}
            className={cn(buttonVariants())}
          >
            {openLabel}
          </ShellLink>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** One labelled block of the quick look. */
function QuickLookSection({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      data-slot="quick-look-section"
      className={cn("flex flex-col gap-2", className)}
    >
      <h3 id={id} className="text-ui font-semibold text-ink">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Label and value rows: an area and its state, a fact and its value. */
function QuickLookFacts({ children }: { children: React.ReactNode }) {
  return (
    <dl
      data-slot="quick-look-facts"
      className="flex flex-col divide-y divide-line rounded-(--np-radius-card) border border-line"
    >
      {children}
    </dl>
  )
}

function QuickLookFact({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
      <dt className="min-w-0 text-ui text-ink-secondary">{label}</dt>
      <dd className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 text-right text-ui text-ink">
        {children}
      </dd>
    </div>
  )
}

export {
  isQuickLookClick,
  QuickLookFact,
  QuickLookFacts,
  QuickLookPanel,
  QuickLookSection,
  useQuickLook,
}
