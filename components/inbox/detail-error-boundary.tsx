"use client"

import { Component, type ReactNode } from "react"

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
}
type State = { error: Error | null }

class DetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      const { onBack } = this.props
      return (
        <div className="p-(--np-card-pad)">
          <Alert variant="destructive">
            <AlertTitle>This review could not be shown.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>
                The rest of your inbox is unaffected. Try again, or pick another
                review.
              </span>
              <span className="flex flex-wrap gap-2">
                <Button variant="secondary" pill onClick={this.reset}>
                  Try again
                </Button>
                {onBack ? (
                  <Button
                    variant="ghost"
                    pill
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
