// The composer validates against the very schema the route parses with, so the
// two cannot drift. The form-side names are kept for the existing importers.
export {
  localPostInputSchema as localPostFormSchema,
  type LocalPostInput as LocalPostFormValues,
} from "@/lib/contracts/location-posts"
