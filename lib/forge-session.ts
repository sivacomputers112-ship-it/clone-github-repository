export const FORGE_SESSION_KEY = 'forge.v1'
export const FORGE_CONSOLE_KEY = 'forge.console.v1'

export type ForgeSession = {
  code: string
  phoneSecret: string
  expiresAt?: string
  deviceId?: string
  hostname?: string
  daemonOnline?: boolean
}

export type ConsolePrefs = {
  provider?: string
  cwd?: string
  sessionId?: string
}

export function readForgeSession(): ForgeSession | null {
  try {
    const raw = localStorage.getItem(FORGE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ForgeSession
    if (!parsed?.code || !parsed.phoneSecret) return null
    return parsed
  } catch {
    return null
  }
}

export function writeForgeSession(session: ForgeSession) {
  localStorage.setItem(FORGE_SESSION_KEY, JSON.stringify(session))
}

export function clearForgeSession() {
  localStorage.removeItem(FORGE_SESSION_KEY)
}

export function readConsolePrefs(): ConsolePrefs {
  try {
    return JSON.parse(localStorage.getItem(FORGE_CONSOLE_KEY) || '{}') as ConsolePrefs
  } catch {
    return {}
  }
}

export function writeConsolePrefs(prefs: ConsolePrefs) {
  localStorage.setItem(FORGE_CONSOLE_KEY, JSON.stringify(prefs))
}
