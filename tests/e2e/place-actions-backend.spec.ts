import { expect, test, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { startPlaceActionsBackend } from "./helpers/place-actions-backend"
import { captureServicesPanel } from "./helpers/services-capture"
import { seedMemberUser } from "../integration/helpers/tenant"
import { JOURNEY_WIDTH, LAYOUT_WIDTHS, viewportAt } from "./helpers/widths"
let backend: Awaited<ReturnType<typeof startPlaceActionsBackend>>
// The sheet is titled as a review until a request is recorded, then as its outcome.
const actionLinkSheet =
  /^(Review booking link change|Saved booking link outcome)$/
test.beforeAll(async () => {
  backend = await startPlaceActionsBackend()
})
test.afterAll(async () => {
  await backend.stop()
})
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === backend.server.baseUrl
      ? route.continue()
      : route.abort("blockedbyclient")
  )
})
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  scope = '[role="dialog"]'
) {
  // Let open/close transitions settle first: a closing confirmation overlay
  // over an opening sheet fades the text axe samples.
  await expect(
    page.locator("[data-starting-style], [data-ending-style]")
  ).toHaveCount(0)
  expect(
    (await new AxeBuilder({ page }).include(scope).analyze()).violations
  ).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    animations: "disabled",
  })
}
async function prepare(page: Page) {
  await page
    .getByRole("textbox", { name: "Link", exact: true })
    .fill("https://shop.example.test/products")
  await page
    .getByRole("button", { name: "Review booking link", exact: true })
    .click()
  return page.getByRole("dialog", { name: actionLinkSheet })
}
// Each state journey runs once, at JOURNEY_WIDTH. The three tests that reach
// this screen's distinct layouts (the editor and review sheet, the stacked
// drift diff, the managed-links rows with their overflow menus) also run at
// every layout width, and the empty-set handoff runs at the phone width too,
// where "Check Google now" moves into the status pill's sheet.
for (const width of [JOURNEY_WIDTH, ...LAYOUT_WIDTHS])
  test.describe(`Reviewed booking links at ${width}px`, () => {
    test.use({ viewport: viewportAt(width) })
    const journeyOnly = width === JOURNEY_WIDTH
    test("reads provider-supported retail action types and prepares approval before a single independently confirmed create", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page)
      await f.open()
      // The review action is docked once a link is typed.
      await expect(
        page.getByRole("button", { name: "Review booking link", exact: true })
      ).toHaveCount(0)
      await page
        .getByRole("textbox", { name: "Link", exact: true })
        .fill("https://shop.example.test/products")
      await expect(
        page.getByRole("button", { name: "Review booking link", exact: true })
      ).toBeEnabled()
      await captureServicesPanel(
        page,
        info,
        "retail-action-editor",
        "#section-action-links"
      )
      const dialog = await prepare(page)
      // The raw Google resource name sits behind "Details for support".
      await dialog.getByText("Details for support", { exact: true }).click()
      await expect(
        dialog.getByText("Google target:", { exact: false })
      ).toBeVisible()
      await capture(page, info, "review")
      expect(f.writes()).toHaveLength(0)
      await dialog
        .getByRole("button", {
          name: "Approve booking link change",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
      ).toBeDisabled()
      expect(f.writes()).toHaveLength(0)
      await dialog
        .getByRole("checkbox", {
          name: "Send this exact approved booking link change to Google.",
        })
        .check()
      await capture(page, info, "approved-consent")
      await dialog
        .getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByText("Accepted by Google", { exact: true })
      ).toBeVisible()
      await expect(
        dialog.getByText("Independently confirmed", { exact: true })
      ).toBeVisible()
      await expect(dialog.locator("time").last()).toBeVisible()
      expect(f.writes()).toHaveLength(1)
      expect(f.state.links[0]).toMatchObject({
        uri: "https://shop.example.test/products",
        placeActionType: "SHOP_ONLINE",
      })
      await capture(page, info, "confirmed")
    })
    test("blocks provider metadata drift after approval without a write", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page)
      await f.open()
      const dialog = await prepare(page)
      await dialog
        .getByRole("button", {
          name: "Approve booking link change",
          exact: true,
        })
        .click()
      await dialog.getByRole("checkbox").check()
      f.state.types = ["APPOINTMENT"]
      await dialog
        .getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
        .click()
      await expect(dialog.getByRole("alert")).toBeVisible()
      expect(f.writes()).toHaveLength(0)
      await expect(
        dialog.getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
      ).toBeDisabled()
      // Under 560px the diff stacks and drops its header row, so check the
      // label each value carries at every width.
      await expect(
        dialog.locator('td[data-label="Before (reviewed)"]').first()
      ).toBeVisible()
      await expect(
        dialog.locator('td[data-label="On Google now"]')
      ).toHaveCount(0)
      await capture(page, info, "metadata-drift")
    })
    if (journeyOnly)
      test("recovers a lost response and discovers its expired saved outcome while disconnected", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page)
      await f.open()
      const dialog = await prepare(page)
      await dialog
        .getByRole("button", {
          name: "Approve booking link change",
          exact: true,
        })
        .click()
      await dialog.getByRole("checkbox").check()
      let lost = false
      await page.route(
        `**/api/locations/${f.linked.locationId}/place-action-reviews/*/execute`,
        async (route) => {
          if (route.request().method() === "POST" && !lost) {
            lost = true
            await route.fetch()
            await route.abort("failed")
          } else await route.continue()
        }
      )
      await dialog
        .getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByText(/The send response is unavailable/)
      ).toBeVisible()
      await expect(
        dialog.getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
      ).toHaveCount(0)
      await expect(
        dialog.getByRole("button", {
          name: "Read saved booking link outcome",
          exact: true,
        })
      ).toBeEnabled()
      await expect(
        dialog.getByRole("button", { name: "Keep editing", exact: true })
      ).toBeEnabled()
      await capture(page, info, "lost-response")
      await dialog
        .getByRole("button", {
          name: "Read saved booking link outcome",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByText("Independently confirmed", { exact: true })
      ).toBeVisible()
      expect(f.writes()).toHaveLength(1)
      const reviewId = await f.reviewId("place_action")
      await backend.admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${reviewId}`
      await f.disconnect()
      await page.reload()
      const saved = page.getByRole("region", {
        name: "Saved booking link work",
        exact: true,
      })
      await expect(
        saved.getByRole("button", {
          name: "Open booking link outcome",
          exact: true,
        })
      ).toBeEnabled()
      await expect(
        saved.getByText("Add Shop online link", { exact: true })
      ).toBeVisible()
      await captureServicesPanel(
        page,
        info,
        "disconnected-saved-index",
        '[aria-label="Saved booking link work"]'
      )
      await saved
        .getByRole("button", { name: "Open booking link outcome", exact: true })
        .click()
      await expect(
        page
          .getByRole("dialog")
          .getByText("Independently confirmed", { exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("dialog").getByText(/fresh preview|Approval expired/)
      ).toHaveCount(0)
      await capture(page, info, "expired-disconnected-outcome")
      expect(f.writes()).toHaveLength(1)
    })
    if (journeyOnly)
      test("preserves unknown acknowledgement, blocks further writes, then confirms through a separate observation", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page)
      await f.open()
      const dialog = await prepare(page)
      await dialog
        .getByRole("button", {
          name: "Approve booking link change",
          exact: true,
        })
        .click()
      await dialog.getByRole("checkbox").check()
      f.state.status = 503
      f.state.apply = false
      await dialog
        .getByRole("button", {
          name: "Send approved booking link change",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByText("Google acknowledgement unknown", { exact: true })
      ).toBeVisible()
      await expect(
        dialog.getByText("Independent confirmation unresolved", { exact: true })
      ).toBeVisible()
      await capture(page, info, "unknown-unresolved")
      await dialog
        .getByRole("button", { name: "Keep editing", exact: true })
        .click()
      // Changes are paused: no review action is offered until the saved
      // outcome has been read.
      await expect(
        page.getByRole("button", { name: "Review booking link", exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByText("Booking link changes are paused", { exact: true })
      ).toBeVisible()
      await captureServicesPanel(
        page,
        info,
        "unresolved-editor",
        "#section-action-links"
      )
      await page
        .getByRole("button", { name: "Open booking link outcome", exact: true })
        .click()
      f.state.links.push({
        name: `${f.linked.googleLocationName}/placeActionLinks/recovered`,
        providerType: "MERCHANT",
        isEditable: true,
        uri: "https://shop.example.test/products",
        placeActionType: "SHOP_ONLINE",
        isPreferred: false,
      })
      await dialog
        .getByRole("button", {
          name: "Refresh booking link observation",
          exact: true,
        })
        .click()
      await expect(
        dialog.getByText("Independently confirmed", { exact: true })
      ).toBeVisible()
      await expect(
        dialog.getByText("Google acknowledgement unknown", { exact: true })
      ).toBeVisible()
      await capture(page, info, "unknown-confirmed")
      expect(f.writes()).toHaveLength(1)
    })
    if (width !== 768)
      test("shows an observed empty action set and hands unknown future action types to Google", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page)
      f.state.types = []
      await f.open()
      await expect(
        page.getByRole("heading", {
          name: "Google doesn’t offer booking links for this listing",
          exact: true,
        })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Review booking link", exact: true })
      ).toHaveCount(0)
      await captureServicesPanel(
        page,
        info,
        "empty-observed-types",
        "#section-action-links"
      )
      f.state.types = ["FUTURE_ACTION"]
      // Within the editors' staleness budget a reload serves the stored
      // observation (W3-2); "Check Google now" reads the new types. Under
      // 768px it sits in the status pill's sheet (L03).
      if (width < 768)
        await page
          .getByRole("button", { name: /how changes reach Google$/i })
          .click()
      await page
        .getByRole("button", { name: "Check Google now", exact: true })
        .click()
      if (width < 768) await page.keyboard.press("Escape")
      await expect(
        page.getByRole("link", {
          name: "Manage booking links in Google",
          exact: true,
        })
      ).toHaveAttribute("href", "https://business.google.com/")
      await expect(
        page.getByRole("button", { name: "Review booking link", exact: true })
      ).toHaveCount(0)
      await captureServicesPanel(
        page,
        info,
        "unknown-type-handoff",
        "#section-action-links"
      )
      expect(f.writes()).toHaveLength(0)
    })
    test("edits, prefers and removes merchant links through separate reviews while provider and future-type links stay read-only", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page),
        base = `${f.linked.googleLocationName}/placeActionLinks`
      f.state.links.push(
        {
          name: `${base}/first`,
          providerType: "MERCHANT",
          isEditable: true,
          uri: "https://shop.example.test/first",
          placeActionType: "SHOP_ONLINE",
          isPreferred: true,
        },
        {
          name: `${base}/second`,
          providerType: "MERCHANT",
          isEditable: true,
          uri: "https://shop.example.test/second",
          placeActionType: "SHOP_ONLINE",
          isPreferred: false,
        },
        {
          name: `${base}/partner`,
          providerType: "AGGREGATOR_3P",
          isEditable: false,
          uri: "https://partner.example.test/book",
          placeActionType: "SHOP_ONLINE",
          isPreferred: false,
        },
        {
          name: `${base}/future`,
          providerType: "AGGREGATOR_3P",
          isEditable: false,
          uri: "https://future.example.test/action",
          placeActionType: "FUTURE_ACTION_TYPE",
          isPreferred: false,
        }
      )
      await f.open()
      const managed = page.getByRole("region", {
        name: "Managed in Google",
        exact: true,
      })
      await expect(
        managed.getByText("https://future.example.test/action", { exact: true })
      ).toBeVisible()
      await expect(
        managed.getByRole("link", {
          name: "Manage these links in Google",
          exact: true,
        })
      ).toHaveAttribute("href", "https://business.google.com/")
      await expect(
        page.getByText("Added by a booking provider · can’t be edited here")
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: /Edit the Shop online link/ })
      ).toHaveCount(2)
      await captureServicesPanel(
        page,
        info,
        "managed-links-editor",
        "#section-action-links"
      )
      const sheet = page.getByRole("dialog", { name: actionLinkSheet })
      async function approveAndSend() {
        await sheet
          .getByRole("button", {
            name: "Approve booking link change",
            exact: true,
          })
          .click()
        await sheet
          .getByRole("checkbox", {
            name: "Send this exact approved booking link change to Google.",
          })
          .check()
        await sheet
          .getByRole("button", {
            name: "Send approved booking link change",
            exact: true,
          })
          .click()
        await expect(
          sheet.getByText("Independently confirmed", { exact: true })
        ).toBeVisible()
        await expect(
          sheet.getByRole("button", {
            name: "Refresh booking link observation",
            exact: true,
          })
        ).toHaveCount(0)
      }
      // The one link that is not yet preferred offers "Make preferred" in
      // its row's overflow menu.
      await page
        .getByRole("listitem")
        .filter({ hasNot: page.getByText("Preferred", { exact: true }) })
        .getByRole("button", {
          name: "More actions for the Shop online link",
          exact: true,
        })
        .click()
      await page
        .getByRole("menuitem", { name: "Make preferred", exact: true })
        .click()
      await page
        .getByRole("button", {
          name: "Prepare preferred link review",
          exact: true,
        })
        .click()
      const preferredRow = sheet
        .getByRole("row")
        .filter({
          has: page.getByRole("rowheader", { name: "Preferred", exact: true }),
        })
      await expect(preferredRow.getByRole("deletion")).toHaveText("No")
      await expect(preferredRow.getByRole("insertion")).toHaveText("Yes")
      await capture(page, info, "preferred-review")
      expect(f.writes()).toHaveLength(0)
      await approveAndSend()
      expect(f.writes().map((call) => call.method)).toEqual(["PATCH"])
      await capture(page, info, "preferred-confirmed")
      await sheet
        .getByRole("button", { name: "Keep editing", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Edit the Shop online link", exact: true })
        .first()
        .click()
      const edit = page.getByRole("dialog", {
        name: "Edit Shop online link",
        exact: true,
      })
      await edit
        .getByRole("textbox", { name: "Link", exact: true })
        .fill("https://shop.example.test/first-updated")
      await edit
        .getByRole("button", {
          name: "Review booking link change",
          exact: true,
        })
        .click()
      await expect(
        sheet.getByText("https://shop.example.test/first-updated", {
          exact: true,
        })
      ).toBeVisible()
      await approveAndSend()
      expect(f.writes().map((call) => call.method)).toEqual(["PATCH", "PATCH"])
      await sheet
        .getByRole("button", { name: "Keep editing", exact: true })
        .click()
      await page
        .getByRole("button", {
          name: "More actions for the Shop online link",
          exact: true,
        })
        .last()
        .click()
      await page
        .getByRole("menuitem", { name: "Remove link", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Prepare removal review", exact: true })
        .click()
      await expect(
        sheet.getByText("Remove this link", { exact: true })
      ).toBeVisible()
      await capture(page, info, "removal-review")
      await approveAndSend()
      expect(f.writes().map((call) => call.method)).toEqual([
        "PATCH",
        "PATCH",
        "DELETE",
      ])
      expect(f.state.links.map((link) => link.name)).toEqual(
        expect.arrayContaining([`${base}/partner`, `${base}/future`])
      )
      await expect(
        page.getByRole("dialog", { name: "Saved booking link outcome" })
      ).toBeVisible()
      await expect(
        sheet.getByText("Remove this link", { exact: true })
      ).toHaveCount(0)
      await expect(sheet.getByText("Removed", { exact: true })).toBeVisible()
      await capture(page, info, "removal-confirmed")
    })
    if (journeyOnly)
      test("shows a failed review preparation inside the dialog that started it", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page),
        name = `${f.linked.googleLocationName}/placeActionLinks/gone`
      f.state.links.push({
        name,
        providerType: "MERCHANT",
        isEditable: true,
        uri: "https://shop.example.test/gone",
        placeActionType: "SHOP_ONLINE",
        isPreferred: false,
      })
      await f.open()
      const moreActions = page.getByRole("button", {
        name: "More actions for the Shop online link",
        exact: true,
      })
      await expect(moreActions).toBeEnabled()
      // Google drops the link after the page has read it.
      f.state.links = []
      await moreActions.click()
      await page
        .getByRole("menuitem", { name: "Remove link", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Prepare removal review", exact: true })
        .click()
      const confirm = page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .filter({ hasText: "Review removing this booking link?" })
      await expect(confirm.getByRole("alert")).toContainText(
        "Google no longer lists this action link"
      )
      await capture(
        page,
        info,
        "preparation-failure-in-dialog",
        '[role="alertdialog"]'
      )
      expect(f.writes()).toHaveLength(0)
    })
    if (journeyOnly)
      test("a second manager approves by keyboard and a revoked approver blocks sending without a write", async ({
      page,
    }, info) => {
      const f = await backend.actionFixture(page)
      await backend.admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
      await f.open()
      const link = page.getByRole("textbox", { name: "Link", exact: true })
      await link.focus()
      await page.keyboard.type("https://shop.example.test/keyboard")
      await page.keyboard.press("Enter")
      const sheet = page.getByRole("dialog", { name: actionLinkSheet })
      await expect(
        sheet.getByText(
          "A different current owner or administrator must approve this exact change.",
          { exact: true }
        )
      ).toBeVisible()
      await expect(
        sheet.getByRole("button", {
          name: "Approve booking link change",
          exact: true,
        })
      ).toBeDisabled()
      await capture(page, info, "second-approver-required")
      const second = await seedMemberUser(backend.admin, {
        organisationId: f.owner.organisationId,
      })
      await backend.admin`update member set role = 'admin', can_publish = true where user_id = ${second.userId}`
      await page.context().clearCookies()
      await page.context().addCookies([
        {
          name: "naba_session",
          value: second.cookie.slice("naba_session=".length),
          url: backend.server.baseUrl,
          httpOnly: true,
          sameSite: "Lax",
        },
      ])
      await f.open()
      const saved = page.getByRole("region", {
        name: "Saved booking link work",
        exact: true,
      })
      await saved
        .getByRole("button", { name: "Open booking link review", exact: true })
        .focus()
      await page.keyboard.press("Enter")
      const approve = sheet.getByRole("button", {
        name: "Approve booking link change",
        exact: true,
      })
      await expect(approve).toBeEnabled()
      await approve.focus()
      await page.keyboard.press("Enter")
      const consent = sheet.getByRole("checkbox", {
        name: "Send this exact approved booking link change to Google.",
      })
      await expect(consent).toBeVisible()
      await consent.focus()
      await page.keyboard.press("Space")
      await expect(consent).toBeChecked()
      await capture(page, info, "second-manager-approved")
      await backend.admin`update member set role = 'viewer', can_publish = false where user_id = ${second.userId}`
      await page.context().clearCookies()
      await page.context().addCookies([
        {
          name: "naba_session",
          value: f.owner.cookie.slice("naba_session=".length),
          url: backend.server.baseUrl,
          httpOnly: true,
          sameSite: "Lax",
        },
      ])
      await f.open()
      await saved
        .getByRole("button", { name: "Open booking link review", exact: true })
        .click()
      await sheet
        .getByRole("checkbox", {
          name: "Send this exact approved booking link change to Google.",
        })
        .check()
      const send = sheet.getByRole("button", {
        name: "Send approved booking link change",
        exact: true,
      })
      await send.focus()
      await page.keyboard.press("Enter")
      await expect(sheet.getByRole("alert")).toBeVisible()
      await expect(send).toBeDisabled()
      await capture(page, info, "revoked-approver-blocked")
      expect(f.writes()).toHaveLength(0)
    })
  })
