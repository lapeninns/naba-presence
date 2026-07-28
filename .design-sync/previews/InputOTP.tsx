import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "NabaReview"

const SLOTS = [0, 1, 2, 3, 4, 5]

export function ConnectCode() {
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <span className="text-sm text-muted-foreground">
        Enter the 6-digit code Google sent to confirm the Lapen Inn Central
        profile connection.
      </span>
      <InputOTP maxLength={6} defaultValue="482915">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
    </div>
  )
}

export function SingleGroup() {
  return (
    <InputOTP maxLength={6} defaultValue="740193">
      <InputOTPGroup>
        {SLOTS.map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}

export function PartiallyEntered() {
  return (
    <InputOTP maxLength={6} defaultValue="48">
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}

export function Invalid() {
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <InputOTP maxLength={6} defaultValue="119203">
        <InputOTPGroup>
          {SLOTS.map((index) => (
            <InputOTPSlot key={index} index={index} aria-invalid />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <span className="text-xs text-destructive">
        That code has expired. Request a new one from Google Business Profile.
      </span>
    </div>
  )
}

export function Disabled() {
  return (
    <InputOTP maxLength={6} defaultValue="482915" disabled>
      <InputOTPGroup>
        {SLOTS.map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}
