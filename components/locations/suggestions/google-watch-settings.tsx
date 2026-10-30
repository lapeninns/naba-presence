"use client"

import { useState } from "react"

import { RefreshCwIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { SettingsGroup } from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import type {
  GoogleWatchAlertMode,
  GoogleWatchPerson,
  GoogleWatchSettings as Settings,
} from "@/lib/contracts/google-change-watch"
import {
  WATCHED_FIELDS,
  WATCHED_FIELD_LABELS,
  type WatchedField,
} from "@/lib/domain/google-change-watch-vocabulary"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  useGoogleWatchSettings,
  useSaveGoogleWatchSettings,
} from "@/lib/queries/use-google-change-watch"

/**
 * Which fields of this listing are protected on Google and who hears when
 * Google changes one. Owners and admins choose; everyone else sees what is
 * watched and who is alerted. One card, saved with its own button (the
 * settings save contract, components/settings/policy-form.tsx).
 */

const ALERT_MODES: Array<{
  mode: GoogleWatchAlertMode
  label: string
  description: string
}> = [
  {
    mode: "managers",
    label: "Owners and admins",
    description: "The people who can put ours back or keep Google’s.",
  },
  {
    mode: "everyone",
    label: "Everyone who can see this listing",
    description: "Including members who can’t decide on a change.",
  },
  {
    mode: "chosen",
    label: "Chosen people",
    description: "Only the people you pick below.",
  },
]

type Draft = {
  protectedFields: WatchedField[]
  alertMode: GoogleWatchAlertMode
  recipientIds: string[]
}

function draftOf(settings: Settings): Draft {
  return {
    protectedFields: settings.protectedFields,
    alertMode: settings.alertMode,
    recipientIds: settings.recipientIds,
  }
}

function sameDraft(left: Draft, right: Draft) {
  const key = (draft: Draft) =>
    JSON.stringify([
      [...draft.protectedFields].sort(),
      draft.alertMode,
      draft.alertMode === "chosen" ? [...draft.recipientIds].sort() : [],
    ])
  return key(left) === key(right)
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item)
    ? list.filter((entry) => entry !== item)
    : [...list, item]
}

function canDecide(person: GoogleWatchPerson) {
  return person.role === "owner" || person.role === "admin"
}

