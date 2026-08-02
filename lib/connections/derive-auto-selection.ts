export type AutoSelectionInput = {
  connections: Array<{ id: string; status: string }>
  accounts: Array<{ googleAccountName: string; isActive: boolean }>
  selectedConnectionId: string | null
  selectedAccountName: string | null
}

export type AutoSelection = { connectionId: string | null; accountName: string | null }

export function deriveAutoSelection(input: AutoSelectionInput): AutoSelection {
  const { connections, accounts, selectedConnectionId, selectedAccountName } = input

  const validSelected = connections.find((connection) => connection.id === selectedConnectionId)
  const firstActive = connections.find((connection) => connection.status === "active")
  const connectionId = validSelected?.id ?? firstActive?.id ?? connections[0]?.id ?? null

  const activeAccounts = accounts.filter((account) => account.isActive)
  const selectedStillActive = activeAccounts.some((account) => account.googleAccountName === selectedAccountName)
  const accountName = selectedStillActive
    ? selectedAccountName
    : activeAccounts.length === 1
      ? activeAccounts[0].googleAccountName
      : null

  return { connectionId, accountName }
}
