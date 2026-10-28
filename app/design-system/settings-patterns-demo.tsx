"use client"

import {
  Building2Icon,
  RefreshCwIcon,
  SendIcon,
  ShieldIcon,
  ShieldCheckIcon,
} from "lucide-react"
import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import {
  SettingsDestructiveAction,
  SettingsGroup,
  SettingsRow,
} from "@/components/ui/settings-row"
import { StatusPill } from "@/components/ui/status-pill"

// Gate reasons copied verbatim from lib/settings/gating.ts (memberRowGate),
// so the specimen says exactly what Team's member sheet says.
const LAST_OWNER_ROLE_REASON =
  "Make someone else an owner before changing the last owner’s role."
const SELF_REMOVE_REASON = "You can’t remove your own access."
// The invite sheet's Can publish hint for an owner or admin.
const ALWAYS_PUBLISH_REASON = "Owners and admins can always publish."

const noop = () => {}

/** A pattern's label inside the block: one level under its h3. */
function PatternTitle({ id, children }: { id: string; children: string }) {
  return (
    <h4 id={id} className="scroll-mt-4 text-caption font-medium text-ink-muted">
      {children}
    </h4>
  )
}

/** The outcome specimen: success words only after the (simulated) server confirms. */
function ConfirmedOutcomeDemo() {
  const [state, setState] = React.useState<"idle" | "pending" | "confirmed">(
    "idle"
  )
  const timer = React.useRef<number | null>(null)
  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="secondary"
        pending={state === "pending"}
        pendingLabel="Saving…"
        onClick={() => {
          setState("pending")
          // Stands in for the request: no fetch on this page. In a screen,
          // the message is set in the mutation's onSuccess (after a 2xx).
          timer.current = window.setTimeout(() => setState("confirmed"), 1200)
        }}
      >
        Save preferences
      </Button>
      {state === "confirmed" ? (
        <Alert variant="success" className="max-w-md">
          <AlertTitle>Preferences saved</AlertTitle>
          <AlertDescription>
            The server confirmed the change. It applies from your next visit.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/**
 * Settings patterns used across the settings area: the row variants, a
 * status summary, a "Needs attention" list, a server-confirmed outcome and a
 * locked switch. A demo only: no-op handlers and no API calls. Renders no
 * h2 (the page's six sections are pinned), so a pattern added here later
 * keeps one "Settings" chip in the on-page index.
 */
function SettingsPatternsDemo() {
  return (
    <section
      id="ds-settings"
      aria-labelledby="ds-settings-title"
      className="flex min-w-0 scroll-mt-4 flex-col gap-6"
      data-slot="settings-patterns-demo"
    >
      <div className="flex flex-col gap-3">
        <h3
          id="ds-settings-title"
          className="text-section font-semibold text-ink"
        >
          Settings patterns
        </h3>
        <p className="max-w-(--np-measure-reading) text-ui text-ink-secondary">
          One row per setting. A row you can change is a link, a button, a
          switch or a field. A row you can’t change shows its value and says why
          underneath, in words, never only a dimmed control. A page ends with at
          most one destructive text action. Removing something always asks
          first; only a Google disconnect asks you to type the login.
        </p>
        <p className="max-w-(--np-measure-reading) text-caption text-ink-muted">
          <code>SettingsGroup</code>, <code>SettingsRow</code> and{" "}
          <code>SettingsDestructiveAction</code> from
          components/ui/settings-row; <code>StatusPill</code>,{" "}
          <code>Alert</code> and <code>ListRow</code> for summaries. Switch
          rows, “Turn all on” and a Save footer:{" "}
          <a
            href="#demo-notifications-heading"
            className="text-accent-ink underline underline-offset-3 focus-halo"
          >
            Notifications per event
          </a>
          .
        </p>
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <PatternTitle id="ds-settings-rows">
          Rows: one you can’t change, a link, and a removal you can’t make
        </PatternTitle>
        <SettingsGroup>
          <SettingsRow
            icon={<ShieldIcon />}
            label="Role"
            value="Owner"
            disabled
            onClick={noop}
            footnote={LAST_OWNER_ROLE_REASON}
            footnoteProps={{ role: "note" }}
          />
          <SettingsRow
            icon={<Building2Icon />}
            label="Location access"
            value="3 of 5"
            href="#ds-settings-rows"
          />
        </SettingsGroup>
        <SettingsDestructiveAction
          disabled
          onClick={noop}
          footnote={SELF_REMOVE_REASON}
          footnoteProps={{ role: "note" }}
        >
          Remove from team…
        </SettingsDestructiveAction>
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <PatternTitle id="ds-settings-locked-switch">
          A switch that is on and can’t be changed
        </PatternTitle>
        <SettingsGroup>
          <SettingsRow
            icon={<SendIcon />}
            label="Can publish"
            checked
            disabled
            onCheckedChange={noop}
            footnote={ALWAYS_PUBLISH_REASON}
            footnoteProps={{ role: "note" }}
          />
        </SettingsGroup>
        <p className="text-caption text-ink-muted">
          Show the value the role really gives (on for owners and admins), not
          the form’s own default, and keep the reason beside it.
        </p>
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <PatternTitle id="ds-settings-status">
          Status: a pill and a plain sentence
        </PatternTitle>
        <ul className="flex flex-col gap-3">
          <li className="flex items-start gap-3">
            <ShieldCheckIcon
              aria-hidden="true"
              className="mt-0.5 size-4.5 shrink-0 text-ink-secondary"
            />
            <span className="flex min-w-0 flex-col items-start gap-1">
              <StatusPill tone="healthy">On</StatusPill>
              <span className="text-body text-ink">
                With one authenticator app. Add a backup in case you lose that
                device.
              </span>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <ShieldIcon
              aria-hidden="true"
              className="mt-0.5 size-4.5 shrink-0 text-ink-secondary"
            />
            <span className="flex min-w-0 flex-col items-start gap-1">
              <StatusPill tone="neutral" dashed>
                Off
              </StatusPill>
              <span className="text-body text-ink">
                Signing in needs only your password.
              </span>
            </span>
          </li>
        </ul>
        <p className="text-caption text-ink-muted">
          The word says the state; the sentence says what it means for you.
          Colour is never the only signal.
        </p>
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <PatternTitle id="ds-settings-attention">
          Needs attention: a summary, then where to go
        </PatternTitle>
        <Alert variant="warning" live={false}>
          <AlertTitle>Some work needs attention</AlertTitle>
          <AlertDescription>
            Background jobs are running. Two kinds of work failed and are listed
            below.
          </AlertDescription>
        </Alert>
        <p
          id="ds-settings-attention-list"
          className="text-caption font-medium text-ink-muted"
        >
          Needs attention
        </p>
        <ListRows aria-labelledby="ds-settings-attention-list">
          <ListRow
            flush
            emphasis="neutral"
            leading={<RefreshCwIcon aria-hidden="true" />}
            title="Syncs that failed"
            meta="2"
            href="#ds-settings-attention"
          />
          <ListRow
            flush
            emphasis="neutral"
            leading={<SendIcon aria-hidden="true" />}
            title="Failed emails you can retry"
            meta="1"
            href="#ds-settings-attention"
          />
        </ListRows>
        <p className="text-caption text-ink-muted">
          Only rows with a count above zero appear. When nothing needs
          attention, the list is not drawn and the summary is the answer.
        </p>
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <PatternTitle id="ds-settings-outcome">
          An outcome shown only after the server confirms
        </PatternTitle>
        <ConfirmedOutcomeDemo />
        <p className="text-caption text-ink-muted">
          While the request runs, the button says what it is doing. Toasts and
          success messages go in the mutation’s onSuccess only, after the server
          answers; never in onMutate or before the request. The message is a
          polite status (<code>role=&quot;status&quot;</code>), so it is
          announced without interrupting.
        </p>
      </div>
    </section>
  )
}

export { SettingsPatternsDemo }
