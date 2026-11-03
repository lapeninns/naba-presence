import { render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  OperationReceiptNotice,
  unconfirmedReceiptId,
} from "@/components/locations/operation-outcome"
import { OperationOutcomeNotice } from "@/components/ui/operation-outcome"
import { ApiClientError } from "@/lib/api/client"
import * as mutationsApi from "@/lib/api/mutations"
import type { MutationReceipt } from "@/lib/api/mutations"
import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import {
  RECEIPT_POLL_DELAYS_MS,
  RECEIPT_POLL_LIMIT,
  receiptPollDelay,
} from "@/lib/queries/use-mutation-receipt"
import { PublishSteps } from "@/components/ui/publish-steps"
import {
  OPERATION_OUTCOMES,
  operationOutcomeSchema,
} from "@/lib/contracts/mutation-operations"
import {
  describeOutcome,
  LIFECYCLE_ONLY_STATES,
  OUTCOME_PRESENTATION,
  type PresentedState,
  statusText,
  outcomeToast,
  successToastFields,
} from "@/lib/editors/outcome"

const EXPECTED = {
  saved_locally: { label: "Draft saved", toast: "success" },
  awaiting_approval: { label: "Awaiting approval", toast: "info" },
  sent: { label: "Sending to Google", toast: "info" },
  awaiting_confirmation: { label: "Sent, waiting for Google", toast: "info" },
  confirmed_applied: { label: "On Google", toast: "success" },
  rejected: { label: "Rejected by Google", toast: "error" },
  failed: { label: "Failed: retry", toast: "error" },
  uncertain: { label: "Not confirmed: check Google", toast: "warning" },
} as const

describe("operation outcome vocabulary", () => {
  it("has exactly the eight shared states, each with copy", () => {
    expect(OPERATION_OUTCOMES).toEqual(Object.keys(EXPECTED))
    // The eight operation outcomes plus the lifecycle states that are not
    // operation outcomes (DIRECTION §6.2), all in the one map.
    expect(Object.keys(OUTCOME_PRESENTATION).sort()).toEqual(
      [...OPERATION_OUTCOMES, ...LIFECYCLE_ONLY_STATES].sort()
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
      expect(label === "On Google" || /confirmed on google/i.test(title)).toBe(
        confirmed
      )
      expect(words).not.toMatch(/\blive\b/i)
      if (!confirmed) expect(words).not.toMatch(/published/i)
    }
  })

  it("words every lifecycle-only state from the vocabulary, never as on Google", () => {
    for (const state of LIFECYCLE_ONLY_STATES) {
      const presentation = describeOutcome(state)
      expect(presentation.live).toBe(false)
      expect(presentation.tone).not.toBe("healthy")
      expect(presentation.toast).not.toBe("success")
      expect(`${presentation.title} ${presentation.description}`).not.toMatch(
        /published|\blive\b|confirmed on google/i
      )
    }
    expect(describeOutcome("blocked").label).toBe("Blocked by checks")
    expect(describeOutcome("changes").label).toBe("Sent back")
    expect(describeOutcome("conflict").label).toBe("Changed on Google")
  })

  it("places each state on the change track as DIRECTION §6.1 says", () => {
    expect(describeOutcome("saved_locally").track).toEqual({ stop: "saved" })
    expect(describeOutcome("awaiting_approval").track).toEqual({
      stop: "approved",
    })
    expect(describeOutcome("sent").track).toEqual({ stop: "sent" })
    expect(describeOutcome("awaiting_confirmation").track).toEqual({
      stop: "google",
    })
    expect(describeOutcome("confirmed_applied").track).toEqual({
      stop: "google",
      reached: true,
    })
    expect(describeOutcome("failed").track).toEqual({
      stop: "sent",
      failed: true,
    })
    expect(describeOutcome("conflict").track).toBeNull()
    // Amber: a person approves next (DIRECTION §6.3 #8).
    expect(describeOutcome("awaiting_approval").tone).toBe("attention")
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
  it("shows each outcome's word and 'On Google' only for a confirmed step", () => {
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
    expect(within(list).getAllByText("On Google")).toHaveLength(1)
  })
})

describe("OperationReceiptNotice", () => {
  const receipt = (outcome: OperationOutcome): MutationReceipt => ({
    id: "op-1",
    intentId: "11111111-1111-4111-8111-111111111111",
    surface: "local_post",
    action: "create",
    locationId: "loc-1",
    targetType: "local_post",
    targetRef: "p1",
    outcome,
    errorCode: null,
    attemptId: "a1",
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("shows the fallback until the receipt is read, never as live", async () => {
    vi.spyOn(mutationsApi, "fetchMutationReceipt").mockReturnValue(
      new Promise(() => {})
    )
    renderWithProviders(<OperationReceiptNotice receiptId="op-1" />)
    const notice = screen.getByRole("status")
    expect(notice).toHaveAttribute("data-outcome", "uncertain")
    expect(notice).toHaveTextContent("We can’t tell whether Google applied it")
    expect(notice).toHaveTextContent("checking again automatically")
    expect(notice).not.toHaveTextContent("On Google")
  })

  it.each(["awaiting_confirmation", "uncertain", "sent"] as const)(
    "says %s without claiming it is live",
    async (outcome) => {
      vi.spyOn(mutationsApi, "fetchMutationReceipt").mockResolvedValue(
        receipt(outcome)
      )
      renderWithProviders(<OperationReceiptNotice receiptId="op-1" />)
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveAttribute(
          "data-outcome",
          outcome
        )
      )
      expect(screen.getByRole("status")).toHaveTextContent(
        describeOutcome(outcome).title
      )
      expect(screen.queryByText(/^On Google$|Confirmed on Google/)).toBeNull()
    }
  )

  it("moves on by itself when a polled receipt settles, and reports it once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchReceipt = vi
      .spyOn(mutationsApi, "fetchMutationReceipt")
      .mockResolvedValueOnce(receipt("uncertain"))
      .mockResolvedValue(receipt("confirmed_applied"))
    const onSettled = vi.fn()
    renderWithProviders(
      <OperationReceiptNotice receiptId="op-1" onSettled={onSettled} />
    )
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-outcome",
        "uncertain"
      )
    )
    await vi.advanceTimersByTimeAsync(RECEIPT_POLL_DELAYS_MS[0])
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-outcome",
        "confirmed_applied"
      )
    )
    expect(screen.getByRole("status")).toHaveTextContent("Confirmed on Google")
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith("confirmed_applied")
    // Settled: no more asking.
    const calls = fetchReceipt.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchReceipt.mock.calls.length).toBe(calls)
  })

  it("backs off and stops asking after the poll limit", () => {
    expect(receiptPollDelay(0)).toBe(RECEIPT_POLL_DELAYS_MS[0])
    expect(receiptPollDelay(99 % RECEIPT_POLL_LIMIT)).toBe(
      RECEIPT_POLL_DELAYS_MS.at(-1)
    )
    expect(receiptPollDelay(RECEIPT_POLL_LIMIT)).toBe(false)
  })

  it("follows only failures that leave the outcome open", () => {
    const intentId = "11111111-1111-4111-8111-111111111111"
    expect(
      unconfirmedReceiptId(
        new ApiClientError(502, "google_mutation_ambiguous", "x", undefined, {
          intentId,
        })
      )
    ).toBe(intentId)
    expect(
      unconfirmedReceiptId(
        new ApiClientError(400, "INVALID_ARGUMENT", "x", undefined, {
          intentId,
        })
      )
    ).toBeNull()
    expect(
      unconfirmedReceiptId(
        new ApiClientError(502, "google_mutation_ambiguous", "x")
      )
    ).toBeNull()
  })
})

