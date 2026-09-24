export type ImportSourceAccount = {
  googleAccountName: string
  accountName: string
  isActive: boolean
  googleConnectionId?: string | null
}

export type ImportSource = {
  /** The active accounts this login reaches, in the order Google listed them. */
  activeAccounts: ImportSourceAccount[]
  /** The account whose locations are shown, or null when there is none. */
  accountName: string | null
}

/**
 * Which account's locations the import list shows. The account list covers
 * the whole organisation, so it is narrowed to the working login first. The
 * operator's choice wins while it is still active; otherwise the first
 * active account is shown, so a login with several accounts is never stuck
 * on "choose an account" with nothing to choose from.
 */
export function resolveImportSource(input: {
  accounts: ImportSourceAccount[]
  connectionId: string | null
  chosenAccountName: string | null
}): ImportSource {
  const activeAccounts = input.accounts.filter(
    (account) =>
      account.isActive &&
      (input.connectionId === null ||
        account.googleConnectionId == null ||
        account.googleConnectionId === input.connectionId)
  )
  const chosen = activeAccounts.find(
    (account) => account.googleAccountName === input.chosenAccountName
  )
  return {
    activeAccounts,
    accountName:
      chosen?.googleAccountName ?? activeAccounts[0]?.googleAccountName ?? null,
  }
}
