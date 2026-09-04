"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"

import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"

export type EditorDraft<T> = {
  draft: T
  setDraft: Dispatch<SetStateAction<T>>
  isDirty: boolean
  /** Throw the local edits away and go back to what the server holds. */
  discard: () => void
  /** Ask before losing edits; resolves true when it is safe to continue. */
  confirmDiscard: () => Promise<boolean>
}

/**
 * The three things every Google-writing editor did by hand: seed a draft from
 * the server value, reset it only when that value's revision moves, and arm
 * the dirty guard so a reload or a forced sign-out doesn't eat the work.
 *
 * Comparison is by JSON shape, which is what the tabs already used. It is
 * exact enough for these draft objects (plain data, stable key order from the
 * same schema) and avoids every editor writing its own equality.
 */
export function useEditorDraft<T>({
  initial,
  revision,
  key,
}: {
  initial: T
  /** Token that changes when the SERVER value changes — usually a revision. */
  revision: unknown
  /** Stash key, unique per location and resource. */
  key: string
}): EditorDraft<T> {
  const [draft, setDraft] = useResetOnRevision(initial, revision)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const { confirmDiscard } = useDirtyGuard({
    key,
    isDirty,
    snapshot: () => JSON.stringify(draft),
  })

  const discard = useCallback(() => setDraft(initial), [initial, setDraft])

  return { draft, setDraft, isDirty, discard, confirmDiscard }
}
