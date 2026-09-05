import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The seven type roles are font sizes, not colours. Without this, tailwind-merge
// files `text-caption` under text-colour and drops a `text-primary-foreground`
// that sits beside it, so a small button silently loses its label colour.
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
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
