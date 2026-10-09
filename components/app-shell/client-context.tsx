"use client"

import * as React from "react"

import { clientScopeCookie } from "@/lib/clients/scope"

/**
 * Which client the current page belongs to, if any.
 *
 * The shell's health chip and its reconnect banner are client-scoped: on a
 * client hub or a location workspace they report THAT client, and on an
 * org-wide page they report the roll-up. Only the routed layouts know which
 * case they are, so they declare it with `ClientScopeProvider`.
 *
 * The chip and the banner are drawn by the shell, ABOVE the routed page in
 * the tree, so a plain context set by the page never reached them. The
 * provider therefore does two things: it provides the id to everything
 * beneath it, and it reports the id up to the shell's registry
 * (`ClientScopeRoot`), which is what `useClientScope` reads when there is no
 * provider above the caller.
 *
 * The root also holds the two parts of the top-bar client switcher's state
 * that are not in the address (see lib/clients/scope.ts): the remembered
 * client, and the handler a page registers when it must apply a client
 * change itself (the Inbox, whose unsaved-reply guard has to run first).
 */
const ClientScopeContext = React.createContext<string | null | undefined>(
  undefined
)

/**
 * Applies a switcher choice on the page's behalf. Resolves false when the
 * page declined (the operator kept an unsaved reply); the switcher then
 * leaves the preference as it was.
 */
export type ClientScopeHandler = (clientId: string | null) => Promise<boolean>

/** At most one page handler at a time: the routed page that is mounted. */
class HandlerSlot {
  private handler: ClientScopeHandler | null = null
  current = () => this.handler
  register = (handler: ClientScopeHandler) => {
    this.handler = handler
    return () => {
      if (this.handler === handler) this.handler = null
    }
  }
}

type Registry = {
  scoped: string | null
  setScoped: (clientId: string | null) => void
  remembered: string | null
  setRemembered: (clientId: string | null) => void
  handlers: HandlerSlot
}

const RegistryContext = React.createContext<Registry | null>(null)

/**
 * Mounted once by the shell, around both its chrome and the routed page.
 * `rememberedClientId` is the cookie as the server read it, so the first
 * client render agrees with the server's HTML.
 */
function ClientScopeRoot({
  rememberedClientId = null,
  children,
}: {
  rememberedClientId?: string | null
  children: React.ReactNode
}) {
  const [scoped, setScoped] = React.useState<string | null>(null)
  const [remembered, setRememberedState] = React.useState<string | null>(
    rememberedClientId
  )
  const [handlers] = React.useState(() => new HandlerSlot())
  const setRemembered = React.useCallback((clientId: string | null) => {
    setRememberedState(clientId)
    document.cookie = clientScopeCookie(clientId)
  }, [])
  const value = React.useMemo(
    () => ({ scoped, setScoped, remembered, setRemembered, handlers }),
    [scoped, remembered, setRemembered, handlers]
  )
  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  )
}

function ClientScopeProvider({
  clientId,
  children,
}: {
  clientId: string | null
  children: React.ReactNode
}) {
  const setScoped = React.useContext(RegistryContext)?.setScoped
  React.useEffect(() => {
    if (!setScoped) return
    setScoped(clientId)
    return () => setScoped(null)
  }, [setScoped, clientId])

  return (
    <ClientScopeContext.Provider value={clientId}>
      {children}
    </ClientScopeContext.Provider>
  )
}

function useClientScope(): string | null {
  const own = React.useContext(ClientScopeContext)
  const registry = React.useContext(RegistryContext)
  return own !== undefined ? own : (registry?.scoped ?? null)
}

/** The client the routed page declared, whatever provider is above the caller. */
function usePageClientScope(): string | null {
  return React.useContext(RegistryContext)?.scoped ?? null
}

const NO_REMEMBERED = {
  remembered: null,
  setRemembered: () => {},
} as const

/** The remembered client and its setter; inert outside the shell. */
function useRememberedClient(): {
  remembered: string | null
  setRemembered: (clientId: string | null) => void
} {
  return React.useContext(RegistryContext) ?? NO_REMEMBERED
}

/**
 * Lets a page apply the switcher's choice itself. The latest handler is
 * kept in a ref, so a page may pass a fresh closure every render. Only one
 * page is mounted at a time, so one slot is enough.
 */
function useClientScopeHandler(handler: ClientScopeHandler) {
  const handlers = React.useContext(RegistryContext)?.handlers
  const latest = React.useRef(handler)
  React.useEffect(() => {
    latest.current = handler
  })
  React.useEffect(
    () => handlers?.register((clientId) => latest.current(clientId)),
    [handlers]
  )
}

/**
 * The switcher's way in: returns the mounted page's handler, or null when
 * the page has none and the switcher navigates by itself.
 */
function usePageScopeHandler(): () => ClientScopeHandler | null {
  const handlers = React.useContext(RegistryContext)?.handlers
  return React.useCallback(() => handlers?.current() ?? null, [handlers])
}

export {
  ClientScopeProvider,
  ClientScopeRoot,
  useClientScope,
  useClientScopeHandler,
  usePageScopeHandler,
  usePageClientScope,
  useRememberedClient,
}
