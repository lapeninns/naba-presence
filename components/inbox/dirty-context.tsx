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

type ConfirmDiscardFn = () => Promise<boolean>

type Gate = { isDirty: boolean; confirmDiscard: ConfirmDiscardFn }

class DirtyStore {
  private gate: Gate = {
    isDirty: false,
    confirmDiscard: async () => true,
  }
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getIsDirty = () => this.gate.isDirty
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
              <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                Keep editing
              </AlertDialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => settle(true)}
              >
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

// The composer publishes its live dirtiness + confirm into the shared store.
function useRegisterDirtyGuard(
  isDirty: boolean,
  confirmDiscard: ConfirmDiscardFn
) {
  const store = useContext(DirtyStoreContext)
  useEffect(() => {
    store?.set({ isDirty, confirmDiscard })
    return () =>
      store?.set({ isDirty: false, confirmDiscard: async () => true })
  }, [store, isDirty, confirmDiscard])
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

export {
  DirtyGuardProvider,
  useAskDiscardConfirm,
  useRegisterDirtyGuard,
  useDirtyGate,
  useReadIsDirty,
  useIsDirty,
}
