"use client"

import { EyeIcon } from "lucide-react"
import * as React from "react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type QuickLookFact = {
  label: string
  value: React.ReactNode
}

type QuickLookLink = {
  label: string
  href: string
}

type QuickLookProps = {
  /** What is being looked at ("Old Crown Group"): names the button and the panel. */
  subject: string
  /** The one line under the title (a health word, an address). */
  description?: React.ReactNode
  /** Label and value pairs, read top to bottom. */
  facts: readonly QuickLookFact[]
  /** Where to go for more, the primary first; they sit in the panel's footer. */
  links: readonly QuickLookLink[]
  /** Extra content between the facts and the footer. */
  children?: React.ReactNode
  className?: string
}

/**
 * The desk's quick look: a row's key facts in a side panel, so an operator
 * scanning a long list can check one client or listing without leaving it
 * and losing their place (their filters, search and scroll stay put).
 *
 * The trigger is an icon button for a table cell, in a column that only a
 * desk-width table draws (a phone row is already one tap to the record).
 * It sits above a row's stretched link and keeps its clicks and the panel's
 * own clicks from reaching the row, so neither opening nor using
 * the panel navigates away. Escape or the close button dismisses it and
 * focus returns to the button.
 *
 *   <QuickLook
 *     subject="Old Crown Group"
 *     description="In sync"
 *     facts={[{ label: "Listings", value: "3 of 3 linked" }]}
 *     links={[{ label: "Open client", href: "/clients/c1" }]}
 *   />
 */
function QuickLook({
  subject,
  description,
  facts,
  links,
  children,
  className,
}: QuickLookProps) {
  const [open, setOpen] = React.useState(false)
  // React bubbles a portal's events to its parent component, which here is a
  // table row that navigates on click: stop them at this wrapper.
  const contain = (event: React.SyntheticEvent) => event.stopPropagation()
  return (
    <span
      data-slot="quick-look"
      className={cn("relative z-raised inline-flex", className)}
      onClick={contain}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Quick look: ${subject}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <EyeIcon aria-hidden strokeWidth={1.75} />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{subject}</SheetTitle>
            {description ? (
              <SheetDescription>{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">
                A quick look at {subject}
              </SheetDescription>
            )}
          </SheetHeader>
          <SheetBody>
            <dl className="flex flex-col divide-y divide-line-subtle">
              {facts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex flex-col gap-0.5 py-2.5 first:pt-0"
                >
                  <dt className="text-caption font-medium text-ink-muted">
                    {fact.label}
                  </dt>
                  <dd className="min-w-0 text-ui break-words text-ink">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            {children}
          </SheetBody>
          {links.length > 0 ? (
            <SheetFooter>
              {/* Listed with the primary first, drawn last (nearest the corner). */}
              {links
                .map((link, index) => (
                  <ShellLink
                    key={link.href}
                    href={link.href}
                    className={buttonVariants({
                      variant: index === 0 ? "default" : "secondary",
                    })}
                  >
                    {link.label}
                  </ShellLink>
                ))
                .reverse()}
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </span>
  )
}

export { QuickLook }
export type { QuickLookFact, QuickLookLink, QuickLookProps }
