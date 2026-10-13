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
 *   <PageChrome back={{ href: "/inbox?queue=needs_reply", label: "Reviews" }} />
 *
 * `back: null` removes the back control (a page that is its own root).
 * `title` replaces the h1 text in the phone app bar; keep it the h1's
 * words, shortened if anything, never different ones.
 *
 * The override lives only while the page that rendered it is mounted, so a
 * route change can never leave one page's back control on the next.
 */
export type PageChromeOverride = {
  back?: BackTarget | null
  title?: string
}

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
function PageChrome({ back, title }: PageChromeOverride) {
  const set = React.useContext(PageChromeContext)?.set
  const [owner] = React.useState(() => Symbol("page-chrome"))
  const hasBack = back !== undefined
  const backHref = back?.href
  const backLabel = back?.label

  React.useEffect(() => {
    if (!set) return
    const value: PageChromeOverride = {}
    if (hasBack) {
      value.back =
        backHref && backLabel ? { href: backHref, label: backLabel } : null
    }
    if (title !== undefined) value.title = title
    set(owner, value)
  }, [set, owner, hasBack, backHref, backLabel, title])

  React.useEffect(() => () => set?.(owner, null), [set, owner])

  return null
}

/** The current page's overrides; empty outside the shell. */
function usePageChromeOverride(): PageChromeOverride {
  return React.useContext(PageChromeContext)?.override ?? NO_OVERRIDE
}

const NO_OVERRIDE: PageChromeOverride = {}

export { PageChrome, PageChromeProvider, usePageChromeOverride }
