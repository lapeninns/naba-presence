/**
 * Options for a query whose read reaches Google live (hours, profile, menus,
 * place actions, business information, photos, posts). Each such read costs
 * seconds and Google quota, so leaving the tab and coming back must not
 * repeat it (W5-07): the data stays fresh for five minutes and a focus
 * return never refetches. A write still refreshes it (its mutation
 * invalidates the key), and so do the tabs' own Refresh actions.
 */
export const GOOGLE_LIVE_READ = {
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
} as const
