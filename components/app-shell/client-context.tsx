"use client"

import * as React from "react"

/**
 * Which client the current page belongs to, if any.
 *
 * The shell's health chip and its reconnect banner are client-scoped: on a
 * client hub or a location workspace they report THAT client, and on an
 * org-wide page they report the roll-up. Only the routed layouts know which
 * case they are, so they declare it here.
 */
const ClientScopeContext = React.createContext<string | null>(null)

function ClientScopeProvider({
  clientId,
  children,
}: {
  clientId: string | null
  children: React.ReactNode
}) {
  return (
    <ClientScopeContext.Provider value={clientId}>
      {children}
    </ClientScopeContext.Provider>
  )
}

function useClientScope() {
  return React.useContext(ClientScopeContext)
}

export { ClientScopeProvider, useClientScope }
