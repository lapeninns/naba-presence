"use client"

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { applyWithUndo, toast } from "@/components/ui/toast"
import { useOptimisticMutation } from "@/lib/queries/use-optimistic-mutation"
import { cn } from "@/lib/utils"

/**
 * Feedback recipes (P07): the three patterns later features adopt rather than
 * reinvent. Everything here is fake and local: no request leaves the page.
 */

function DemoPanel({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-5">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-ui font-semibold text-ink">{title}</h4>
        <p className="text-caption text-ink-muted">{note}</p>
      </div>
      {children}
    </div>
  )
}

/** One id for the message, so a second add replaces the first. */
const REPLACE_ID = "ds-replace-by-id"

function ReplaceByIdDemo() {
  const count = React.useRef(0)
  return (
    <DemoPanel
      title="Replace by id"
      note="Tap three times: one toast, new words, the timer starts again. Without an id each tap would stack a toast."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            count.current += 1
            toast.add({
              id: REPLACE_ID,
              title: `Switched to scope ${count.current}`,
            })
          }}
        >
          Switch scope (stable id)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            count.current += 1
            toast.add({ title: `Switched to scope ${count.current}` })
          }}
        >
          Switch scope (no id, stacks)
        </Button>
      </div>
    </DemoPanel>
  )
}

type Row = { id: string; label: string; read: boolean }
const ROWS_KEY = ["design-system", "ux-p07", "rows"] as const
const INITIAL_ROWS: Row[] = [
  { id: "r1", label: "New review from Sam", read: false },
  { id: "r2", label: "Reply published", read: false },
  { id: "r3", label: "Sync finished", read: false },
]
/**
 * The fake server keeps the answer, so the refetch on settle shows the truth
 * whether the change was accepted or not.
 */
const fakeServer = { rows: INITIAL_ROWS, refuses: false }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function OptimisticRows() {
  const rows = useQuery({
    queryKey: ROWS_KEY,
    queryFn: () => fakeServer.rows,
    staleTime: Infinity,
  })
  const markRead = useOptimisticMutation<void, string, Row[]>({
    mutationFn: async (id) => {
      await wait(800)
      if (fakeServer.refuses) throw new Error("The fake server refused it.")
      fakeServer.rows = fakeServer.rows.map((row) =>
        row.id === id ? { ...row, read: true } : row
      )
    },
    queryKey: ROWS_KEY,
    update: (current, id) =>
      current?.map((row) => (row.id === id ? { ...row, read: true } : row)),
    errorTitle: "Could not mark as read",
    errorDescription: (error) => error.message,
  })
  return (
    <ul className="flex flex-col divide-y divide-line rounded-(--np-radius-control) border border-line">
      {(rows.data ?? []).map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 px-3 py-1"
        >
          <span
            className={cn(
              "text-body",
              row.read ? "text-ink-muted" : "font-medium text-ink"
            )}
          >
            {row.label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={row.read}
            onClick={() => markRead.mutate(row.id)}
          >
            {row.read ? "Read" : "Mark read"}
          </Button>
        </li>
      ))}
    </ul>
  )
}

function OptimisticDemo() {
  // The demo's own cache, so it never touches the app's queries.
  const [client] = React.useState(() => new QueryClient())
  const [refuses, setRefuses] = React.useState(false)
  return (
    <DemoPanel
      title="Optimistic update"
      note="useOptimisticMutation: the row changes at once (the fake server takes 0.8 s). When it refuses, the row goes back and an error toast says so."
    >
      <QueryClientProvider client={client}>
        <OptimisticRows />
      </QueryClientProvider>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={refuses}
          onClick={() => {
            fakeServer.refuses = !fakeServer.refuses
            setRefuses(fakeServer.refuses)
          }}
        >
          {refuses ? "Server refuses: on" : "Server refuses: off"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            fakeServer.rows = INITIAL_ROWS
            void client.invalidateQueries({ queryKey: ROWS_KEY })
          }}
        >
          Reset rows
        </Button>
      </div>
    </DemoPanel>
  )
}

function UndoDemo() {
  const [archived, setArchived] = React.useState(false)
  return (
    <DemoPanel
      title="Undo for a local action"
      note="applyWithUndo: the action happens straight away; Undo is the way back. Never for a Google write."
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body text-ink">
          Note: {archived ? "archived" : "active"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={archived}
          onClick={() =>
            applyWithUndo({
              id: "ds-undo",
              title: "Note archived",
              apply: () => setArchived(true),
              revert: () => setArchived(false),
            })
          }
        >
          Archive
        </Button>
      </div>
    </DemoPanel>
  )
}

export function UxP07Demo() {
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-3">
      <ReplaceByIdDemo />
      <OptimisticDemo />
      <UndoDemo />
    </div>
  )
}
