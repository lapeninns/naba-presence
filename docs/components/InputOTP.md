---
category: Forms
---

One-time-code entry split into per-character slots.

Set `maxLength` to the code length; render `InputOTPSlot` per character inside `InputOTPGroup`, with `InputOTPSeparator` between groups.

## Parts

Composed inside `<InputOTP>`, each importable from `window.NabaPresence.*`:

- `InputOTPGroup`
- `InputOTPSeparator`
- `InputOTPSlot`
