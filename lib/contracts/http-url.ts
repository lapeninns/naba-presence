import { z } from "zod"

/** The longest URL a customer-facing field accepts (Google's own limit). */
export const HTTP_URL_MAX_LENGTH = 2048

/**
 * The one schema for a link a person types and Google (or a browser) later
 * follows: an absolute http(s) URL, at most 2048 characters, with no
 * `user:password@` part. `z.url()` alone accepts `javascript:`, `data:`,
 * `ftp:` and embedded credentials, all of which would be published as-is.
 */
export function httpUrl(message = "Use an http or https link.") {
  return z
    .url({ message })
    .max(HTTP_URL_MAX_LENGTH, {
      message: `Links can be at most ${HTTP_URL_MAX_LENGTH} characters.`,
    })
    .refine(
      (value) => {
        const url = parseUrl(value)
        return (
          url !== null &&
          (url.protocol === "http:" || url.protocol === "https:")
        )
      },
      { message }
    )
    .refine(
      (value) => {
        const url = parseUrl(value)
        return url !== null && url.username === "" && url.password === ""
      },
      { message: "Links cannot contain a user name or password." }
    )
}

// These schemas also run in the browser (the profile editor parses its payload
// client-side), and the static `URL.parse` is missing before Safari 18 and
// Chrome 126. Zod runs these refinements even when `z.url()` has already
// failed, so an invalid value must also return null rather than throw.
function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
