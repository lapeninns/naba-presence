// Registry of every concept frame. name -> { title, width, height, build() }.
import { inbox } from "./c-inbox.mjs"
import { listing } from "./c-listing.mjs"
import { report } from "./c-report.mjs"
import { shell } from "./c-shell.mjs"
import { team } from "./c-team.mjs"

export const CONCEPTS = { ...inbox, ...listing, ...report, ...team, ...shell }
