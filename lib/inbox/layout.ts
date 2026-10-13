import type { CSSProperties } from "react"

/**
 * The split view's list column (reference `.work`): a third of the room,
 * between 300px and 420px, from lg. One value for the workspace
 * (components/inbox/inbox-view.tsx) and its loading outline
 * (app/(dashboard)/inbox/loading.tsx), so the skeleton's columns are the
 * columns the page then draws. Read with
 * `lg:grid-cols-[var(--inbox-list-w)_minmax(0,1fr)]`.
 */
export const INBOX_SPLIT_STYLE = {
  "--inbox-list-w": "clamp(18.75rem, 32%, 26.25rem)",
} as CSSProperties
