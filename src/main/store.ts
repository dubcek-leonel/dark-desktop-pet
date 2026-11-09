import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { DEFAULT_CONFIG, normalizeConfig, type Config, type ProviderId } from '../core/config'
import type { Reminder } from '../core/reminders'

const file = (name: string): string => join(app.getPath('userData'), name)

function readJson(name: string): unknown {
  try {
    const p = file(name)
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined
  } catch {
    return undefined
  }
}

function writeJson(name: string, data: unknown): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(name), JSON.stringify(data, null, 2), 'utf8')
}

export function loadConfig(): Config {
  const raw = readJson('config.json')
  return raw === undefined ? { ...DEFAULT_CONFIG } : normalizeConfig(raw)
}

export function saveConfig(c: Config): void {
  writeJson('config.json', normalizeConfig(c))
}

// ---- Memoria (cosas que Dark sabe del usuario) ----

export function loadMemories(): string[] {
  const raw = readJson('memoria.json') as { facts?: unknown } | undefined
  return Array.isArray(raw?.facts) ? raw.facts.filter((f): f is string => typeof f === 'string') : []
}

export function saveMemories(facts: string[]): void {
  writeJson('memoria.json', { facts })
}

// ---- Recordatorios ----

export function loadReminders(): Reminder[] {
  const raw = readJson('recordatorios.json')
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is Reminder =>
      !!r && typeof r.id === 'string' && typeof r.text === 'string' && typeof r.at === 'number'
  )
}

export function saveReminders(list: Reminder[]): void {
  writeJson('recordatorios.json', list)
}

// ---- API keys: cifradas con el usuario de Windows (DPAPI vía safeStorage) ----

type Secrets = Partial<Record<ProviderId, string>>

function readSecrets(): Secrets {
  const raw = readJson('secrets.json')
  return raw && typeof raw === 'object' ? (raw as Secrets) : {}
}

export function getApiKey(provider: ProviderId): string {
  const enc = readSecrets()[provider]
  if (!enc || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

export function hasApiKey(provider: ProviderId): boolean {
  return getApiKey(provider) !== ''
}

export function setApiKey(provider: ProviderId, key: string | null): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado del sistema no está disponible')
  const s = readSecrets()
  if (key) s[provider] = safeStorage.encryptString(key.trim()).toString('base64')
  else delete s[provider]
  writeJson('secrets.json', s)
}
