"use client"

import { useCallback, useEffect, useState, useTransition } from "react"

import {
  loadSettings,
  type OrganisationSettings,
  saveSettings,
} from "@/lib/naba-presence-api"

export type SettingsStatus = "loading" | "ready" | "error"

function normaliseSettings(
  settings: OrganisationSettings
): OrganisationSettings {
  return {
    ...settings,
    directPublishConsent:
      settings.directPublishConsent ?? Boolean(settings.directPublishConsentAt),
  }
}

export function useOrganisationSettings() {
  const [settings, setSettings] = useState<OrganisationSettings | null>(null)
  const [status, setStatus] = useState<SettingsStatus>("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    let active = true
    void loadSettings()
      .then(({ settings: loaded }) => {
        if (!active) return
        setSettings(normaliseSettings(loaded))
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setSettings(null)
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }, [])

  const save = useCallback(async () => {
    if (!settings) return
    await new Promise<void>((resolve, reject) => {
      startSaving(async () => {
        try {
          await saveSettings({
            ...settings,
            directPublishConsent: Boolean(settings.directPublishConsent),
          })
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  }, [settings])

  return { settings, setSettings, status, save, isSaving, reload }
}
