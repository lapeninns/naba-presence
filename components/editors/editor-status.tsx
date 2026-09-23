"use client"

import * as React from "react"

import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * What the editor on a listing area knows right now, published by its
 * EditorFooter so the area header's status pill tells the same story as the
 * footer: unsaved edits, saved here but not on Google, a conflict, or in
 * sync. The summary the header otherwise reads is DB-only and knows nothing
 * of edits that live only in this tab.
 */
export type EditorStatusReport = {
  /** The footer's status word. */
  status: "in_sync" | "edited" | "unpublished" | "google_dirty" | "conflict"
  /** Anything to publish: local edits, or drift already saved here. */
  isDirty: boolean
  /** Edits in this tab that are not saved anywhere yet. */
  localEdits: boolean
  /** The resource keeps a NabaPresence copy ("Save here" exists). */
  savesHere: boolean
  /** How many fields differ from Google, when the editor counts them. */
  changeCount?: number
}

type Store = {
  subscribe: (listener: () => void) => () => void
  get: () => EditorStatusReport | null
  set: (report: EditorStatusReport | null) => void
}

function createStore(): Store {
  let report: EditorStatusReport | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get: () => report,
    set: (next) => {
      report = next
      listeners.forEach((listener) => listener())
    },
  }
}

const EditorStatusContext = React.createContext<Store | null>(null)
const NOOP_SUBSCRIBE = () => () => {}

function EditorStatusProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(createStore)
  return (
    <EditorStatusContext.Provider value={store}>
      {children}
    </EditorStatusContext.Provider>
  )
}

/**
 * Publish the editor's state to the enclosing area header. `null` (a
 * view-only footer) withdraws it. Outside a provider this does nothing.
 */
function useReportEditorStatus(report: EditorStatusReport | null) {
  const store = React.useContext(EditorStatusContext)
  const status = report?.status
  const isDirty = report?.isDirty
  const localEdits = report?.localEdits
  const savesHere = report?.savesHere
  const changeCount = report?.changeCount
  const present = report !== null
  React.useEffect(() => {
    if (!store) return
    store.set(
      present
        ? {
            status: status!,
            isDirty: isDirty!,
            localEdits: localEdits!,
            savesHere: savesHere!,
            changeCount,
          }
        : null
    )
  }, [store, present, status, isDirty, localEdits, savesHere, changeCount])
  React.useEffect(() => {
    if (!store) return
    return () => store.set(null)
  }, [store])
}

/** The latest report from the editor on this page, or null. */
function useEditorStatus(): EditorStatusReport | null {
  const store = React.useContext(EditorStatusContext)
  return React.useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    () => (store ? store.get() : null),
    () => null
  )
}

function changesWords(count: number) {
  return `${count} ${count === 1 ? "change" : "changes"} not on Google`
}

/**
 * The header pill for an editor's state, or null when the editor has nothing
 * to add and the DB summary should speak (a clean editor that never compared
 * with Google must not be promoted to "In sync").
 */
function editorStatusPill(
  report: EditorStatusReport | null
): { tone: StatusTone; label: string } | null {
  if (!report) return null
  if (report.status === "conflict")
    return { tone: "attention", label: "Conflict with Google" }
  if (report.localEdits) return { tone: "pending", label: "Unsaved edits" }
  if (report.isDirty) {
    if (report.status === "google_dirty")
      return { tone: "attention", label: "Changed on Google" }
    if (report.savesHere || report.status === "unpublished")
      return { tone: "pending", label: "Saved here, not on Google" }
    return {
      tone: "pending",
      label:
        typeof report.changeCount === "number" && report.changeCount > 0
          ? changesWords(report.changeCount)
          : "Not on Google yet",
    }
  }
  if (report.status === "in_sync")
    return { tone: "healthy", label: "In sync with Google" }
  return null
}

export {
  EditorStatusProvider,
  editorStatusPill,
  useEditorStatus,
  useReportEditorStatus,
}
