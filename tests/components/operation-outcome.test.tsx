import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { OperationOutcomeNotice } from "@/components/ui/operation-outcome"
import { PublishSteps } from "@/components/ui/publish-steps"
import {
  OPERATION_OUTCOMES,
  operationOutcomeSchema,
} from "@/lib/contracts/mutation-operations"
import {
  describeOutcome,
  OUTCOME_PRESENTATION,
  outcomeToast,
  successToastFields,
} from "@/lib/editors/outcome"

const EXPECTED = {
  saved_locally: { label: "Saved here", toast: "success" },
  sent: { label: "Sent to Google", toast: "info" },
  awaiting_confirmation: { label: "Waiting for Google", toast: "info" },
  confirmed_applied: { label: "Live on Google", toast: "success" },
  rejected: { label: "Rejected by Google", toast: "error" },
  failed: { label: "Failed", toast: "error" },
  uncertain: { label: "Not confirmed", toast: "warning" },
} as const

describe("operation outcome vocabulary", () => {
  it("has exactly the seven shared states, each with copy", () => {
    expect(OPERATION_OUTCOMES).toEqual(Object.keys(EXPECTED))
    expect(Object.keys(OUTCOME_PRESENTATION).sort()).toEqual(
      [...OPERATION_OUTCOMES].sort()
    )
    expect(operationOutcomeSchema.safeParse("live").success).toBe(false)
    expect(operationOutcomeSchema.safeParse("sent").success).toBe(true)
  })

  it.each(OPERATION_OUTCOMES)("words %s as the product promises", (outcome) => {
    const presentation = describeOutcome(outcome)
    expect(presentation.label).toBe(EXPECTED[outcome].label)
    expect(presentation.toast).toBe(EXPECTED[outcome].toast)
    expect(presentation.title.length).toBeGreaterThan(0)
    expect(presentation.description.length).toBeGreaterThan(0)
  })

  it("calls only confirmed_applied live, and nothing short of it published", () => {
    for (const outcome of OPERATION_OUTCOMES) {
      const { label, title, description, live } = describeOutcome(outcome)
      const words = `${label} ${title} ${description}`
      const confirmed = outcome === "confirmed_applied"
      expect(live).toBe(confirmed)
      expect(/live on google/i.test(words)).toBe(confirmed)
      if (!confirmed) expect(words).not.toMatch(/published/i)
    }
  })

  it("never lets an override turn a sent write into a success toast", () => {
    expect(outcomeToast({ outcome: "sent", title: "Menu sent" })).toEqual({
      title: "Menu sent",
      description: undefined,
      type: "info",
    })
    expect(outcomeToast({ outcome: "uncertain" }).type).toBe("warning")
    expect(successToastFields("Post deleted")).toEqual({
      title: "Post deleted",
      description: undefined,
      type: "success",
    })
  })
})

describe("OperationOutcomeNotice", () => {
  it.each(OPERATION_OUTCOMES)(
    "reports %s politely with its default words",
    (outcome) => {
      render(<OperationOutcomeNotice outcome={outcome} />)
      const notice = screen.getByRole("status")
      expect(notice).toHaveAttribute("aria-live", "polite")
      expect(notice).toHaveAttribute("data-outcome", outcome)
      expect(notice).toHaveTextContent(describeOutcome(outcome).title)
      expect(notice).toHaveTextContent(describeOutcome(outcome).description)
    }
  )

  it("carries a retry or reconcile action and caller overrides", () => {
    render(
      <OperationOutcomeNotice
        outcome="uncertain"
        title="Sunday hours not confirmed"
        action={<button type="button">Check Google</button>}
      />
    )
    const notice = screen.getByRole("status")
    expect(notice).toHaveTextContent("Sunday hours not confirmed")
    expect(
      within(notice).getByRole("button", { name: "Check Google" })
    ).toBeInTheDocument()
  })
})

describe("PublishSteps with outcome states", () => {
  it("shows each outcome's word and 'Live on Google' only for a confirmed step", () => {
    render(
      <PublishSteps
        aria-label="Results"
        steps={OPERATION_OUTCOMES.map((outcome) => ({
          id: outcome,
          label: `Step ${outcome}`,
          state: outcome,
        }))}
      />
    )
    const list = screen.getByRole("list", { name: "Results" })
    for (const outcome of OPERATION_OUTCOMES) {
      const row = list.querySelector(`[data-state=${outcome}]`) as HTMLElement
      expect(row).toHaveTextContent(EXPECTED[outcome].label)
    }
    expect(within(list).getAllByText("Live on Google")).toHaveLength(1)
  })
})
