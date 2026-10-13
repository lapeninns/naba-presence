"use client"

import {
  ScopeSelect,
  scopeFieldInRowClassName,
  scopeTriggerInRowClassName,
} from "@/components/performance/scope-select"
import type { ClientSummary } from "@/lib/contracts/clients"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * Which client a report covers (the scope's `Client` field).
 *
 * Reports were organisation-wide only, which for an agency means every number
 * is an average across businesses that have nothing to do with each other.
 * The one number an account manager needs is their client's.
 *
 * Nothing renders in business mode (a business has no client layer) or when
 * there are no clients to pick from.
 */
export function ClientSelect({
  clients,
  value,
  onChange,
  className = scopeFieldInRowClassName,
  triggerClassName = scopeTriggerInRowClassName,
}: {
  clients: ClientSummary[]
  value: string | undefined
  onChange: (clientId: string | undefined) => void
  className?: string
  triggerClassName?: string
}) {
  const business = useWorkspaceMode() === "business"
  if (business || clients.length === 0) return null

  return (
    <ScopeSelect
      label="Client"
      allLabel="All clients"
      value={value}
      onChange={onChange}
      options={clients.map((client) => ({ id: client.id, label: client.name }))}
      className={className}
      triggerClassName={triggerClassName}
    />
  )
}
