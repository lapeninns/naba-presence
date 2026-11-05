import { expect, type Page } from "@playwright/test"
import { mediaQuery } from "@/lib/ui/breakpoints"

/** Open one section on a phone, where the profile starts at the index. */
export async function openProfileSectionOnPhone(page: Page, label: string) {
  if (
    await page.evaluate((query) => matchMedia(query).matches, mediaQuery("md"))
  )
    return

  const navigation = page.getByRole("navigation", { name: "Profile sections" })
  await expect(navigation).toBeVisible()
  const index = navigation.getByRole("link", {
    name: "All sections",
    exact: true,
  })
  if (await index.isVisible()) await index.click()
  await navigation
    .getByRole("button")
    .filter({ has: page.getByText(label, { exact: true }) })
    .click()
}