describe("status vocabulary (DIRECTION §6.1)", () => {
  const STATES = Object.keys(OUTCOME_PRESENTATION) as PresentedState[]

  it("says On Google only for confirmed_applied, green only there, never published", () => {
    for (const state of STATES) {
      const { label, title, tone, track } = describeOutcome(state)
      expect(`${label} ${title}`).not.toMatch(/published|\blive\b/i)
      const live = state === "confirmed_applied"
      expect(tone === "healthy").toBe(live)
      expect(label === "On Google").toBe(live)
      expect(Boolean(track?.reached)).toBe(live)
    }
    expect(describeOutcome("confirmed_applied").title).toBe(
      "Confirmed on Google"
    )
  })

  it("gives each tone family its own glyph shapes, so state never relies on hue", () => {
    const owners = new Map<string, string>()
    for (const state of STATES) {
      const { tone, glyph } = describeOutcome(state)
      expect(owners.get(glyph) ?? tone).toBe(tone)
      owners.set(glyph, tone)
    }
  })

  it("fills the long forms' slots, and drops them gracefully", () => {
    const unsaved = describeOutcome("unsaved").title
    expect(statusText(unsaved, { n: 2 })).toBe("2 unsaved changes")
    expect(statusText(unsaved, { n: 1 })).toBe("1 unsaved change")
    expect(statusText(unsaved)).toBe("Unsaved changes")
    const retrying = describeOutcome("retrying").label
    expect(statusText(retrying, { time: "10:42" })).toBe("Will retry at 10:42")
    expect(statusText(retrying)).toBe("Will retry later")
    const changes = describeOutcome("changes").title
    expect(statusText(changes, { name: "Priya" })).toBe("Sent back by Priya")
    expect(statusText(changes)).toBe("Sent back")
  })
})
