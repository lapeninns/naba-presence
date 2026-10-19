// Inbox journeys (desktop only: they publish to the local Google stub).
// Modelled on tests/e2e/journeys.spec.ts. Order-tolerant: the queue is opened
// on "All" so a review already replied to by an earlier run is still listed,
// and the primary control may read "Publish reply" or "Update reply".
import { describe, test } from "@e2e-dev/web"
import { expect, unique } from "e2e"

import { readJourneyState, requireLayout, useSessionCookie } from "./support.ts"

// A run-unique tag with no digits: the reply checks treat a long digit run
// (Date.now()) as a phone number and block publishing ("Draft needs a
// correction").
const runTag = () =>
  Date.now()
    .toString(36)
    .replace(/\d/g, (digit) => "abcdefghij"[Number(digit)])

describe("inbox", { tags: ["desktop", "inbox", "mutates"] }, () => {
  test(
    "owner drafts, edits, checks and publishes a reply",
    { session: "owner", timeout: 300_000 },
    async ({ agent, app, browser, screen }) => {
      const state = await readJourneyState()
      await app.open("/inbox?queue=all")
      await requireLayout(browser, "desktop")
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await agent.act(
        "In the review list, open the review that reads {review}",
        {
          params: { review: state.directReview.text },
        }
      )
      const selected = screen.getByRole("region", { name: "Selected review" })
      await expect(
        selected.getByText(state.directReview.text, { exact: true })
      ).toBeVisible()
      const replyBox = screen.getByRole("textbox", { name: "Your reply" })
      await expect(replyBox).toBeVisible()

      // No OpenAI key here, so Generate answers with an error (or is off).
      // One try, then the typed reply below is what the journey publishes.
      await agent.act(
        'Press "Generate reply" (or "Regenerate") once to ask for a suggested reply. This test environment has no AI provider, so a message such as "No reply was generated" is an expected result: the goal is done once you have pressed it, or found it disabled. Do not retry and do not type anything.'
      )
      await expect(replyBox).toBeVisible()

      const reply = `Thank you for your kind review. We are delighted you enjoyed your stay (ref ${runTag()}).`
      await agent.act(
        'Replace whatever is in the "Your reply" box with exactly {reply}',
        {
          params: { reply: unique(reply) },
        }
      )
      await expect(replyBox).toHaveValue(reply)

      const signOff = "We hope to welcome you back soon."
      await agent.act(
        'Edit the reply: add {signOff} to the end of the text in "Your reply", keeping the rest',
        {
          params: { signOff },
        }
      )
      await expect(replyBox).toHaveValue(
        /We are delighted you enjoyed your stay.*We hope to welcome you back soon\.\s*$/s
      )

      // "Verify": the reply status line says the written reply can go out
      // (lib/inbox/reply-state.ts; the publish press runs the check itself).
      await agent.assert(
        'The reply status for the selected review says it is ready to publish, and a "Publish reply" or "Update reply" button is enabled'
      )

      await agent.act(
        'Publish the reply to Google with the "Publish reply" button (it reads "Update reply" if a reply is already live)'
      )
      await expect(
        // "Reply sent" when Google holds the reply for moderation (the stub
        // can answer PENDING); either way it reached Google
        // (lib/inbox/actions.ts describeOutcomeToast).
        screen.getByText(/^Reply (published|sent)$/).first()
      ).toBeVisible({
        timeout: 30_000,
      })
    }
  )

  // A separate two-person-approval organisation: the requester's publish
  // routes to approval, then its owner approves and that publishes. One test,
  // switching cookies mid-way, so it runs alone and needs no ordering.
  test(
    "requester submits for approval, approver approves and it publishes",
    { session: "requester", timeout: 360_000 },
    async ({ agent, app, browser, screen }) => {
      const state = await readJourneyState()
      await app.open("/inbox?queue=all")
      await requireLayout(browser, "desktop")
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })

      await agent.act(
        "In the review list, open the review that reads {review}",
        {
          params: { review: state.approval.text },
        }
      )
      const selected = screen.getByRole("region", { name: "Selected review" })
      await expect(
        selected.getByText(state.approval.text, { exact: true })
      ).toBeVisible()
      const replyBox = screen.getByRole("textbox", { name: "Your reply" })

      const reply = `Thank you for sharing your experience. Our team appreciates your kind feedback (ref ${runTag()}).`
      await agent.act(
        'Replace whatever is in the "Your reply" box with exactly {reply}',
        {
          params: { reply: unique(reply) },
        }
      )
      await expect(replyBox).toHaveValue(reply)

      await agent.act(
        'Send the reply on: press the primary reply button below it ("Publish reply", "Update reply" or "Submit for approval"). This organisation needs approval, so it should be submitted for approval.'
      )
      await expect(
        screen.getByText("Submitted for approval", { exact: true }).first()
      ).toBeVisible({
        timeout: 30_000,
      })

      // The approver (the organisation's owner), in the same browser.
      await useSessionCookie(
        browser,
        app.baseUrl,
        state.approval.approverCookie
      )
      await app.open("/inbox?queue=approval")
      await expect(
        screen.getByRole("heading", { name: "Inbox", level: 1 })
      ).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        screen
          .getByRole("navigation", { name: "Review queues" })
          .getByRole("button", { name: /^Approval/ })
      ).toHaveAttribute("aria-current", "true")

      await agent.act(
        "In the Approval queue, open the review that reads {review}",
        {
          params: { review: state.approval.text },
        }
      )
      await expect(
        selected.getByText(state.approval.text, { exact: true })
      ).toBeVisible()
      await agent.assert(
        "The selected review shows a reply waiting for approval, with an Approve reply button"
      )

      await agent.act('Approve the reply with the "Approve reply" button')
      await expect(
        // "Reply sent" when Google holds the reply for moderation (the stub
        // can answer PENDING); either way it reached Google
        // (lib/inbox/actions.ts describeOutcomeToast).
        screen.getByText(/^Reply (published|sent)$/).first()
      ).toBeVisible({
        timeout: 30_000,
      })
    }
  )
})
