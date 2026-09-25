"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { Verification } from "@/lib/contracts/reviews"

type ConfirmDiscardFn = () => Promise<boolean>

/** What a composer save hands back: the new draft and its checks. */
export type ComposerSaveResult = {
  draftId: string
  verification: Verification
}

/**
 * The composer's own save, offered to the publish bar while the reply holds
 * unsaved edits. Publish runs it first, then publishes the draft it returns,
 * so one press saves, checks and sends the text on screen.
 */
export type ComposerSave = {
  /**
   * Saves and verifies the text on screen. Resolves null when the save did
   * not happen or failed; the composer has already said why.
   */
  save: () => Promise<ComposerSaveResult | null>
  /** Why the text cannot be saved as it stands, or null when it can. */
  blockedReason: string | null
  saving: boolean
}

type Gate = {
  isDirty: boolean
  confirmDiscard: ConfirmDiscardFn
  save: ComposerSave | null
}

const CLEAN_GATE: Gate = {
  isDirty: false,
  confirmDiscard: async () => true,
  save: null,
}

class DirtyStore {
  private gate: Gate = CLEAN_GATE
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getIsDirty = () => this.gate.isDirty
  getSave = () => this.gate.save
  confirmDiscard = () => this.gate.confirmDiscard()
  set = (gate: Gate) => {
    this.gate = gate
    this.listeners.forEach((listener) => listener())
  }
}

const DirtyStoreContext = createContext<DirtyStore | null>(null)
const AskDiscardContext = createContext<(() => Promise<boolean>) | null>(null)
const NOOP_SUBSCRIBE = () => () => {}

function DirtyGuardProvider({ children }: { children: ReactNode }) {
  // Lazy `useState` initializer, not a ref: it creates the store exactly once
  // per mount (the setter is never called, so this never re-renders) without
  // touching a ref's `.current` during render.
  const [store] = useState(() => new DirtyStore())
  const [open, setOpen] = useState(false)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    setOpen(false)
    const resolve = resolverRef.current
    resolverRef.current = null
    resolve?.(value)
  }, [])

  const askDiscard = useCallback(() => {
    // A second request while the dialog is open resolves the previous one as
    // "keep editing" so we never leave a dangling promise.
    if (resolverRef.current) {
      resolverRef.current(false)
      resolverRef.current = null
    }
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOpen(true)
    })
  }, [])

  return (
    <DirtyStoreContext.Provider value={store}>
      <AskDiscardContext.Provider value={askDiscard}>
        {children}
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (!next) settle(false)
          }}
        >
          <AlertDialogContent aria-label="Discard unsaved reply?">
            <AlertDialogTitle>Discard unsaved reply?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this reply. Discard them?
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="secondary" />}>
                Keep editing
              </AlertDialogClose>
              <Button variant="destructive" onClick={() => settle(true)}>
                Discard
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AskDiscardContext.Provider>
    </DirtyStoreContext.Provider>
  )
}

/** Opens the discard AlertDialog. Falls back to `window.confirm` outside the provider. */
function useAskDiscardConfirm(): () => Promise<boolean> {
  const ask = useContext(AskDiscardContext)
  return useCallback(() => {
    if (ask) return ask()
    return Promise.resolve(
      window.confirm("You have unsaved changes to this reply. Discard them?")
    )
  }, [ask])
}

// The composer publishes its live dirtiness + confirm into the shared store,
// and — while the text on screen is not yet a checked draft — the save the
// publish bar runs before it publishes.
// `save.save` must be referentially stable, or every render re-registers.
function useRegisterDirtyGuard(
  isDirty: boolean,
  confirmDiscard: ConfirmDiscardFn,
  save?: ComposerSave
) {
  const store = useContext(DirtyStoreContext)
  const run = save?.save
  const blockedReason = save?.blockedReason ?? null
  const saving = save?.saving ?? false
  useEffect(() => {
    store?.set({
      isDirty,
      confirmDiscard,
      save: run ? { save: run, blockedReason, saving } : null,
    })
    return () => store?.set(CLEAN_GATE)
  }, [store, isDirty, confirmDiscard, run, blockedReason, saving])
}

// The list uses this before a selection change: true if it is safe to navigate
// (clean, or the user confirmed discarding). Imperative — does NOT subscribe.
function useDirtyGate(): () => Promise<boolean> {
  const store = useContext(DirtyStoreContext)
  return useCallback(async () => {
    if (!store) return true
    if (!store.getIsDirty()) return true
    return store.confirmDiscard()
  }, [store])
}

// The auto-select effect uses this to read dirtiness at decision time without
// subscribing (no re-render churn on the list).
function useReadIsDirty(): () => boolean {
  const store = useContext(DirtyStoreContext)
  return useCallback(() => (store ? store.getIsDirty() : false), [store])
}

// The action bar subscribes reactively so Publish disables the moment the
// composer becomes dirty; only this consumer re-renders (not the list).
function useIsDirty(): boolean {
  const store = useContext(DirtyStoreContext)
  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    () => (store ? store.getIsDirty() : false),
    () => false
  )
}

// The publish bar's view of the composer's save: null unless the composer
// offered one (unsaved edits, or a saved draft that was never checked).
function useComposerSave(): ComposerSave | null {
  const store = useContext(DirtyStoreContext)
  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    () => (store ? store.getSave() : null),
    () => null
  )
}

export {
  DirtyGuardProvider,
  useComposerSave,
  useAskDiscardConfirm,
  useRegisterDirtyGuard,
  useDirtyGate,
  useReadIsDirty,
  useIsDirty,
}
