import type { Page } from "@playwright/test"

/**
 * The workspace mode of the page's own session. Read through `page.request`,
 * which shares the page's cookie jar: that bootstraps the local development
 * session in the browser context, so the next `page.goto` renders as a signed
 * in session and not as the anonymous first visit (which reads as agency and
 * skips the business redirects).
 */
export async function pageWorkspaceMode(
  page: Page
): Promise<"business" | "agency" | null> {
  const response = await page.request.get("/api/session")
  if (!response.ok()) return null
  const body = (await response.json()) as {
    session: { workspaceMode?: "business" | "agency" } | null
  }
  return body.session?.workspaceMode ?? null
}
