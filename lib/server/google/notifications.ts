import "server-only"

import {
  googleNotificationSettingRequest,
  type GoogleNotificationType,
} from "@/lib/domain/google-contract"
import { googleRequest } from "./transport"

export function getGoogleNotificationSetting(
  accessToken: string,
  accountName: string,
  options: { connectionKey?: string } = {}
) {
  return googleRequest<{
    name: string
    pubsubTopic?: string
    notificationTypes?: string[]
  }>(
    `https://mybusinessnotifications.googleapis.com/v1/${accountName}/notificationSetting`,
    accessToken,
    {},
    options
  )
}

export function updateGoogleNotificationSetting(
  accessToken: string,
  accountName: string,
  pubsubTopic: string,
  notificationTypes: readonly GoogleNotificationType[],
  options: { connectionKey?: string } = {}
) {
  const request = googleNotificationSettingRequest(
    accountName,
    pubsubTopic,
    notificationTypes
  )
  return googleRequest<{
    name: string
    pubsubTopic?: string
    notificationTypes?: string[]
  }>(request.url, accessToken, request.init, {
    connectionKey: options.connectionKey,
    mode: "mutation",
  })
}
