/**
 * Hands the address typed on the sign-in form to Forgot password without
 * putting it in the URL, where it would land in server logs and browser
 * history. Session storage is per tab and cleared when the tab closes; the
 * reset form clears it once a link has been requested.
 */
const KEY = "naba:reset-email"

export function stashResetEmail(email: string) {
  try {
    if (email) window.sessionStorage.setItem(KEY, email)
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the reset form simply starts empty.
  }
}

/** The handed-over address, or "" (also on the server and when blocked). */
export function peekResetEmail(): string {
  try {
    return window.sessionStorage.getItem(KEY) ?? ""
  } catch {
    return ""
  }
}

export function clearResetEmail() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
