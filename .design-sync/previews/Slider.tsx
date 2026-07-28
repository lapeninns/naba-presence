import { Label, Slider } from "NabaReview"

export function AutoReplyThreshold() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="threshold">Auto-reply at or above</Label>
        <span className="font-mono text-sm text-foreground">4 stars</span>
      </div>
      <Slider id="threshold" defaultValue={[4]} min={1} max={5} step={1} />
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>1</span>
        <span>5</span>
      </div>
    </div>
  )
}

export function RangeValues() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="age">Review age window</Label>
        <span className="font-mono text-sm text-foreground">7–45 days</span>
      </div>
      <Slider id="age" defaultValue={[7, 45]} min={0} max={90} />
      <p className="text-sm text-muted-foreground">
        Only reviews inside this window enter the Riverside reply queue.
      </p>
    </div>
  )
}

export function SteppedValue() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="delay">Draft delay before publish</Label>
        <span className="font-mono text-sm text-foreground">45 min</span>
      </div>
      <Slider id="delay" defaultValue={[45]} min={0} max={120} step={15} />
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>0</span>
        <span>30</span>
        <span>60</span>
        <span>90</span>
        <span>120</span>
      </div>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="sample">Sentiment sample size</Label>
        <span className="font-mono text-sm text-muted-foreground">128</span>
      </div>
      <Slider id="sample" defaultValue={[128]} min={0} max={200} disabled />
      <p className="text-sm text-muted-foreground">
        Locked while the Airport backfill is still running.
      </p>
    </div>
  )
}
