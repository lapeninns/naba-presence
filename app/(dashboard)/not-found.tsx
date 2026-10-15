import { BoundaryFrame } from "@/components/app-shell/boundary"
import { NotFoundContent } from "@/components/app-shell/not-found-content"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation, and a list of where
 * they can go instead. The page itself is NotFoundContent.
 */
export default function DashboardNotFound() {
  return (
    <BoundaryFrame>
      <NotFoundContent />
    </BoundaryFrame>
  )
}