export function GoogleWatchSettings({ locationId }: { locationId: string }) {
  const toasts = useToastManager()
  const query = useGoogleWatchSettings(locationId)
  const save = useSaveGoogleWatchSettings(locationId)
  // Unsaved edits only; with none, the form shows what is saved, so a save
  // or a refetch is the new starting point without copying it into state.
  const [edits, setDraft] = useState<Draft | null>(null)
  const saved = query.data ? draftOf(query.data.settings) : null
  const draft = edits ?? saved

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="destructive">
          <AlertTitle>We couldn’t load what’s watched on Google</AlertTitle>
          <AlertDescription>
            {describeActionError(query.error)}
          </AlertDescription>
        </Alert>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon aria-hidden />
          Try again
        </Button>
      </div>
    )
  }
  if (query.isPending || !draft || !saved) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <p role="status" className="sr-only">
          Loading what’s watched on Google…
        </p>
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  const { canManage, people } = query.data
  const chosenPeople = people.filter((person) =>
    draft.recipientIds.includes(person.userId)
  )
  const noDecider =
    draft.alertMode === "chosen" &&
    chosenPeople.length > 0 &&
    !chosenPeople.some(canDecide)
  const changed = !sameDraft(draft, saved)
  const invalid =
    draft.alertMode === "chosen" && draft.recipientIds.length === 0

  if (!canManage) {
    const fields = saved.protectedFields.map(
      (field) => WATCHED_FIELD_LABELS[field]
    )
    const audience =
      saved.alertMode === "chosen"
        ? people.map((person) => person.name).join(", ") || "Chosen people"
        : ALERT_MODES.find((entry) => entry.mode === saved.alertMode)?.label
    return (
      <SettingsGroup
        headingAs="h2"
        headingId="google-watch-heading"
        label="What’s watched on Google"
        caption="Owners and admins choose what’s watched and who is alerted."
        card
        bodyAs="div"
        className="mt-0"
      >
        <dl className="flex flex-col gap-2 py-3 text-ui desk:px-(--np-card-pad)">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">Watched</dt>
            <dd className="text-ink">
              {fields.length ? fields.join(", ") : "Nothing is watched"}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">Alerts go to</dt>
            <dd className="text-ink">{audience}</dd>
          </div>
        </dl>
      </SettingsGroup>
    )
  }

  const submit = () =>
    save.mutate(
      {
        protectedFields: draft.protectedFields,
        alertMode: draft.alertMode,
        recipientIds: draft.alertMode === "chosen" ? draft.recipientIds : [],
      },
      {
        onSuccess: () => {
          setDraft(null)
          toasts.add({ title: "Watch settings saved", type: "success" })
        },
      }
    )

  return (
    <SettingsGroup
      headingAs="h2"
      headingId="google-watch-heading"
      label="What’s watched on Google"
      caption="Choose the fields to protect and who hears when Google changes one. Nothing is ever put back automatically."
      card
      bodyAs="div"
      className="mt-0"
    >
      <div className="flex flex-col gap-5 py-3 desk:px-(--np-card-pad)">
        <div className="flex flex-col gap-1">
          <p
            id="google-watch-fields"
            className="text-ui font-semibold text-ink"
          >
            Protected fields
          </p>
          <OptionRowGroup type="multiple" aria-labelledby="google-watch-fields">
            {WATCHED_FIELDS.map((field) => (
              <OptionRow
                key={field}
                indicator="checkbox"
                selected={draft.protectedFields.includes(field)}
                label={WATCHED_FIELD_LABELS[field]}
                onClick={() =>
                  setDraft({
                    ...draft,
                    protectedFields: toggle(draft.protectedFields, field),
                  })
                }
              />
            ))}
          </OptionRowGroup>
          {draft.protectedFields.length === 0 ? (
            <p className="text-caption text-ink-muted">
              Nothing is watched. Google can change this listing without anyone
              hearing about it here.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <p
            id="google-watch-audience"
            className="text-ui font-semibold text-ink"
          >
            Who is alerted
          </p>
          <OptionRowGroup aria-labelledby="google-watch-audience">
            {ALERT_MODES.map((entry) => (
              <OptionRow
                key={entry.mode}
                indicator="radio"
                selected={draft.alertMode === entry.mode}
                label={entry.label}
                description={entry.description}
                onClick={() => setDraft({ ...draft, alertMode: entry.mode })}
              />
            ))}
          </OptionRowGroup>
          <p className="text-caption text-ink-muted">
            Each person’s own notification settings still decide whether they
            get an email.
          </p>
        </div>

        {draft.alertMode === "chosen" ? (
          <div className="flex flex-col gap-1">
            <p
              id="google-watch-people"
              className="text-ui font-semibold text-ink"
            >
              People to alert
            </p>
            {people.length === 0 ? (
              <p className="text-ui text-ink-muted">
                Nobody else can see this listing yet.
              </p>
            ) : (
              <OptionRowGroup
                type="multiple"
                aria-labelledby="google-watch-people"
              >
                {people.map((person) => (
                  <OptionRow
                    key={person.userId}
                    indicator="checkbox"
                    selected={draft.recipientIds.includes(person.userId)}
                    label={person.name}
                    description={
                      canDecide(person)
                        ? "Owner or admin"
                        : "Can’t decide on changes"
                    }
                    onClick={() =>
                      setDraft({
                        ...draft,
                        recipientIds: toggle(draft.recipientIds, person.userId),
                      })
                    }
                  />
                ))}
              </OptionRowGroup>
            )}
            {invalid ? (
              <p className="text-caption text-ink-muted">
                Choose at least one person.
              </p>
            ) : null}
            {noDecider ? (
              <p className="text-caption text-ink-muted">
                None of the people chosen can put ours back or keep Google’s.
                Include an owner or admin.
              </p>
            ) : null}
          </div>
        ) : null}

        {save.isError ? (
          <p role="alert" className="text-ui text-danger-ink">
            Your watch settings weren’t saved. {describeActionError(save.error)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={submit}
            disabled={!changed}
            disabledReason={
              invalid
                ? "Choose at least one person to alert."
                : !changed
                  ? "Nothing has changed."
                  : undefined
            }
            pending={save.isPending}
            pendingLabel="Saving…"
          >
            Save watch settings
          </Button>
          {changed ? (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Undo changes
            </Button>
          ) : null}
        </div>
      </div>
    </SettingsGroup>
  )
}
