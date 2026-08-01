"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

type Gate = { isDirty: boolean; confirmDiscard: () => boolean }

class DirtyStore {
  private gate: Gate = { isDirty: false, confirmDiscard: () => true }
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
const NOOP_SUBSCRIBE = () => () => {}

function DirtyGuardProvider({ children }: { children: ReactNode }) {
  // Lazy `useState` initializer, not a ref: it creates the store exactly once
  // per mount (the setter is never called, so this never re-renders) without
  // touching a ref's `.current` during render.
  const [store] = useState(() => new DirtyStore())
  return (
    <DirtyStoreContext.Provider value={store}>
      {children}
    </DirtyStoreContext.Provider>
  )
}

// The composer publishes its live dirtiness + confirm into the shared store.
function useRegisterDirtyGuard(isDirty: boolean, confirmDiscard: () => boolean) {
  const store = useContext(DirtyStoreContext)
  useEffect(() => {
    store?.set({ isDirty, confirmDiscard })
    return () => store?.set({ isDirty: false, confirmDiscard: () => true })
  }, [store, isDirty, confirmDiscard])
}

// The list uses this before a selection change: true if it is safe to navigate
// (clean, or the user confirmed discarding). Imperative — does NOT subscribe.
function useDirtyGate(): () => boolean {
  const store = useContext(DirtyStoreContext)
  return useCallback(() => {
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
  useRegisterDirtyGuard,
  useDirtyGate,
  useReadIsDirty,
  useIsDirty,
}
