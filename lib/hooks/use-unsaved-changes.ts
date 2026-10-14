"use client"

import { useCallback, useState } from "react"

import { peekStashedDraft } from "@/lib/api/draft-stash"
import { useLeaveGuard, type LeavePrompt } from "@/lib/editors/use-leave-guard"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { useHydrated } from "@/lib/hooks/use-hydrated"

/**
 * How a restorable editor's edits are kept and offered back: `snapshot` is
 * what a forced sign-out (or an unmount the operator did not choose) stashes,
 * and `parse` reads a stash back, returning null for one that is malformed or
 * matches what is saved (nothing to offer). Read once `ready` (default true),
 * so an editor waiting for its server value does not judge the stash early.
 */
export type RestoreOptions<T> = {
  snapshot: () => T
  parse: (value: unknown) => T | null
  ready?: boolean
}

export type UnsavedChanges<T> = {
  /** Spread into a `<DiscardDialog />`: the in-app leave prompt. */
  leavePrompt: LeavePrompt
  /** Ask before a discard the editor starts itself (a Cancel, a close). */
  confirmDiscard: () => Promise<boolean>
  /** The operator chose to lose these edits: nothing stashes them now. */
  forget: () => void
  /** Restorable only: edits stashed by an earlier visit, to offer back. */
  stashed: T | null
  /** Takes the stash (it is offered once) and returns it to apply. */
  restoreStashed: () => T | null
  /** Drops the stash without applying it. */
  dismissStashed: () => void
}

/**
 * Everything an editor needs so unsaved edits are not lost without asking,
 * in one place (`useDirtyGuard` and `useLeaveGuard` wired the same way for
 * every editor):
 *
 *   - while `isDirty`, a reload or closed tab warns (`beforeunload`), except
 *     once a forced sign-out has abandoned the drafts (`draftsAbandoned`);
 *   - while `leaveWhen` (default: `isDirty`), an in-app link, the back button
 *     or a guarded router navigation opens `leavePrompt`; agreeing to leave
 *     forgets the edits;
 *   - with `restore`, the edits are stashed in this tab on a forced sign-out
 *     or an unmount nobody agreed to, and the next mount offers them back as
 *     `stashed`. Without it nothing is stashed: a stash no editor reads only
 *     lingers in sessionStorage.
 *
 * `scope` is the editor's draft key (`useDraftKey`), which names the
 * signed-in identity as well as the resource.
 */
export function useUnsavedChanges<T = never>({
  scope,
  isDirty,
  leaveWhen = isDirty,
  restore,
}: {
  scope: string
  isDirty: boolean
  leaveWhen?: boolean
  restore?: RestoreOptions<T>
}): UnsavedChanges<T> {
  const restorable = restore !== undefined
  const guard = useDirtyGuard({
    key: scope,
    isDirty,
    snapshot: () => JSON.stringify(restore?.snapshot() ?? null),
    stash: restorable,
  })
  const leavePrompt = useLeaveGuard({ when: leaveWhen, onLeave: guard.markDiscarded })

  // Read once per key, without consuming it, after hydration (the server
  // render had no stash) and once the editor is ready to judge it; a stash
  // read under an earlier key (another identity) is never offered.
  const canRead = useHydrated() && restorable && (restore.ready ?? true)
  const [read, setRead] = useState<{ key: string | null; value: T | null }>({
    key: null,
    value: null,
  })
  if (canRead && read.key !== scope) {
    setRead({ key: scope, value: readStash(scope, restore.parse) })
  }
  const stashed = read.key === scope ? read.value : null

  const { restore: take } = guard
  const restoreStashed = useCallback(() => {
    take()
    setRead({ key: scope, value: null })
    return stashed
  }, [scope, stashed, take])
  const dismissStashed = useCallback(() => {
    take()
    setRead({ key: scope, value: null })
  }, [scope, take])

  return {
    leavePrompt,
    confirmDiscard: guard.confirmDiscard,
    forget: guard.markDiscarded,
    stashed,
    restoreStashed,
    dismissStashed,
  }
}

function readStash<T>(key: string, parse: (value: unknown) => T | null) {
  const raw = peekStashedDraft(key)
  if (raw === null) return null
  try {
    return parse(JSON.parse(raw))
  } catch {
    // A corrupt stash is ignored, as if it had never been written.
    return null
  }
}
