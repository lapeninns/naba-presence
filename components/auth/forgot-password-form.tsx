"use client"

import { Mail } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react"

import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { WRAPPING_BLOCK_BUTTON } from "@/components/auth/wrapping-button"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import * as authApi from "@/lib/api/auth"
import {
  authErrorMessage,
  fieldErrorsFrom,
  type AuthMessage,
} from "@/lib/api/auth-errors"
import { clearResetEmail, peekResetEmail } from "@/lib/api/reset-email"

// Fields are rendered by `name` (Field's id comes from an internal useId
// the parent never sees), so a name-based query is the reliable way to
// move focus to an invalid input - same approach as sign-in-form.tsx.
function focusField(name: string) {
  document.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
}

// The outcome of "Send another link". A failure is an error and says what
// to do next; a success stays polite.
type ResendNote = { tone: "sent" | "failed"; text: string }

// zod is ~20 KB gz the page would otherwise download before it can render
// (same as sign-in-form.tsx). It loads on the first focus inside the form
// and a submit awaits it.
const loadAuthSchemas = () => import("@/lib/domain/auth")

// The handed-over address never changes while the page is open.
const subscribeNever = () => () => {}

/**
 * Starts with what the visitor had already typed on the sign-in form (handed
 * over in session storage, never the URL), so "Forgot password?" is not a
 * second chance to mistype it.
 */
function ForgotPasswordForm() {
  // null until the visitor types; until then the field shows the address
  // handed over from sign-in, read after hydration (storage doesn't exist on
  // the server, whose snapshot is "").
  const [typed, setEmail] = useState<string | null>(null)
  const handedOver = useSyncExternalStore(
    subscribeNever,
    peekResetEmail,
    () => ""
  )
  const email = typed ?? handedOver
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<AuthMessage | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [resendNote, setResendNote] = useState<ResendNote | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const sentHeadingRef = useRef<HTMLHeadingElement>(null)
  // Set by "Use a different email", so the form that comes back puts the
  // visitor in the field, ready to correct the address.
  const returnToForm = useRef(false)

  // role="alert" is already an assertive live region, so this is a belt and
  // braces enhancement: move keyboard/screen-reader focus to the banner
  // whenever a server error lands with no field to blame it on. The alert
  // only mounts once `message` is set, so this has to happen post-commit.
  // Same idiom as sign-in-form.tsx.
  useEffect(() => {
    if (message && Object.keys(fieldErrors).length === 0) {
      alertRef.current?.focus()
    }
  }, [message, fieldErrors])

  // Either stage change unmounts the focused button, which would drop focus
  // to the body. Land it on the new stage's heading, or back in the field
  // with the address selected.
  useEffect(() => {
    if (sentTo) {
      sentHeadingRef.current?.focus()
    } else if (returnToForm.current) {
      returnToForm.current = false
      const field = document.querySelector<HTMLInputElement>('[name="email"]')
      field?.focus()
      field?.select()
    }
  }, [sentTo])

  const validating = useRef(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || validating.current) return
    validating.current = true
    void loadAuthSchemas()
      .then((schemas) => submitWith(schemas))
      .finally(() => {
        validating.current = false
      })
  }

  function submitWith({
    resetRequestSchema,
  }: Awaited<ReturnType<typeof loadAuthSchemas>>) {
    const parsed = resetRequestSchema.safeParse({ email })
    if (!parsed.success) {
      // No invented fallback copy - zod always supplies a message for every
      // issue it raises, so `message` is only ever absent in theory. Mirrors
      // zodFieldErrors in sign-in-form.tsx, which applies the same rule.
      const message = parsed.error.issues[0]?.message
      setFieldErrors(message ? { email: message } : {})
      focusField("email")
      return
    }
    setFieldErrors({})
    // A banner from an earlier attempt must not sit above this one.
    setMessage(null)
    startTransition(async () => {
      try {
        await authApi.requestPasswordReset(parsed.data.email)
        // Kept as typed, so "Use a different email" brings it back for a
        // one-letter fix even though the handed-over copy is cleared below.
        setEmail(email)
        setSentTo(parsed.data.email)
        clearResetEmail()
      } catch (error) {
        const errors = fieldErrorsFrom(error)
        setFieldErrors(errors)
        setMessage(authErrorMessage(error, "forgot-password"))
        if (errors.email) focusField("email")
      }
    })
  }

  function resend(address: string) {
    // Cleared first, so a second identical result is still a change a
    // screen reader announces.
    setResendNote(null)
    startTransition(async () => {
      try {
        await authApi.requestPasswordReset(address)
        // Neutral on purpose: never confirms whether the address has an
        // account.
        setResendNote({
          tone: "sent",
          text: `Another link is on its way to ${address} if it has an account.`,
        })
      } catch (error) {
        const { title, description } = authErrorMessage(
          error,
          "forgot-password"
        )
        setResendNote({
          tone: "failed",
          text: description ? `${title} ${description}` : title,
        })
      }
    })
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span
            aria-hidden
            className="mb-1 grid size-11 place-items-center rounded-lg bg-accent-tint text-accent-ink"
          >
            <Mail className="size-5" strokeWidth={1.75} />
          </span>
          <h2
            ref={sentHeadingRef}
            tabIndex={-1}
            className="text-section font-semibold text-ink outline-none"
          >
            Check your email
          </h2>
          {/* Neutral on purpose: the server answers every address the same
              way, so "we sent" would confirm the account exists. */}
          <p role="status" className="text-body text-ink-muted">
            If{" "}
            <span className="font-semibold [overflow-wrap:anywhere] text-ink">
              {sentTo}
            </span>{" "}
            has an account, a reset link is on its way. Open it to choose a new
            password.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-lg bg-surface-alt p-4">
          <p className="text-ui text-ink">
            Not there after a few minutes? Check spam or promotions, then send
            another link. Only the newest link works.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              block
              className={WRAPPING_BLOCK_BUTTON}
              pending={pending}
              pendingLabel="Sending…"
              onClick={() => resend(sentTo)}
            >
              Send another link
            </Button>
            <span aria-live="polite" className="text-caption text-ink-muted">
              {resendNote?.tone === "sent" ? resendNote.text : null}
            </span>
            {resendNote?.tone === "failed" ? (
              <span role="alert" className="text-caption text-danger-ink">
                {resendNote.text}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          block
          className={WRAPPING_BLOCK_BUTTON}
          onClick={() => {
            returnToForm.current = true
            setSentTo(null)
            setResendNote(null)
            setMessage(null)
          }}
        >
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      onFocusCapture={() => void loadAuthSchemas()}
      noValidate
      className="flex flex-col gap-5"
    >
      {message ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <AuthErrorAlert message={message} email={email} />
        </div>
      ) : null}

      <Field error={fieldErrors.email}>
        <FieldLabel>Email address</FieldLabel>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <FieldDescription>The address you sign in with.</FieldDescription>
        <FieldError />
      </Field>

      <Button
        type="submit"
        size="lg"
        block
        pending={pending}
        pendingLabel="Sending…"
      >
        Send reset link
      </Button>
    </form>
  )
}

export { ForgotPasswordForm }
