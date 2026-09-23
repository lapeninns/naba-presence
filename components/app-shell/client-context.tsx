"use client"

import * as React from "react"

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
 */
const ClientScopeContext = React.createContext<string | null | undefined>(
  undefined
)

type Registry = {
  scoped: string | null
  setScoped: (clientId: string | null) => void
}

const RegistryContext = React.createContext<Registry | null>(null)

/** Mounted once by the shell, around both its chrome and the routed page. */
function ClientScopeRoot({ children }: { children: React.ReactNode }) {
  const [scoped, setScoped] = React.useState<string | null>(null)
  const value = React.useMemo(() => ({ scoped, setScoped }), [scoped])
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

export { ClientScopeProvider, ClientScopeRoot, useClientScope }
