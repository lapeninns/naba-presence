"use client"

import * as React from "react"

import type { BackTarget } from "@/lib/navigation/back-target"

/**
 * What a page may tell the shell's chrome about itself, when the URL alone
 * gets it wrong.
 *
 * The shell derives everything it can from the address: the back control
 * from the breadcrumb trail (lib/navigation/back-target.ts), the compact
 * title from the page's own `h1`. A page overrides only what that cannot
 * know, by rendering `<PageChrome …/>` anywhere in its tree:
 *
 *   // The Inbox's pushed review detail goes back to the list, which is the
 *   // same path with a different query string.
 *   <PageChrome
 *     back={{ href: "/inbox?queue=needs_reply", label: "Inbox" }}
 *     onBack={backToList}
 *   />
 *
 * `back: null` removes the back control (a page that is its own root).
 * `onBack` is for a page whose way back is more than a link: the control
 * stays a real link to `back.href` (a modified click still opens it in a
 * new tab), but a plain activation runs `onBack` instead, so the page can
 * pop the history entry it pushed, ask its leave guard, and put focus back
 * where it came from.
 * `title` replaces the h1 text in the phone app bar; keep it the h1's
 * words, shortened if anything, never different ones.
 *
 * The override lives only while the page that rendered it is mounted, so a
 * route change can never leave one page's back control on the next.
 */
export type PageChromeOverride = {
  back?: ShellBackTarget | null
  title?: string
}

/** A back target, with the page's own handler when it declared one. */
export type ShellBackTarget = BackTarget & { onNavigate?: () => void }

type Registry = {
  override: PageChromeOverride
  set: (owner: symbol, value: PageChromeOverride | null) => void
}

const PageChromeContext = React.createContext<Registry | null>(null)

function PageChromeProvider({ children }: { children: React.ReactNode }) {
  // Last writer wins, so a nested override (a detail inside a list page)
  // beats the page's own; removing it restores the previous one.
  const [entries, setEntries] = React.useState<
    { owner: symbol; value: PageChromeOverride }[]
  >([])
  const set = React.useCallback(
    (owner: symbol, value: PageChromeOverride | null) => {
      setEntries((previous) => {
        const rest = previous.filter((entry) => entry.owner !== owner)
        return value ? [...rest, { owner, value }] : rest
      })
    },
    []
  )
  const override = React.useMemo(
    () =>
      entries.reduce<PageChromeOverride>(
        (merged, entry) => ({ ...merged, ...entry.value }),
        {}
      ),
    [entries]
  )
  const value = React.useMemo(() => ({ override, set }), [override, set])
  return (
    <PageChromeContext.Provider value={value}>
      {children}
    </PageChromeContext.Provider>
  )
}

/** Declares this page's chrome overrides; renders nothing. */
function PageChrome({
  back,
  title,
  onBack,
}: {
  back?: BackTarget | null
  title?: string
  /** Runs instead of following `back.href` on a plain activation. */
  onBack?: () => void
}) {
  const set = React.useContext(PageChromeContext)?.set
  const [owner] = React.useState(() => Symbol("page-chrome"))
  const hasBack = back !== undefined
  const backHref = back?.href
  const backLabel = back?.label
  // The latest handler, read at click time, so a page passing a fresh
  // closure every render doesn't re-register its override every render.
  const onBackRef = React.useRef(onBack)
  React.useEffect(() => {
    onBackRef.current = onBack
  })
  const hasHandler = onBack !== undefined

  React.useEffect(() => {
    if (!set) return
    const value: PageChromeOverride = {}
    if (hasBack) {
      value.back =
        backHref && backLabel
          ? {
              href: backHref,
              label: backLabel,
              ...(hasHandler
                ? { onNavigate: () => onBackRef.current?.() }
                : {}),
            }
          : null
    }
    if (title !== undefined) value.title = title
    set(owner, value)
  }, [set, owner, hasBack, backHref, backLabel, hasHandler, title])

  React.useEffect(() => () => set?.(owner, null), [set, owner])

  return null
}

/** The current page's overrides; empty outside the shell. */
function usePageChromeOverride(): PageChromeOverride {
  return React.useContext(PageChromeContext)?.override ?? NO_OVERRIDE
}

const NO_OVERRIDE: PageChromeOverride = {}

export { PageChrome, PageChromeProvider, usePageChromeOverride }
