"use client"

import * as React from "react"

type SelectionValue = {
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  extendTo: (id: string, orderedIds: string[]) => void
  replace: (ids: string[]) => void
  clear: () => void
}

const SelectionContext = React.createContext<SelectionValue | null>(null)

/**
 * Which reviews are ticked for a bulk action.
 *
 * Kept out of the URL deliberately: a selection is a momentary working set,
 * not a place. Putting it in the address bar would fill the history with
 * every tick and make "share this view" mean "share my half-finished batch".
 */
function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  // The row a range extends FROM. Shift-click without one selects a single row
  // rather than guessing at an anchor.
  const anchor = React.useRef<string | null>(null)

  const value = React.useMemo<SelectionValue>(
    () => ({
      selected,
      toggle(id) {
        anchor.current = id
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      },
      extendTo(id, orderedIds) {
        const from = anchor.current
        if (!from) {
          anchor.current = id
          setSelected((current) => new Set(current).add(id))
          return
        }
        const start = orderedIds.indexOf(from)
        const end = orderedIds.indexOf(id)
        if (start === -1 || end === -1) return
        const [low, high] = start < end ? [start, end] : [end, start]
        setSelected((current) => {
          const next = new Set(current)
          for (const rangeId of orderedIds.slice(low, high + 1)) next.add(rangeId)
          return next
        })
      },
      replace(ids) {
        setSelected(new Set(ids))
      },
      clear() {
        anchor.current = null
        setSelected(new Set())
      },
    }),
    [selected]
  )

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  )
}

function useSelection(): SelectionValue {
  const context = React.useContext(SelectionContext)
  if (!context) {
    throw new Error("useSelection must be used inside a SelectionProvider")
  }
  return context
}

export { SelectionProvider, useSelection }
