"use client"

import { Component, type ReactNode } from "react"

import { isLoadFailure } from "@/components/inbox/lazy-dialog-boundary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type Props = {
  children: ReactNode
  /**
   * Back to the list. Below lg the review has replaced the list, so a pane
   * that failed must still offer the way out; from lg the list is beside it
   * and the button is not drawn.
   */
  onBack?: () => void
  /**
   * When the pane's code would not download. It loads through
   * `next/dynamic`, and React keeps a rejected load for the life of that lazy
   * component, so a fresh one is made at once: "Try again" and the next
   * review picked both ask for the code afresh.
   */
  onLoadFailure?: () => void
}
type State = { error: Error | null }

class DetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: unknown) {
    if (isLoadFailure(error)) this.props.onLoadFailure?.()
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      const { onBack } = this.props
      return (
        <div className="px-(--np-page-pad-x) py-(--np-card-pad) md:px-7">
          <Alert variant="destructive">
            <AlertTitle>This review could not be shown.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>
                The rest of your inbox is unaffected. Try again, or pick another
                review.
              </span>
              <span className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={this.reset}>
                  Try again
                </Button>
                {onBack ? (
                  <Button
                    variant="ghost"
                    onClick={onBack}
                    className="lg:hidden"
                  >
                    Back to Inbox
                  </Button>
                ) : null}
              </span>
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    return this.props.children
  }
}

export { DetailErrorBoundary }
