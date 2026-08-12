import "server-only"

import {
  googleFoodMenusGetRequest,
  googleFoodMenusPatchRequest,
} from "@/lib/domain/google-contract"
import { googleRequest } from "./transport"

export function getGoogleFoodMenus(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleFoodMenusGetRequest(name)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleFoodMenus(
  accessToken: string,
  input: { name: string; menus: Array<Record<string, unknown>> },
  options: { connectionKey?: string } = {}
) {
  const request = googleFoodMenusPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}
