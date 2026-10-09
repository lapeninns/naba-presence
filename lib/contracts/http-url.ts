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
        const url = URL.parse(value)
        return url !== null && (url.protocol === "http:" || url.protocol === "https:")
      },
      { message }
    )
    .refine(
      (value) => {
        const url = URL.parse(value)
        return url !== null && url.username === "" && url.password === ""
      },
      { message: "Links cannot contain a user name or password." }
    )
}
