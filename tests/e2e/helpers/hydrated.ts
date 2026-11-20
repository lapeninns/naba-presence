import { expect, type Locator } from "@playwright/test"

/**
 * Waits until React has hydrated `locator`'s element, so its event handlers
 * are attached. A server-rendered control is visible and clickable before
 * then, but a press does nothing: on a loaded gate that window lasts seconds
 * (lifecycle-backend's "Transfer this location", 2026-11-20). React marks
 * each DOM node it owns with a `__reactProps$<id>` property.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(
      () =>
        locator.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps$"))
        ),
      { message: "the element was never hydrated by React" }
    )
    .toBe(true)
}
