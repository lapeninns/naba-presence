"use client"

import { Component, type ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type Props = { children: ReactNode }
type State = { error: Error | null }

class DetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>This review could not be shown.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>
                The rest of your inbox is unaffected. Try again, or pick another
                review.
              </span>
              <Button variant="outline" size="sm" onClick={this.reset}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    return this.props.children
  }
}

export { DetailErrorBoundary }
