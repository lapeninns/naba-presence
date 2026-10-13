import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The eight type roles are font sizes, not colours. Without this, tailwind-merge
// files `text-caption` under text-colour and drops a `text-primary-foreground`
// that sits beside it, so a small button silently loses its label colour.
//
// The stacking (`z-overlay`) and safe-area (`pb-safe`, `pb-dock`) utilities are
// project names tailwind-merge cannot know; registering them lets a caller's
// `z-popover` replace a primitive's `z-overlay`, and `pb-dock` replace `pb-4`,
// instead of both landing in the class list.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "caption",
            "ui",
            "body",
            "title",
            "section",
            "page-title",
            "display",
            "reading",
          ],
        },
      ],
      z: [
        {
          z: [
            "raised",
            "sticky",
            "chrome",
            "scrim",
            "overlay",
            "popover",
            "toast",
            "tooltip",
            "skip-link",
          ],
        },
      ],
      pt: [{ pt: ["safe"] }],
      pb: [{ pb: ["safe", "dock"] }],
      pl: [{ pl: ["safe"] }],
      pr: [{ pr: ["safe"] }],
      px: [{ px: ["safe"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
