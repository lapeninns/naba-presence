"use client"

import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/**
 * Content warnings the server asked the person to acknowledge (409
 * `content_warning_acknowledgement_required`, read with
 * `contentWarningFromError` in lib/api/content-warnings.ts), drawn the same
 * way in every editor: a warning alert listing the messages, then the
 * acknowledgement and what to do next. The checkbox sits outside the
 * alert's polite live region, so ticking it is not read out as news and the
 * warnings are announced once, when they appear.
 *
 * `action` is the verb of the button that sends again ("save", "publish",
 * "preview", "approve"), so the next step reads as the button does.
 */
export function ContentWarnings({
  messages,
  checked,
  onCheckedChange,
  action = "save",
  label = "I have reviewed these content warnings.",
  className,
  ref,
}: {
  messages: readonly string[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  action?: string
  /** The acknowledgement's words; defaults to the general one. */
  label?: string
  className?: string
  /** Focus target: the block takes focus where an editor moves it here. */
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-slot="content-warnings"
      className={cn("flex flex-col gap-2 outline-none", className)}
    >
      <Alert variant="warning">
        <AlertTitle>Check these content warnings</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        label={label}
        description={`Tick this, then ${action} again.`}
      />
    </div>
  )
}
